import type { INestApplication } from "@nestjs/common";
import request from "supertest";
import { PrismaService } from "../prisma/prisma.service";
import { createApp, loginAs, nextWeekday, passwordFor } from "../test-utils";
import { canReceive } from "./turno-events";

describe("canReceive (who gets live events)", () => {
  const evento = { clinicaId: "A", doctorId: "d1" };
  it("same clinic: admin and reception get everything", () => {
    expect(canReceive({ clinicaId: "A", rol: "ADMIN", doctorId: null }, evento)).toBe(true);
    expect(canReceive({ clinicaId: "A", rol: "RECEPCION", doctorId: null }, evento)).toBe(true);
  });
  it("another clinic never gets it", () => {
    expect(canReceive({ clinicaId: "B", rol: "ADMIN", doctorId: null }, evento)).toBe(false);
  });
  it("a doctor only gets their own appointments", () => {
    expect(canReceive({ clinicaId: "A", rol: "DOCTOR", doctorId: "d1" }, evento)).toBe(true);
    expect(canReceive({ clinicaId: "A", rol: "DOCTOR", doctorId: "d2" }, evento)).toBe(false);
  });
});

// Reads an SSE response for `ms` milliseconds and returns everything received.
async function collect(res: Response, ms: number, stopWhen?: (text: string) => boolean): Promise<string> {
  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  let text = "";
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    const chunk = await Promise.race([
      reader.read(),
      new Promise<null>((r) => setTimeout(() => r(null), Math.max(1, deadline - Date.now()))),
    ]);
    if (!chunk || chunk.done) break;
    text += decoder.decode(chunk.value);
    if (stopWhen?.(text)) break;
  }
  reader.cancel().catch(() => undefined);
  return text;
}

describe("agenda y stream en vivo (requires seeded DB)", () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let recepcion: Awaited<ReturnType<typeof loginAs>>;
  let doctorSession: Awaited<ReturnType<typeof loginAs>>;
  let duarteId: string;
  let pacienteId: string;
  let fecha: string;
  let base: string;
  const startedAt = new Date();

  const cookieFor = async (email: string) => {
    const res = await request(app.getHttpServer()).post("/auth/login").send({ email, password: passwordFor(email) }).expect(200);
    return (res.headers["set-cookie"] as unknown as string[])[0].split(";")[0];
  };

  beforeAll(async () => {
    app = await createApp();
    await app.listen(0);
    base = (await app.getUrl()).replace("[::1]", "localhost");
    prisma = app.get(PrismaService);
    recepcion = await loginAs(app, "recepcion@demo.test");
    doctorSession = await loginAs(app, "doctor@demo.test"); // Dra. Benítez
    duarteId = (await recepcion.get("/doctores")).body.find((d: { nombre: string }) => d.nombre.includes("Duarte")).id;
    pacienteId = (await recepcion.get("/pacientes?q=Ficticio")).body[0].id;
    fecha = nextWeekday(1); // Dr. Duarte works Mondays
  });

  afterAll(async () => {
    const turnos = await prisma.turno.findMany({ where: { doctorId: duarteId, creadoEn: { gte: startedAt } }, select: { id: true } });
    const ids = turnos.map((t) => t.id);
    await prisma.auditoria.deleteMany({ where: { entidadId: { in: ids } } });
    await prisma.turno.deleteMany({ where: { id: { in: ids } } });
    await app.close();
  });

  it("agenda: reception sees every doctor, a DOCTOR only their own", async () => {
    const all = (await recepcion.get(`/agenda?fecha=${fecha}`).expect(200)).body;
    expect(all.fecha).toBe(fecha);
    expect(all.doctores.length).toBeGreaterThan(1);
    const duarte = all.doctores.find((d: { id: string }) => d.id === duarteId);
    expect(duarte.slots.length).toBe(3); // 09-12, 60 min
    expect(duarte.slots.every((s: { turno: unknown }) => s.turno === null)).toBe(true);

    const mine = (await doctorSession.get(`/agenda?fecha=${fecha}`).expect(200)).body;
    expect(mine.doctores).toHaveLength(1);
    const asked = (await doctorSession.get(`/agenda?fecha=${fecha}&doctorId=${duarteId}`).expect(200)).body;
    expect(asked.doctores.map((d: { id: string }) => d.id)).not.toContain(duarteId);
    await request(app.getHttpServer()).get("/agenda").expect(401);
  });

  it("agenda: a booked slot shows the patient; cancelling shows it free again", async () => {
    const before = (await recepcion.get(`/agenda?fecha=${fecha}`)).body.doctores.find((d: { id: string }) => d.id === duarteId);
    const slot = before.slots[0].inicio;
    const created = await recepcion.post("/turnos").send({ doctorId: duarteId, pacienteId, inicio: slot }).expect(201);

    const during = (await recepcion.get(`/agenda?fecha=${fecha}`)).body.doctores.find((d: { id: string }) => d.id === duarteId);
    expect(during.slots[0].turno.id).toBe(created.body.id);
    expect(during.slots[0].turno.paciente.nombre).toBeTruthy();

    await recepcion.patch(`/turnos/${created.body.id}/cancelar`).expect(200);
    const after = (await recepcion.get(`/agenda?fecha=${fecha}`)).body.doctores.find((d: { id: string }) => d.id === duarteId);
    expect(after.slots[0].turno).toBeNull();
  });

  it("stream: reception receives the event (without patient data); another doctor's stream stays silent", async () => {
    const recepCookie = await cookieFor("recepcion@demo.test");
    const docCookie = await cookieFor("doctor@demo.test");
    const [recepStream, docStream] = await Promise.all([
      fetch(`${base}/turnos/stream`, { headers: { cookie: recepCookie } }),
      fetch(`${base}/turnos/stream`, { headers: { cookie: docCookie } }),
    ]);
    expect(recepStream.status).toBe(200);
    expect(recepStream.headers.get("content-type")).toContain("text/event-stream");

    const recepText = collect(recepStream, 4000, (t) => t.includes("turno.creado"));
    const docText = collect(docStream, 1500);
    await new Promise((r) => setTimeout(r, 300)); // let both subscriptions register

    const free = (await recepcion.get(`/agenda?fecha=${fecha}`)).body.doctores.find((d: { id: string }) => d.id === duarteId);
    await recepcion.post("/turnos").send({ doctorId: duarteId, pacienteId, inicio: free.slots[1].inicio }).expect(201);

    const got = await recepText;
    expect(got).toContain("turno.creado");
    expect(got).not.toContain("telefono");
    expect(await docText).not.toContain("turno.creado");
  });

  it("stream requires authentication", async () => {
    const res = await fetch(`${base}/turnos/stream`);
    expect(res.status).toBe(401);
  });
});
