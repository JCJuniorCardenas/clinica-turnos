import { localToUtc, toMinutes, weekdayOf } from "../common/time";

export interface Franja {
  diaSemana: number;
  horaInicio: string;
  horaFin: string;
}

export interface Slot {
  inicio: Date;
  fin: Date;
}

/**
 * Slots a doctor offers on one clinic-local calendar date, ignoring existing appointments.
 * A slot is only generated when it fits entirely inside a working block.
 */
export function generateSlots(franjas: Franja[], duracionMin: number, date: string, tz: string): Slot[] {
  const dia = weekdayOf(date);
  const slots: Slot[] = [];
  for (const f of franjas.filter((x) => x.diaSemana === dia)) {
    const start = toMinutes(f.horaInicio);
    const end = toMinutes(f.horaFin);
    for (let t = start; t + duracionMin <= end; t += duracionMin) {
      const hh = String(Math.floor(t / 60)).padStart(2, "0");
      const mm = String(t % 60).padStart(2, "0");
      const inicio = localToUtc(date, `${hh}:${mm}`, tz);
      slots.push({ inicio, fin: new Date(inicio.getTime() + duracionMin * 60000) });
    }
  }
  return slots.sort((a, b) => a.inicio.getTime() - b.inicio.getTime());
}
