import { HttpException, Injectable } from "@nestjs/common";
import type { AuthUser } from "../common/roles";
import { addDays, isValidDate, localToUtc, utcToLocal } from "../common/time";
import { DisponibilidadService } from "../disponibilidad/disponibilidad.module";
import { PrismaService } from "../prisma/prisma.service";
import { CreateTurnoDto, TurnosService } from "../turnos/turnos.service";
import { diaSemanaDe } from "./config";
import { summaryMatches } from "./confirmation";
import type { ConvState } from "./state";
import type { ToolDefinition } from "./types";

/** Everything a tool may touch is derived from here, never from what the model says. */
export interface ToolContext {
  clinicaId: string;
  /** Phone of the person chatting. All patient/appointment access is scoped to it. */
  phone: string;
  timezone: string;
  state: ConvState;
  /** Set by derivar_a_recepcion; the conversation engine reacts to it after the model turn. */
  derivar?: { motivo: string; urgencia: boolean };
  /** True once a write tool (crear/cancelar/reprogramar) really succeeded during this message. */
  wrote?: boolean;
  /** The last successful write (tool name + result), used to write the confirmation without the model if needed. */
  lastWrite?: { tool: string; result: Record<string, any> };
  /** The incoming message is a plain "yes". */
  userAffirmed?: boolean;
  /** The last thing the assistant said to the person before this message (the summary they are answering). */
  lastAssistantText?: string;
}

/** Surname of a doctor's display name ("Dra. Valeria Acosta" -> "Acosta"). */
const apellido = (nombre: string) => nombre.trim().split(/\s+/).pop() ?? nombre;

export const BOT_ACTOR: Pick<AuthUser, "userId" | "rol" | "doctorId"> = { userId: "BOT", rol: "RECEPCION", doctorId: null };

const WRITE_TOOLS = new Set(["crear_turno", "cancelar_turno", "reprogramar_turno"]);
const FECHA_HORA_RE = /^\d{4}-\d{2}-\d{2}T([01]\d|2[0-3]):[0-5]\d$/;
const MAX_SLOTS = 12;
const MAX_RANGE_DAYS = 14;

export const TOOL_DEFINITIONS: ToolDefinition[] = [
  {
    name: "listar_especialidades",
    description: "Lista las especialidades disponibles en la clínica.",
    parameters: { type: "object", properties: {} },
  },
  {
    name: "listar_doctores",
    description: "Lista los doctores activos de una especialidad.",
    parameters: {
      type: "object",
      properties: { especialidadId: { type: "string", description: "ID devuelto por listar_especialidades" } },
      required: ["especialidadId"],
    },
  },
  {
    name: "buscar_disponibilidad",
    description:
      "Busca horarios libres de un doctor entre dos fechas (máximo 14 días). Devuelve hasta 12 horarios; ofrecé 3 a 5 a la persona.",
    parameters: {
      type: "object",
      properties: {
        doctorId: { type: "string" },
        desde: { type: "string", description: "Fecha inicial YYYY-MM-DD (hora de Argentina)" },
        hasta: { type: "string", description: "Fecha final YYYY-MM-DD, inclusive" },
        franja: { type: "string", enum: ["manana", "tarde", "noche"], description: "Opcional: filtra por momento del día" },
      },
      required: ["doctorId", "desde", "hasta"],
    },
  },
  {
    name: "identificar_paciente",
    description:
      "Indica si el DNI ya está registrado para este teléfono. Si no está registrado hay que pedir el nombre completo antes de crear el turno.",
    parameters: {
      type: "object",
      properties: { dni: { type: "string", description: "DNI, con o sin puntos" } },
      required: ["dni"],
    },
  },
  {
    name: "crear_turno",
    description:
      "Crea un turno. Pide confirmación la primera vez: mostrale el resumen a la persona y, cuando diga que sí, volvé a llamar con exactamente los mismos datos.",
    parameters: {
      type: "object",
      properties: {
        doctorId: { type: "string" },
        fechaHora: { type: "string", description: "YYYY-MM-DDTHH:mm en hora de Argentina, uno de los horarios de buscar_disponibilidad" },
        paciente: {
          type: "object",
          properties: {
            dni: { type: "string" },
            nombre: { type: "string", description: "Nombre completo; obligatorio si el paciente no está registrado" },
          },
          required: ["dni"],
        },
      },
      required: ["doctorId", "fechaHora", "paciente"],
    },
  },
  {
    name: "listar_turnos_paciente",
    description: "Lista los turnos futuros de los pacientes asociados a este teléfono.",
    parameters: { type: "object", properties: {} },
  },
  {
    name: "cancelar_turno",
    description: "Cancela un turno del teléfono actual. Pide confirmación la primera vez, igual que crear_turno.",
    parameters: { type: "object", properties: { turnoId: { type: "string" } }, required: ["turnoId"] },
  },
  {
    name: "reprogramar_turno",
    description: "Mueve un turno del teléfono actual a otro horario libre del mismo doctor. Pide confirmación la primera vez.",
    parameters: {
      type: "object",
      properties: {
        turnoId: { type: "string" },
        nuevaFechaHora: { type: "string", description: "YYYY-MM-DDTHH:mm en hora de Argentina" },
      },
      required: ["turnoId", "nuevaFechaHora"],
    },
  },
  {
    name: "derivar_a_recepcion",
    description:
      "Pasa la conversación a una persona de recepción. Usala cuando la persona lo pida, cuando algo falle o ante una urgencia (urgencia=true).",
    parameters: {
      type: "object",
      properties: {
        motivo: { type: "string", description: "Breve motivo para recepción" },
        urgencia: { type: "boolean", description: "true si describe síntomas graves o una urgencia" },
      },
      required: ["motivo"],
    },
  },
];

