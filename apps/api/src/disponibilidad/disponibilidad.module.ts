import {
  Controller,
  ForbiddenException,
  Get,
  Injectable,
  Module,
  NotFoundException,
  Query,
  UnprocessableEntityException,
  UseGuards,
} from "@nestjs/common";
import { IsString, Matches } from "class-validator";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { CurrentUser } from "../common/current-user";
import { RolesGuard } from "../common/roles";
import type { AuthUser } from "../common/roles";
import { DATE_RE, addDays, dateRange, isValidDate, localToUtc, utcToLocal } from "../common/time";
import { PrismaService } from "../prisma/prisma.service";
import { generateSlots } from "./slots";

export const MAX_RANGE_DAYS = 31;

class DisponibilidadQuery {
  @IsString() doctorId: string;
  @Matches(DATE_RE, { message: "desde debe tener formato YYYY-MM-DD" }) desde: string;
  @Matches(DATE_RE, { message: "hasta debe tener formato YYYY-MM-DD" }) hasta: string;
}

@Injectable()
export class DisponibilidadService {
  constructor(private prisma: PrismaService) {}

  async getTimezone(clinicaId: string): Promise<string> {
    const c = await this.prisma.clinica.findUnique({ where: { id: clinicaId } });
    if (!c) throw new NotFoundException("Clínica no encontrada");
    return c.timezone;
  }

  async getDoctorActivo(clinicaId: string, doctorId: string) {
    const d = await this.prisma.doctor.findFirst({ where: { id: doctorId, clinicaId } });
    if (!d) throw new NotFoundException("Doctor no encontrado");
    if (!d.activo) throw new UnprocessableEntityException("El doctor no está activo");
    return d;
  }

  /** Free slots in [desde, hasta] (clinic-local dates, inclusive): working blocks minus active appointments, minus the past. */
  async buscar(clinicaId: string, doctorId: string, desde: string, hasta: string) {
    if (!isValidDate(desde) || !isValidDate(hasta)) throw new UnprocessableEntityException("Fecha inválida");
    if (hasta < desde) throw new UnprocessableEntityException("'hasta' no puede ser anterior a 'desde'");
    if (dateRange(desde, hasta).length > MAX_RANGE_DAYS) {
      throw new UnprocessableEntityException(`El rango máximo es de ${MAX_RANGE_DAYS} días`);
    }
    const doctor = await this.getDoctorActivo(clinicaId, doctorId);
    const tz = await this.getTimezone(clinicaId);
    const franjas = await this.prisma.horarioDoctor.findMany({ where: { clinicaId, doctorId } });

    const from = localToUtc(desde, "00:00", tz);
    const to = localToUtc(addDays(hasta, 1), "00:00", tz);
    const ocupados = await this.prisma.turno.findMany({
      where: { clinicaId, doctorId, estado: { not: "CANCELADO" }, inicio: { gte: from, lt: to } },
      select: { inicio: true },
    });
    const taken = new Set(ocupados.map((t) => t.inicio.getTime()));
    const now = Date.now();

    const slots = dateRange(desde, hasta)
      .flatMap((date) => generateSlots(franjas, doctor.duracionTurnoMin, date, tz))
      .filter((s) => s.inicio.getTime() > now && !taken.has(s.inicio.getTime()))
      .map((s) => ({ inicio: s.inicio.toISOString(), fin: s.fin.toISOString() }));

    return { doctorId, duracionTurnoMin: doctor.duracionTurnoMin, timezone: tz, slots };
  }

  /** Throws 422 unless `inicio` is in the future and lines up exactly with one of the doctor's slots. */
  async assertSlotValido(clinicaId: string, doctor: { id: string; duracionTurnoMin: number }, inicio: Date) {
    if (Number.isNaN(inicio.getTime())) throw new UnprocessableEntityException("Fecha y hora inválidas");
    if (inicio.getTime() <= Date.now()) throw new UnprocessableEntityException("No se puede sacar un turno en el pasado");
    const tz = await this.getTimezone(clinicaId);
    const franjas = await this.prisma.horarioDoctor.findMany({ where: { clinicaId, doctorId: doctor.id } });
    const { date } = utcToLocal(inicio, tz);
    const valid = generateSlots(franjas, doctor.duracionTurnoMin, date, tz).some(
      (s) => s.inicio.getTime() === inicio.getTime(),
    );
    if (!valid) throw new UnprocessableEntityException("Ese horario no está dentro de la agenda del doctor");
  }

  /** Next free slots, used to offer alternatives after a conflict. */
  async proximos(clinicaId: string, doctorId: string, limit = 5) {
    const tz = await this.getTimezone(clinicaId);
    const today = utcToLocal(new Date(), tz).date;
    const { slots } = await this.buscar(clinicaId, doctorId, today, addDays(today, 14));
    return slots.slice(0, limit);
  }
}

@Controller("disponibilidad")
@UseGuards(JwtAuthGuard, RolesGuard)
export class DisponibilidadController {
  constructor(private service: DisponibilidadService) {}

  @Get()
  buscar(@CurrentUser() u: AuthUser, @Query() q: DisponibilidadQuery) {
    if (u.rol === "DOCTOR" && u.doctorId !== q.doctorId) throw new ForbiddenException();
    return this.service.buscar(u.clinicaId, q.doctorId, q.desde, q.hasta);
  }
}

@Module({
  controllers: [DisponibilidadController],
  providers: [DisponibilidadService],
  exports: [DisponibilidadService],
})
export class DisponibilidadModule {}
