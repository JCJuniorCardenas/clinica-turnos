import { Global, Injectable, Module } from "@nestjs/common";
import { EventEmitter } from "node:events";

export type TurnoEventType = "turno.creado" | "turno.cancelado" | "turno.reprogramado" | "turno.estado";

export interface TurnoEvent {
  type: TurnoEventType;
  clinicaId: string;
  doctorId: string;
  turnoId: string;
  inicio: Date;
  /** userId of whoever caused the change ("BOT" for the WhatsApp bot). */
  actor: string;
}

/** Who may receive an event: same clinic, and a DOCTOR only their own appointments. */
export function canReceive(
  user: { clinicaId: string; rol: string; doctorId: string | null },
  event: Pick<TurnoEvent, "clinicaId" | "doctorId">,
): boolean {
  if (user.clinicaId !== event.clinicaId) return false;
  if (user.rol === "DOCTOR") return user.doctorId === event.doctorId;
  return true;
}

/** Internal event bus. Phase 3 plugs the live panel (SSE) into this. */
@Injectable()
export class TurnoEvents {
  private emitter = new EventEmitter();

  emit(event: TurnoEvent) {
    this.emitter.emit("turno", event);
  }

  subscribe(handler: (event: TurnoEvent) => void): () => void {
    this.emitter.on("turno", handler);
    return () => this.emitter.off("turno", handler);
  }
}

@Global()
@Module({ providers: [TurnoEvents], exports: [TurnoEvents] })
export class TurnoEventsModule {}
