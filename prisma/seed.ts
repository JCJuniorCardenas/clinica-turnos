import "dotenv/config";
import argon2 from "argon2";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient, Rol } from "../apps/api/src/generated/prisma/client";

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
  await prisma.clinica.deleteMany({ where: { nombre: "Clínica Demo" } });
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

  await prisma.paciente.createMany({
    data: [
      { clinicaId, nombre: "Paciente Ficticio Uno", telefono: "+5400000000001", dni: "10000001" },
      { clinicaId, nombre: "Paciente Ficticio Dos", telefono: "+5400000000002", dni: "10000002" },
      { clinicaId, nombre: "Paciente Ficticio Tres", telefono: "+5400000000002", dni: "10000003" },
    ],
  });

  console.log("Seed OK. Users: admin@demo.test, recepcion@demo.test, doctor@demo.test");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
