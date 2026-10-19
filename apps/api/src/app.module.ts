import { Module } from "@nestjs/common";
import { APP_GUARD } from "@nestjs/core";
import { ThrottlerGuard, ThrottlerModule } from "@nestjs/throttler";
import { AuditoriaModule } from "./auditoria/auditoria.service";
import { AuthModule } from "./auth/auth.module";
import { BotModule } from "./bot/bot.module";
import { DemoModule } from "./demo/demo.module";
import { DisponibilidadModule } from "./disponibilidad/disponibilidad.module";
import { DoctoresModule } from "./doctores/doctores.module";
import { EspecialidadesModule } from "./especialidades/especialidades.module";
import { PacientesModule } from "./pacientes/pacientes.module";
import { PrismaModule } from "./prisma/prisma.module";
import { TurnoEventsModule } from "./turnos/turno-events";
import { TurnosModule } from "./turnos/turnos.module";

@Module({
  imports: [
    ThrottlerModule.forRoot([{ ttl: 60_000, limit: Number(process.env.GLOBAL_RATE_LIMIT ?? 100) }]),
    PrismaModule,
    AuditoriaModule,
    TurnoEventsModule,
    AuthModule,
    EspecialidadesModule,
    DoctoresModule,
    DisponibilidadModule,
    PacientesModule,
    TurnosModule,
    BotModule,
    DemoModule,
  ],
  providers: [{ provide: APP_GUARD, useClass: ThrottlerGuard }],
})
export class AppModule {}
