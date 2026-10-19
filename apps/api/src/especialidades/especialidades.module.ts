import {
  Body,
  ConflictException,
  Controller,
  Delete,
  Get,
  Injectable,
  Module,
  NotFoundException,
  Param,
  Patch,
  Post,
  UseGuards,
} from "@nestjs/common";
import { IsString, MaxLength, MinLength } from "class-validator";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { CurrentUser } from "../common/current-user";
import { isUniqueViolation } from "../common/db-errors";
import { Roles, RolesGuard } from "../common/roles";
import type { AuthUser } from "../common/roles";
import { PrismaService } from "../prisma/prisma.service";

class EspecialidadDto {
  @IsString() @MinLength(2) @MaxLength(80) nombre: string;
}

@Injectable()
export class EspecialidadesService {
  constructor(private prisma: PrismaService) {}

  list(clinicaId: string) {
    return this.prisma.especialidad.findMany({ where: { clinicaId }, orderBy: { nombre: "asc" } });
  }

  private async get(clinicaId: string, id: string) {
    const e = await this.prisma.especialidad.findFirst({ where: { id, clinicaId } });
    if (!e) throw new NotFoundException("Especialidad no encontrada");
    return e;
  }

  async create(clinicaId: string, nombre: string) {
    try {
      return await this.prisma.especialidad.create({ data: { clinicaId, nombre: nombre.trim() } });
    } catch (e) {
      if (isUniqueViolation(e)) throw new ConflictException("Ya existe una especialidad con ese nombre");
      throw e;
    }
  }

  async update(clinicaId: string, id: string, nombre: string) {
    await this.get(clinicaId, id);
    try {
      return await this.prisma.especialidad.update({ where: { id }, data: { nombre: nombre.trim() } });
    } catch (e) {
      if (isUniqueViolation(e)) throw new ConflictException("Ya existe una especialidad con ese nombre");
      throw e;
    }
  }

  async remove(clinicaId: string, id: string) {
    await this.get(clinicaId, id);
    const doctores = await this.prisma.doctor.count({ where: { clinicaId, especialidadId: id } });
    if (doctores > 0) throw new ConflictException("No se puede borrar: tiene doctores asociados");
    await this.prisma.especialidad.delete({ where: { id } });
    return { ok: true };
  }
}

@Controller("especialidades")
@UseGuards(JwtAuthGuard, RolesGuard)
export class EspecialidadesController {
  constructor(private service: EspecialidadesService) {}

  @Get()
  list(@CurrentUser() u: AuthUser) {
    return this.service.list(u.clinicaId);
  }

  @Post()
  @Roles("ADMIN")
  create(@CurrentUser() u: AuthUser, @Body() dto: EspecialidadDto) {
    return this.service.create(u.clinicaId, dto.nombre);
  }

  @Patch(":id")
  @Roles("ADMIN")
  update(@CurrentUser() u: AuthUser, @Param("id") id: string, @Body() dto: EspecialidadDto) {
    return this.service.update(u.clinicaId, id, dto.nombre);
  }

  @Delete(":id")
  @Roles("ADMIN")
  remove(@CurrentUser() u: AuthUser, @Param("id") id: string) {
    return this.service.remove(u.clinicaId, id);
  }
}

@Module({ controllers: [EspecialidadesController], providers: [EspecialidadesService] })
export class EspecialidadesModule {}
