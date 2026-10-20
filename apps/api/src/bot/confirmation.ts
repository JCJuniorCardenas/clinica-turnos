// Deterministic helpers around the "confirm before writing" step. The model must never be the only thing between
// a patient's "sí" and a database write, nor the only judge of whether something was really done.

export function normalize(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "") // strip accents
    .replace(/[^a-z0-9ñ\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const AFFIRM_START = /^(si+|sip|sep|dale|ok(ey|a)?|oka|confirmo|confirmado|confirmala|confirmalo|listo|perfecto|correcto|exacto|claro|adelante|de una|bueno|agendalo|agendala|reservalo|reservala|hacelo|hacela|obvio|por supuesto|afirmativo)\b/;
// Anything that changes or doubts the plan is NOT a plain yes.
const NOT_PLAIN_YES = /\b(no|nunca|pero|cambi\w*|otro|otra|otros|otras|mejor|espera\w*|aguanta|duda|todavia|antes|distint\w*|corrig\w*|equivoc\w*)\b/;

/** A short, plain "yes": "si", "sí por favor", "dale", "si, confirmo". Longer or hedged messages go to the model. */
export function isAffirmative(text: string): boolean {
  const t = normalize(text);
  if (!t || t.split(" ").length > 6) return false;
  if (NOT_PLAIN_YES.test(t)) return false;
  return AFFIRM_START.test(t);
}

/** A short, plain "no". */
export function isNegative(text: string): boolean {
  const t = normalize(text);
  if (!t || t.split(" ").length > 6) return false;
  return /^(no|nop|nel|cancelar|cancela|mejor no|no gracias|no quiero|olvidalo|dejalo)\b/.test(t);
}

/**
 * Does the last thing the assistant said to the patient (the summary they just read and answered "sí" to) really
 * contain every key detail of the action about to run? Only then is that "sí" a valid confirmation of THAT action.
 * Each check is a plain token such as "16:00", a DNI or a doctor's surname; dots, accents and case are ignored.
 */
export function summaryMatches(lastAssistantText: string | undefined, checks: string[]): boolean {
  if (!lastAssistantText || !/[?¿]/.test(lastAssistantText)) return false; // it must have asked something
  const haystack = normalize(lastAssistantText).replace(/\s+/g, "");
  return checks.length > 0 && checks.every((c) => haystack.includes(normalize(c).replace(/\s+/g, "")));
}

/** The confirmation message for a write that really happened, built from the tool's own result (no model involved). */
export function formatWriteConfirmation(tool: string, r: Record<string, any>): string | null {
  const cuando = (s: { dia: string; fecha: string; hora: string }) => `${s.dia} ${s.fecha} a las ${s.hora}`;
  const cierre = "\n\n¿Te puedo ayudar con algo más?";
  if (tool === "crear_turno") {
    return `¡Listo! Quedó confirmado el turno de ${r.paciente} con ${r.doctor}${r.especialidad ? ` (${r.especialidad})` : ""} el ${cuando(r as never)}.${cierre}`;
  }
  if (tool === "cancelar_turno" && r.cancelado) {
    return `Listo, cancelé el turno de ${r.cancelado.paciente} con ${r.cancelado.doctor} del ${cuando(r.cancelado)}. El horario quedó libre.${cierre}`;
  }
  if (tool === "reprogramar_turno" && r.antes && r.ahora) {
    return `Listo, cambié el turno de ${r.paciente} con ${r.doctor}: pasó del ${cuando(r.antes)} al ${cuando(r.ahora)}.${cierre}`;
  }
  return null;
}

const CLAIMS_DONE =
  /(qued[oó]|quedaron|est[aá]|fue|ha sido|ya (est[aá]|qued[oó]))[^.\n]{0,60}(confirmad|agendad|cancelad|reprogramad|registrad|reservad)|(agend|cancel|reprogram|registr|reserv)(e|é|amos|ado|ada) (tu|el|su|la) (turno|cita)/i;

/** True when the reply states that a booking/cancellation/change is already done. */
export function claimsDone(reply: string): boolean {
  const text = reply.normalize("NFC");
  const m = CLAIMS_DONE.exec(text);
  if (!m) return false;
  // "Todavía NO quedó agendado nada" is the opposite of a claim: look at the words right before the match.
  const before = normalize(text.slice(Math.max(0, m.index - 30), m.index + 12));
  return !/\b(no|nunca|todavia|aun|ni)\b/.test(before);
}
