import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import request from "supertest";
import { PrismaService } from "../prisma/prisma.service";
import { TurnoEvents } from "../turnos/turno-events";
import type { TurnoEvent } from "../turnos/turno-events";
import { PASSWORD } from "../test-utils";
import { utcToLocal } from "../common/time";
import { DEFAULT_CONFIG } from "./config";
import { toGeminiContents, withSkippedSignatures } from "./llm/gemini.provider";
import { splitMessage } from "./bot.service";
import { newState } from "./state";
import { BotToolsService, normalizeDni, samePhone } from "./tools";
import type { ToolContext } from "./tools";
import type { ChatMessage, IncomingMessage, LlmProvider, LlmResponse, WhatsAppProvider } from "./types";
import { LLM_PROVIDER, LlmRateLimitError, WHATSAPP_PROVIDER } from "./types";
import { looksLikeUrgency } from "./urgency";

// ---------- fakes: no network, no WhatsApp, deterministic "model" ----------

class FakeWhatsApp implements WhatsAppProvider {
  sent: { to: string; text: string }[] = [];
  failNext = 0;
  typing: string[] = [];
  onMessage() {}
  async setTyping(to: string) {
    this.typing.push(to);
  }
  async sendText(to: string, text: string) {
    if (this.failNext > 0) {
      this.failNext--;
      throw new Error("network down");
    }
    this.sent.push({ to, text });
  }
  to(phone: string) {
    return this.sent.filter((m) => m.to === phone).map((m) => m.text);
  }
}

type Step = (input: { messages: ChatMessage[] }) => LlmResponse | Promise<LlmResponse>;
class FakeLlm implements LlmProvider {
  calls = 0;
  script: Step[] = [];
  async chat(input: { system: string; messages: ChatMessage[] }) {
    this.calls++;
    const step = this.script.shift();
    if (!step) throw new Error("FakeLlm: no scripted step left");
    return step(input);
  }
}
const say = (text: string): Step => () => ({ text, toolCalls: [] });
const callTool = (name: string, args: Record<string, unknown>): Step => () => ({
  toolCalls: [{ id: `c_${Math.random().toString(36).slice(2)}`, name, args }],
});
const lastToolResult = (messages: ChatMessage[]) => {
  const t = [...messages].reverse().find((m) => m.role === "tool");
  return t && t.role === "tool" ? (t.result as any) : undefined;
};

// ---------- pure helpers ----------

