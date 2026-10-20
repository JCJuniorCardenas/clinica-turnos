import { ChatMessage, LlmProvider, LlmRateLimitError, LlmResponse, LlmUnavailableError, ToolDefinition } from "../types";

const REST_SECONDS = 60;

/**
 * Tries several providers in order (e.g. Groq first, Gemini as backup). A provider that is over quota, slow or
 * failing rests for a minute so the next messages go straight to the one that works. The conversation history is
 * provider-neutral, so switching in the middle of a chat is invisible to the patient.
 */
export class FallbackLlm implements LlmProvider {
  private readonly restingUntil = new Map<LlmProvider, number>();

  constructor(
    private readonly providers: { name: string; provider: LlmProvider }[],
    private readonly restSeconds = REST_SECONDS,
  ) {
    if (providers.length === 0) throw new Error("FallbackLlm needs at least one provider");
  }

  async chat(input: { system: string; messages: ChatMessage[]; tools: ToolDefinition[] }): Promise<LlmResponse> {
    const now = Date.now();
    const available = this.providers.filter((p) => (this.restingUntil.get(p.provider) ?? 0) <= now);
    // If everything is resting, try them all anyway rather than refusing to answer.
    const queue = available.length > 0 ? available : this.providers;

    let hardError: unknown;
    for (const { name, provider } of queue) {
      try {
        return await provider.chat(input);
      } catch (e) {
        const soft = e instanceof LlmRateLimitError || e instanceof LlmUnavailableError;
        if (!soft) hardError ??= e;
        this.restingUntil.set(provider, Date.now() + this.restSeconds * 1000);
        console.warn(`[llm] ${name} falló (${soft ? (e as Error).message : "error"}); probando el siguiente proveedor`);
      }
    }
    // Soft failures end as the friendly "busy" message; a real bug is surfaced so it gets logged and handed off.
    throw hardError ?? new LlmRateLimitError();
  }
}
