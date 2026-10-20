// Deterministic helpers around the "confirm before writing" step. The model must never be the only thing between
// a patient's "sí" and a database write, nor the only judge of whether something was really done.

function normalize(text: string): string {
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
