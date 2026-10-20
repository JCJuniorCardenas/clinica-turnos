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
        // Calls that did not come from Gemini (e.g. Groq) have no signature: bypass the validation for them.
        parts.push((tc.raw as GeminiPart) ?? { functionCall: { name: tc.name, args: tc.args }, thoughtSignature: SKIP_SIGNATURE });
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
  constructor(
    public seconds: number,
    public reason: "cupo" | "timeout" | "no existe" = "cupo",
  ) {
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
  /** How much the model "thinks" before answering. Low keeps chat replies fast ("" or "none" disables the setting). */
  private readonly thinkingLevel = (process.env.GEMINI_THINKING_LEVEL ?? "low").trim().toLowerCase();
  /** Per-attempt timeout: a slow model is skipped instead of making the patient wait for a failure. */
  private readonly timeoutMs = Number(process.env.GEMINI_TIMEOUT_MS ?? 20_000);
  /** Models that rejected the thinking setting; they are called without it from then on. */
  private readonly withoutThinking = new Set<string>();

  private generationConfig(model: string) {
    const useThinking = this.thinkingLevel && this.thinkingLevel !== "none" && !this.withoutThinking.has(model);
    // maxOutputTokens also counts the thinking tokens, so leave room for the actual answer.
    return {
      temperature: 0.3,
      maxOutputTokens: 2048,
      ...(useThinking ? { thinkingConfig: { thinkingLevel: this.thinkingLevel } } : {}),
    };
  }

  async chat(input: { system: string; messages: ChatMessage[]; tools: ToolDefinition[] }): Promise<LlmResponse> {
    if (!this.apiKey) throw new Error("GEMINI_API_KEY is not set");
    const contents = toGeminiContents(input.messages);
    const base = {
      systemInstruction: { parts: [{ text: input.system }] },
      tools: [{ functionDeclarations: input.tools.map((t) => ({ name: t.name, description: t.description, parameters: t.parameters })) }],
      toolConfig: { functionCallingConfig: { mode: "AUTO" } },
    };

    const now = Date.now();
    const candidates = this.models.filter((m) => (this.blockedUntil.get(m) ?? 0) <= now);
    for (const model of candidates) {
      const switched = this.lastModel !== undefined && this.lastModel !== model;
      try {
        const data = await this.post(model, (m) => ({
          ...base,
          generationConfig: this.generationConfig(m),
          contents: switched ? withSkippedSignatures(contents) : contents,
        }));
        this.lastModel = model;
        return this.parse(data);
      } catch (e) {
        if (!(e instanceof ModelExhausted)) throw e;
        this.blockedUntil.set(model, Date.now() + e.seconds * 1000);
        console.warn(`[gemini] ${model} no disponible por ${Math.max(1, Math.round(e.seconds / 60))} min (${e.reason}); probando el siguiente modelo`);
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

  private async post(model: string, buildBody: (model: string) => unknown, attempt = 1): Promise<any> {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;
    let res: Response;
    try {
      res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-goog-api-key": this.apiKey },
        body: JSON.stringify(buildBody(model)),
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (e) {
      // Too slow (or the network dropped): give this model a rest for two minutes and let the next one answer.
      const name = (e as Error)?.name;
      if (name === "TimeoutError" || name === "AbortError") throw new ModelExhausted(120, "timeout");
      throw e;
    }
    if (res.ok) return res.json();

    // Never log the request: it can contain patient data.
    const errText = await res.text();
    if (res.status === 429) {
      const wait = retryDelaySeconds(errText) ?? 5;
      if (wait <= MAX_WAIT_SECONDS && attempt < 2) {
        await new Promise((r) => setTimeout(r, (wait + 1) * 1000));
        return this.post(model, buildBody, attempt + 1);
      }
      throw new ModelExhausted(Math.max(wait, 30), "cupo");
    }
    // A model that does not accept the thinking setting: remember it and call it again without.
    if (res.status === 400 && /thinking/i.test(errText) && !this.withoutThinking.has(model)) {
      this.withoutThinking.add(model);
      return this.post(model, buildBody, attempt);
    }
    // A model that was retired or is not available to this key: skip it for a while instead of failing every chat.
    if (res.status === 404) throw new ModelExhausted(3600, "no existe");
    if (res.status >= 500 && attempt < 3) {
      await new Promise((r) => setTimeout(r, 1000 * attempt));
      return this.post(model, buildBody, attempt + 1);
    }
    throw new Error(`Gemini error ${res.status} (${model}): ${errText.slice(0, 300)}`);
  }
}
