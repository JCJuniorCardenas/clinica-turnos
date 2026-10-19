import { Module } from "@nestjs/common";
import { DisponibilidadModule } from "../disponibilidad/disponibilidad.module";
import { TurnosModule } from "../turnos/turnos.module";
import { BaileysProvider } from "../whatsapp/baileys.provider";
import { ConsoleWhatsApp } from "../whatsapp/console.provider";
import { BotService } from "./bot.service";
import { WhatsAppController } from "./whatsapp.controller";
import { ConversacionesController, ConversacionesService } from "./conversaciones";
import { GeminiProvider } from "./llm/gemini.provider";
import { BotToolsService } from "./tools";
import { LLM_PROVIDER, WHATSAPP_PROVIDER } from "./types";

@Module({
  imports: [TurnosModule, DisponibilidadModule],
  controllers: [ConversacionesController, WhatsAppController],
  providers: [
    BotService,
    BotToolsService,
    ConversacionesService,
    {
      provide: WHATSAPP_PROVIDER,
      useFactory: () => (process.env.WHATSAPP_PROVIDER === "console" ? new ConsoleWhatsApp() : new BaileysProvider()),
    },
    // Switching to another LLM (e.g. Groq) means adding a provider class and selecting it here.
    { provide: LLM_PROVIDER, useFactory: () => new GeminiProvider() },
  ],
  exports: [BotService],
})
export class BotModule {}
