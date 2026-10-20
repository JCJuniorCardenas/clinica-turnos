import { Module } from "@nestjs/common";
import { DisponibilidadModule } from "../disponibilidad/disponibilidad.module";
import { TurnosModule } from "../turnos/turnos.module";
import { BaileysProvider } from "../whatsapp/baileys.provider";
import { ConsoleWhatsApp } from "../whatsapp/console.provider";
import { MetaCloudProvider } from "../whatsapp/meta-cloud.provider";
import { MetaWebhookController } from "../whatsapp/meta-webhook.controller";
import { BotService } from "./bot.service";
import { WhatsAppController } from "./whatsapp.controller";
import { ConversacionesController, ConversacionesService } from "./conversaciones";
import { FallbackLlm } from "./llm/fallback.provider";
import { GeminiProvider } from "./llm/gemini.provider";
import { GroqProvider } from "./llm/groq.provider";
import { BotToolsService } from "./tools";
import { LLM_PROVIDER, LlmProvider, WHATSAPP_PROVIDER } from "./types";

/**
 * LLM_PROVIDER lists the providers in order of preference, comma separated ("groq,gemini"). If it is not set,
 * Groq goes first when GROQ_API_KEY exists, and Gemini is always the backup.
 */
export function buildLlm(): LlmProvider {
  const wanted = (process.env.LLM_PROVIDER ?? (process.env.GROQ_API_KEY ? "groq,gemini" : "gemini"))
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  const providers = wanted.map((name) => {
    if (name === "groq") return { name, provider: new GroqProvider() as LlmProvider };
    if (name === "gemini") return { name, provider: new GeminiProvider() as LlmProvider };
    throw new Error(`LLM_PROVIDER desconocido: ${name}`);
  });
  return providers.length === 1 ? providers[0].provider : new FallbackLlm(providers);
}

@Module({
  imports: [TurnosModule, DisponibilidadModule],
  controllers: [ConversacionesController, WhatsAppController, MetaWebhookController],
  providers: [
    BotService,
    BotToolsService,
    ConversacionesService,
    {
      provide: WHATSAPP_PROVIDER,
      useFactory: () => {
        switch (process.env.WHATSAPP_PROVIDER) {
          case "console":
            return new ConsoleWhatsApp();
          case "meta":
            return new MetaCloudProvider();
          default:
            return new BaileysProvider();
        }
      },
    },
    { provide: LLM_PROVIDER, useFactory: buildLlm },
  ],
  exports: [BotService],
})
export class BotModule {}
