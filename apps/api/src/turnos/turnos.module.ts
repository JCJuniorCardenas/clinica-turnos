import {
  Body,
  Controller,
  Get,
  Module,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from "@nestjs/common";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { CurrentUser } from "../common/current-user";
import { Roles, RolesGuard } from "../common/roles";
import type { AuthUser } from "../common/roles";
import { DisponibilidadModule } from "../disponibilidad/disponibilidad.module";
import { AgendaController, AgendaService, TurnosStreamController } from "./agenda";
import { ExportarController, ExportarService } from "./exportar";
import { CreateTurnoDto, EstadoDto, ListQuery, ReprogramarDto, TurnosService } from "./turnos.service";

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
  controllers: [TurnosStreamController, ExportarController, TurnosController, AgendaController],
  providers: [TurnosService, AgendaService, ExportarService],
  exports: [TurnosService],
})
export class TurnosModule {}