const digits = (s: string) => s.replace(/\D/g, "");
const str = (v: unknown) => (typeof v === "string" ? v.trim() : "");

/** Argentine numbers show up with/without country code, 9 or 0/15: compare the last 10 digits. */
export function samePhone(a: string, b: string): boolean {
  const [da, db] = [digits(a), digits(b)];
  if (da.length >= 10 && db.length >= 10) return da.slice(-10) === db.slice(-10);
  return da === db;
}

export function normalizeDni(raw: string): string | null {
  const d = digits(raw);
  return /^\d{6,9}$/.test(d) ? d : null;
}

class ToolError extends Error {
  constructor(
    public code: string,
    message: string,
    public extra: Record<string, unknown> = {},
  ) {
    super(message);
  }
}

@Injectable()
export class BotToolsService {
  constructor(
    private prisma: PrismaService,
    private disp: DisponibilidadService,
    private turnos: TurnosService,
  ) {}

  /** Runs one tool call and records whether a real write happened. */
  async execute(ctx: ToolContext, name: string, args: Record<string, unknown>): Promise<unknown> {
    const result = await this.run(ctx, name, args);
    if (WRITE_TOOLS.has(name) && (result as { ok?: boolean } | null)?.ok === true) {
      ctx.wrote = true;
      ctx.lastWrite = { tool: name, result: result as Record<string, any> };
    }
    return result;
  }

  /** Never throws: failures come back as { error, mensaje } for the model to explain. */
  private async run(ctx: ToolContext, name: string, args: Record<string, unknown>): Promise<unknown> {
    try {
      switch (name) {
        case "listar_especialidades":
          return await this.listarEspecialidades(ctx);
        case "listar_doctores":
          return await this.listarDoctores(ctx, str(args.especialidadId));
        case "buscar_disponibilidad":
          return await this.buscarDisponibilidad(ctx, args);
        case "identificar_paciente":
          return await this.identificarPaciente(ctx, str(args.dni));
        case "crear_turno":
          return await this.crearTurno(ctx, args);
        case "listar_turnos_paciente":
          return await this.listarTurnos(ctx);
        case "cancelar_turno":
          return await this.cancelarTurno(ctx, str(args.turnoId));
        case "reprogramar_turno":
          return await this.reprogramarTurno(ctx, str(args.turnoId), str(args.nuevaFechaHora));
        case "derivar_a_recepcion":
          ctx.derivar = { motivo: str(args.motivo).slice(0, 300) || "Sin motivo", urgencia: args.urgencia === true };
          return { ok: true };
        default:
          return { error: "herramienta_desconocida", mensaje: `No existe la herramienta ${name}.` };
      }
    } catch (e) {
      return this.toErrorResult(ctx, e);
    }
  }

