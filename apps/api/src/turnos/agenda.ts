import {
  Controller,
  Get,
  Injectable,
  MessageEvent,
  Query,
  Sse,
  UnprocessableEntityException,
  UseGuards,
} from "@nestjs/common";
import { IsOptional, IsString, Matches } from "class-validator";
import { Observable } from "rxjs";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { CurrentUser } from "../common/current-user";
import { RolesGuard } from "../common/roles";
import type { AuthUser } from "../common/roles";
import { DATE_RE, addDays, isValidDate, localToUtc, utcToLocal } from "../common/time";
import { DisponibilidadService } from "../disponibilidad/disponibilidad.module";
import { generateSlots } from "../disponibilidad/slots";
import { PrismaService } from "../prisma/prisma.service";
import { TurnoEvents, canReceive } from "./turno-events";

class AgendaQuery {
  @IsOptional() @Matches(DATE_RE) fecha?: string;
  @IsOptional() @IsString() doctorId?: string;
}

@Injectable()
export class AgendaService {
  constructor(
    private prisma: PrismaService,
    private disp: DisponibilidadService,
  ) {}

  /** One day of the paper-style grid: every active doctor with their slots, each either free or holding an appointment. */
  async dia(u: AuthUser, fechaParam?: string, doctorId?: string) {
    const tz = await this.disp.getTimezone(u.clinicaId);
    const fecha = fechaParam ?? utcToLocal(new Date(), tz).date;
    if (!isValidDate(fecha)) throw new UnprocessableEntityException("Fecha inválida");

    const scopedDoctor = u.rol === "DOCTOR" ? (u.doctorId ?? "none") : doctorId;
    const doctores = await this.prisma.doctor.findMany({
      where: { clinicaId: u.clinicaId, activo: true, ...(scopedDoctor ? { id: scopedDoctor } : {}) },
      include: { especialidad: { select: { nombre: true } } },
      orderBy: { nombre: "asc" },
    });
    const ids = doctores.map((d) => d.id);
    const [franjas, turnos] = await Promise.all([
      this.prisma.horarioDoctor.findMany({ where: { clinicaId: u.clinicaId, doctorId: { in: ids } } }),
      this.prisma.turno.findMany({
        where: {
          clinicaId: u.clinicaId,
          doctorId: { in: ids },
          estado: { not: "CANCELADO" },
          inicio: { gte: localToUtc(fecha, "00:00", tz), lt: localToUtc(addDays(fecha, 1), "00:00", tz) },
        },
        include: { paciente: { select: { id: true, nombre: true, telefono: true, dni: true } } },
      }),
    ]);

    const now = Date.now();
    return {
      fecha,
      timezone: tz,
      doctores: doctores.map((d) => {
        const mios = turnos.filter((t) => t.doctorId === d.id);
        const porInicio = new Map(mios.map((t) => [t.inicio.getTime(), t]));
        const grid = generateSlots(
          franjas.filter((f) => f.doctorId === d.id),
          d.duracionTurnoMin,
          fecha,
          tz,
        );
        const inGrid = new Set(grid.map((s) => s.inicio.getTime()));
        // Appointments that no longer line up with the schedule (schedule edited later) still show up.
        const extra = mios
          .filter((t) => !inGrid.has(t.inicio.getTime()))
          .map((t) => ({ inicio: t.inicio, fin: t.fin }));
        const slots = [...grid, ...extra]
          .sort((a, b) => a.inicio.getTime() - b.inicio.getTime())
          .map((s) => {
            const t = porInicio.get(s.inicio.getTime());
            return {
              inicio: s.inicio.toISOString(),
              fin: s.fin.toISOString(),
              pasado: s.inicio.getTime() <= now,
              turno: t
                ? { id: t.id, estado: t.estado, origen: t.origen, paciente: t.paciente }
                : null,
            };
          });
        return {
          id: d.id,
          nombre: d.nombre,
          especialidad: d.especialidad.nombre,
          duracionTurnoMin: d.duracionTurnoMin,
          slots,
        };
      }),
    };
  }
}

@Controller("agenda")
@UseGuards(JwtAuthGuard, RolesGuard)
export class AgendaController {
  constructor(private service: AgendaService) {}

  @Get()
  dia(@CurrentUser() u: AuthUser, @Query() q: AgendaQuery) {
    return this.service.dia(u, q.fecha, q.doctorId);
  }
}

/** Server-Sent Events: the browser keeps this request open and we push a message whenever an appointment changes. */
@Controller("turnos")
@UseGuards(JwtAuthGuard, RolesGuard)
export class TurnosStreamController {
  constructor(private events: TurnoEvents) {}

  @Sse("stream")
  stream(@CurrentUser() u: AuthUser): Observable<MessageEvent> {
    return new Observable<MessageEvent>((subscriber) => {
      subscriber.next({ data: { type: "ready" } });
      const unsubscribe = this.events.subscribe((e) => {
        if (!canReceive(u, e)) return;
        // No patient data goes through the stream: clients refetch what they need over the authenticated API.
        subscriber.next({
          data: {
            type: e.type,
            turnoId: e.turnoId,
            doctorId: e.doctorId,
            inicio: e.inicio?.toISOString() ?? null,
            actor: e.actor,
          },
        });
      });
      const heartbeat = setInterval(() => subscriber.next({ data: { type: "ping" } }), 25_000);
      return () => {
        unsubscribe();
        clearInterval(heartbeat);
      };
    });
  }
}
