import * as argon2 from "argon2";
import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import request from "supertest";
import { LLM_PROVIDER, WHATSAPP_PROVIDER } from "../bot/types";
import type { ChatMessage, LlmProvider, WhatsAppProvider } from "../bot/types";
import { PrismaService } from "../prisma/prisma.service";
import { PASSWORD } from "../test-utils";

class FakeWa implements WhatsAppProvider {
  sent: string[] = [];
  onMessage() {}
  async sendText(_to: string, text: string) {
    this.sent.push(text);
  }
}
class EchoLlm implements LlmProvider {
  async chat(input: { messages: ChatMessage[] }) {
    const last = [...input.messages].reverse().find((m) => m.role === "user");
    return { text: `eco: ${last && last.role === "user" ? last.text : ""}`, toolCalls: [] };
  }
}

describe("herramientas de demo (requires seeded DB)", () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let wa: FakeWa;
  let clinicaBId: string;
  const PHONE = "+5493770009981";

  const login = async (email: string, password = PASSWORD) => {
    const agent = request.agent(app.getHttpServer());
    await agent.post("/auth/login").send({ email, password }).expect(200);
    return agent;
  };

  beforeAll(async () => {
    const { AppModule } = await import("../app.module");
    const { configureApp } = await import("../setup");
    wa = new FakeWa();
    const mod = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(WHATSAPP_PROVIDER).useValue(wa)
      .overrideProvider(LLM_PROVIDER).useValue(new EchoLlm())
      .compile();
    app = mod.createNestApplication();
    configureApp(app);
    await app.init();
    prisma = app.get(PrismaService);
    process.env.BOT_CLINICA_ID = (await prisma.clinica.findFirstOrThrow({ where: { nombre: "Clínica Demo" } })).id;
  });

  afterAll(async () => {
    if (clinicaBId) {
      const where = { clinicaId: clinicaBId };
      await prisma.auditoria.deleteMany({ where });
      await prisma.turno.deleteMany({ where });
      await prisma.usuario.deleteMany({ where });
      await prisma.paciente.deleteMany({ where });
      await prisma.clinica.delete({ where: { id: clinicaBId } });
    }
    const conv = await prisma.conversacion.findMany({ where: { telefono: PHONE }, select: { id: true } });
    await prisma.auditoria.deleteMany({ where: { entidadId: { in: conv.map((c) => c.id) } } });
    await prisma.conversacion.deleteMany({ where: { telefono: PHONE } });
    await app.close();
  });

  it("the simulated chat answers through the bot without touching WhatsApp", async () => {
    const recepcion = await login("recepcion@demo.test");
    const res = await recepcion.post("/demo/chat").send({ texto: "hola", telefono: PHONE }).expect(201);
    expect(res.body.respuestas).toEqual(["eco: hola"]);
    expect(wa.sent).toHaveLength(0);
  });

  it("is hidden when DEMO_MODE is off, and requires the right role", async () => {
    const recepcion = await login("recepcion@demo.test");
    const doctor = await login("doctor@demo.test");
    await doctor.post("/demo/chat").send({ texto: "hola" }).expect(403);
    await request(app.getHttpServer()).post("/demo/chat").send({ texto: "hola" }).expect(401);
    await recepcion.post("/demo/reiniciar").expect(403); // admin only

    process.env.DEMO_MODE = "false";
    try {
      await recepcion.post("/demo/chat").send({ texto: "hola" }).expect(404);
      expect((await recepcion.get("/demo/estado").expect(200)).body).toEqual({ demoMode: false });
    } finally {
      process.env.DEMO_MODE = "true";
    }
    expect((await recepcion.get("/demo/estado").expect(200)).body).toEqual({ demoMode: true });
  });

  it("validates the chat payload", async () => {
    const recepcion = await login("recepcion@demo.test");
    await recepcion.post("/demo/chat").send({ texto: "" }).expect(400);
    await recepcion.post("/demo/chat").send({ texto: "hola", telefono: "no-es-telefono" }).expect(400);
  });

  it("reset only touches the caller's clinic and keeps users logged in", async () => {
    // A second clinic with its own admin, so the shared demo data used by other tests is never wiped.
    const clinicaB = await prisma.clinica.create({ data: { nombre: "Clínica Reset Test" } });
    clinicaBId = clinicaB.id;
    await prisma.usuario.create({
      data: { clinicaId: clinicaBId, email: "admin@reset.test", passwordHash: await argon2.hash(PASSWORD), rol: "ADMIN" },
    });
    await prisma.paciente.create({ data: { clinicaId: clinicaBId, nombre: "Se borra", telefono: "+5400000001234", dni: "99887766" } });

    const admin = await login("admin@reset.test");
    await admin.post("/demo/reiniciar").expect(201);

    const nombres = (await prisma.paciente.findMany({ where: { clinicaId: clinicaBId } })).map((p) => p.nombre);
    expect(nombres).not.toContain("Se borra");
    expect(nombres).toHaveLength(8); // sample patients reloaded
    // The demo clinic keeps its own sample patients (other tests run in parallel, so only check presence).
    expect(await prisma.paciente.count({ where: { clinica: { nombre: "Clínica Demo" }, dni: "10000001" } })).toBe(1);
    await admin.get("/auth/me").expect(200); // session still valid
  });
});
