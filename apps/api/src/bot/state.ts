import type { ChatMessage } from "./types";

/** Stored as JSON in Conversacion.estado, one row per (clinic, phone). */
export interface ConvState {
  /** MENU: nothing in progress. EN_CURSO: a flow is running. DERIVADO_A_HUMANO: the bot stays silent. */
  estado: "MENU" | "EN_CURSO" | "DERIVADO_A_HUMANO";
  /** Counts messages received from the person; used to force a confirmation round trip before any write. */
  userTurn: number;
  /** Write action announced to the person and waiting for their explicit "sí". */
  pendiente?: { key: string; userTurn: number; call?: { name: string; args: Record<string, unknown> } };
  historial: ChatMessage[];
  ultimaActividad: string;
  derivacion?: { motivo: string; urgencia: boolean; en: string };
}

export const MAX_HISTORY = 30;

export function newState(): ConvState {
  return { estado: "MENU", userTurn: 0, historial: [], ultimaActividad: new Date().toISOString() };
}

/** Keeps the history bounded without cutting a tool exchange in half: always starts at a user message. */
export function trimHistory(historial: ChatMessage[]): ChatMessage[] {
  if (historial.length <= MAX_HISTORY) return historial;
  const tail = historial.slice(-MAX_HISTORY);
  const firstUser = tail.findIndex((m) => m.role === "user");
  return firstUser === -1 ? [] : tail.slice(firstUser);
}

export function parseState(raw: unknown): ConvState {
  if (!raw || typeof raw !== "object") return newState();
  const s = raw as Partial<ConvState>;
  return {
    estado: s.estado ?? "MENU",
    userTurn: s.userTurn ?? 0,
    pendiente: s.pendiente,
    historial: Array.isArray(s.historial) ? s.historial : [],
    ultimaActividad: s.ultimaActividad ?? new Date().toISOString(),
    derivacion: s.derivacion,
  };
}
