// End-to-end check of the whole demo, through the panel's own address (so the production proxy is exercised too).
//   pnpm demo:smoke                                  -> against http://localhost:3000
//   SMOKE_BASE_URL=https://mi-panel.up.railway.app SMOKE_PASSWORD=... pnpm demo:smoke
// SMOKE_BOT=false skips the part that talks to the real AI. Uses only fictional data and cleans up after itself.

const BASE = (process.env.SMOKE_BASE_URL ?? "http://localhost:3000").replace(/\/$/, "");
const PASSWORD = process.env.SMOKE_PASSWORD ?? process.env.SEED_PASSWORD ?? "Demo1234!";
const WITH_BOT = process.env.SMOKE_BOT !== "false";
const BOT_PACE_MS = Number(process.env.SMOKE_BOT_PACE_MS ?? 25_000); // free AI tier allows few requests per minute

type Json = any;
let failures = 0;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function step(name: string, ok: boolean, detail = "") {
  console.log(`${ok ? "✔" : "✘"} ${name}${detail ? `  (${detail})` : ""}`);
  if (!ok) failures++;
}

class Client {
  private cookie = "";
  async login(email: string) {
    const res = await fetch(`${BASE}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password: PASSWORD }),
    });
    if (!res.ok) throw new Error(`login ${email} -> ${res.status}`);
    this.cookie = res.headers.getSetCookie().map((c) => c.split(";")[0]).join("; ");
  }
  async call(method: string, path: string, body?: unknown): Promise<{ status: number; json: Json; res: Response }> {
    const res = await fetch(`${BASE}/api${path}`, {
      method,
      headers: { "Content-Type": "application/json", Cookie: this.cookie },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const json = await res.clone().json().catch(() => null);
    return { status: res.status, json, res };
  }
  /** Opens the live stream and collects everything received, so tests can wait for specific events. */
  async openStream() {
    const ctrl = new AbortController();
    const res = await fetch(`${BASE}/api/turnos/stream`, { headers: { Cookie: this.cookie }, signal: ctrl.signal });
    let text = "";
    void (async () => {
      const reader = res.body!.getReader();
      const dec = new TextDecoder();
      try {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          text += dec.decode(value);
        }
      } catch {
        /* aborted */
      }
    })();
    return {
      status: res.status,
      async waitFor(needle: string, ms = 6000) {
        const end = Date.now() + ms;
        while (Date.now() < end) {
          if (text.includes(needle)) return true;
          await sleep(150);
        }
        return text.includes(needle);
      },
      close: () => ctrl.abort(),
    };
  }
}

function nextWeekday(weekday: number, minDaysAhead = 2): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + minDaysAhead);
  while (d.getUTCDay() !== weekday) d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

async function main() {
  console.log(`Prueba de punta a punta contra ${BASE}\n`);

  // ---- health through the proxy
  const health = await fetch(`${BASE}/api/health`).catch(() => null);
  step("La API responde a través del panel (/api/health)", health?.status === 200);
  if (health?.status !== 200) throw new Error("No se puede continuar sin API");

  const recepcion = new Client();
  const admin = new Client();
  await recepcion.login("recepcion@demo.test");
  await admin.login("admin@demo.test");
  step("Login de recepción y administrador", true);

  const stream = await recepcion.openStream();
  step("Agenda en vivo conectada (SSE)", stream.status === 200 && (await stream.waitFor("ready")));

  // ---- appointments through the panel API
  const doctores: Json[] = (await recepcion.call("GET", "/doctores")).json;
  const sosa = doctores.find((d) => d.nombre.includes("Sosa"));
  const fecha = nextWeekday(1); // Dr. Sosa works Mondays
  const disp = (await recepcion.call("GET", `/disponibilidad?doctorId=${sosa.id}&desde=${fecha}&hasta=${fecha}`)).json;
  step("Disponibilidad calculada", disp.slots.length >= 3, `${disp.slots.length} horarios`);

  const mkPaciente = async (nombre: string, dni: string, tel: string) => {
    const r = await recepcion.call("POST", "/pacientes", { nombre, dni, telefono: tel });
    if (r.status === 409) return (await recepcion.call("GET", `/pacientes?dni=${dni}`)).json[0];
    return r.json;
  };
  const p1 = await mkPaciente("Smoke Test Panel Uno", "40000001", "+5493770009801");
  const p2 = await mkPaciente("Smoke Test Panel Dos", "40000002", "+5493770009802");

  const creado = await recepcion.call("POST", "/turnos", { doctorId: sosa.id, pacienteId: p1.id, inicio: disp.slots[0].inicio });
  step("Recepción saca un turno", creado.status === 201);
  step("…y la agenda en vivo avisa", await stream.waitFor("turno.creado"));

  const choque = await recepcion.call("POST", "/turnos", { doctorId: sosa.id, pacienteId: p2.id, inicio: disp.slots[0].inicio });
  step("Mismo horario: gana uno, el otro recibe alternativas (409)", choque.status === 409 && choque.json.alternativas?.length > 0);

  const repro = await recepcion.call("PATCH", `/turnos/${creado.json.id}/reprogramar`, { nuevaFechaHora: disp.slots[1].inicio });
  step("Reprogramar un turno", repro.status === 200);
  const libre = (await recepcion.call("GET", `/disponibilidad?doctorId=${sosa.id}&desde=${fecha}&hasta=${fecha}`)).json.slots;
  step("El horario anterior vuelve a quedar libre", libre.some((s: Json) => s.inicio === disp.slots[0].inicio));

  const agenda = (await recepcion.call("GET", `/agenda?fecha=${fecha}`)).json;
  const enAgenda = agenda.doctores.find((d: Json) => d.id === sosa.id).slots.some((s: Json) => s.turno?.paciente?.dni === "40000001");
  step("El turno figura en la agenda del día", enAgenda);

  const xlsx = await recepcion.call("GET", `/turnos/exportar?desde=${fecha}&hasta=${fecha}`);
  const bytes = Buffer.from(await xlsx.res.arrayBuffer());
  step("Exportación a Excel", xlsx.status === 200 && bytes.subarray(0, 2).toString() === "PK" && bytes.length > 1000, `${bytes.length} bytes`);

  await recepcion.call("PATCH", `/turnos/${creado.json.id}/cancelar`);
  step("Cancelar un turno", true);

  // ---- bot (simulated chat = same logic as WhatsApp)
  const chat = async (telefono: string, texto: string): Promise<string> => {
    for (let intento = 0; intento < 3; intento++) {
      const r = await recepcion.call("POST", "/demo/chat", { telefono, texto });
      if (r.status !== 201) throw new Error(`demo/chat -> ${r.status} ${JSON.stringify(r.json)}`);
      const texto2 = (r.json.respuestas as string[]).join("\n");
      if (!/muchas consultas/i.test(texto2)) return texto2;
      console.log("   (el modelo gratuito pidió esperar, reintento en 30 s)");
      await sleep(30_000);
    }
    throw new Error("El modelo sigue ocupado");
  };

  const urg = await chat("+5493770009803", "me duele el pecho y no puedo respirar");
  step("Urgencia: el bot responde con el texto fijo de emergencias", /emergencias|guardia/i.test(urg));
  const derivadas = (await recepcion.call("GET", "/conversaciones/derivadas")).json as Json[];
  const fila = derivadas.find((c) => c.telefono === "+5493770009803");
  step("…y el chat aparece derivado a recepción", !!fila?.urgencia);
  step("…con aviso en vivo", await stream.waitFor("conversacion.derivada"));
  if (fila) await recepcion.call("POST", `/conversaciones/${fila.id}/liberar`);

  if (WITH_BOT) {
    const tel = "+5493770009804";
    const dniBot = "40404040";
    const r1 = await chat(tel, "Hola, quiero sacar un turno con el Dr. Martín Sosa de clínica médica");
    step("Bot: saluda y avanza", r1.length > 10);
    await sleep(BOT_PACE_MS);
    const r2 = await chat(tel, "Me sirve cualquier día de la semana próxima a la tarde. ¿Qué horarios tenés?");
    step("Bot: ofrece horarios reales", /\d{1,2}:\d{2}/.test(r2));
    await sleep(BOT_PACE_MS);
    await chat(tel, `Quiero el primero que me ofreciste. Es para mí, me llamo Smoke Test Bot y mi DNI es ${dniBot}`);
    await sleep(BOT_PACE_MS);
    await chat(tel, "Sí, confirmo");
    let turnoBot: Json | undefined;
    for (let i = 0; i < 2 && !turnoBot; i++) {
      const lista = (await recepcion.call("GET", `/pacientes?dni=${dniBot}`)).json as Json[];
      if (lista.length) {
        const rango = `desde=${nextWeekday(0, 0)}&hasta=${nextWeekday(0, 30)}`;
        turnoBot = ((await recepcion.call("GET", `/turnos?${rango}`)).json as Json[]).find((t) => t.pacienteId === lista[0].id);
      }
      if (!turnoBot) {
        await sleep(BOT_PACE_MS);
        await chat(tel, "Sí, agendalo por favor");
      }
    }
    step("Bot: el turno quedó agendado y figura en el panel", !!turnoBot && turnoBot.origen === "BOT");
    step("…con aviso en vivo", await stream.waitFor('"actor":"BOT"'));
    if (turnoBot) await recepcion.call("PATCH", `/turnos/${turnoBot.id}/cancelar`);

    await sleep(BOT_PACE_MS);
    const h = await chat("+5493770009805", "Quiero hablar con una persona de recepción");
    step("Bot: deriva cuando piden hablar con una persona", /recepci/i.test(h));
    const derivadas2 = (await recepcion.call("GET", "/conversaciones/derivadas")).json as Json[];
    const fila2 = derivadas2.find((c) => c.telefono === "+5493770009805");
    step("…y recepción lo ve", !!fila2);
    if (fila2) await recepcion.call("POST", `/conversaciones/${fila2.id}/liberar`);
  } else {
    console.log("- Parte del bot con IA omitida (SMOKE_BOT=false)");
  }

  stream.close();

  // ---- leave the demo clean
  const reset = await admin.call("POST", "/demo/reiniciar");
  step("Datos de la demo reiniciados", reset.status === 201);

  console.log(failures === 0 ? "\n✔ Todo OK: la demo corre de punta a punta." : `\n✘ ${failures} paso(s) fallaron.`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error("\n✘ La prueba se interrumpió:", e.message);
  process.exit(1);
});
