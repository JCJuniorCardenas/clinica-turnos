"use client";

import { FormEvent, Fragment, useEffect, useRef, useState } from "react";
import { Avatar, Button, EmptyState, Icon, PageHeader } from "../../../components/ui";
import { ApiError, apiJson } from "../../../lib-api";
import { useSession } from "../../../lib/session";

type Mensaje = { de: "paciente" | "bot"; texto: string; hora: string };

const PACIENTES = [
  { label: "Paciente 1", telefono: "+5493770000001" },
  { label: "Paciente 2", telefono: "+5493770000002" },
];

const SUGERENCIAS = ["Hola, quiero un turno con pediatría", "Quiero ver mis turnos", "Quiero cancelar mi turno", "Quiero hablar con una persona"];

const ahora = () => new Intl.DateTimeFormat("es-AR", { timeZone: "America/Argentina/Buenos_Aires", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date());

/** WhatsApp-style *bold* (a single asterisk) rendered as bold text. */
function conFormato(texto: string) {
  return texto.split(/(\*[^*\n]+\*)/g).map((parte, i) =>
    parte.startsWith("*") && parte.endsWith("*") && parte.length > 2 ? <strong key={i}>{parte.slice(1, -1)}</strong> : <Fragment key={i}>{parte}</Fragment>,
  );
}

export default function SimuladorPage() {
  const me = useSession();
  const [demo, setDemo] = useState<boolean | null>(null);
  const [telefono, setTelefono] = useState(PACIENTES[0].telefono);
  const [chats, setChats] = useState<Record<string, Mensaje[]>>({});
  const [texto, setTexto] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const fin = useRef<HTMLDivElement>(null);

  useEffect(() => {
    apiJson<{ demoMode: boolean }>("/demo/estado").then((r) => setDemo(r.demoMode)).catch(() => setDemo(false));
  }, []);
  const mensajes = chats[telefono] ?? [];
  useEffect(() => {
    // Block body on purpose: an effect must not return anything but a cleanup function.
    fin.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [mensajes.length, enviando]);

  async function enviarTexto(t: string) {
    const limpio = t.trim();
    if (!limpio || enviando) return;
    setTexto("");
    setError(null);
    setAviso(null);
    setEnviando(true);
    setChats((c) => ({ ...c, [telefono]: [...(c[telefono] ?? []), { de: "paciente", texto: limpio, hora: ahora() }] }));
    try {
      const r = await apiJson<{ respuestas: string[] }>("/demo/chat", { method: "POST", body: JSON.stringify({ texto: limpio, telefono }) });
      setChats((c) => ({ ...c, [telefono]: [...(c[telefono] ?? []), ...r.respuestas.map((x) => ({ de: "bot" as const, texto: x, hora: ahora() }))] }));
    } catch (err) {
      setError((err as ApiError).message);
    } finally {
      setEnviando(false);
    }
  }

  function enviar(e: FormEvent) {
    e.preventDefault();
    void enviarTexto(texto);
  }

  async function reiniciar() {
    if (!confirm("Esto borra los pacientes, turnos y chats de prueba y carga los de ejemplo. ¿Seguir?")) return;
    setError(null);
    try {
      await apiJson("/demo/reiniciar", { method: "POST" });
      setChats({});
      setAviso("Datos de la demo reiniciados.");
    } catch (err) {
      setError((err as ApiError).message);
    }
  }

  if (demo === false) {
    return (
      <main className="p-8">
        <EmptyState icon="shield" title="Solo disponible en modo demo" />
      </main>
    );
  }
  if (me.rol === "DOCTOR") {
    return (
      <main className="p-8">
        <EmptyState icon="shield" title="Solo para recepción y administración" />
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-xl p-4 sm:p-6 lg:p-8">
      <PageHeader
        eyebrow="Herramientas"
        title="Simulador de WhatsApp"
        description="Conversá con el asistente como si fueras un paciente. Usa la misma lógica que el WhatsApp real, así que sirve de respaldo si la conexión falla. Datos ficticios solamente."
      />

      <div className="mb-3 flex flex-wrap items-center gap-2">
        <div className="inline-flex rounded-xl border border-line bg-surface p-0.5 shadow-card">
          {PACIENTES.map((p) => (
            <button
              key={p.telefono}
              onClick={() => setTelefono(p.telefono)}
              className={`rounded-lg px-3.5 py-1.5 text-sm font-medium transition ${telefono === p.telefono ? "brand-gradient text-white shadow-card" : "text-muted hover:text-ink"}`}
            >
              {p.label}
            </button>
          ))}
        </div>
        {me.rol === "ADMIN" && (
          <Button variant="danger" size="sm" icon="refresh" onClick={reiniciar} className="ml-auto">
            Reiniciar datos de la demo
          </Button>
        )}
      </div>
      {aviso && <p className="animate-pop-in mb-3 rounded-xl bg-ok-soft p-2.5 text-sm text-ok">{aviso}</p>}

      {/* Phone-like chat window */}
      <div className="animate-fade-up overflow-hidden rounded-3xl border border-line bg-surface shadow-modal">
        <div className="flex items-center gap-3 bg-[#0f766e] px-4 py-3 text-white dark:bg-[#0b4f49]">
          <Avatar name="Asistente Turnos" size={40} />
          <div className="leading-tight">
            <p className="font-semibold">Asistente de turnos</p>
            <p className="flex items-center gap-1.5 text-xs text-white/80">
              <span className="h-2 w-2 rounded-full bg-[#7CFFB2]" />
              {enviando ? "escribiendo..." : "en línea"}
            </p>
          </div>
          <Icon name="whatsapp" size={22} className="ml-auto text-white/70" />
        </div>

        <div className="flex h-[48vh] min-h-72 flex-col gap-2 overflow-y-auto bg-[#efe9df] p-4 dark:bg-[#0c1514]"
          style={{ backgroundImage: "radial-gradient(rgb(0 0 0 / 0.045) 1px, transparent 1px)", backgroundSize: "18px 18px" }}>
          {mensajes.length === 0 && (
            <div className="m-auto max-w-xs text-center">
              <p className="text-sm text-muted">Escribí un mensaje o probá con una de estas frases:</p>
              <div className="mt-3 flex flex-wrap justify-center gap-2">
                {SUGERENCIAS.map((s) => (
                  <button key={s} onClick={() => enviarTexto(s)} className="rounded-full border border-line bg-surface px-3 py-1.5 text-xs font-medium shadow-card transition hover:border-accent hover:text-accent">
                    {s}
                  </button>
                ))}
              </div>
            </div>
          )}
          {mensajes.map((m, i) => (
            <div key={i} className={`animate-pop-in max-w-[85%] whitespace-pre-wrap rounded-2xl px-3.5 py-2 text-sm shadow-card ${
              m.de === "paciente" ? "self-end rounded-tr-md bg-[#d9fdd3] text-[#111b21] dark:bg-[#005c4b] dark:text-white" : "self-start rounded-tl-md bg-surface"
            }`}>
              {conFormato(m.texto)}
              <span className={`mt-1 block text-right text-[10px] ${m.de === "paciente" ? "text-black/45 dark:text-white/60" : "text-muted"}`}>{m.hora}</span>
            </div>
          ))}
          {enviando && (
            <div className="animate-pop-in flex w-16 items-center justify-center gap-1 self-start rounded-2xl rounded-tl-md bg-surface px-3.5 py-3 shadow-card" aria-label="El asistente está escribiendo">
              {[0, 1, 2].map((d) => (
                <span key={d} className="h-2 w-2 rounded-full bg-muted" style={{ animation: "typing 1.1s infinite", animationDelay: `${d * 0.15}s` }} />
              ))}
            </div>
          )}
          <div ref={fin} />
        </div>

        <form onSubmit={enviar} className="flex items-center gap-2 border-t border-line bg-surface p-3">
          <input value={texto} onChange={(e) => setTexto(e.target.value)} maxLength={500} placeholder="Escribí un mensaje" aria-label="Mensaje"
            className="min-w-0 flex-1 rounded-full border border-line bg-surface-2 px-4 py-2.5 text-sm outline-none transition focus:border-accent focus:ring-4 focus:ring-accent/15" />
          <button disabled={enviando || !texto.trim()} aria-label="Enviar"
            className="brand-gradient flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-white shadow-card transition hover:shadow-pop active:scale-95 disabled:opacity-50">
            <Icon name="send" size={18} />
          </button>
        </form>
      </div>

      {error && (
        <p role="alert" className="animate-pop-in mt-3 flex items-center gap-2 rounded-xl bg-danger-soft p-3 text-sm text-danger">
          <Icon name="alert" size={18} />
          {error}
        </p>
      )}
    </main>
  );
}
