import {
  Body,
  ConflictException,
  Controller,
  Get,
  Injectable,
  Module,
  NotFoundException,
  Param,
  Patch,
  Post,
  Query,
  UnprocessableEntityException,
  UseGuards,
} from "@nestjs/common";
import { IsDateString, IsIn, IsOptional, IsString, Matches } from "class-validator";
import { AuditoriaService } from "../auditoria/auditoria.service";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { CurrentUser } from "../common/current-user";
import { isUniqueViolation } from "../common/db-errors";
import { Roles, RolesGuard } from "../common/roles";
import type { AuthUser } from "../common/roles";
import { DATE_RE, addDays, dateRange, isValidDate, localToUtc, utcToLocal } from "../common/time";
import { DisponibilidadModule, DisponibilidadService, MAX_RANGE_DAYS } from "../disponibilidad/disponibilidad.module";
import { PrismaService } from "../prisma/prisma.service";
import { AgendaController, AgendaService, TurnosStreamController } from "./agenda";
import { TurnoEvents } from "./turno-events";
import type { TurnoEventType } from "./turno-events";

const ACTIVOS = ["PENDIENTE", "CONFIRMADO"] as const;

class CreateTurnoDto {
  @IsString() doctorId: string;
  @IsString() pacienteId: string;
  @IsDateString() inicio: string;
}

class ReprogramarDto {
  @IsDateString() nuevaFechaHora: string;
}

class EstadoDto {
  @IsIn(["ATENDIDO", "AUSENTE"]) estado: "ATENDIDO" | "AUSENTE";
}

class ListQuery {
  @IsOptional() @Matches(DATE_RE) desde?: string;
  @IsOptional() @Matches(DATE_RE) hasta?: string;
  @IsOptional() @IsString() doctorId?: string;
  @IsOptional() @IsIn(["true", "false"]) incluirCancelados?: string;
}

@Injectable()
export class TurnosService {
  constructor(
    private prisma: PrismaService,
    private disp: DisponibilidadService,
    private audit: AuditoriaService,
    private events: TurnoEvents,
  ) {}

  private emit(
    type: TurnoEventType,
    t: { clinicaId: string; doctorId: string; id: string; inicio: Date },
    actor: string,
  ) {
    this.events.emit({ type, clinicaId: t.clinicaId, doctorId: t.doctorId, turnoId: t.id, inicio: t.inicio, actor });
  }

  private async conflict(clinicaId: string, doctorId: string): Promise<ConflictException> {
    const alternativas = await this.disp.proximos(clinicaId, doctorId).catch(() => []);
    return new ConflictException({
      statusCode: 409,
      message: "Ese horario ya fue tomado",
      error: "Conflict",
      alternativas,
    });
  }

  private async getTurno(u: AuthUser, id: string) {
    const t = await this.prisma.turno.findFirst({
      where: { id, clinicaId: u.clinicaId, ...(u.rol === "DOCTOR" ? { doctorId: u.doctorId ?? "none" } : {}) },
    });
    if (!t) throw new NotFoundException("Turno no encontrado");
    return t;
  }

  async list(u: AuthUser, q: ListQuery) {
    const tz = await this.disp.getTimezone(u.clinicaId);
    const today = utcToLocal(new Date(), tz).date;
    const desde = q.desde ?? today;
    const hasta = q.hasta ?? desde;
    if (!isValidDate(desde) || !isValidDate(hasta) || hasta < desde) {
      throw new UnprocessableEntityException("Rango de fechas inválido");
    }
    if (dateRange(desde, hasta).length > MAX_RANGE_DAYS) {
      throw new UnprocessableEntityException(`El rango máximo es de ${MAX_RANGE_DAYS} días`);
    }
    const doctorId = u.rol === "DOCTOR" ? (u.doctorId ?? "none") : q.doctorId;
    return this.prisma.turno.findMany({
      where: {
        clinicaId: u.clinicaId,
        inicio: { gte: localToUtc(desde, "00:00", tz), lt: localToUtc(addDays(hasta, 1), "00:00", tz) },
        ...(doctorId ? { doctorId } : {}),
        ...(q.incluirCancelados === "true" ? {} : { estado: { not: "CANCELADO" as const } }),
      },
      include: {
        paciente: { select: { id: true, nombre: true, telefono: true, dni: true } },
        doctor: { select: { id: true, nombre: true } },
      },
      orderBy: { inicio: "asc" },
    });
  }

  async get(u: AuthUser, id: string) {
    await this.getTurno(u, id);
    return this.prisma.turno.findFirst({
      where: { id, clinicaId: u.clinicaId },
      include: { paciente: true, doctor: { select: { id: true, nombre: true } } },
    });
  }

  async crear(u: AuthUser, dto: CreateTurnoDto, origen = "PANEL") {
    const doctor = await this.disp.getDoctorActivo(u.clinicaId, dto.doctorId);
    const paciente = await this.prisma.paciente.findFirst({ where: { id: dto.pacienteId, clinicaId: u.clinicaId } });
    if (!paciente) throw new NotFoundException("Paciente no encontrado");

    const inicio = new Date(dto.inicio);
    await this.disp.assertSlotValido(u.clinicaId, doctor, inicio);
    const fin = new Date(inicio.getTime() + doctor.duracionTurnoMin * 60000);

    try {
      const turno = await this.prisma.$transaction(async (tx) => {
        const t = await tx.turno.create({
          data: { clinicaId: u.clinicaId, doctorId: doctor.id, pacienteId: paciente.id, inicio, fin, origen },
        });
        await this.audit.record(
          {
            clinicaId: u.clinicaId,
            actor: u.userId,
            accion: "TURNO_CREADO",
            entidad: "Turno",
            entidadId: t.id,
            detalle: { doctorId: doctor.id, pacienteId: paciente.id, inicio: inicio.toISOString(), origen },
          },
          tx,
        );
        return t;
      });
      this.emit("turno.creado", turno, u.userId);
      return turno;
    } catch (e) {
      // The partial unique index decides who wins a race; the loser gets alternatives.
      if (isUniqueViolation(e)) throw await this.conflict(u.clinicaId, doctor.id);
      throw e;
    }
  }

