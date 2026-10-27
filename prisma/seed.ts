import "dotenv/config";
import argon2 from "argon2";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient, Rol } from "../apps/api/src/generated/prisma/client";
import { cargarPacientesYTurnos } from "./demo-data";

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
  // A real client's deployment must never get the fictional demo clinic and its demo users.
  if (process.env.SKIP_SEED === "true") {
    console.log("Seed omitido: SKIP_SEED=true.");
    return;
  }
  // Used on deploy: load the demo only the first time, never wipe an existing database.
  if (process.env.SEED_ONLY_IF_EMPTY === "true" && (await prisma.clinica.count()) > 0) {
    console.log("Seed omitido: la base ya tiene datos.");
    return;
  }
  const password = process.env.SEED_PASSWORD ?? "Demo1234!";
  // A public deployment must never end up with the well-known example password.
  if (process.env.NODE_ENV === "production" && (process.env.SEED_PASSWORD ?? "").length < 10) {
    throw new Error("En producción SEED_PASSWORD es obligatoria y debe tener al menos 10 caracteres.");
  }
  const passwordHash = await argon2.hash(password);

  // Optional separate password for the read-only doctor user, so it can be shared publicly
  // (portfolio demo) without exposing the admin and reception accounts.
  const doctorPassword = process.env.SEED_DOCTOR_PASSWORD;
  if (process.env.NODE_ENV === "production" && doctorPassword !== undefined && doctorPassword.length < 10) {
    throw new Error("En producción SEED_DOCTOR_PASSWORD, si se define, debe tener al menos 10 caracteres.");
  }
  const doctorPasswordHash = doctorPassword ? await argon2.hash(doctorPassword) : passwordHash;

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
      { clinicaId, email: "doctor@demo.test", passwordHash: doctorPasswordHash, rol: Rol.DOCTOR, doctorId: doctorIds[0] },
    ],
  });

  await cargarPacientesYTurnos(prisma, clinica);

  console.log("Seed OK. Users: admin@demo.test, recepcion@demo.test, doctor@demo.test");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
