import "dotenv/config";
import argon2 from "argon2";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient, Rol } from "../apps/api/src/generated/prisma/client";
import { utcToLocal, addDays } from "../apps/api/src/common/time";
import { generateSlots } from "../apps/api/src/disponibilidad/slots";

// Fictional demo data only. Not real clinic data.
const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
});

const ESPECIALIDADES = [
  "Clínica médica",
  "Pediatría",
  "Ginecología",
  "Cardiología",
  "Dermatología",
];

const DOCTORES: { nombre: string; esp: string; dias: number[]; ini: string; fin: string }[] = [
  { nombre: "Dra. Laura Benítez", esp: "Clínica médica", dias: [1, 2, 3, 4, 5], ini: "08:00", fin: "12:00" },
  { nombre: "Dr. Martín Sosa", esp: "Clínica médica", dias: [1, 3, 5], ini: "15:00", fin: "19:00" },
  { nombre: "Dra. Carolina Ibarra", esp: "Pediatría", dias: [1, 2, 4], ini: "09:00", fin: "13:00" },
  { nombre: "Dr. Gabriel Romero", esp: "Pediatría", dias: [3, 5], ini: "14:00", fin: "18:00" },
  { nombre: "Dra. Valeria Acosta", esp: "Ginecología", dias: [2, 4], ini: "15:00", fin: "19:00" },
  { nombre: "Dr. Federico Duarte", esp: "Cardiología", dias: [1, 3], ini: "09:00", fin: "12:00" },
  { nombre: "Dra. Natalia Giménez", esp: "Dermatología", dias: [2, 5], ini: "10:00", fin: "14:00" },
];

async function main() {
  const password = process.env.SEED_PASSWORD ?? "Demo1234!";
  const passwordHash = await argon2.hash(password);

  // Idempotent: wipe the demo clinic and rebuild it.
  const previas = await prisma.clinica.findMany({ where: { nombre: "Clínica Demo" }, select: { id: true } });
  for (const { id: clinicaId } of previas) {
    const where = { clinicaId };
    await prisma.auditoria.deleteMany({ where });
    await prisma.turno.deleteMany({ where });
    await prisma.conversacion.deleteMany({ where });
    await prisma.usuario.deleteMany({ where });
    await prisma.horarioDoctor.deleteMany({ where });
    await prisma.paciente.deleteMany({ where });
    await prisma.doctor.deleteMany({ where });
    await prisma.especialidad.deleteMany({ where });
    await prisma.clinica.delete({ where: { id: clinicaId } });
  }
  const clinica = await prisma.clinica.create({ data: { nombre: "Clínica Demo" } });
  const clinicaId = clinica.id;

  const espIds = new Map<string, string>();
  for (const nombre of ESPECIALIDADES) {
    const e = await prisma.especialidad.create({ data: { clinicaId, nombre } });
    espIds.set(nombre, e.id);
  }

  const doctorIds: string[] = [];
  for (const d of DOCTORES) {
    const doc = await prisma.doctor.create({
      data: {
        clinicaId,
        nombre: d.nombre,
        especialidadId: espIds.get(d.esp)!,
        horarios: {
          create: d.dias.map((diaSemana) => ({
            clinicaId,
            diaSemana,
            horaInicio: d.ini,
            horaFin: d.fin,
          })),
        },
      },
    });
    doctorIds.push(doc.id);
  }

  await prisma.usuario.createMany({
    data: [
      { clinicaId, email: "admin@demo.test", passwordHash, rol: Rol.ADMIN },
      { clinicaId, email: "recepcion@demo.test", passwordHash, rol: Rol.RECEPCION },
      { clinicaId, email: "doctor@demo.test", passwordHash, rol: Rol.DOCTOR, doctorId: doctorIds[0] },
    ],
  });

  const NOMBRES = [
    "Paciente Ficticio Uno",
    "Paciente Ficticio Dos",
    "Paciente Ficticio Tres",
    "Paciente Ficticio Cuatro",
    "Paciente Ficticio Cinco",
    "Paciente Ficticio Seis",
    "Paciente Ficticio Siete",
    "Paciente Ficticio Ocho",
  ];
  const pacienteIds: string[] = [];
  for (const [i, nombre] of NOMBRES.entries()) {
    const p = await prisma.paciente.create({
      data: {
        clinicaId,
        nombre,
        // Dos y Tres comparten teléfono a propósito (familiares).
        telefono: `+54000000000${String((i === 2 ? 1 : i) + 1).padStart(2, "0")}`,
        dni: String(10000001 + i),
      },
    });
    pacienteIds.push(p.id);
  }

  // Demo appointments for the next few days. Dr. Duarte, Dr. Romero and Dr. Sosa are left free on purpose
  // (the automated tests book slots with them).
  const tz = clinica.timezone;
  const hoy = utcToLocal(new Date(), tz).date;
  let n = 0;
  for (const idx of [0, 2, 4, 6]) {
    const franjas = await prisma.horarioDoctor.findMany({ where: { doctorId: doctorIds[idx] } });
    for (let dia = 0; dia < 4; dia++) {
      const slots = generateSlots(franjas, 60, addDays(hoy, dia), tz).filter((s) => s.inicio.getTime() > Date.now());
      for (const [i, slot] of slots.entries()) {
        if (i % 2 === 1) continue; // leave every other slot free
        await prisma.turno.create({
          data: {
            clinicaId,
            doctorId: doctorIds[idx],
            pacienteId: pacienteIds[n % pacienteIds.length],
            inicio: slot.inicio,
            fin: slot.fin,
            origen: n % 3 === 0 ? "BOT" : "PANEL",
          },
        });
        n++;
      }
    }
  }

  console.log("Seed OK. Users: admin@demo.test, recepcion@demo.test, doctor@demo.test");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
