import {
  Body,
  CanActivate,
  Controller,
  Get,
  Injectable,
  Module,
  NotFoundException,
  Post,
  UseGuards,
} from "@nestjs/common";
import { IsOptional, IsString, Matches, MaxLength, MinLength } from "class-validator";
import { reiniciarDatosDemo } from "../../../../prisma/demo-data";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { BotModule } from "../bot/bot.module";
import { BotService } from "../bot/bot.service";
import { CurrentUser } from "../common/current-user";
import { Roles, RolesGuard } from "../common/roles";
import type { AuthUser } from "../common/roles";
import { PrismaService } from "../prisma/prisma.service";
import { TurnoEvents } from "../turnos/turno-events";

const isDemoMode = () => process.env.DEMO_MODE === "true";

/** The demo tools only exist when DEMO_MODE=true; otherwise they look like they were never there. */
@Injectable()
class DemoModeGuard implements CanActivate {
  canActivate() {
    if (!isDemoMode()) throw new NotFoundException();
    return true;
  }
}

class ChatDto {
  @IsString() @MinLength(1) @MaxLength(500) texto: string;
  @IsOptional() @Matches(/^\+\d{8,15}$/, { message: "telefono debe ser internacional, ej. +5493770000001" }) telefono?: string;
}

@Controller("demo")
@UseGuards(JwtAuthGuard, RolesGuard)
export class DemoController {
  constructor(
    private bot: BotService,
    private prisma: PrismaService,
    private events: TurnoEvents,
  ) {}

  /** Lets the panel know whether to show the demo tools. */
  @Get("estado")
  estado() {
    return { demoMode: isDemoMode() };
  }

  /** Talks to the bot without WhatsApp (plan B during a presentation, and used by the smoke test). */
  @Post("chat")
  @UseGuards(DemoModeGuard)
  @Roles("ADMIN", "RECEPCION")
  async chat(@Body() dto: ChatDto) {
    const respuestas = await this.bot.simulate(dto.telefono ?? "+5493770000001", dto.texto);
    return { respuestas };
  }

  /** Clears patients, appointments and chats and reloads the sample ones. Users and doctors stay, so sessions survive. */
  @Post("reiniciar")
  @UseGuards(DemoModeGuard)
  @Roles("ADMIN")
  async reiniciar(@CurrentUser() u: AuthUser) {
    const clinica = await this.prisma.clinica.findUniqueOrThrow({ where: { id: u.clinicaId } });
    await reiniciarDatosDemo(this.prisma, clinica);
    this.events.emit({ type: "conversacion.liberada", clinicaId: u.clinicaId, doctorId: null, turnoId: null, inicio: null, actor: u.userId });
    return { ok: true };
  }
}

@Module({ imports: [BotModule], controllers: [DemoController], providers: [DemoModeGuard] })
export class DemoModule {}
