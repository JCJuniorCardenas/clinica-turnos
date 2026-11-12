// Conversation check against the REAL AI (Groq/Gemini keys from .env): pnpm --filter api bot:eval
// Runs a few typical chats through the same engine as WhatsApp (simulated, nothing is sent) and checks the result
// in the database. It spends a little of the free AI quota, so run it by hand before recording or deploying,
// not in CI. Only against a local database unless EVAL_ALLOW_REMOTE=true.
import "reflect-metadata";
import { config } from "dotenv";
config({ path: "../../.env", quiet: true });
process.env.WHATSAPP_PROVIDER = "console";
process.env.BOT_ENABLED = "false";

import { NestFactory } from "@nestjs/core";
import { AppModule } from "../app.module";
import { PrismaService } from "../prisma/prisma.service";
import { BotService } from "./bot.service";
import { DEFAULT_CONFIG } from "./config";
import { apellido } from "./lists";

const PHONE = "+5490000000999"; // fictitious, only used by this check
const DNI = "10000099";

type Check = { ok: boolean; detalle: string };
type Scenario = { nombre: string; run: (chat: Chat, db: PrismaService, clinicaId: string) => Promise<Check> };
type Chat = (text: string) => Promise<string>;

const norm = (s: string) => s.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();

async function turnoDelEval(db: PrismaService, clinicaId: string) {
  return db.turno.findFirst({
    where: { clinicaId, paciente: { telefono: PHONE }, inicio: { gt: new Date() } },
    include: { doctor: true },
    orderBy: { creadoEn: "desc" },
  });
}

/** Answers follow-up questions with a plain yes until the condition holds (the AI may ask one more thing). */
async function insistir(chat: Chat, hecho: () => Promise<boolean>, respuesta: string, veces = 2) {
  for (let i = 0; i < veces && !(await hecho()); i++) await chat(respuesta);
  return hecho();
}

const SCENARIOS: Scenario[] = [
  {
    nombre: "Nombra a todos los pediatras",
    run: async (chat, db, clinicaId) => {
      const reply = await chat("Buen día, ¿tienen pediatra en la clínica?");
      const pediatras = await db.doctor.findMany({ where: { clinicaId, activo: true, especialidad: { nombre: "Pediatría" } } });
      const faltan = pediatras.filter((d) => !norm(reply).includes(norm(apellido(d.nombre))));
      return { ok: pediatras.length > 0 && faltan.length === 0, detalle: faltan.length ? `faltó: ${faltan.map((d) => d.nombre).join(", ")}` : "todos nombrados" };
    },
  },
  {
    nombre: "Lista todas las especialidades",
    run: async (chat, db, clinicaId) => {
      const reply = await chat("¿Qué especialidades tienen?");
      const esp = await db.especialidad.findMany({ where: { clinicaId, doctores: { some: { activo: true } } } });
      const faltan = esp.filter((e) => !norm(reply).includes(norm(e.nombre)));
      return { ok: faltan.length === 0, detalle: faltan.length ? `faltó: ${faltan.map((e) => e.nombre).join(", ")}` : "todas nombradas" };
    },
  },
  {
    nombre: "Saca un turno y queda en la agenda",
    run: async (chat, db, clinicaId) => {
      await chat("Hola, quiero sacar un turno con el Dr. Martín Sosa");
      await chat("El primer horario que tengas, por favor");
      await chat(`Es para mí, me llamo Juan Prueba, DNI ${DNI}`);
      await chat("Sí, confirmo");
      const ok = await insistir(chat, async () => !!(await turnoDelEval(db, clinicaId)), "Sí, confirmo");
      const t = await turnoDelEval(db, clinicaId);
      return { ok: ok && !!t && t.doctor.nombre.includes("Sosa") && t.estado === "CONFIRMADO", detalle: t ? `turno ${t.estado} con ${t.doctor.nombre}` : "no se creó el turno" };
    },
  },
  {
    nombre: "Muestra los turnos del paciente",
    run: async (chat) => {
      const reply = await chat("¿Qué turnos tengo?");
      return { ok: norm(reply).includes("sosa"), detalle: norm(reply).includes("sosa") ? "mencionó el turno con Sosa" : "no mencionó el turno" };
    },
  },
  {
    nombre: "Cancela el turno con confirmación",
    run: async (chat, db, clinicaId) => {
      await chat("Quiero cancelar mi turno");
      const cancelado = async () => (await db.turno.count({ where: { clinicaId, paciente: { telefono: PHONE }, estado: "CANCELADO" } })) > 0;
      await chat("Sí, cancelalo");
      const ok = await insistir(chat, cancelado, "Sí, confirmo");
      return { ok, detalle: ok ? "turno cancelado" : "el turno sigue activo" };
    },
  },
];

