import type { INestApplication } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { TurnoEvents } from "./turno-events";
import type { TurnoEvent } from "./turno-events";
import { createApp, loginAs } from "../test-utils";

// Integration tests against the seeded dev DB. Test data is tagged by creation time and removed in afterAll.
describe("turnos (requires seeded DB)", () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let recepcion: Awaited<ReturnType<typeof loginAs>>;
  let doctor: Awaited<ReturnType<typeof loginAs>>;
  let doctorId: string;
  let otroDoctorId: string;
  let pacienteId: string;
  let slots: { inicio: string }[];
  const startedAt = new Date();

  beforeAll(async () => {
    app = await createApp();
    prisma = app.get(PrismaService);
    recepcion = await loginAs(app, "recepcion@demo.test");
    doctor = await loginAs(app, "doctor@demo.test"); // seeded as Dra. Benítez

    const me = (await doctor.get("/auth/me")).body;
    doctorId = me.doctorId;
    const doctores = (await recepcion.get("/doctores")).body as { id: string }[];
    otroDoctorId = doctores.find((d) => d.id !== doctorId)!.id;
    pacienteId = (await recepcion.get("/pacientes")).body[0].id;

    const hoy = new Date().toISOString().slice(0, 10);
    const hasta = new Date(Date.now() + 14 * 86400000).toISOString().slice(0, 10);
    const disp = await recepcion.get(`/disponibilidad?doctorId=${doctorId}&desde=${hoy}&hasta=${hasta}`).expect(200);
    slots = disp.body.slots;
    expect(slots.length).toBeGreaterThanOrEqual(5);
  });

  afterAll(async () => {
    const turnos = await prisma.turno.findMany({
      where: { creadoEn: { gte: startedAt }, doctorId: { in: [doctorId, otroDoctorId] } },
      select: { id: true },
    });
    const ids = turnos.map((t) => t.id);
    await prisma.auditoria.deleteMany({ where: { entidadId: { in: ids } } });
    await prisma.turno.deleteMany({ where: { id: { in: ids } } });
    await app.close();
  });

  const crear = (agent: typeof recepcion, inicio: string, extra: object = {}) =>
    agent.post("/turnos").send({ doctorId, pacienteId, inicio, ...extra });

  it("no double booking: 12 simultaneous requests for one slot -> exactly one wins, the rest get 409 with alternatives", async () => {
    const slot = slots[0].inicio;
    const results = await Promise.all(Array.from({ length: 12 }, () => crear(recepcion, slot)));

    const statuses = results.map((r) => r.status).sort();
    expect(statuses.filter((s) => s === 201)).toHaveLength(1);
    expect(statuses.filter((s) => s === 409)).toHaveLength(11);

    const loser = results.find((r) => r.status === 409)!;
    expect(loser.body.alternativas.length).toBeGreaterThan(0);
    expect(loser.body.alternativas.map((a: { inicio: string }) => a.inicio)).not.toContain(slot);

    const active = await prisma.turno.count({
      where: { doctorId, inicio: new Date(slot), estado: { not: "CANCELADO" } },
    });
    expect(active).toBe(1);
  });

  it("a booked slot disappears from availability; cancelling frees it and it can be booked again", async () => {
    const slot = slots[0].inicio;
    const fecha = slot.slice(0, 10);
    const taken = await prisma.turno.findFirstOrThrow({ where: { doctorId, inicio: new Date(slot), estado: "CONFIRMADO" } });

    const during = (await recepcion.get(`/disponibilidad?doctorId=${doctorId}&desde=${fecha}&hasta=${fecha}`)).body.slots;
    expect(during.map((s: { inicio: string }) => s.inicio)).not.toContain(slot);

    const events: TurnoEvent[] = [];
    const unsubscribe = app.get(TurnoEvents).subscribe((e) => events.push(e));

    await recepcion.patch(`/turnos/${taken.id}/cancelar`).expect(200);
    const audit = await prisma.auditoria.findFirst({ where: { entidadId: taken.id, accion: "TURNO_CANCELADO" } });
    expect(audit).toBeTruthy();
    expect(audit!.actor).not.toBe("BOT");

    await crear(recepcion, slot).expect(201);
    unsubscribe();
    expect(events.map((e) => e.type)).toEqual(["turno.cancelado", "turno.creado"]);

    // cancelling twice is rejected
    await recepcion.patch(`/turnos/${taken.id}/cancelar`).expect(422);
  });

  it("reprogramar moves the appointment atomically, audits it and frees the old slot", async () => {
    const [from, to] = [slots[1].inicio, slots[2].inicio];
    const created = await crear(recepcion, from).expect(201);
    const id = created.body.id;

    await recepcion.patch(`/turnos/${id}/reprogramar`).send({ nuevaFechaHora: to }).expect(200);
    const t = await prisma.turno.findUniqueOrThrow({ where: { id } });
    expect(t.inicio.toISOString()).toBe(new Date(to).toISOString());
    expect(await prisma.auditoria.count({ where: { entidadId: id, accion: "TURNO_REPROGRAMADO" } })).toBe(1);

    const fecha = from.slice(0, 10);
    const free = (await recepcion.get(`/disponibilidad?doctorId=${doctorId}&desde=${fecha}&hasta=${fecha}`)).body.slots;
    expect(free.map((s: { inicio: string }) => s.inicio)).toContain(from);

    // moving onto an already-taken slot -> 409 and the appointment stays where it was
    const taken = slots[0].inicio;
    const res = await recepcion.patch(`/turnos/${id}/reprogramar`).send({ nuevaFechaHora: taken }).expect(409);
    expect(res.body.alternativas).toBeDefined();
    const after = await prisma.turno.findUniqueOrThrow({ where: { id } });
    expect(after.inicio.toISOString()).toBe(new Date(to).toISOString());
  });

  it("rejects past dates and times outside the doctor's schedule", async () => {
    await crear(recepcion, new Date(Date.now() - 86400000).toISOString()).expect(422);
    const offGrid = new Date(new Date(slots[3].inicio).getTime() + 17 * 60000).toISOString();
    await crear(recepcion, offGrid).expect(422);
    await crear(recepcion, "no-es-una-fecha").expect(400);
  });

  it("rejects unknown ids", async () => {
    await recepcion.post("/turnos").send({ doctorId: "nope", pacienteId, inicio: slots[3].inicio }).expect(404);
    await recepcion.post("/turnos").send({ doctorId, pacienteId: "nope", inicio: slots[3].inicio }).expect(404);
  });

  it("roles: a DOCTOR cannot book, only sees their own agenda and doctor record", async () => {
    await crear(doctor, slots[3].inicio).expect(403);

    const doctores = (await doctor.get("/doctores").expect(200)).body;
    expect(doctores.map((d: { id: string }) => d.id)).toEqual([doctorId]);
    await doctor.get(`/doctores/${otroDoctorId}`).expect(404);
    await doctor.get(`/disponibilidad?doctorId=${otroDoctorId}&desde=2030-01-01&hasta=2030-01-02`).expect(403);

    // a turno of another doctor is invisible and cannot be modified by this DOCTOR
    const otherSlot = (
      await recepcion.get(
        `/disponibilidad?doctorId=${otroDoctorId}&desde=${slots[0].inicio.slice(0, 10)}&hasta=${new Date(Date.now() + 14 * 86400000).toISOString().slice(0, 10)}`,
      )
    ).body.slots[0].inicio;
    const foreign = await recepcion.post("/turnos").send({ doctorId: otroDoctorId, pacienteId, inicio: otherSlot }).expect(201);
    await doctor.get(`/turnos/${foreign.body.id}`).expect(404);
    await doctor.patch(`/turnos/${foreign.body.id}/estado`).send({ estado: "ATENDIDO" }).expect(404);

    const list = (await doctor.get(`/turnos?desde=${slots[0].inicio.slice(0, 10)}&hasta=${new Date(Date.now() + 14 * 86400000).toISOString().slice(0, 10)}&doctorId=${otroDoctorId}`).expect(200)).body;
    expect(list.every((t: { doctorId: string }) => t.doctorId === doctorId)).toBe(true);
  });

  it("a DOCTOR can mark their own appointment as attended, and it cannot be cancelled afterwards", async () => {
    const mine = await prisma.turno.findFirstOrThrow({ where: { doctorId, estado: "CONFIRMADO", creadoEn: { gte: startedAt } } });
    await doctor.patch(`/turnos/${mine.id}/estado`).send({ estado: "ATENDIDO" }).expect(200);
    await recepcion.patch(`/turnos/${mine.id}/cancelar`).expect(422);
    await doctor.patch(`/turnos/${mine.id}/estado`).send({ estado: "CANCELADO" }).expect(400);
  });

  it("requires authentication", async () => {
    const anon = (await import("supertest")).default(app.getHttpServer());
    await anon.get("/turnos").expect(401);
    await anon.post("/turnos").send({}).expect(401);
    await anon.get("/doctores").expect(401);
    await anon.get("/disponibilidad").expect(401);
  });
});
