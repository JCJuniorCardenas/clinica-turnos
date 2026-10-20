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

import { formatWriteConfirmation, summaryMatches } from "./confirmation";

describe("summaryMatches", () => {
  const resumen = "Acá tenés el resumen: Paciente Gimena, DNI 45.941.284, Dra. Valeria Acosta, martes 20/10 a las 16:00. ¿Confirmás?";
  it("accepts a question that contains every key detail (dots, accents and case ignored)", () => {
    expect(summaryMatches(resumen, ["16:00", "45941284", "Acosta"])).toBe(true);
  });
  it("rejects when any detail differs, when nothing was asked, or when there is nothing to check", () => {
    expect(summaryMatches(resumen, ["17:00", "45941284", "Acosta"])).toBe(false);
    expect(summaryMatches(resumen, ["16:00", "45941285", "Acosta"])).toBe(false);
    expect(summaryMatches(resumen, ["16:00", "45941284", "Romero"])).toBe(false);
    expect(summaryMatches("Dra. Acosta a las 16:00 DNI 45941284.", ["16:00", "45941284", "Acosta"])).toBe(false);
    expect(summaryMatches(undefined, ["16:00"])).toBe(false);
    expect(summaryMatches(resumen, [])).toBe(false);
  });
});

describe("formatWriteConfirmation", () => {
  const slot = { dia: "martes", fecha: "20/10", hora: "16:00" };
  it("builds the message for each write from the tool result", () => {
    expect(formatWriteConfirmation("crear_turno", { ok: true, paciente: "Ana", doctor: "Dra. Acosta", especialidad: "Ginecología", ...slot })).toContain(
      "Quedó confirmado el turno de Ana con Dra. Acosta (Ginecología) el martes 20/10 a las 16:00",
    );
    expect(formatWriteConfirmation("cancelar_turno", { ok: true, cancelado: { paciente: "Ana", doctor: "Dra. Acosta", ...slot } })).toContain("cancelé el turno de Ana");
    expect(
      formatWriteConfirmation("reprogramar_turno", { ok: true, paciente: "Ana", doctor: "Dra. Acosta", antes: slot, ahora: { dia: "jueves", fecha: "22/10", hora: "10:00" } }),
    ).toContain("del martes 20/10 a las 16:00 al jueves 22/10 a las 10:00");
    expect(formatWriteConfirmation("listar_doctores", {})).toBeNull();
  });
});
