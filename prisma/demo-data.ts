// Fictional patients and sample appointments for the demo. Shared by the seed and by the in-app "reset demo" action.
import { addDays, utcToLocal } from "../apps/api/src/common/time";
import { generateSlots } from "../apps/api/src/disponibilidad/slots";
import type { PrismaClient } from "../apps/api/src/generated/prisma/client";

const NOMBRES_PACIENTES = [
  "Paciente Ficticio Uno",
  "Paciente Ficticio Dos",
  "Paciente Ficticio Tres",
  "Paciente Ficticio Cuatro",
  "Paciente Ficticio Cinco",
  "Paciente Ficticio Seis",
  "Paciente Ficticio Siete",
  "Paciente Ficticio Ocho",
];

// Dr. Duarte, Dr. Romero and Dr. Sosa stay free on purpose: the automated tests and the live demo book with them.
const DOCTORES_CON_TURNOS = ["Dra. Laura Benítez", "Dra. Carolina Ibarra", "Dra. Valeria Acosta", "Dra. Natalia Giménez"];

type Db = Pick<PrismaClient, "paciente" | "turno" | "doctor" | "horarioDoctor">;

export async function cargarPacientesYTurnos(db: Db, clinica: { id: string; timezone: string }) {
  const pacienteIds: string[] = [];
  for (const [i, nombre] of NOMBRES_PACIENTES.entries()) {
    const p = await db.paciente.create({
      data: {
        clinicaId: clinica.id,
        nombre,
        // "Dos" and "Tres" share a phone on purpose (relatives).
        telefono: `+54000000000${String((i === 2 ? 1 : i) + 1).padStart(2, "0")}`,
        dni: String(10000001 + i),
      },
    });
    pacienteIds.push(p.id);
  }

  const hoy = utcToLocal(new Date(), clinica.timezone).date;
  let n = 0;
  for (const nombre of DOCTORES_CON_TURNOS) {
    const doctor = await db.doctor.findFirst({ where: { clinicaId: clinica.id, nombre } });
    if (!doctor) continue;
    const franjas = await db.horarioDoctor.findMany({ where: { doctorId: doctor.id } });
    for (let dia = 0; dia < 4; dia++) {
      const slots = generateSlots(franjas, doctor.duracionTurnoMin, addDays(hoy, dia), clinica.timezone).filter(
        (s) => s.inicio.getTime() > Date.now(),
      );
      for (const [i, slot] of slots.entries()) {
        if (i % 2 === 1) continue; // leave every other slot free
        await db.turno.create({
          data: {
            clinicaId: clinica.id,
            doctorId: doctor.id,
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
}

/** Removes patients, appointments, chats and audit rows of a clinic and reloads the sample ones. Keeps doctors, schedules and users. */
export async function reiniciarDatosDemo(
  prisma: PrismaClient,
  clinica: { id: string; timezone: string },
): Promise<void> {
  const where = { clinicaId: clinica.id };
  await prisma.$transaction(async (tx) => {
    await tx.auditoria.deleteMany({ where });
    await tx.turno.deleteMany({ where });
    await tx.conversacion.deleteMany({ where });
    await tx.paciente.deleteMany({ where });
    await cargarPacientesYTurnos(tx as unknown as PrismaClient, clinica);
  });
}
