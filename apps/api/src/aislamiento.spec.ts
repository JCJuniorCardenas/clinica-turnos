import type { INestApplication } from "@nestjs/common";
import { PrismaService } from "./prisma/prisma.service";
import { createApp, loginAs, nextWeekday } from "./test-utils";

// Clinic isolation: a user from clinic A must never see or change anything that belongs to clinic B.
describe("aislamiento entre clínicas (requires seeded DB)", () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let admin: Awaited<ReturnType<typeof loginAs>>;
  let recepcion: Awaited<ReturnType<typeof loginAs>>;
  let clinicaBId: string;
  const B: Record<string, string> = {};
  let doctorA: string;
  let turnoInicio: Date;

  beforeAll(async () => {
    app = await createApp();
    prisma = app.get(PrismaService);
    admin = await loginAs(app, "admin@demo.test");
    recepcion = await loginAs(app, "recepcion@demo.test");
    doctorA = (await recepcion.get("/doctores")).body[1].id;

    const clinicaB = await prisma.clinica.create({ data: { nombre: "Clínica Aislamiento Test" } });
    clinicaBId = clinicaB.id;
    const esp = await prisma.especialidad.create({ data: { clinicaId: clinicaBId, nombre: "Especialidad B" } });
    const doc = await prisma.doctor.create({ data: { clinicaId: clinicaBId, nombre: "Doctor B", especialidadId: esp.id } });
    const horario = await prisma.horarioDoctor.create({
      data: { clinicaId: clinicaBId, doctorId: doc.id, diaSemana: 1, horaInicio: "08:00", horaFin: "20:00" },
    });
    const pac = await prisma.paciente.create({
      data: { clinicaId: clinicaBId, nombre: "Paciente B", telefono: "+5400000009999", dni: "99999999" },
    });
    turnoInicio = new Date(`${nextWeekday(1)}T12:00:00.000Z`); // Monday 09:00 local
    const turno = await prisma.turno.create({
      data: {
        clinicaId: clinicaBId,
        doctorId: doc.id,
        pacienteId: pac.id,
        inicio: turnoInicio,
        fin: new Date(turnoInicio.getTime() + 3600000),
        origen: "PANEL",
      },
    });
    Object.assign(B, { esp: esp.id, doc: doc.id, horario: horario.id, pac: pac.id, turno: turno.id });
  });

  afterAll(async () => {
    const where = { clinicaId: clinicaBId };
    await prisma.auditoria.deleteMany({ where });
    await prisma.turno.deleteMany({ where });
    await prisma.horarioDoctor.deleteMany({ where });
    await prisma.paciente.deleteMany({ where });
    await prisma.doctor.deleteMany({ where });
    await prisma.especialidad.deleteMany({ where });
    await prisma.clinica.delete({ where: { id: clinicaBId } });
    // paciente created in clinic A by the DNI test
    await prisma.paciente.deleteMany({ where: { dni: "99999999" } });
    await app.close();
  });

  it("lists never include clinic B data", async () => {
    const fecha = turnoInicio.toISOString().slice(0, 10);
    const esps = (await admin.get("/especialidades").expect(200)).body;
    const docs = (await admin.get("/doctores").expect(200)).body;
    const pacs = (await recepcion.get("/pacientes?q=Paciente").expect(200)).body;
    const turnos = (await recepcion.get(`/turnos?desde=${fecha}&hasta=${fecha}`).expect(200)).body;
    expect(JSON.stringify(esps)).not.toContain(B.esp);
    expect(JSON.stringify(docs)).not.toContain(B.doc);
    expect(JSON.stringify(pacs)).not.toContain(B.pac);
    expect(JSON.stringify(turnos)).not.toContain(B.turno);
  });

  it("reading clinic B resources by id returns 404", async () => {
    await admin.get(`/doctores/${B.doc}`).expect(404);
    await admin.get(`/doctores/${B.doc}/horarios`).expect(404);
    await recepcion.get(`/pacientes/${B.pac}`).expect(404);
    await recepcion.get(`/turnos/${B.turno}`).expect(404);
    await recepcion.get(`/disponibilidad?doctorId=${B.doc}&desde=2030-01-01&hasta=2030-01-02`).expect(404);
  });

  it("modifying clinic B resources returns 404 and changes nothing", async () => {
    await admin.patch(`/doctores/${B.doc}`).send({ nombre: "Hackeado" }).expect(404);
    await admin.post(`/doctores/${B.doc}/horarios`).send({ diaSemana: 2, horaInicio: "08:00", horaFin: "09:00" }).expect(404);
    await admin.patch(`/horarios/${B.horario}`).send({ horaFin: "10:00" }).expect(404);
    await admin.delete(`/horarios/${B.horario}`).expect(404);
    await admin.patch(`/especialidades/${B.esp}`).send({ nombre: "Hackeada" }).expect(404);
    await admin.delete(`/especialidades/${B.esp}`).expect(404);
    await recepcion.patch(`/pacientes/${B.pac}`).send({ nombre: "Hackeado" }).expect(404);
    await recepcion.patch(`/turnos/${B.turno}/cancelar`).expect(404);
    await recepcion.patch(`/turnos/${B.turno}/reprogramar`).send({ nuevaFechaHora: new Date(Date.now() + 5 * 86400000).toISOString() }).expect(404);
    await recepcion.patch(`/turnos/${B.turno}/estado`).send({ estado: "ATENDIDO" }).expect(404);

    expect((await prisma.doctor.findUniqueOrThrow({ where: { id: B.doc } })).nombre).toBe("Doctor B");
    expect((await prisma.turno.findUniqueOrThrow({ where: { id: B.turno } })).estado).toBe("CONFIRMADO");
    expect(await prisma.horarioDoctor.count({ where: { id: B.horario } })).toBe(1);
    expect(await prisma.especialidad.count({ where: { id: B.esp } })).toBe(1);
  });

  it("cannot mix clinic B ids into clinic A writes", async () => {
    await admin.post("/doctores").send({ nombre: "Doctor X", especialidadId: B.esp }).expect(422);
    await recepcion.post("/turnos").send({ doctorId: B.doc, pacienteId: B.pac, inicio: turnoInicio.toISOString() }).expect(404);
    await recepcion.post("/turnos").send({ doctorId: doctorA, pacienteId: B.pac, inicio: new Date(Date.now() + 5 * 86400000).toISOString() }).expect(404);
  });

  it("DNI uniqueness is per clinic: the same DNI can exist in clinic A", async () => {
    await recepcion.post("/pacientes").send({ nombre: "Homónimo", telefono: "+5400000000077", dni: "99999999" }).expect(201);
    await recepcion.post("/pacientes").send({ nombre: "Otro", telefono: "+5400000000078", dni: "99999999" }).expect(409);
  });
});
