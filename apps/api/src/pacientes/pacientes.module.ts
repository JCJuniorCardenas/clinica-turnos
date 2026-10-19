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
  UseGuards,
} from "@nestjs/common";
import { IsOptional, IsString, Matches, MaxLength, MinLength } from "class-validator";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { CurrentUser } from "../common/current-user";
import { isUniqueViolation } from "../common/db-errors";
import { Roles, RolesGuard } from "../common/roles";
import type { AuthUser } from "../common/roles";
import { PrismaService } from "../prisma/prisma.service";

class CreatePacienteDto {
  @IsString() @MinLength(2) @MaxLength(120) nombre: string;
  @Matches(/^\+?\d{6,20}$/, { message: "telefono debe tener solo números (con + opcional)" }) telefono: string;
  @IsOptional() @Matches(/^\d{6,9}$/, { message: "dni debe tener entre 6 y 9 dígitos" }) dni?: string;
}

class UpdatePacienteDto {
  @IsOptional() @IsString() @MinLength(2) @MaxLength(120) nombre?: string;
  @IsOptional() @Matches(/^\+?\d{6,20}$/) telefono?: string;
  @IsOptional() @Matches(/^\d{6,9}$/) dni?: string;
}

@Injectable()
export class PacientesService {
  constructor(private prisma: PrismaService) {}

  search(clinicaId: string, q: { telefono?: string; dni?: string; q?: string }) {
    return this.prisma.paciente.findMany({
      where: {
        clinicaId,
        ...(q.telefono ? { telefono: q.telefono } : {}),
        ...(q.dni ? { dni: q.dni } : {}),
        ...(q.q ? { nombre: { contains: q.q, mode: "insensitive" as const } } : {}),
      },
      orderBy: { nombre: "asc" },
      take: 50,
    });
  }

  async get(clinicaId: string, id: string) {
    const p = await this.prisma.paciente.findFirst({ where: { id, clinicaId } });
    if (!p) throw new NotFoundException("Paciente no encontrado");
    return p;
  }

  async create(clinicaId: string, dto: CreatePacienteDto) {
    try {
      return await this.prisma.paciente.create({ data: { clinicaId, ...dto, nombre: dto.nombre.trim() } });
    } catch (e) {
      if (isUniqueViolation(e)) throw new ConflictException("Ya existe un paciente con ese DNI");
      throw e;
    }
  }

  async update(clinicaId: string, id: string, dto: UpdatePacienteDto) {
    await this.get(clinicaId, id);
    try {
      return await this.prisma.paciente.update({ where: { id }, data: dto });
    } catch (e) {
      if (isUniqueViolation(e)) throw new ConflictException("Ya existe un paciente con ese DNI");
      throw e;
    }
  }
}

@Controller("pacientes")
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles("ADMIN", "RECEPCION")
export class PacientesController {
  constructor(private service: PacientesService) {}

  @Get()
  search(
    @CurrentUser() u: AuthUser,
    @Query("telefono") telefono?: string,
    @Query("dni") dni?: string,
    @Query("q") q?: string,
  ) {
    return this.service.search(u.clinicaId, { telefono, dni, q });
  }

  @Get(":id")
  get(@CurrentUser() u: AuthUser, @Param("id") id: string) {
    return this.service.get(u.clinicaId, id);
  }

  @Post()
  create(@CurrentUser() u: AuthUser, @Body() dto: CreatePacienteDto) {
    return this.service.create(u.clinicaId, dto);
  }

  @Patch(":id")
  update(@CurrentUser() u: AuthUser, @Param("id") id: string, @Body() dto: UpdatePacienteDto) {
    return this.service.update(u.clinicaId, id, dto);
  }
}

@Module({ controllers: [PacientesController], providers: [PacientesService], exports: [PacientesService] })
export class PacientesModule {}
