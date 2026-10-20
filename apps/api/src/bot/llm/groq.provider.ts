import { Injectable } from "@nestjs/common";
import { ChatMessage, LlmProvider, LlmResponse, LlmUnavailableError, ToolCall, ToolDefinition } from "../types";

// Groq serves open models (Llama, GPT-OSS...) with very low latency and a free tier. Its API is OpenAI-compatible
// (chat completions + tools), so the mapping below is the same one any OpenAI-style provider would need.

const BASE_URL = "https://api.groq.com/openai/v1/chat/completions";
const MODELS_URL = "https://api.groq.com/openai/v1/models";
/** Not chat models (speech, safety classifiers, embeddings...). */
const EXCLUDED_MODELS = /whisper|guard|safeguard|tts|playai|orpheus|embed|moderation|transcri/i;
/** Preference order when discovering models: strong tool users first. */
const PREFERRED_MODELS = [/gpt-oss-120b/i, /llama-?4.*maverick/i, /llama-?3\.3.*70b/i, /kimi/i, /qwen/i, /gpt-oss-20b/i, /llama-?4.*scout/i, /llama-?3\.1.*8b/i];
const MAX_WAIT_SECONDS = 8;

interface OpenAiToolCall {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
}
type OpenAiMessage =
  | { role: "system" | "user"; content: string }
  | { role: "assistant"; content: string | null; tool_calls?: OpenAiToolCall[] }
  | { role: "tool"; tool_call_id: string; content: string };

/** Maps our neutral chat history to OpenAI-style messages. Provider-specific `raw` data (Gemini signatures) is dropped. */
export function toOpenAiMessages(system: string, messages: ChatMessage[]): OpenAiMessage[] {
  const out: OpenAiMessage[] = [{ role: "system", content: system }];
  for (const m of messages) {
    if (m.role === "user") {
      out.push({ role: "user", content: m.text });
    } else if (m.role === "assistant") {
      out.push({
        role: "assistant",
        content: m.text ?? null,
        ...(m.toolCalls?.length
          ? { tool_calls: m.toolCalls.map((tc) => ({ id: tc.id, type: "function" as const, function: { name: tc.name, arguments: JSON.stringify(tc.args ?? {}) } })) }
          : {}),
      });
    } else {
      out.push({ role: "tool", tool_call_id: m.toolCallId, content: JSON.stringify(m.result ?? null) });
    }
  }
  return out;
}

function parseArgs(raw: string | undefined): Record<string, unknown> {
  try {
    const v = JSON.parse(raw || "{}");
    return v && typeof v === "object" && !Array.isArray(v) ? v : {};
  } catch {
    return {};
  }
}

/**
 * Groq over its REST API. GROQ_MODEL may list several models separated by commas (tried in order). Any
 * recoverable failure (rate limit, timeout, overload, malformed tool call) raises LlmUnavailableError so the
 * caller can move on to the next provider.
 */
@Injectable()
export class GroqProvider implements LlmProvider {
  private readonly apiKey = process.env.GROQ_API_KEY ?? "";
  private models = (process.env.GROQ_MODEL ?? "llama-3.3-70b-versatile").split(",").map((m) => m.trim()).filter(Boolean);
  private readonly timeoutMs = Number(process.env.GROQ_TIMEOUT_MS ?? 10_000);
  private readonly blockedUntil = new Map<string, number>();
  private discovered = false;

  /**
   * Model names on Groq change often. When none of the configured models exists, ask Groq what it currently offers
   * and pick the best chat models (good at tool use first). The list is logged once so GROQ_MODEL can be set explicitly.
   */
  private async discoverModels(): Promise<string[]> {
    this.discovered = true;
    try {
      const res = await fetch(MODELS_URL, { headers: { Authorization: `Bearer ${this.apiKey}` }, signal: AbortSignal.timeout(8000) });
      if (!res.ok) return [];
      const ids: string[] = ((await res.json())?.data ?? []).map((m: { id: string }) => m.id);
      const chat = ids.filter((id) => !EXCLUDED_MODELS.test(id));
      console.log(`[groq] modelos disponibles: ${chat.join(", ")}`);
      const ranked: string[] = [];
      for (const pattern of PREFERRED_MODELS) for (const id of chat) if (pattern.test(id) && !ranked.includes(id)) ranked.push(id);
      return ranked.slice(0, 3);
    } catch {
      return [];
    }
  }

