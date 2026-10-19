// Safety net that does not depend on the LLM: obvious emergency phrases get the fixed urgency text and a handoff.
// It is deliberately conservative; the model also flags urgencies through derivar_a_recepcion(urgencia=true).

const PATTERNS: RegExp[] = [
  /dolor (de|en el) pecho/,
  /me duele el pecho/,
  /(no puedo|cuesta|dificultad para) respirar/,
  /me ahogo/,
  /(se )?desmay(o|ó|e|ado|ada)/,
  /perdi(o|ó) el conocimiento/,
  /convulsi(on|ón|ones)/,
  /sangrado (abundante|fuerte|importante)|sangra mucho|hemorragia/,
  /ataque (al coraz(o|ó)n|cardiaco|cardíaco)/,
  /\bacv\b|derrame cerebral/,
  /intoxicaci(o|ó)n|envenen/,
  /quiero (morirme|matarme)|me quiero (morir|matar)/,
];

function normalize(text: string): string {
  return text.toLowerCase().normalize("NFC");
}

export function looksLikeUrgency(text: string): boolean {
  const t = normalize(text);
  return PATTERNS.some((p) => p.test(t));
}
