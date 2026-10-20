import { claimsDone, isAffirmative, isNegative } from "./confirmation";

describe("isAffirmative", () => {
  it.each(["si", "Sí", "sii", "SI!", "sí, confirmo", "si por favor", "dale", "Dale, agendalo", "ok", "listo", "de una", "perfecto", "confirmo", "si dale gracias"])(
    "accepts %s",
    (t) => expect(isAffirmative(t)).toBe(true),
  );
  it.each([
    "no",
    "sí pero mejor otro día",
    "si, pero cambiame el horario",
    "dale, aunque no estoy seguro de la hora",
    "no sé",
    "sí, quiero el de las 10 y además otro turno para mi hija mañana",
    "",
    "hola",
    "quiero un turno",
  ])("rejects %j", (t) => expect(isAffirmative(t)).toBe(false));
});

describe("isNegative", () => {
  it.each(["no", "No gracias", "nop", "cancelar", "mejor no", "no quiero"])("accepts %s", (t) => expect(isNegative(t)).toBe(true));
  it.each(["si", "no sé qué día me queda bien, decime los horarios del jueves", "quiero un turno"])("rejects %j", (t) => expect(isNegative(t)).toBe(false));
});

describe("claimsDone", () => {
  it.each([
    "¡Listo! El turno para Julio con la Dra. Ibarra quedó confirmado para hoy martes 20/10 a las 12:00.",
    "Tu turno está confirmado para el jueves.",
    "El turno fue cancelado.",
    "Ya quedó agendado, te esperamos.",
    "Tu turno ha sido reprogramado.",
    "Agendé tu turno para el lunes.",
  ])("detects a claim: %s", (t) => expect(claimsDone(t)).toBe(true));

  it.each([
    "¿Te confirmo el turno?",
    "Acá tenés el resumen del turno: ¿lo agendo?",
    "Para confirmar necesito tu DNI.",
    "Todavía NO quedó agendado nada.",
    "¿Querés que quede confirmado para el jueves?",
    "Tenemos horarios libres el martes.",
  ])("does not flag a question or a plan: %s", (t) => expect(claimsDone(t)).toBe(false));
});