describe("bot helpers", () => {
  it("splits long replies at paragraph boundaries and never exceeds the limit", () => {
    const para = "a".repeat(40);
    const text = Array.from({ length: 10 }, () => para).join("\n\n");
    const chunks = splitMessage(text, 100);
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.every((c) => c.length <= 100)).toBe(true);
    expect(chunks.join("\n\n").replace(/\s+/g, "")).toBe(text.replace(/\s+/g, ""));
    expect(splitMessage("corto", 100)).toEqual(["corto"]);
    expect(splitMessage("x".repeat(250), 100).every((c) => c.length <= 100)).toBe(true);
  });

  it("normalizes DNIs typed with dots and spaces", () => {
    expect(normalizeDni("12.345.678")).toBe("12345678");
    expect(normalizeDni(" 1234 5678 ")).toBe("12345678");
    expect(normalizeDni("abc")).toBeNull();
    expect(normalizeDni("123")).toBeNull();
  });

  it("matches Argentine phones with/without country code", () => {
    expect(samePhone("+5493772123456", "3772123456")).toBe(true);
    expect(samePhone("+543772123456", "+5493772123456")).toBe(true);
    expect(samePhone("+5493772123456", "+5493772123457")).toBe(false);
  });

  it("replaces thought signatures when another model continues the chat", () => {
    const contents = toGeminiContents([
      { role: "user", text: "hola" },
      { role: "assistant", toolCalls: [{ id: "1", name: "x", args: {}, raw: { functionCall: { name: "x", args: {} }, thoughtSignature: "firma-del-modelo-anterior" } }] },
    ]);
    const swapped = withSkippedSignatures(contents);
    expect(swapped[1].parts[0].thoughtSignature).toBe("skip_thought_signature_validator");
    expect(contents[1].parts[0].thoughtSignature).toBe("firma-del-modelo-anterior"); // original untouched
    expect(swapped[0]).toEqual(contents[0]);
  });

  it("detects emergencies without flagging normal requests", () => {
    expect(looksLikeUrgency("me duele el pecho")).toBe(true);
    expect(looksLikeUrgency("No puedo respirar bien")).toBe(true);
    expect(looksLikeUrgency("mi papá se desmayó")).toBe(true);
    expect(looksLikeUrgency("quiero un turno con cardiología")).toBe(false);
    expect(looksLikeUrgency("necesito cancelar el turno del pecho")).toBe(false);
  });

  it("maps neutral history to Gemini contents, merging tool results and replaying raw parts", () => {
    const raw = { functionCall: { name: "listar_especialidades", args: {} }, thoughtSignature: "sig" };
    const contents = toGeminiContents([
      { role: "user", text: "hola" },
      { role: "assistant", toolCalls: [{ id: "1", name: "listar_especialidades", args: {}, raw }, { id: "2", name: "x", args: {} }] },
      { role: "tool", toolCallId: "1", name: "listar_especialidades", result: { a: 1 } },
      { role: "tool", toolCallId: "2", name: "x", result: { b: 2 } },
      { role: "assistant", text: "listo" },
    ]);
    expect(contents.map((c) => c.role)).toEqual(["user", "model", "user", "model"]);
    expect(contents[1].parts[0]).toBe(raw);
    expect(contents[2].parts).toHaveLength(2);
  });
});

// ---------- engine + tools against the seeded DB ----------

