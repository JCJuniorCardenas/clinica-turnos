import { Inject, Injectable, Logger, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { AuditoriaService } from "../auditoria/auditoria.service";
import { PrismaService } from "../prisma/prisma.service";
import { TurnoEvents } from "../turnos/turno-events";
import { BotConfig, buildSystemPrompt, resolveConfig } from "./config";
import { ConvState, newState, parseState, trimHistory } from "./state";
import { BotToolsService, TOOL_DEFINITIONS, ToolContext } from "./tools";
import {
  IncomingMessage,
  LLM_PROVIDER,
  LlmRateLimitError,
  LlmProvider,
  WHATSAPP_PROVIDER,
  WhatsAppProvider,
} from "./types";
import { looksLikeUrgency } from "./urgency";

const MAX_TOOL_ROUNDS = 6;
const MAX_TEXT_LENGTH = 2000;
const MENU_WORDS = new Set(["menu", "menú", "cancelar"]);

@Injectable()
export class BotService implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger("Bot");
  /** Per-phone queue: two fast messages from the same person are processed one after the other, in order. */
  private readonly queues = new Map<string, Promise<void>>();
  private readonly hits = new Map<string, number[]>();

  constructor(
    private prisma: PrismaService,
    private tools: BotToolsService,
    private events: TurnoEvents,
    private audit: AuditoriaService,
    @Inject(WHATSAPP_PROVIDER) private wa: WhatsAppProvider,
    @Inject(LLM_PROVIDER) private llm: LlmProvider,
  ) {}

  async onModuleInit() {
    this.wa.onMessage((msg) => this.handle(msg));
    if (process.env.BOT_ENABLED === "true") {
      await this.wa.start?.().catch((e) => this.log.error(`No se pudo iniciar WhatsApp: ${(e as Error).message}`));
    }
  }

  async onModuleDestroy() {
    await this.wa.stop?.();
  }

  /** Entry point for every incoming message. The returned promise resolves once that message has been fully handled. */
  handle(msg: IncomingMessage): Promise<void> {
    const prev = this.queues.get(msg.phone) ?? Promise.resolve();
    const run = prev.then(() => this.process(msg)).catch((e) => this.log.error(`Error inesperado: ${(e as Error).message}`));
    this.queues.set(msg.phone, run);
    void run.finally(() => {
      if (this.queues.get(msg.phone) === run) this.queues.delete(msg.phone);
    });
    return run;
  }

  // ---------- internals ----------

  private async getClinica() {
    const id = process.env.BOT_CLINICA_ID;
    const clinica = id
      ? await this.prisma.clinica.findUnique({ where: { id } })
      : await this.prisma.clinica.findFirst({ orderBy: { creadoEn: "asc" } });
    if (!clinica) throw new Error("No hay clínica configurada para el bot (BOT_CLINICA_ID)");
    return clinica;
  }

  /** True when the person exceeded the allowed messages per minute. */
  private rateLimited(phone: string, limit: number): { limited: boolean; firstExcess: boolean } {
    const now = Date.now();
    const recent = (this.hits.get(phone) ?? []).filter((t) => now - t < 60_000);
    recent.push(now);
    this.hits.set(phone, recent);
    return { limited: recent.length > limit, firstExcess: recent.length === limit + 1 };
  }

  private async send(to: string, text: string) {
    try {
      await this.wa.sendText(to, text);
    } catch (e) {
      this.log.error(`No se pudo enviar el mensaje: ${(e as Error).message}`);
    }
  }

  private async process(msg: IncomingMessage) {
    const clinica = await this.getClinica();
    const cfg = resolveConfig(clinica.configBot);

    const rate = this.rateLimited(msg.phone, cfg.rateLimitPerMin);
    if (rate.limited) {
      if (rate.firstExcess) await this.send(msg.from, cfg.textoRateLimit);
      return;
    }

    const conv = await this.prisma.conversacion.upsert({
      where: { clinicaId_telefono: { clinicaId: clinica.id, telefono: msg.phone } },
      create: { clinicaId: clinica.id, telefono: msg.phone, estado: newState() as object },
      update: {},
    });
    let state = parseState(conv.estado);

    // Handed to a person: the bot stays silent until reception releases the chat from the panel.
    if (state.estado === "DERIVADO_A_HUMANO") return;

    const idleMs = Date.now() - new Date(state.ultimaActividad).getTime();
    if (idleMs > cfg.sessionTimeoutMin * 60_000) state = newState();

    const save = (s: ConvState) => {
      s.ultimaActividad = new Date().toISOString();
      s.historial = trimHistory(s.historial);
      return this.prisma.conversacion.update({ where: { id: conv.id }, data: { estado: s as object } });
    };

    const antes = structuredClone(state); // restore point for transient failures
    try {
      const text = msg.text?.trim().slice(0, MAX_TEXT_LENGTH);

      if (!text) {
        await this.send(msg.from, cfg.textoNoTexto);
        await save(state);
        return;
      }

      if (MENU_WORDS.has(text.toLowerCase())) {
        state = newState();
        await this.send(msg.from, cfg.textoMenu);
        await save(state);
        return;
      }

      // Emergencies never wait for the model: fixed text + immediate handoff.
      if (looksLikeUrgency(text)) {
        await this.derivar(clinica.id, conv.id, state, { motivo: "Posible urgencia: " + text.slice(0, 200), urgencia: true });
        await this.send(msg.from, cfg.textoUrgencia);
        await save(state);
        return;
      }

      state.userTurn += 1;
      state.estado = "EN_CURSO";
      state.historial.push({ role: "user", text });

      const ctx: ToolContext = { clinicaId: clinica.id, phone: msg.phone, timezone: clinica.timezone, state };
      const reply = await this.runModel(clinica.nombre, cfg, ctx);

      if (ctx.derivar) {
        await this.derivar(clinica.id, conv.id, state, ctx.derivar);
        await this.send(msg.from, ctx.derivar.urgencia ? cfg.textoUrgencia : cfg.textoDerivacion);
      } else {
        state.historial.push({ role: "assistant", text: reply });
        await this.send(msg.from, reply);
      }
      await save(state);
    } catch (e) {
      if (e instanceof LlmRateLimitError) {
        // Not a real failure: forget this attempt, ask the person to retry, and keep the bot active.
        this.log.warn("Cupo del modelo agotado; se pide reintentar.");
        await this.send(msg.from, cfg.textoOcupado);
        await save(antes).catch(() => undefined);
        return;
      }
      // Honest failure + handoff, as the flow design requires. Details only go to the server log.
      this.log.error(`Falló el procesamiento: ${(e as Error).message}`);
      await this.derivar(clinica.id, conv.id, state, { motivo: "Error técnico del asistente", urgencia: false });
      await this.send(msg.from, cfg.textoError);
      await save(state).catch(() => undefined);
    }
  }

  /** Model <-> tools loop. Returns the final text for the person. */
  private async runModel(clinicaNombre: string, cfg: BotConfig, ctx: ToolContext): Promise<string> {
    const system = buildSystemPrompt(clinicaNombre, ctx.timezone, cfg);
    for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
      const res = await this.llm.chat({ system, messages: ctx.state.historial, tools: TOOL_DEFINITIONS });

      if (res.toolCalls.length === 0) {
        if (!res.text) throw new Error("El modelo devolvió una respuesta vacía");
        return res.text;
      }

      ctx.state.historial.push({ role: "assistant", text: res.text, toolCalls: res.toolCalls });
      for (const call of res.toolCalls) {
        const result = await this.tools.execute(ctx, call.name, call.args);
        ctx.state.historial.push({ role: "tool", toolCallId: call.id, name: call.name, result });
      }
      if (ctx.derivar) return ""; // handoff requested: the caller sends the fixed text
    }
    throw new Error("El modelo no terminó después de varias llamadas a herramientas");
  }

  private async derivar(
    clinicaId: string,
    conversacionId: string,
    state: ConvState,
    d: { motivo: string; urgencia: boolean },
  ) {
    state.estado = "DERIVADO_A_HUMANO";
    state.pendiente = undefined;
    state.derivacion = { motivo: d.motivo, urgencia: d.urgencia, en: new Date().toISOString() };
    await this.audit.record({
      clinicaId,
      actor: "BOT",
      accion: d.urgencia ? "CONVERSACION_DERIVADA_URGENCIA" : "CONVERSACION_DERIVADA",
      entidad: "Conversacion",
      entidadId: conversacionId,
      detalle: { motivo: d.motivo },
    });
    this.events.emit({
      type: "conversacion.derivada",
      clinicaId,
      doctorId: null,
      turnoId: null,
      inicio: null,
      actor: "BOT",
    });
  }
}
