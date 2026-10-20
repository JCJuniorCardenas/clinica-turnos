// Provider-agnostic contracts. The bot talks only to these interfaces, so WhatsApp (Baileys -> Meta Cloud)
// and the LLM (Gemini -> Groq or anything else) can be swapped without touching the conversation logic.

export interface IncomingMessage {
  /** Reply address as the transport knows it (e.g. a WhatsApp JID). Always answer to this. */
  from: string;
  /** Phone number in international format ("+549...") used to identify the person. */
  phone: string;
  /** Text content; undefined for audio, images, stickers, etc. */
  text?: string;
  id?: string;
}

export interface WhatsAppStatus {
  estado: "desconectado" | "esperando_qr" | "conectado";
  /** Raw QR payload to scan from WhatsApp > Linked devices; only while waiting for the scan. */
  qr?: string;
  /** Human-readable problem detected while sending (e.g. an expired token), shown in the panel. */
  problema?: string;
}

export interface WhatsAppProvider {
  /** Which transport this is, so the panel can show the right instructions. */
  readonly kind?: "meta" | "baileys" | "console";
  onMessage(handler: (msg: IncomingMessage) => Promise<void>): void;
  sendText(to: string, text: string): Promise<void>;
  /** Shows the "typing..." indicator to the person. Optional. */
  setTyping?(to: string): Promise<void>;
  /** Connection state for the panel (and the QR to link a number). Optional. */
  status?(): WhatsAppStatus;
  /** Connects to the transport. Optional so test doubles can skip it. */
  start?(): Promise<void>;
  stop?(): Promise<void>;
}

export interface ToolDefinition {
  name: string;
  description: string;
  /** JSON-schema-like object describing the arguments. */
  parameters: Record<string, unknown>;
}

export interface ToolCall {
  id: string;
  name: string;
  args: Record<string, unknown>;
  /** Opaque provider data that must be replayed untouched on the next request (e.g. thought signatures). */
  raw?: unknown;
}

export type ChatMessage =
  | { role: "user"; text: string }
  | { role: "assistant"; text?: string; toolCalls?: ToolCall[] }
  | { role: "tool"; toolCallId: string; name: string; result: unknown };

export interface LlmResponse {
  text?: string;
  toolCalls: ToolCall[];
}

export interface LlmProvider {
  chat(input: { system: string; messages: ChatMessage[]; tools: ToolDefinition[] }): Promise<LlmResponse>;
}

export const WHATSAPP_PROVIDER = Symbol("WHATSAPP_PROVIDER");
export const LLM_PROVIDER = Symbol("LLM_PROVIDER");

/** The provider is temporarily over its quota. Transient: the bot asks the person to retry instead of handing off. */
export class LlmRateLimitError extends Error {
  constructor(message = "LLM rate limit") {
    super(message);
    this.name = "LlmRateLimitError";
  }
}

/** A provider could not answer right now (rate limit, timeout, overload, malformed tool call). Another one may. */
export class LlmUnavailableError extends Error {
  constructor(
    public reason: string,
    /** Seconds the failing model should rest before being tried again (0 = a one-off failure). */
    public restSeconds = 0,
  ) {
    super(`LLM unavailable: ${reason}`);
    this.name = "LlmUnavailableError";
  }
}
