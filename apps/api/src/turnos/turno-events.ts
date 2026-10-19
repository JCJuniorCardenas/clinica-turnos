import { Global, Injectable, Module } from "@nestjs/common";
import { EventEmitter } from "node:events";

export type TurnoEventType = "turno.creado" | "turno.cancelado" | "turno.reprogramado" | "turno.estado";

export interface TurnoEvent {
  type: TurnoEventType;
  clinicaId: string;
  doctorId: string;
  turnoId: string;
  inicio: Date;
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
