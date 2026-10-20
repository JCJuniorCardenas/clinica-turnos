import { Inject, Injectable, Logger, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { AuditoriaService } from "../auditoria/auditoria.service";
import { PrismaService } from "../prisma/prisma.service";
import { TurnoEvents } from "../turnos/turno-events";
import { BotConfig, buildSystemPrompt, resolveConfig } from "./config";
import { ConvState, newState, parseState, trimHistory } from "./state";
import { BotToolsService, TOOL_DEFINITIONS, ToolContext, samePhone } from "./tools";
import {
  IncomingMessage,
  LLM_PROVIDER,
  LlmRateLimitError,
  LlmProvider,
  WHATSAPP_PROVIDER,
  WhatsAppProvider,
} from "./types";
import { claimsDone, formatWriteConfirmation, isAffirmative, isNegative } from "./confirmation";
import { looksLikeUrgency } from "./urgency";

const MAX_TOOL_ROUNDS = 6;
const MAX_TEXT_LENGTH = 2000;
const MAX_REPLY_CHARS = 1500;
const SEEN_IDS_MAX = 500;
const MENU_WORDS = new Set(["menu", "menú", "cancelar"]);

@Injectable()
export class BotService implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger("Bot");
  /** Per-phone queue: two fast messages from the same person are processed one after the other, in order. */
  private readonly queues = new Map<string, Promise<void>>();
  private readonly hits = new Map<string, number[]>();
  /** Recently handled message ids: WhatsApp sometimes redelivers a message and the person must not get two answers. */
  private readonly seenIds = new Set<string>();
  /** Replies for simulated chats (panel simulator / smoke test): addressed as "sim:<phone>", never sent to WhatsApp. */
  private readonly simOutbox = new Map<string, string[]>();

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
    // With BOT_ALLOWED_PHONES set, only those numbers get answers; everyone else is ignored (simulated chats are exempt).
    if (!msg.from.startsWith("sim:") && !this.isAllowed(msg.phone)) return Promise.resolve();
    if (msg.id) {
      if (this.seenIds.has(msg.id)) return Promise.resolve();
      this.seenIds.add(msg.id);
      if (this.seenIds.size > SEEN_IDS_MAX) this.seenIds.delete(this.seenIds.values().next().value as string);
    }
    const prev = this.queues.get(msg.phone) ?? Promise.resolve();
    const run = prev.then(() => this.process(msg)).catch((e) => this.log.error(`Error inesperado: ${(e as Error).message}`));
    this.queues.set(msg.phone, run);
    void run.finally(() => {
      if (this.queues.get(msg.phone) === run) this.queues.delete(msg.phone);
    });
    return run;
  }

  /** Runs a message through the exact same logic as a real WhatsApp one and returns what the bot answered. */
  async simulate(phone: string, text: string): Promise<string[]> {
    const from = `sim:${phone}`;
    this.simOutbox.set(from, []);
    await this.handle({ from, phone, text });
    const replies = this.simOutbox.get(from) ?? [];
    this.simOutbox.delete(from);
    return replies;
  }

  /** Empty/unset list = everyone is allowed. Otherwise the phone must match one of the listed numbers. */
  private isAllowed(phone: string): boolean {
    const allowed = (process.env.BOT_ALLOWED_PHONES ?? "").split(",").map((p) => p.trim()).filter(Boolean);
    return allowed.length === 0 || allowed.some((p) => samePhone(p, phone));
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

  /** Sends a reply: long texts are split in chunks, and each chunk is retried a few times if the transport fails. */
  private async send(to: string, text: string) {
    for (const chunk of splitMessage(text, MAX_REPLY_CHARS)) {
      if (to.startsWith("sim:")) {
        this.simOutbox.get(to)?.push(chunk);
        continue;
      }
      for (let attempt = 1; attempt <= 3; attempt++) {
        try {
          await this.wa.sendText(to, chunk);
          break;
        } catch (e) {
          if (attempt === 3) this.log.error(`No se pudo enviar el mensaje: ${(e as Error).message}`);
          else await new Promise((r) => setTimeout(r, 500 * attempt));
        }
      }
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

      void this.wa.setTyping?.(msg.from).catch(() => undefined);
      state.userTurn += 1;
      state.estado = "EN_CURSO";
      state.historial.push({ role: "user", text });

      const ctx: ToolContext = { clinicaId: clinica.id, phone: msg.phone, timezone: clinica.timezone, state };
      // What the person is answering: a plain "yes" and the last thing the assistant said (usually the summary).
      ctx.userAffirmed = isAffirmative(text);
      ctx.lastAssistantText = [...state.historial].reverse().flatMap((m) => (m.role === "assistant" && m.text ? [m.text] : []))[0];

      // A plain "yes" to an announced action is carried out by the system itself, not left to the model's memory,
      // and the confirmation message is built from the real result.
      let reply: string | undefined;
      if (state.pendiente?.call) {
        if (ctx.userAffirmed) {
          await this.runPending(ctx);
          if (ctx.lastWrite) reply = formatWriteConfirmation(ctx.lastWrite.tool, ctx.lastWrite.result) ?? undefined;
        } else if (isNegative(text)) {
          state.pendiente = undefined;
        }
      }

      reply ??= await this.runModel(clinica.nombre, cfg, ctx, text);

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
  private async runModel(clinicaNombre: string, cfg: BotConfig, ctx: ToolContext, userText: string): Promise<string> {
    const system = buildSystemPrompt(clinicaNombre, ctx.timezone, cfg);
    for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
      let res;
      try {
        res = await this.llm.chat({ system, messages: ctx.state.historial, tools: TOOL_DEFINITIONS });
      } catch (e) {
        // The booking/cancellation already happened: never tell the person to "try again". Confirm it ourselves.
        const done = ctx.lastWrite ? formatWriteConfirmation(ctx.lastWrite.tool, ctx.lastWrite.result) : null;
        if (done) return done;
        throw e;
      }

      if (res.toolCalls.length === 0) {
        if (!res.text) throw new Error("El modelo devolvió una respuesta vacía");
        // The model says something is done but no write succeeded in this message: that must not reach the patient.
        if (!ctx.wrote && (isAffirmative(userText) || ctx.state.pendiente) && claimsDone(res.text)) {
          this.log.warn("El modelo afirmó un éxito sin ejecutar la herramienta; se reemplaza la respuesta.");
          return ctx.state.pendiente ? cfg.textoNoRegistradoPendiente : cfg.textoNoRegistrado;
        }
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

  /** Runs the announced action (the exact call the backend stored) and puts it in the history for the model to report. */
  private async runPending(ctx: ToolContext) {
    const call = ctx.state.pendiente!.call!;
    const id = `confirm_${Date.now()}`;
    ctx.state.historial.push({ role: "assistant", toolCalls: [{ id, name: call.name, args: call.args }] });
    const result = await this.tools.execute(ctx, call.name, call.args);
    ctx.state.historial.push({ role: "tool", toolCallId: id, name: call.name, result });
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

/** Splits a long reply at paragraph (or line, or word) boundaries so each WhatsApp message stays readable. */
export function splitMessage(text: string, max: number): string[] {
  if (text.length <= max) return [text];
  const chunks: string[] = [];
  let rest = text;
  while (rest.length > max) {
    const slice = rest.slice(0, max);
    const cut = Math.max(slice.lastIndexOf("\n\n"), slice.lastIndexOf("\n"), slice.lastIndexOf(" "));
    const at = cut > max / 2 ? cut : max;
    chunks.push(rest.slice(0, at).trim());
    rest = rest.slice(at).trim();
  }
  if (rest) chunks.push(rest);
  return chunks;
}
