import { Injectable } from "@nestjs/common";
import { ChatMessage, LlmProvider, LlmRateLimitError, LlmResponse, ToolCall, ToolDefinition } from "../types";

const MAX_WAIT_SECONDS = 20;

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

interface GeminiPart {
  text?: string;
  thought?: boolean;
  functionCall?: { name: string; args?: Record<string, unknown>; id?: string };
  functionResponse?: { name: string; response: unknown };
  [k: string]: unknown;
}
interface GeminiContent {
  role: "user" | "model";
  parts: GeminiPart[];
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

@Injectable()
export class GeminiProvider implements LlmProvider {
  private readonly apiKey = process.env.GEMINI_API_KEY ?? "";
  private readonly model = process.env.GEMINI_MODEL ?? "gemini-3.8-flash";

  async chat(input: { system: string; messages: ChatMessage[]; tools: ToolDefinition[] }): Promise<LlmResponse> {
    if (!this.apiKey) throw new Error("GEMINI_API_KEY is not set");
    const body = {
      systemInstruction: { parts: [{ text: input.system }] },
      contents: toGeminiContents(input.messages),
      tools: [{ functionDeclarations: input.tools.map((t) => ({ name: t.name, description: t.description, parameters: t.parameters })) }],
      toolConfig: { functionCallingConfig: { mode: "AUTO" } },
      generationConfig: { temperature: 0.3, maxOutputTokens: 1024 },
    };

    const data = await this.post(body);
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

  private async post(body: unknown, attempt = 1): Promise<any> {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${this.model}:generateContent`;
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
      if (attempt < 2 && wait <= MAX_WAIT_SECONDS) {
        await new Promise((r) => setTimeout(r, (wait + 1) * 1000));
        return this.post(body, attempt + 1);
      }
      throw new LlmRateLimitError();
    }
    if (res.status >= 500 && attempt < 3) {
      await new Promise((r) => setTimeout(r, 1000 * attempt));
      return this.post(body, attempt + 1);
    }
    throw new Error(`Gemini error ${res.status}: ${errText.slice(0, 300)}`);
  }
}
