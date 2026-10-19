import { Controller, Get, Injectable, NotFoundException, Param, Post, UseGuards } from "@nestjs/common";
import { AuditoriaService } from "../auditoria/auditoria.service";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { CurrentUser } from "../common/current-user";
import { Roles, RolesGuard } from "../common/roles";
import type { AuthUser } from "../common/roles";
import { PrismaService } from "../prisma/prisma.service";
import { TurnoEvents } from "../turnos/turno-events";
import { newState, parseState } from "./state";

@Injectable()
export class ConversacionesService {
  constructor(
    private prisma: PrismaService,
    private audit: AuditoriaService,
    private events: TurnoEvents,
  ) {}

  /** Chats the bot handed over to reception, oldest first. No message history is exposed here. */
  async derivadas(clinicaId: string) {
    const rows = await this.prisma.conversacion.findMany({
      where: { clinicaId, estado: { path: ["estado"], equals: "DERIVADO_A_HUMANO" } },
      orderBy: { updatedAt: "asc" },
    });
    return rows.map((c) => {
      const s = parseState(c.estado);
      return {
        id: c.id,
        telefono: c.telefono,
        motivo: s.derivacion?.motivo ?? "",
        urgencia: s.derivacion?.urgencia ?? false,
        derivadaEn: s.derivacion?.en ?? c.updatedAt.toISOString(),
      };
    });
  }

  /** Reception took care of it: the bot answers this phone again from the next message. */
  async liberar(u: AuthUser, id: string) {
    const conv = await this.prisma.conversacion.findFirst({ where: { id, clinicaId: u.clinicaId } });
    if (!conv) throw new NotFoundException("Conversación no encontrada");
    await this.prisma.conversacion.update({ where: { id }, data: { estado: newState() as object } });
    await this.audit.record({
      clinicaId: u.clinicaId,
      actor: u.userId,
      accion: "CONVERSACION_LIBERADA",
      entidad: "Conversacion",
      entidadId: id,
    });
    this.events.emit({ type: "conversacion.liberada", clinicaId: u.clinicaId, doctorId: null, turnoId: null, inicio: null, actor: u.userId });
    return { ok: true };
  }
}

@Controller("conversaciones")
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles("ADMIN", "RECEPCION")
export class ConversacionesController {
  constructor(private service: ConversacionesService) {}

  @Get("derivadas")
  derivadas(@CurrentUser() u: AuthUser) {
    return this.service.derivadas(u.clinicaId);
  }

  @Post(":id/liberar")
  liberar(@CurrentUser() u: AuthUser, @Param("id") id: string) {
    return this.service.liberar(u, id);
  }
}
