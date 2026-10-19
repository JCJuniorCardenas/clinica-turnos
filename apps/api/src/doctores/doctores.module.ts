import {
  Body,
  Controller,
  Delete,
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
import { IsBoolean, IsInt, IsOptional, IsString, Matches, Max, MaxLength, Min, MinLength } from "class-validator";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { CurrentUser } from "../common/current-user";
import { Roles, RolesGuard } from "../common/roles";
import type { AuthUser } from "../common/roles";
import { TIME_RE, toMinutes } from "../common/time";
import { PrismaService } from "../prisma/prisma.service";

class CreateDoctorDto {
  @IsString() @MinLength(2) @MaxLength(120) nombre: string;
  @IsString() especialidadId: string;
  @IsOptional() @IsInt() @Min(5) @Max(480) duracionTurnoMin?: number;
}

class UpdateDoctorDto {
  @IsOptional() @IsString() @MinLength(2) @MaxLength(120) nombre?: string;
  @IsOptional() @IsString() especialidadId?: string;
  @IsOptional() @IsInt() @Min(5) @Max(480) duracionTurnoMin?: number;
  @IsOptional() @IsBoolean() activo?: boolean;
}

class HorarioDto {
  @IsInt() @Min(0) @Max(6) diaSemana: number;
  @Matches(TIME_RE, { message: "horaInicio debe tener formato HH:mm" }) horaInicio: string;
  @Matches(TIME_RE, { message: "horaFin debe tener formato HH:mm" }) horaFin: string;
}

class UpdateHorarioDto {
  @IsOptional() @IsInt() @Min(0) @Max(6) diaSemana?: number;
  @IsOptional() @Matches(TIME_RE) horaInicio?: string;
  @IsOptional() @Matches(TIME_RE) horaFin?: string;
}

@Injectable()
export class DoctoresService {
  constructor(private prisma: PrismaService) {}

  private async assertEspecialidad(clinicaId: string, especialidadId: string) {
    const e = await this.prisma.especialidad.findFirst({ where: { id: especialidadId, clinicaId } });
    if (!e) throw new UnprocessableEntityException("La especialidad no existe en esta clínica");
  }

  /** A DOCTOR only sees their own record. */
  private scope(u: AuthUser) {
    return u.rol === "DOCTOR" ? { clinicaId: u.clinicaId, id: u.doctorId ?? "none" } : { clinicaId: u.clinicaId };
  }

  list(u: AuthUser, especialidadId?: string) {
    return this.prisma.doctor.findMany({
      where: { ...this.scope(u), ...(especialidadId ? { especialidadId } : {}) },
      include: { especialidad: { select: { id: true, nombre: true } } },
      orderBy: { nombre: "asc" },
    });
  }

  async get(u: AuthUser, id: string) {
    const d = await this.prisma.doctor.findFirst({
      where: { AND: [this.scope(u), { id }] },
      include: { especialidad: { select: { id: true, nombre: true } } },
    });
    if (!d) throw new NotFoundException("Doctor no encontrado");
    return d;
  }

  async create(clinicaId: string, dto: CreateDoctorDto) {
    await this.assertEspecialidad(clinicaId, dto.especialidadId);
    return this.prisma.doctor.create({
      data: {
        clinicaId,
        nombre: dto.nombre.trim(),
        especialidadId: dto.especialidadId,
        ...(dto.duracionTurnoMin ? { duracionTurnoMin: dto.duracionTurnoMin } : {}),
      },
    });
  }

  async update(clinicaId: string, id: string, dto: UpdateDoctorDto) {
    const existing = await this.prisma.doctor.findFirst({ where: { id, clinicaId } });
    if (!existing) throw new NotFoundException("Doctor no encontrado");
    if (dto.especialidadId) await this.assertEspecialidad(clinicaId, dto.especialidadId);
    return this.prisma.doctor.update({
      where: { id },
      data: { ...dto, ...(dto.nombre ? { nombre: dto.nombre.trim() } : {}) },
    });
  }

  // ---- Horarios ----

  async listHorarios(u: AuthUser, doctorId: string) {
    await this.get(u, doctorId);
    return this.prisma.horarioDoctor.findMany({
      where: { clinicaId: u.clinicaId, doctorId },
      orderBy: [{ diaSemana: "asc" }, { horaInicio: "asc" }],
    });
  }

  private async assertHorarioValido(
    clinicaId: string,
    doctorId: string,
    h: { diaSemana: number; horaInicio: string; horaFin: string },
    excludeId?: string,
  ) {
    if (toMinutes(h.horaInicio) >= toMinutes(h.horaFin)) {
      throw new UnprocessableEntityException("horaInicio debe ser anterior a horaFin");
    }
    const sameDay = await this.prisma.horarioDoctor.findMany({
      where: { clinicaId, doctorId, diaSemana: h.diaSemana, ...(excludeId ? { id: { not: excludeId } } : {}) },
    });
    const overlap = sameDay.some(
      (o) => toMinutes(h.horaInicio) < toMinutes(o.horaFin) && toMinutes(o.horaInicio) < toMinutes(h.horaFin),
    );
    if (overlap) throw new UnprocessableEntityException("La franja se superpone con otra del mismo día");
  }

  async createHorario(clinicaId: string, doctorId: string, dto: HorarioDto) {
    const doc = await this.prisma.doctor.findFirst({ where: { id: doctorId, clinicaId } });
    if (!doc) throw new NotFoundException("Doctor no encontrado");
    await this.assertHorarioValido(clinicaId, doctorId, dto);
    return this.prisma.horarioDoctor.create({ data: { clinicaId, doctorId, ...dto } });
  }

  async updateHorario(clinicaId: string, id: string, dto: UpdateHorarioDto) {
    const h = await this.prisma.horarioDoctor.findFirst({ where: { id, clinicaId } });
    if (!h) throw new NotFoundException("Horario no encontrado");
    const merged = {
      diaSemana: dto.diaSemana ?? h.diaSemana,
      horaInicio: dto.horaInicio ?? h.horaInicio,
      horaFin: dto.horaFin ?? h.horaFin,
    };
    await this.assertHorarioValido(clinicaId, h.doctorId, merged, id);
    return this.prisma.horarioDoctor.update({ where: { id }, data: merged });
  }

  async removeHorario(clinicaId: string, id: string) {
    const h = await this.prisma.horarioDoctor.findFirst({ where: { id, clinicaId } });
    if (!h) throw new NotFoundException("Horario no encontrado");
    await this.prisma.horarioDoctor.delete({ where: { id } });
    return { ok: true };
  }
}

@Controller("doctores")
@UseGuards(JwtAuthGuard, RolesGuard)
export class DoctoresController {
  constructor(private service: DoctoresService) {}

  @Get()
  list(@CurrentUser() u: AuthUser, @Query("especialidadId") especialidadId?: string) {
    return this.service.list(u, especialidadId);
  }

  @Get(":id")
  get(@CurrentUser() u: AuthUser, @Param("id") id: string) {
    return this.service.get(u, id);
  }

  @Post()
  @Roles("ADMIN")
  create(@CurrentUser() u: AuthUser, @Body() dto: CreateDoctorDto) {
    return this.service.create(u.clinicaId, dto);
  }

  @Patch(":id")
  @Roles("ADMIN")
  update(@CurrentUser() u: AuthUser, @Param("id") id: string, @Body() dto: UpdateDoctorDto) {
    return this.service.update(u.clinicaId, id, dto);
  }

  @Get(":id/horarios")
  listHorarios(@CurrentUser() u: AuthUser, @Param("id") id: string) {
    return this.service.listHorarios(u, id);
  }

  @Post(":id/horarios")
  @Roles("ADMIN")
  createHorario(@CurrentUser() u: AuthUser, @Param("id") id: string, @Body() dto: HorarioDto) {
    return this.service.createHorario(u.clinicaId, id, dto);
  }
}

@Controller("horarios")
@UseGuards(JwtAuthGuard, RolesGuard)
export class HorariosController {
  constructor(private service: DoctoresService) {}

  @Patch(":id")
  @Roles("ADMIN")
  update(@CurrentUser() u: AuthUser, @Param("id") id: string, @Body() dto: UpdateHorarioDto) {
    return this.service.updateHorario(u.clinicaId, id, dto);
  }

  @Delete(":id")
  @Roles("ADMIN")
  remove(@CurrentUser() u: AuthUser, @Param("id") id: string) {
    return this.service.removeHorario(u.clinicaId, id);
  }
}

@Module({
  controllers: [DoctoresController, HorariosController],
  providers: [DoctoresService],
  exports: [DoctoresService],
})
export class DoctoresModule {}