  // ---------- helpers ----------

  private async toErrorResult(ctx: ToolContext, e: unknown) {
    if (e instanceof ToolError) return { error: e.code, mensaje: e.message, ...e.extra };
    if (e instanceof HttpException) {
      const body = e.getResponse() as { message?: string | string[]; alternativas?: { inicio: string }[] };
      const mensaje = Array.isArray(body?.message) ? body.message.join(". ") : (body?.message ?? e.message);
      const status = e.getStatus();
      return {
        error: status === 409 ? "horario_ocupado" : status === 404 ? "no_encontrado" : "no_permitido",
        mensaje,
        ...(body?.alternativas ? { alternativas: body.alternativas.map((a) => this.fmtSlot(new Date(a.inicio), ctx.timezone)) } : {}),
      };
    }
    // Unexpected failure: do not leak details to the model/user; the engine logs and hands off.
    console.error("[bot] tool failed:", (e as Error)?.message);
    return { error: "error_interno", mensaje: "Falló la herramienta. Disculpate con la persona y derivá a recepción." };
  }

  private fmtSlot(inicio: Date, tz: string) {
    const { date, time } = utcToLocal(inicio, tz);
    const [, m, d] = date.split("-");
    return { fechaHora: `${date}T${time}`, dia: diaSemanaDe(date), fecha: `${d}/${m}`, hora: time };
  }

  private slotView(inicio: Date, tz: string) {
    return this.fmtSlot(inicio, tz);
  }

  private parseFechaHora(ctx: ToolContext, v: string): Date {
    if (!FECHA_HORA_RE.test(v)) throw new ToolError("fecha_invalida", "fechaHora debe tener formato YYYY-MM-DDTHH:mm.");
    const [date, time] = v.split("T");
    if (!isValidDate(date)) throw new ToolError("fecha_invalida", "La fecha no es válida.");
    return localToUtc(date, time, ctx.timezone);
  }

  /** Patients registered under this chat's phone. */
  private async pacientesDelTelefono(ctx: ToolContext) {
    const d = digits(ctx.phone);
    const candidates = await this.prisma.paciente.findMany({
      where: { clinicaId: ctx.clinicaId, telefono: { endsWith: d.slice(-10) } },
    });
    return candidates.filter((p) => samePhone(p.telefono, ctx.phone));
  }

  /**
   * Two-step gate for writes: the first call only announces the action (and stores it); the write runs when the
   * very same call arrives again after the person sent another message. The model cannot skip the confirmation.
   */
  private needsConfirmation(
    ctx: ToolContext,
    key: string,
    resumen: Record<string, unknown>,
    call: { name: string; args: Record<string, unknown> },
    checks: string[],
  ) {
    const p = ctx.state.pendiente;
    if (p && p.key === key && p.userTurn < ctx.state.userTurn) {
      ctx.state.pendiente = undefined;
      return null;
    }
    // The person just answered a plain "sí" to a summary that really contains this action's key details
    // (time, DNI, doctor): that "sí" confirms exactly this action, even if the model skipped announcing it first.
    if (ctx.userAffirmed && summaryMatches(ctx.lastAssistantText, checks)) {
      ctx.state.pendiente = undefined;
      return null;
    }
    // The call is stored so the engine itself can run it when the person says yes.
    ctx.state.pendiente = { key, userTurn: ctx.state.userTurn, call };
    return {
      requiere_confirmacion: true,
      mensaje:
        "Todavía NO se hizo nada. Mostrale este resumen a la persona, pedile que confirme con un sí y, cuando lo haga, volvé a llamar a esta herramienta con los mismos datos.",
      resumen,
    };
  }

  private async turnoDelTelefono(ctx: ToolContext, turnoId: string) {
    if (!turnoId) throw new ToolError("turno_invalido", "Falta turnoId.");
    const pacientes = await this.pacientesDelTelefono(ctx);
    const turno = await this.prisma.turno.findFirst({
      where: {
        id: turnoId,
        clinicaId: ctx.clinicaId,
        pacienteId: { in: pacientes.map((p) => p.id) },
        estado: { in: ["PENDIENTE", "CONFIRMADO"] },
        inicio: { gt: new Date() },
      },
      include: { doctor: { include: { especialidad: true } }, paciente: true },
    });
    // Same answer whether the appointment does not exist or belongs to someone else.
    if (!turno) throw new ToolError("turno_no_encontrado", "No encontré ese turno entre los turnos futuros de este teléfono.");
    return turno;
  }