async function limpiar(db: PrismaService, clinicaId: string) {
  const pacientes = await db.paciente.findMany({ where: { clinicaId, telefono: PHONE }, select: { id: true } });
  const turnos = await db.turno.findMany({ where: { pacienteId: { in: pacientes.map((p) => p.id) } }, select: { id: true } });
  const convs = await db.conversacion.findMany({ where: { clinicaId, telefono: PHONE }, select: { id: true } });
  await db.auditoria.deleteMany({ where: { entidadId: { in: [...turnos, ...convs].map((x) => x.id) } } });
  await db.turno.deleteMany({ where: { id: { in: turnos.map((t) => t.id) } } });
  await db.paciente.deleteMany({ where: { id: { in: pacientes.map((p) => p.id) } } });
  await db.conversacion.deleteMany({ where: { id: { in: convs.map((c) => c.id) } } });
}

async function main() {
  const url = process.env.DATABASE_URL ?? "";
  if (!/@(localhost|127\.0\.0\.1)[:/]/.test(url) && process.env.EVAL_ALLOW_REMOTE !== "true") {
    throw new Error("La prueba solo corre contra la base local. Para otra base, EVAL_ALLOW_REMOTE=true (crea y borra un turno de prueba).");
  }
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ["error"] });
  const db = app.get(PrismaService);
  const bot = app.get(BotService);
  const clinicaId = process.env.BOT_CLINICA_ID ?? (await db.clinica.findFirstOrThrow({ orderBy: { creadoEn: "asc" } })).id;

  await limpiar(db, clinicaId);
  let fallas = 0;
  try {
    for (const [i, s] of SCENARIOS.entries()) {
      // Turns 3 to 5 continue one conversation (book, list, cancel); the others start fresh.
      if (i < 3) await db.conversacion.deleteMany({ where: { clinicaId, telefono: PHONE } });
      console.log(`\n=== ${s.nombre} ===`);
      const chat: Chat = async (text) => {
        const inicio = Date.now();
        let reply = (await bot.simulate(PHONE, text)).join("\n");
        // "Busy" means every AI model was out of quota or too slow: that message was not processed, so wait and resend it.
        for (let intento = 0; intento < 2 && reply === DEFAULT_CONFIG.textoOcupado; intento++) {
          console.log("  (la IA está ocupada; espero 30 s y reenvío el mensaje)");
          await new Promise((r) => setTimeout(r, 30_000));
          reply = (await bot.simulate(PHONE, text)).join("\n");
        }
        console.log(`  Paciente: ${text}\n  Bot (${((Date.now() - inicio) / 1000).toFixed(1)} s): ${reply.replace(/\n/g, "\n       ")}`);
        return reply;
      };
      const r = await s.run(chat, db, clinicaId).catch((e) => ({ ok: false, detalle: `error: ${(e as Error).message}` }));
      if (!r.ok) fallas++;
      console.log(`  -> ${r.ok ? "OK" : "FALLÓ"}: ${r.detalle}`);
    }
  } finally {
    await limpiar(db, clinicaId);
    await app.close();
  }
  console.log(`\nResultado: ${SCENARIOS.length - fallas} de ${SCENARIOS.length} conversaciones correctas.`);
  process.exit(fallas === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