  async cancelar(u: AuthUser, id: string) {
    const t = await this.getTurno(u, id);
    if (!ACTIVOS.includes(t.estado as (typeof ACTIVOS)[number])) {
      throw new UnprocessableEntityException(`El turno ya está ${t.estado.toLowerCase()}`);
    }
    const updated = await this.prisma.$transaction(async (tx) => {
      const r = await tx.turno.update({ where: { id }, data: { estado: "CANCELADO" } });
      await this.audit.record(
        {
          clinicaId: u.clinicaId,
          actor: u.userId,
          accion: "TURNO_CANCELADO",
          entidad: "Turno",
          entidadId: id,
          detalle: { inicio: t.inicio.toISOString(), estadoAnterior: t.estado },
        },
        tx,
      );
      return r;
    });
    this.emit("turno.cancelado", updated, u.userId);
    return updated;
  }

  async reprogramar(u: AuthUser, id: string, nuevaFechaHora: string) {
    const t = await this.getTurno(u, id);
    if (!ACTIVOS.includes(t.estado as (typeof ACTIVOS)[number])) {
      throw new UnprocessableEntityException(`No se puede reprogramar un turno ${t.estado.toLowerCase()}`);
    }
    const doctor = await this.disp.getDoctorActivo(u.clinicaId, t.doctorId);
    const inicio = new Date(nuevaFechaHora);
    if (inicio.getTime() === t.inicio.getTime()) {
      throw new UnprocessableEntityException("El turno ya está en ese horario");
    }
    await this.disp.assertSlotValido(u.clinicaId, doctor, inicio);
    const fin = new Date(inicio.getTime() + doctor.duracionTurnoMin * 60000);

    try {
      const updated = await this.prisma.$transaction(async (tx) => {
        const r = await tx.turno.update({ where: { id }, data: { inicio, fin } });
        await this.audit.record(
          {
            clinicaId: u.clinicaId,
            actor: u.userId,
            accion: "TURNO_REPROGRAMADO",
            entidad: "Turno",
            entidadId: id,
            detalle: { desde: t.inicio.toISOString(), hasta: inicio.toISOString() },
          },
          tx,
        );
        return r;
      });
      this.emit("turno.reprogramado", updated, u.userId);
      return updated;
    } catch (e) {
      if (isUniqueViolation(e)) throw await this.conflict(u.clinicaId, t.doctorId);
      throw e;
    }
  }

  async marcarEstado(u: AuthUser, id: string, estado: "ATENDIDO" | "AUSENTE") {
    const t = await this.getTurno(u, id);
    if (!ACTIVOS.includes(t.estado as (typeof ACTIVOS)[number])) {
      throw new UnprocessableEntityException(`El turno ya está ${t.estado.toLowerCase()}`);
    }
    const updated = await this.prisma.$transaction(async (tx) => {
      const r = await tx.turno.update({ where: { id }, data: { estado } });
      await this.audit.record(
        {
          clinicaId: u.clinicaId,
          actor: u.userId,
          accion: `TURNO_${estado}`,
          entidad: "Turno",
          entidadId: id,
          detalle: { estadoAnterior: t.estado },
        },
        tx,
      );
      return r;
    });
    this.emit("turno.estado", updated, u.userId);
    return updated;
  }
}

@Controller("turnos")
@UseGuards(JwtAuthGuard, RolesGuard)
export class TurnosController {
  constructor(private service: TurnosService) {}

  @Get()
  list(@CurrentUser() u: AuthUser, @Query() q: ListQuery) {
    return this.service.list(u, q);
  }

  @Get(":id")
  get(@CurrentUser() u: AuthUser, @Param("id") id: string) {
    return this.service.get(u, id);
  }

  @Post()
  @Roles("ADMIN", "RECEPCION")
  create(@CurrentUser() u: AuthUser, @Body() dto: CreateTurnoDto) {
    return this.service.crear(u, dto);
  }

  @Patch(":id/cancelar")
  @Roles("ADMIN", "RECEPCION")
  cancelar(@CurrentUser() u: AuthUser, @Param("id") id: string) {
    return this.service.cancelar(u, id);
  }

  @Patch(":id/reprogramar")
  @Roles("ADMIN", "RECEPCION")
  reprogramar(@CurrentUser() u: AuthUser, @Param("id") id: string, @Body() dto: ReprogramarDto) {
    return this.service.reprogramar(u, id, dto.nuevaFechaHora);
  }

  @Patch(":id/estado")
  marcarEstado(@CurrentUser() u: AuthUser, @Param("id") id: string, @Body() dto: EstadoDto) {
    return this.service.marcarEstado(u, id, dto.estado);
  }
}

@Module({
  imports: [DisponibilidadModule],
  // The stream controller goes first so "turnos/stream" is not captured by "turnos/:id".
  controllers: [TurnosStreamController, TurnosController, AgendaController],
  providers: [TurnosService, AgendaService],
  exports: [TurnosService],
})
export class TurnosModule {}
