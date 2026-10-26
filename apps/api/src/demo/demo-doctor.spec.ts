import type { INestApplication } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { createApp, loginAs } from "../test-utils";

// A public portfolio demo shares only the DOCTOR account. These tests pin down that it is effectively read-only:
// it cannot spend AI quota, reset the data or change the agenda, and it only sees its own appointments.
describe("demo doctor account is read-only (requires seeded DB)", () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let doctor: Awaited<ReturnType<typeof loginAs>>;
  let recepcion: Awaited<ReturnType<typeof loginAs>>;
  let doctorId: string;
  let otroDoctorId: string;
  let pacienteId: string;
  let propioId: string;
  let ajenoId: string;
  let libre: string; // a free slot of the doctor, used as reprogramming target
  const previousDemoMode = process.env.DEMO_MODE;
  const creados: string[] = [];

  const diaEnAdelante = (n: number) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);

  beforeAll(async () => {
    process.env.DEMO_MODE = "true"; // the demo endpoints answer 404 when it is off; here we want the role check
    app = await createApp();
    prisma = app.get(PrismaService);
    doctor = await loginAs(app, "doctor@demo.test");
    recepcion = await loginAs(app, "recepcion@demo.test");

    doctorId = (await doctor.get("/auth/me").expect(200)).body.doctorId;
    const doctores = (await recepcion.get("/doctores").expect(200)).body as { id: string }[];
    otroDoctorId = doctores.find((d) => d.id !== doctorId)!.id;
    pacienteId = (await recepcion.get("/pacientes?q=Ficticio").expect(200)).body[0].id;

    const slotsDe = async (id: string) =>
      (await recepcion.get(`/disponibilidad?doctorId=${id}&desde=${diaEnAdelante(1)}&hasta=${diaEnAdelante(21)}`).expect(200)).body
        .slots as { inicio: string }[];
    const propios = await slotsDe(doctorId);
    const ajenos = await slotsDe(otroDoctorId);
    expect(propios.length).toBeGreaterThanOrEqual(2);
    expect(ajenos.length).toBeGreaterThanOrEqual(1);

    const propio = await recepcion.post("/turnos").send({ doctorId, pacienteId, inicio: propios[0].inicio }).expect(201);
    const ajeno = await recepcion.post("/turnos").send({ doctorId: otroDoctorId, pacienteId, inicio: ajenos[0].inicio }).expect(201);
    propioId = propio.body.id;
    ajenoId = ajeno.body.id;
    creados.push(propioId, ajenoId);
    libre = propios[1].inicio;
  });

  afterAll(async () => {
    await prisma.auditoria.deleteMany({ where: { entidadId: { in: creados } } });
    await prisma.turno.deleteMany({ where: { id: { in: creados } } });
    if (previousDemoMode === undefined) delete process.env.DEMO_MODE;
    else process.env.DEMO_MODE = previousDemoMode;
    await app.close();
  });

  it("cannot use the simulator chat or reset the demo data", async () => {
    await doctor.post("/demo/chat").send({ texto: "hola" }).expect(403);
    const pacientesAntes = await prisma.paciente.count();
    await doctor.post("/demo/reiniciar").expect(403);
    expect(await prisma.paciente.count()).toBe(pacientesAntes);
  });

  it("cannot create, cancel or reschedule appointments", async () => {
    await doctor.post("/turnos").send({ doctorId, pacienteId, inicio: libre }).expect(403);
    await doctor.patch(`/turnos/${propioId}/cancelar`).expect(403);
    await doctor.patch(`/turnos/${propioId}/reprogramar`).send({ nuevaFechaHora: libre }).expect(403);

    // nothing changed behind the scenes
    const intacto = await prisma.turno.findUniqueOrThrow({ where: { id: propioId } });
    expect(intacto.estado).toBe("CONFIRMADO");
  });

  it("cannot cancel or reschedule another doctor's appointment either", async () => {
    // 403 (role) or 404 (not visible): either way the appointment must stay untouched
    const cancel = await doctor.patch(`/turnos/${ajenoId}/cancelar`);
    const reprog = await doctor.patch(`/turnos/${ajenoId}/reprogramar`).send({ nuevaFechaHora: libre });
    expect([403, 404]).toContain(cancel.status);
    expect([403, 404]).toContain(reprog.status);
    expect((await prisma.turno.findUniqueOrThrow({ where: { id: ajenoId } })).estado).toBe("CONFIRMADO");
  });

  it("only sees its own appointments, even asking for another doctor's", async () => {
    const rango = `desde=${diaEnAdelante(0)}&hasta=${diaEnAdelante(30)}`;
    const propios = (await doctor.get(`/turnos?${rango}`).expect(200)).body as { id: string; doctorId: string }[];
    expect(propios.map((t) => t.id)).toContain(propioId);
    expect(propios.map((t) => t.id)).not.toContain(ajenoId);
    expect(propios.every((t) => t.doctorId === doctorId)).toBe(true);

    const pidiendoAjeno = (await doctor.get(`/turnos?${rango}&doctorId=${otroDoctorId}`).expect(200)).body as { doctorId: string }[];
    expect(pidiendoAjeno.every((t) => t.doctorId === doctorId)).toBe(true);

    await doctor.get(`/turnos/${ajenoId}`).expect(404);
  });
});