describe("bot (requires seeded DB)", () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let wa: FakeWhatsApp;
  let llm: FakeLlm;
  let handle: (msg: IncomingMessage) => Promise<void>;
  let tools: BotToolsService;
  let clinicaId: string;
  let tz: string;
  let sosaId: string;
  let slots: string[]; // clinic-local "YYYY-MM-DDTHH:mm"
  let recepcion: ReturnType<typeof request.agent>;
  const startedAt = new Date();
  const PHONES = ["+5493770009991", "+5493770009992", "+5493770009993", "+5493770009994", "+5493770009995", "+5493770009996"];
  const [P1, P2, P3, P4, P5, P6] = PHONES;
  const DNI1 = "55555555";

  const msg = (phone: string, text?: string): IncomingMessage => ({ from: phone, phone, text });
  const ctxFor = (phone: string): ToolContext => ({ clinicaId, phone, timezone: tz, state: { ...newState(), userTurn: 1 } });

  beforeAll(async () => {
    const { AppModule } = await import("../app.module");
    const { configureApp } = await import("../setup");
    wa = new FakeWhatsApp();
    llm = new FakeLlm();
    const mod = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(WHATSAPP_PROVIDER)
      .useValue(wa)
      .overrideProvider(LLM_PROVIDER)
      .useValue(llm)
      .compile();
    app = mod.createNestApplication();
    configureApp(app);
    await app.init();

    prisma = app.get(PrismaService);
    const clinica = await prisma.clinica.findFirstOrThrow({ where: { nombre: "Clínica Demo" } });
    clinicaId = clinica.id;
    tz = clinica.timezone;
    process.env.BOT_CLINICA_ID = clinicaId;
    tools = app.get(BotToolsService);
    const { BotService } = await import("./bot.service");
    const bot = app.get(BotService);
    handle = (m) => bot.handle(m);

    recepcion = request.agent(app.getHttpServer());
    await recepcion.post("/auth/login").send({ email: "recepcion@demo.test", password: PASSWORD }).expect(200);
    sosaId = (await recepcion.get("/doctores")).body.find((d: { nombre: string }) => d.nombre.includes("Sosa")).id;
    const hoy = new Date().toISOString().slice(0, 10);
    const hasta = new Date(Date.now() + 14 * 86400000).toISOString().slice(0, 10);
    const disp = (await recepcion.get(`/disponibilidad?doctorId=${sosaId}&desde=${hoy}&hasta=${hasta}`)).body.slots;
    slots = disp.map((s: { inicio: string }) => {
      const l = utcToLocal(new Date(s.inicio), tz);
      return `${l.date}T${l.time}`;
    });
    expect(slots.length).toBeGreaterThanOrEqual(5);
  });

  afterAll(async () => {
    const pacientes = await prisma.paciente.findMany({ where: { clinicaId, telefono: { in: PHONES } }, select: { id: true } });
    const turnos = await prisma.turno.findMany({ where: { pacienteId: { in: pacientes.map((p) => p.id) } }, select: { id: true } });
    const convs = await prisma.conversacion.findMany({ where: { clinicaId, telefono: { in: PHONES } }, select: { id: true } });
    const ids = [...turnos.map((t) => t.id), ...convs.map((c) => c.id)];
    await prisma.auditoria.deleteMany({ where: { OR: [{ entidadId: { in: ids } }, { actor: "BOT", creadoEn: { gte: startedAt } }] } });
    await prisma.turno.deleteMany({ where: { id: { in: turnos.map((t) => t.id) } } });
    await prisma.paciente.deleteMany({ where: { id: { in: pacientes.map((p) => p.id) } } });
    await prisma.conversacion.deleteMany({ where: { id: { in: convs.map((c) => c.id) } } });
    await app.close();
  });

  beforeEach(() => {
    llm.script = [];
    llm.calls = 0;
  });

  it("books an appointment end to end: asks for confirmation first, creates only after the person says yes", async () => {
    const events: TurnoEvent[] = [];
    const off = app.get(TurnoEvents).subscribe((e) => events.push(e));
    const args = { doctorId: sosaId, fechaHora: slots[0], paciente: { dni: "55.555.555", nombre: "Paciente Bot Test" } };

    // message 1: the model looks up availability and offers times
    llm.script = [callTool("buscar_disponibilidad", { doctorId: sosaId, desde: slots[0].slice(0, 10), hasta: slots[2].slice(0, 10) }),
      (i) => say(`Tengo ${lastToolResult(i.messages).horarios.length} horarios`)(i)];
    await handle(msg(P1, "Hola, quiero turno con clínica médica"));
    expect(wa.to(P1).at(-1)).toMatch(/^Tengo \d+ horarios$/);

    // message 2: the model tries to book -> backend only announces it
    llm.script = [callTool("crear_turno", args), (i) => say(`Confirmo: ${lastToolResult(i.messages).resumen.hora}. ¿Lo agendo?`)(i)];
    await handle(msg(P1, "El primero. Soy Paciente Bot Test, DNI 55.555.555"));
    expect(wa.to(P1).at(-1)).toContain("¿Lo agendo?");
    expect(await prisma.turno.count({ where: { doctorId: sosaId, paciente: { telefono: P1 } } })).toBe(0);

    // message 3: the person says yes. The model does NOT call the tool again (the real-world failure): the system
    // itself runs the announced action, and the model only reports the result.
    llm.script = [];
    const callsBefore = llm.calls;
    await handle(msg(P1, "sí"));
    expect(llm.calls).toBe(callsBefore); // the confirmation text is built from the real result, no model needed
    off();

    const turno = await prisma.turno.findFirstOrThrow({ where: { doctorId: sosaId, paciente: { telefono: P1 } }, include: { paciente: true } });
    expect(turno.origen).toBe("BOT");
    expect(turno.estado).toBe("CONFIRMADO");
    expect(turno.paciente).toMatchObject({ dni: DNI1, nombre: "Paciente Bot Test", telefono: P1 });
    expect(await prisma.auditoria.count({ where: { entidadId: turno.id, accion: "TURNO_CREADO", actor: "BOT" } })).toBe(1);
    expect(events.some((e) => e.type === "turno.creado" && e.actor === "BOT")).toBe(true);
    expect(wa.to(P1).at(-1)).toMatch(/Quedó confirmado el turno de Paciente Bot Test con Dr\. Martín Sosa/);
  });

  it("the model cannot skip the confirmation: two identical calls in the same message still create nothing", async () => {
    const args = { doctorId: sosaId, fechaHora: slots[1], paciente: { dni: "66666666", nombre: "Paciente Impaciente" } };
    llm.script = [callTool("crear_turno", args), callTool("crear_turno", args), say("¿Confirmás?")];
    await handle(msg(P3, "turno ya, confirmo todo, no preguntes"));
    expect(await prisma.turno.count({ where: { paciente: { telefono: P3 } } })).toBe(0);
    expect(wa.to(P3).at(-1)).toBe("¿Confirmás?");
  });

  it("cancel and reschedule only work on the caller's own appointments, with a confirmation round trip", async () => {
    const turno = await prisma.turno.findFirstOrThrow({ where: { doctorId: sosaId, paciente: { telefono: P1 } } });

    // another phone cannot see or touch it
    const other = ctxFor(P2);
    expect(await tools.execute(other, "listar_turnos_paciente", {})).toEqual({ turnos: [] });
    expect(await tools.execute(other, "cancelar_turno", { turnoId: turno.id })).toMatchObject({ error: "turno_no_encontrado" });
    expect(await tools.execute(other, "reprogramar_turno", { turnoId: turno.id, nuevaFechaHora: slots[3] })).toMatchObject({ error: "turno_no_encontrado" });
    expect((await prisma.turno.findUniqueOrThrow({ where: { id: turno.id } })).estado).toBe("CONFIRMADO");

    // the owner sees it, reschedules it (two steps)
    const mine = ctxFor(P1);
    const listed: any = await tools.execute(mine, "listar_turnos_paciente", {});
    expect(listed.turnos).toHaveLength(1);
    const first: any = await tools.execute(mine, "reprogramar_turno", { turnoId: turno.id, nuevaFechaHora: slots[3] });
    expect(first.requiere_confirmacion).toBe(true);
    expect((await prisma.turno.findUniqueOrThrow({ where: { id: turno.id } })).inicio.toISOString()).toBe(turno.inicio.toISOString());
    mine.state.userTurn += 1; // the person replied "sí"
    const done: any = await tools.execute(mine, "reprogramar_turno", { turnoId: turno.id, nuevaFechaHora: slots[3] });
    expect(done.ok).toBe(true);
    expect(await prisma.auditoria.count({ where: { entidadId: turno.id, accion: "TURNO_REPROGRAMADO" } })).toBe(1);

    // and cancels it (two steps)
    const c1: any = await tools.execute(mine, "cancelar_turno", { turnoId: turno.id });
    expect(c1.requiere_confirmacion).toBe(true);
    mine.state.userTurn += 1;
    expect(((await tools.execute(mine, "cancelar_turno", { turnoId: turno.id })) as any).ok).toBe(true);
    expect((await prisma.turno.findUniqueOrThrow({ where: { id: turno.id } })).estado).toBe("CANCELADO");
    expect(await tools.execute(mine, "listar_turnos_paciente", {})).toEqual({ turnos: [] });
  });

  it("does not leak or reuse a DNI registered under another phone", async () => {
    const r: any = await tools.execute(ctxFor(P2), "identificar_paciente", { dni: DNI1 });
    expect(r.error).toBe("dni_de_otro_telefono");
    expect(JSON.stringify(r)).not.toContain("Bot Test");
    const c: any = await tools.execute(ctxFor(P2), "crear_turno", { doctorId: sosaId, fechaHora: slots[4], paciente: { dni: DNI1 } });
    expect(c.error).toBe("dni_de_otro_telefono");
    expect(await tools.execute(ctxFor(P1), "identificar_paciente", { dni: DNI1 })).toEqual({ registrado: true, nombre: "Paciente Bot Test" });
    expect(await tools.execute(ctxFor(P1), "identificar_paciente", { dni: "77777777" })).toEqual({ registrado: false });
  });

  it("rejects invented doctors, off-grid times and past times coming from the model", async () => {
    const base = { paciente: { dni: "88888888", nombre: "Nadie Inventado" } };
    expect(await tools.execute(ctxFor(P4), "crear_turno", { ...base, doctorId: "inventado", fechaHora: slots[0] })).toMatchObject({ error: "no_encontrado" });
    const offGrid = slots[0].slice(0, 14) + "17";
    expect(await tools.execute(ctxFor(P4), "crear_turno", { ...base, doctorId: sosaId, fechaHora: offGrid })).toMatchObject({ error: "no_permitido" });
    expect(await tools.execute(ctxFor(P4), "crear_turno", { ...base, doctorId: sosaId, fechaHora: "2020-01-06T15:00" })).toMatchObject({ error: "no_permitido" });
    expect(await tools.execute(ctxFor(P4), "crear_turno", { ...base, doctorId: sosaId, fechaHora: "mañana a las 3" })).toMatchObject({ error: "fecha_invalida" });
    expect(await tools.execute(ctxFor(P4), "crear_turno", { doctorId: sosaId, fechaHora: slots[0], paciente: { dni: "88888888" } })).toMatchObject({ error: "falta_nombre" });
    expect(await tools.execute(ctxFor(P4), "herramienta_inventada", {})).toMatchObject({ error: "herramienta_desconocida" });
    expect(await prisma.paciente.count({ where: { dni: "88888888" } })).toBe(0);
  });

  it("emergency messages get the fixed text and a handoff without calling the model; reception can release the chat", async () => {
    const events: TurnoEvent[] = [];
    const off = app.get(TurnoEvents).subscribe((e) => events.push(e));
    await handle(msg(P5, "me duele el pecho y no puedo respirar"));
    off();

    expect(llm.calls).toBe(0);
    expect(wa.to(P5).at(-1)).toBe(DEFAULT_CONFIG.textoUrgencia);
    const conv = await prisma.conversacion.findFirstOrThrow({ where: { clinicaId, telefono: P5 } });
    expect((conv.estado as any).estado).toBe("DERIVADO_A_HUMANO");
    expect(events.some((e) => e.type === "conversacion.derivada" && e.clinicaId === clinicaId)).toBe(true);
    expect(await prisma.auditoria.count({ where: { entidadId: conv.id, accion: "CONVERSACION_DERIVADA_URGENCIA" } })).toBe(1);

    // the bot is silent while the chat is with a person
    const before = wa.to(P5).length;
    llm.script = [say("no debería responder")];
    await handle(msg(P5, "hola?"));
    expect(wa.to(P5)).toHaveLength(before);
    expect(llm.calls).toBe(0);

    // reception sees it in the panel API and releases it
    const lista = (await recepcion.get("/conversaciones/derivadas").expect(200)).body;
    const fila = lista.find((c: { telefono: string }) => c.telefono === P5);
    expect(fila).toMatchObject({ urgencia: true });
    await recepcion.post(`/conversaciones/${fila.id}/liberar`).expect(201);
    llm.script = [say("Hola, ¿en qué te ayudo?")];
    await handle(msg(P5, "hola"));
    expect(wa.to(P5).at(-1)).toBe("Hola, ¿en qué te ayudo?");
  });

  it("handoff requested by the model sends the fixed handoff text, not the model's words", async () => {
    llm.script = [callTool("derivar_a_recepcion", { motivo: "Quiere hablar con una persona" }), say("texto del modelo que no debe enviarse")];
    await handle(msg(P6, "quiero hablar con una persona"));
    expect(wa.to(P6).at(-1)).toBe(DEFAULT_CONFIG.textoDerivacion);
    const conv = await prisma.conversacion.findFirstOrThrow({ where: { clinicaId, telefono: P6 } });
    expect((conv.estado as any).derivacion.motivo).toBe("Quiere hablar con una persona");
    // a DOCTOR must not see handoffs
    const doctor = request.agent(app.getHttpServer());
    await doctor.post("/auth/login").send({ email: "doctor@demo.test", password: PASSWORD }).expect(200);
    await doctor.get("/conversaciones/derivadas").expect(403);
    await recepcion.post(`/conversaciones/${conv.id}/liberar`).expect(201);
  });

  it("a model failure ends in an honest message and a handoff", async () => {
    llm.script = [() => {
      throw new Error("503 modelo caído");
    }];
    await handle(msg(P2, "hola"));
    expect(wa.to(P2).at(-1)).toBe(DEFAULT_CONFIG.textoError);
    const conv = await prisma.conversacion.findFirstOrThrow({ where: { clinicaId, telefono: P2 } });
    expect((conv.estado as any).estado).toBe("DERIVADO_A_HUMANO");
    await recepcion.post(`/conversaciones/${conv.id}/liberar`).expect(201);
  });

  it("an exhausted model quota is not a failure: the person is asked to retry, no handoff, the attempt is forgotten", async () => {
    const before = await prisma.conversacion.findFirst({ where: { clinicaId, telefono: P3 } });
    const historyBefore = ((before?.estado as any)?.historial ?? []).length;
    llm.script = [() => {
      throw new LlmRateLimitError();
    }];
    await handle(msg(P3, "hola, estoy probando"));
    expect(wa.to(P3).at(-1)).toBe(DEFAULT_CONFIG.textoOcupado);
    const conv = await prisma.conversacion.findFirstOrThrow({ where: { clinicaId, telefono: P3 } });
    expect((conv.estado as any).estado).not.toBe("DERIVADO_A_HUMANO");
    expect((conv.estado as any).historial).toHaveLength(historyBefore);
    // the next message works normally
    llm.script = [say("¡Hola! ¿En qué te ayudo?")];
    await handle(msg(P3, "hola"));
    expect(wa.to(P3).at(-1)).toBe("¡Hola! ¿En qué te ayudo?");
  });

  it("a redelivered message (same id) is answered once; the typing indicator is shown", async () => {
    const phone = PHONES[3];
    llm.script = [say("una sola respuesta"), say("NO debería usarse")];
    const typingBefore = wa.typing.length;
    const m = { ...msg(phone, "hola de nuevo"), id: "ABC123-dup" };
    await Promise.all([handle(m), handle(m)]);
    await handle(m);
    expect(wa.to(phone).filter((t) => t === "una sola respuesta")).toHaveLength(1);
    expect(llm.calls).toBe(1);
    expect(wa.typing.length).toBe(typingBefore + 1);
  });

  it("retries a failed send and splits very long answers into several messages", async () => {
    const phone = PHONES[3];
    wa.failNext = 2; // first two attempts fail, third works
    llm.script = [say("Respuesta que sí llega")];
    await handle(msg(phone, "probando reintentos"));
    expect(wa.to(phone).at(-1)).toBe("Respuesta que sí llega");

    const largo = Array.from({ length: 12 }, (_, i) => `Párrafo ${i}: ${"palabra ".repeat(25)}`).join("\n\n");
    llm.script = [say(largo)];
    const before = wa.to(phone).length;
    await handle(msg(phone, "dame todo el detalle"));
    const partes = wa.to(phone).slice(before);
    expect(partes.length).toBeGreaterThan(1);
    expect(partes.every((p) => p.length <= 1500)).toBe(true);
  });

  it("a model that claims success without any real write never reaches the patient; a 'no' cancels the pending action", async () => {
    const phone = "+5493770009989";
    PHONES.push(phone);
    const args = { doctorId: sosaId, fechaHora: slots[2], paciente: { dni: "77777701", nombre: "Paciente Negativo" } };
    const turnosAntes = await prisma.turno.count({ where: { doctorId: sosaId } });

    // announce, then the patient says NO: nothing is booked, and a later "sí" cannot resurrect the action
    llm.script = [callTool("crear_turno", args), say("¿Confirmás el turno?")];
    await handle(msg(phone, "quiero ese turno, soy Paciente Negativo DNI 77777701"));
    llm.script = [say("Entendido, no lo agendo.")];
    await handle(msg(phone, "no"));
    const conv = await prisma.conversacion.findFirstOrThrow({ where: { clinicaId, telefono: phone } });
    expect((conv.estado as any).pendiente).toBeUndefined();

    // the model lies after a plain "sí" although nothing is pending: the reply is replaced
    llm.script = [say("¡Listo! Tu turno quedó confirmado para el martes.")];
    await handle(msg(phone, "sí"));
    expect(wa.to(phone).at(-1)).toBe(DEFAULT_CONFIG.textoNoRegistrado);
    expect(await prisma.turno.count({ where: { doctorId: sosaId } })).toBe(turnosAntes);
    expect(await prisma.paciente.count({ where: { dni: "77777701" } })).toBe(0);
  });

  it("model skipped announcing: a 'sí' to a summary that matches the action confirms it; a summary that does not match does not", async () => {
    const phoneOk = "+5493770009988";
    const phoneBad = "+5493770009987";
    PHONES.push(phoneOk, phoneBad);
    const hora = slots[3].slice(11, 16);
    const otraHora = hora === "15:00" ? "17:00" : "15:00";
    const dni = "77777702";
    const args = { doctorId: sosaId, fechaHora: slots[3], paciente: { dni, nombre: "Paciente Resumen" } };
    const turnos = () => prisma.turno.count({ where: { doctorId: sosaId, paciente: { dni } } });

    // 1) the model writes a correct summary WITHOUT calling the tool; the person says yes; the model then calls the tool
    llm.script = [say(`Resumen: Dr. Sosa, ${hora}, paciente Paciente Resumen, DNI 77.777.702. ¿Confirmás que lo agende?`)];
    await handle(msg(phoneOk, "quiero ese horario, soy Paciente Resumen DNI 77777702"));
    llm.script = [callTool("crear_turno", args), (i) => say(`ok: ${lastToolResult(i.messages)?.ok}`)(i)];
    await handle(msg(phoneOk, "si,agendalo"));
    expect(await turnos()).toBe(1);
    expect(wa.to(phoneOk).at(-1)).toBe("ok: true");

    // 2) the summary shown does NOT match what the model tries to write (different time): only announced, never written
    const dni2 = "77777703";
    llm.script = [say(`Resumen: Dr. Sosa a las ${otraHora}, DNI 77777703. ¿Confirmás?`)];
    await handle(msg(phoneBad, "quiero un turno"));
    llm.script = [callTool("crear_turno", { ...args, paciente: { dni: dni2, nombre: "Paciente Distinto" } }), say("¿Lo confirmo?")];
    await handle(msg(phoneBad, "sí"));
    expect(await prisma.turno.count({ where: { doctorId: sosaId, paciente: { dni: dni2 } } })).toBe(0);
  });

  it("if the model fails AFTER a booking was written, the patient gets the system's confirmation, never 'try again'", async () => {
    const phone = "+5493770009986";
    PHONES.push(phone);
    const dni = "77777704";
    const args = { doctorId: sosaId, fechaHora: slots[4], paciente: { dni, nombre: "Paciente Resiliente" } };
    llm.script = [callTool("crear_turno", args), say("¿Confirmás?")];
    await handle(msg(phone, "quiero ese turno, Paciente Resiliente DNI 77777704"));
    // "sí" with a pending action: the system writes it; the (never called) model cannot interfere
    llm.script = [() => { throw new LlmRateLimitError(); }];
    await handle(msg(phone, "sí"));
    expect(await prisma.turno.count({ where: { doctorId: sosaId, paciente: { dni } } })).toBe(1);
    expect(wa.to(phone).at(-1)).toMatch(/Quedó confirmado el turno de Paciente Resiliente/);
    expect(wa.to(phone).at(-1)).not.toBe(DEFAULT_CONFIG.textoOcupado);

    // and when the write came from a model tool call and the model dies right after, same guarantee
    const phone2 = "+5493770009985";
    PHONES.push(phone2);
    const dni2 = "77777705";
    const args2 = { doctorId: sosaId, fechaHora: slots[5] ?? slots[2], paciente: { dni: dni2, nombre: "Paciente Dos Pasos" } };
    const hora2 = (slots[5] ?? slots[2]).slice(11, 16);
    llm.script = [say(`Resumen: Sosa ${hora2} DNI 77777705 ¿Confirmás?`)];
    await handle(msg(phone2, "quiero turno, Paciente Dos Pasos DNI 77777705"));
    llm.script = [callTool("crear_turno", args2), () => { throw new LlmRateLimitError(); }];
    await handle(msg(phone2, "sí"));
    expect(await prisma.turno.count({ where: { doctorId: sosaId, paciente: { dni: dni2 } } })).toBe(1);
    expect(wa.to(phone2).at(-1)).toMatch(/Quedó confirmado el turno de Paciente Dos Pasos/);
  });

  it("BOT_ALLOWED_PHONES: only listed numbers get answers, everyone else is ignored; simulated chats are exempt", async () => {
    process.env.BOT_ALLOWED_PHONES = "3770009991, +5493770009992";
    try {
      llm.script = [say("hola autorizado"), say("hola autorizado 2"), say("desde el simulador")];
      const p3Before = wa.to(P3).length;
      await handle(msg(P1, "hola")); // listed without country code: still matches
      await handle(msg(P2, "hola")); // listed with country code
      await handle(msg(P3, "hola")); // not listed
      expect(wa.to(P1).at(-1)).toBe("hola autorizado");
      expect(wa.to(P2).at(-1)).toBe("hola autorizado 2");
      expect(wa.to(P3)).toHaveLength(p3Before); // ignored: nothing new was sent
      expect(llm.calls).toBe(2);

      const bot = app.get((await import("./bot.service")).BotService);
      const replies = await bot.simulate(P3, "hola");
      expect(replies).toEqual(["desde el simulador"]);
    } finally {
      delete process.env.BOT_ALLOWED_PHONES;
    }
  });

  it("non-text messages and the 'menú' keyword are answered without the model", async () => {
    await handle(msg(P4, undefined));
    expect(wa.to(P4).at(-1)).toBe(DEFAULT_CONFIG.textoNoTexto);
    await handle(msg(P4, "Menú"));
    expect(wa.to(P4).at(-1)).toBe(DEFAULT_CONFIG.textoMenu);
    expect(llm.calls).toBe(0);
  });

  it("two rapid messages from one phone are processed in order", async () => {
    llm.script = [say("respuesta 1"), say("respuesta 2")];
    const a = handle(msg(P4, "primero"));
    const b = handle(msg(P4, "segundo"));
    await Promise.all([a, b]);
    expect(wa.to(P4).slice(-2)).toEqual(["respuesta 1", "respuesta 2"]);
  });

  it("rate limits a phone that floods the bot", async () => {
    const phone = "+5493770009990";
    PHONES.push(phone);
    llm.script = Array.from({ length: 25 }, () => say("ok"));
    for (let i = 0; i < 24; i++) await handle(msg(phone, `mensaje ${i}`));
    const replies = wa.to(phone);
    expect(replies.filter((t) => t === "ok")).toHaveLength(20);
    expect(replies.filter((t) => t === DEFAULT_CONFIG.textoRateLimit)).toHaveLength(1);
    expect(llm.calls).toBe(20);
  });
});