  // ---------- tools ----------

  private async listarEspecialidades(ctx: ToolContext) {
    const rows = await this.prisma.especialidad.findMany({
      where: { clinicaId: ctx.clinicaId, doctores: { some: { activo: true } } },
      orderBy: { nombre: "asc" },
    });
    return { especialidades: rows.map((e) => ({ id: e.id, nombre: e.nombre })) };
  }

  private async listarDoctores(ctx: ToolContext, especialidadId: string) {
    const rows = await this.prisma.doctor.findMany({
      where: { clinicaId: ctx.clinicaId, activo: true, especialidadId },
      include: { especialidad: true },
      orderBy: { nombre: "asc" },
    });
    return { doctores: rows.map((d) => ({ id: d.id, nombre: d.nombre, especialidad: d.especialidad.nombre })) };
  }

  private async buscarDisponibilidad(ctx: ToolContext, args: Record<string, unknown>) {
    const [doctorId, desde, hasta] = [str(args.doctorId), str(args.desde), str(args.hasta)];
    if (!isValidDate(desde) || !isValidDate(hasta) || hasta < desde) throw new ToolError("fecha_invalida", "Fechas inválidas (YYYY-MM-DD).");
    const limite = addDays(desde, MAX_RANGE_DAYS - 1);
    const hastaEf = hasta > limite ? limite : hasta;

    const r = await this.disp.buscar(ctx.clinicaId, doctorId, desde, hastaEf);
    const franja = str(args.franja);
    let slots = r.slots.map((s) => new Date(s.inicio));
    if (franja) {
      const hour = (d: Date) => Number(utcToLocal(d, ctx.timezone).time.slice(0, 2));
      slots = slots.filter((d) => (franja === "manana" ? hour(d) < 13 : franja === "tarde" ? hour(d) >= 13 && hour(d) < 20 : hour(d) >= 20));
    }
    if (slots.length === 0) {
      const proximos = await this.disp.proximos(ctx.clinicaId, doctorId, 3).catch(() => []);
      return {
        sinDisponibilidad: true,
        mensaje: "No hay horarios libres en ese rango. Ofrecé los próximos disponibles si hay.",
        proximos: proximos.map((s) => this.slotView(new Date(s.inicio), ctx.timezone)),
      };
    }
    return {
      horarios: slots.slice(0, MAX_SLOTS).map((d) => this.slotView(d, ctx.timezone)),
      hayMas: slots.length > MAX_SLOTS,
    };
  }

  private async identificarPaciente(ctx: ToolContext, dniRaw: string) {
    const dni = normalizeDni(dniRaw);
    if (!dni) throw new ToolError("dni_invalido", "El DNI debe tener entre 6 y 9 dígitos.");
    const p = await this.prisma.paciente.findFirst({ where: { clinicaId: ctx.clinicaId, dni } });
    if (!p) return { registrado: false };
    if (!samePhone(p.telefono, ctx.phone)) {
      // Do not reveal anything about a person registered with a different phone.
      throw new ToolError(
        "dni_de_otro_telefono",
        "Ese DNI figura asociado a otro número. No des detalles; ofrecé derivar a recepción para resolverlo.",
      );
    }
    return { registrado: true, nombre: p.nombre };
  }