  async chat(input: { system: string; messages: ChatMessage[]; tools: ToolDefinition[] }): Promise<LlmResponse> {
    if (!this.apiKey) throw new Error("GROQ_API_KEY is not set");
    const body = (model: string) => ({
      model,
      messages: toOpenAiMessages(input.system, input.messages),
      tools: input.tools.map((t) => ({ type: "function", function: { name: t.name, description: t.description, parameters: t.parameters } })),
      tool_choice: "auto",
      temperature: 0.3,
      max_tokens: 1024,
    });

    let last: LlmUnavailableError | undefined;
    for (let pass = 0; pass < 2; pass++) {
      const now = Date.now();
      const candidates = this.models.filter((m) => (this.blockedUntil.get(m) ?? 0) <= now);
      let missing = 0;
      for (const model of candidates) {
        try {
          return this.parse(await this.post(body(model)));
        } catch (e) {
          if (!(e instanceof LlmUnavailableError)) throw e;
          last = e;
          if (e.reason === "modelo no existe") missing++;
          // A model that is rate limited or slow rests for a while; a malformed tool call is a one-off.
          if (e.restSeconds > 0) this.blockedUntil.set(model, Date.now() + e.restSeconds * 1000);
          console.warn(`[groq] ${model} no disponible (${e.reason}); probando el siguiente`);
        }
      }
      // Every configured model is gone (or was already known to be): find out what Groq offers today, once.
      const allGone = candidates.length === 0 ? this.models.every((m) => (this.blockedUntil.get(m) ?? 0) > now) : missing === candidates.length;
      if (pass === 0 && allGone && !this.discovered) {
        const found = await this.discoverModels();
        if (found.length > 0) {
          console.log(`[groq] usando modelos descubiertos: ${found.join(", ")}`);
          this.models = found;
          continue;
        }
      }
      break;
    }
    throw last ?? new LlmUnavailableError("sin modelos disponibles", 0);
  }

  private parse(data: any): LlmResponse {
    const msg = data?.choices?.[0]?.message;
    const toolCalls: ToolCall[] = (msg?.tool_calls ?? []).map((tc: OpenAiToolCall, i: number) => ({
      id: tc.id || `call_${Date.now()}_${i}`,
      name: tc.function?.name,
      args: parseArgs(tc.function?.arguments),
    }));
    const text = typeof msg?.content === "string" ? msg.content.trim() : "";
    return { text: text || undefined, toolCalls };
  }

  private async post(body: unknown, attempt = 1): Promise<any> {
    let res: Response;
    try {
      res = await fetch(BASE_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${this.apiKey}` },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (e) {
      const name = (e as Error)?.name;
      if (name === "TimeoutError" || name === "AbortError") throw new LlmUnavailableError("timeout", 60);
      throw new LlmUnavailableError(`red: ${(e as Error)?.message}`, 30);
    }
    if (res.ok) return res.json();

    // Never log the request: it can contain patient data.
    const errText = await res.text();
    if (res.status === 429) {
      const wait = Number(res.headers.get("retry-after")) || 5;
      if (wait <= MAX_WAIT_SECONDS && attempt < 2) {
        await new Promise((r) => setTimeout(r, (wait + 0.5) * 1000));
        return this.post(body, attempt + 1);
      }
      throw new LlmUnavailableError("cupo", Math.max(wait, 30));
    }
    // Llama-style models sometimes produce a malformed tool call: Groq answers 400 tool_use_failed. Try another model/provider.
    if (res.status === 400 && /tool_use_failed|failed_generation/i.test(errText)) throw new LlmUnavailableError("tool_use_failed", 0);
    if (res.status === 404 || (res.status === 400 && /model/i.test(errText) && /not found|decommissioned|does not exist/i.test(errText))) {
      throw new LlmUnavailableError("modelo no existe", 3600);
    }
    if (res.status >= 500) throw new LlmUnavailableError(`error ${res.status}`, 30);
    throw new Error(`Groq error ${res.status}: ${errText.slice(0, 300)}`);
  }
}
