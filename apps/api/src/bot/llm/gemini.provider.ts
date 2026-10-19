import { Injectable } from "@nestjs/common";
import { ChatMessage, LlmProvider, LlmRateLimitError, LlmResponse, ToolCall, ToolDefinition } from "../types";

const MAX_WAIT_SECONDS = 20;
/** Documented by Google for histories that come from another model: skips thought-signature validation. */
const SKIP_SIGNATURE = "skip_thought_signature_validator";

interface GeminiPart {
  text?: string;
  thought?: boolean;
  thoughtSignature?: string;
  functionCall?: { name: string; args?: Record<string, unknown>; id?: string };
  functionResponse?: { name: string; response: unknown };
  [k: string]: unknown;
}
interface GeminiContent {
  role: "user" | "model";
  parts: GeminiPart[];
}

/** Google says how long to wait in error.details[].retryDelay ("23s"). */
function retryDelaySeconds(body: string): number | null {
  try {
    const details: { retryDelay?: string }[] = JSON.parse(body)?.error?.details ?? [];
    const raw = details.find((d) => d.retryDelay)?.retryDelay;
    return raw ? Math.ceil(parseFloat(raw)) : null;
  } catch {
    return null;
  }
}

/** Maps our neutral chat history to Gemini's "contents" format. Tool results are merged into one user turn. */
export function toGeminiContents(messages: ChatMessage[]): GeminiContent[] {
  const contents: GeminiContent[] = [];
  const push = (role: GeminiContent["role"], parts: GeminiPart[]) => {
    const last = contents[contents.length - 1];
    if (last && last.role === role && parts.every((p) => p.functionResponse) && last.parts.every((p) => p.functionResponse)) {
      last.parts.push(...parts);
    } else {
      contents.push({ role, parts });
    }
  };

  for (const m of messages) {
    if (m.role === "user") {
      push("user", [{ text: m.text }]);
    } else if (m.role === "assistant") {
      const parts: GeminiPart[] = [];
      if (m.text) parts.push({ text: m.text });
      for (const tc of m.toolCalls ?? []) {
        parts.push((tc.raw as GeminiPart) ?? { functionCall: { name: tc.name, args: tc.args } });
      }
      if (parts.length) push("model", parts);
    } else {
      push("user", [{ functionResponse: { name: m.name, response: { result: m.result } } }]);
    }
  }
  return contents;
}

/** Signatures are tied to the model that produced them; when another model continues the chat, bypass the check. */
export function withSkippedSignatures(contents: GeminiContent[]): GeminiContent[] {
  return contents.map((c) => ({
    ...c,
    parts: c.parts.map((p) => (p.functionCall ? { ...p, thoughtSignature: SKIP_SIGNATURE } : p)),
  }));
}

/** A model hit its quota (typically the free tier's daily cap); try the next one after `seconds`. */
class ModelExhausted extends Error {
  constructor(public seconds: number) {
    super("model exhausted");
  }
}

/**
 * Gemini over its REST API. GEMINI_MODEL may list several models separated by commas: free-tier quotas are per model,
 * so when one runs out for the day the next one takes over (in order), with no cost.
 */
@Injectable()
export class GeminiProvider implements LlmProvider {
  private readonly apiKey = process.env.GEMINI_API_KEY ?? "";
  private readonly models = (process.env.GEMINI_MODEL ?? "gemini-3.8-flash").split(",").map((m) => m.trim()).filter(Boolean);
  private readonly blockedUntil = new Map<string, number>();
  private lastModel?: string;

  async chat(input: { system: string; messages: ChatMessage[]; tools: ToolDefinition[] }): Promise<LlmResponse> {
    if (!this.apiKey) throw new Error("GEMINI_API_KEY is not set");
    const contents = toGeminiContents(input.messages);
    const base = {
      systemInstruction: { parts: [{ text: input.system }] },
      tools: [{ functionDeclarations: input.tools.map((t) => ({ name: t.name, description: t.description, parameters: t.parameters })) }],
      toolConfig: { functionCallingConfig: { mode: "AUTO" } },
      generationConfig: { temperature: 0.3, maxOutputTokens: 1024 },
    };

    const now = Date.now();
    const candidates = this.models.filter((m) => (this.blockedUntil.get(m) ?? 0) <= now);
    for (const model of candidates) {
      const switched = this.lastModel !== undefined && this.lastModel !== model;
      try {
        const data = await this.post(model, { ...base, contents: switched ? withSkippedSignatures(contents) : contents });
        this.lastModel = model;
        return this.parse(data);
      } catch (e) {
        if (!(e instanceof ModelExhausted)) throw e;
        this.blockedUntil.set(model, Date.now() + e.seconds * 1000);
        console.warn(`[gemini] ${model} sin cupo por ${Math.round(e.seconds / 60)} min; probando el siguiente modelo`);
      }
    }
    throw new LlmRateLimitError();
  }

  private parse(data: any): LlmResponse {
    const parts: GeminiPart[] = data?.candidates?.[0]?.content?.parts ?? [];
    const toolCalls: ToolCall[] = [];
    let text = "";
    parts.forEach((p, i) => {
      if (p.functionCall) {
        toolCalls.push({
          id: p.functionCall.id ?? `call_${Date.now()}_${i}`,
          name: p.functionCall.name,
          args: p.functionCall.args ?? {},
          raw: p,
        });
      } else if (p.text && !p.thought) {
        text += p.text;
      }
    });
    return { text: text.trim() || undefined, toolCalls };
  }

  private async post(model: string, body: unknown, attempt = 1): Promise<any> {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": this.apiKey },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(30_000),
    });
    if (res.ok) return res.json();

    // Never log the request: it can contain patient data.
    const errText = await res.text();
    if (res.status === 429) {
      const wait = retryDelaySeconds(errText) ?? 5;
      if (wait <= MAX_WAIT_SECONDS && attempt < 2) {
        await new Promise((r) => setTimeout(r, (wait + 1) * 1000));
        return this.post(model, body, attempt + 1);
      }
      throw new ModelExhausted(Math.max(wait, 30));
    }
    // A model that was retired or is not available to this key: skip it for a while instead of failing every chat.
    if (res.status === 404) throw new ModelExhausted(3600);
    if (res.status >= 500 && attempt < 3) {
      await new Promise((r) => setTimeout(r, 1000 * attempt));
      return this.post(model, body, attempt + 1);
    }
    throw new Error(`Gemini error ${res.status} (${model}): ${errText.slice(0, 300)}`);
  }
}