  private async crearTurno(ctx: ToolContext, args: Record<string, unknown>) {
    const doctorId = str(args.doctorId);
    const fechaHora = str(args.fechaHora);
    const pac = (args.paciente ?? {}) as Record<string, unknown>;
    const dni = normalizeDni(str(pac.dni));
    if (!dni) throw new ToolError("dni_invalido", "El DNI debe tener entre 6 y 9 dígitos.");
    const inicio = this.parseFechaHora(ctx, fechaHora);

    const doctor = await this.disp.getDoctorActivo(ctx.clinicaId, doctorId);
    await this.disp.assertSlotValido(ctx.clinicaId, doctor, inicio);

    const existente = await this.prisma.paciente.findFirst({ where: { clinicaId: ctx.clinicaId, dni } });
    if (existente && !samePhone(existente.telefono, ctx.phone)) {
      throw new ToolError(
        "dni_de_otro_telefono",
        "Ese DNI figura asociado a otro número. No des detalles; ofrecé derivar a recepción para resolverlo.",
      );
    }
    const nombre = existente?.nombre ?? str(pac.nombre);
    if (!existente && nombre.length < 2) throw new ToolError("falta_nombre", "El paciente no está registrado: pedí nombre completo.");

    const especialidad = await this.prisma.especialidad.findUnique({ where: { id: doctor.especialidadId } });
    const resumen = { doctor: doctor.nombre, especialidad: especialidad?.nombre, ...this.slotView(inicio, ctx.timezone), paciente: nombre };

    const pending = this.needsConfirmation(ctx, `crear|${doctorId}|${fechaHora}|${dni}`, resumen, { name: "crear_turno", args }, [resumen.hora, dni, apellido(doctor.nombre)]);
    if (pending) return pending;

    const paciente = existente ?? (await this.prisma.paciente.create({ data: { clinicaId: ctx.clinicaId, nombre, telefono: ctx.phone, dni } }));
    const user: AuthUser = { ...BOT_ACTOR, clinicaId: ctx.clinicaId };
    const turno = await this.turnos.crear(user, { doctorId, pacienteId: paciente.id, inicio: inicio.toISOString() } as CreateTurnoDto, "BOT");
    return { ok: true, turnoId: turno.id, ...resumen };
  }

  private async listarTurnos(ctx: ToolContext) {
    const pacientes = await this.pacientesDelTelefono(ctx);
    const rows = await this.prisma.turno.findMany({
      where: {
        clinicaId: ctx.clinicaId,
        pacienteId: { in: pacientes.map((p) => p.id) },
        estado: { in: ["PENDIENTE", "CONFIRMADO"] },
        inicio: { gt: new Date() },
      },
      include: { doctor: { include: { especialidad: true } }, paciente: true },
      orderBy: { inicio: "asc" },
      take: 10,
    });
    return {
      turnos: rows.map((t) => ({
        turnoId: t.id,
        doctor: t.doctor.nombre,
        especialidad: t.doctor.especialidad.nombre,
        paciente: t.paciente.nombre,
        ...this.slotView(t.inicio, ctx.timezone),
      })),
    };
  }

  private async cancelarTurno(ctx: ToolContext, turnoId: string) {
    const t = await this.turnoDelTelefono(ctx, turnoId);
    const resumen = {
      doctor: t.doctor.nombre,
      especialidad: t.doctor.especialidad.nombre,
      paciente: t.paciente.nombre,
      ...this.slotView(t.inicio, ctx.timezone),
    };
    const pending = this.needsConfirmation(ctx, `cancelar|${turnoId}`, resumen, { name: "cancelar_turno", args: { turnoId } }, [resumen.hora, apellido(t.doctor.nombre)]);
    if (pending) return pending;
    await this.turnos.cancelar({ ...BOT_ACTOR, clinicaId: ctx.clinicaId }, turnoId);
    return { ok: true, cancelado: resumen };
  }

  private async reprogramarTurno(ctx: ToolContext, turnoId: string, nuevaFechaHora: string) {
    const t = await this.turnoDelTelefono(ctx, turnoId);
    const nuevo = this.parseFechaHora(ctx, nuevaFechaHora);
    await this.disp.assertSlotValido(ctx.clinicaId, t.doctor, nuevo);
    const resumen = {
      doctor: t.doctor.nombre,
      paciente: t.paciente.nombre,
      antes: this.slotView(t.inicio, ctx.timezone),
      ahora: this.slotView(nuevo, ctx.timezone),
    };
    const pending = this.needsConfirmation(
      ctx,
      `reprogramar|${turnoId}|${nuevaFechaHora}`,
      resumen,
      { name: "reprogramar_turno", args: { turnoId, nuevaFechaHora } },
      [resumen.ahora.hora, apellido(t.doctor.nombre)],
    );
    if (pending) return pending;
    await this.turnos.reprogramar({ ...BOT_ACTOR, clinicaId: ctx.clinicaId }, turnoId, nuevo.toISOString());
    return { ok: true, ...resumen };
  }
}
