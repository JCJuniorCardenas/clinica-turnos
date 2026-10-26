"use client";

import { FormEvent, Fragment, useEffect, useRef, useState } from "react";
import { ApiError, apiJson } from "../../../lib-api";
import { useSession } from "../../../lib/session";

type Mensaje = { de: "paciente" | "bot"; texto: string };

const PACIENTES = [
  { label: "Paciente 1", telefono: "+5493770000001" },
  { label: "Paciente 2", telefono: "+5493770000002" },
];

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
    // Block body on purpose: scrollIntoView() returns a Promise in recent Chrome, and an effect may only return a cleanup function.
    fin.current?.scrollIntoView({ behavior: "smooth" });
  }, [mensajes.length, enviando]);

  async function enviar(e: FormEvent) {
    e.preventDefault();
    const t = texto.trim();
    if (!t || enviando) return;
    setTexto("");
    setError(null);
    setEnviando(true);
    setChats((c) => ({ ...c, [telefono]: [...(c[telefono] ?? []), { de: "paciente", texto: t }] }));
    try {
      const r = await apiJson<{ respuestas: string[] }>("/demo/chat", { method: "POST", body: JSON.stringify({ texto: t, telefono }) });
      setChats((c) => ({ ...c, [telefono]: [...(c[telefono] ?? []), ...r.respuestas.map((x) => ({ de: "bot" as const, texto: x }))] }));
    } catch (err) {
      setError((err as ApiError).message);
    } finally {
      setEnviando(false);
    }
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

  if (demo === false) return <p className="p-6 text-slate-600">El simulador solo está disponible en modo demo.</p>;
  if (me.rol === "DOCTOR") return <p className="p-6 text-slate-600">Esta pantalla es para recepción y administración.</p>;

  return (
    <main className="mx-auto max-w-xl p-4">
      <h1 className="text-lg font-semibold">Simulador de WhatsApp</h1>
      <p className="mb-3 text-sm text-slate-600">
        Conversá con el asistente como si fueras un paciente. Usa la misma lógica que el WhatsApp real, así que sirve de respaldo si la conexión falla. Datos ficticios solamente.
      </p>
      <div className="mb-2 flex flex-wrap items-center gap-2 text-sm">
        {PACIENTES.map((p) => (
          <button key={p.telefono} onClick={() => setTelefono(p.telefono)}
            className={`rounded border px-3 py-1 ${telefono === p.telefono ? "border-teal-700 bg-teal-700 text-white" : "border-slate-300 bg-white hover:bg-slate-50"}`}>
            {p.label} <span className="opacity-70">({p.telefono.slice(-4)})</span>
          </button>
        ))}
        {me.rol === "ADMIN" && (
          <button onClick={reiniciar} className="ml-auto rounded border border-red-300 px-3 py-1 text-red-700 hover:bg-red-50">
            Reiniciar datos de la demo
          </button>
        )}
      </div>
      {aviso && <p className="mb-2 rounded bg-green-50 p-2 text-sm text-green-700">{aviso}</p>}

      <div className="flex h-[55vh] flex-col gap-2 overflow-y-auto rounded-lg bg-[#e7ded3] p-3">
        {mensajes.length === 0 && <p className="m-auto text-sm text-slate-500">Escribí «hola» para empezar.</p>}
        {mensajes.map((m, i) => (
          <div key={i} className={`max-w-[85%] whitespace-pre-wrap rounded-lg px-3 py-2 text-sm shadow-sm ${m.de === "paciente" ? "self-end bg-[#d9fdd3]" : "self-start bg-white"}`}>
            {conFormato(m.texto)}
          </div>
        ))}
        {enviando && <div className="self-start rounded-lg bg-white px-3 py-2 text-sm text-slate-400 shadow-sm">escribiendo...</div>}
        <div ref={fin} />
      </div>
      {error && <p role="alert" className="mt-2 rounded bg-red-50 p-2 text-sm text-red-700">{error}</p>}
      <form onSubmit={enviar} className="mt-2 flex gap-2">
        <input value={texto} onChange={(e) => setTexto(e.target.value)} maxLength={500} placeholder="Escribí un mensaje" aria-label="Mensaje"
          className="flex-1 rounded border border-slate-300 bg-white px-3 py-2" />
        <button disabled={enviando || !texto.trim()} className="rounded bg-teal-700 px-4 py-2 font-medium text-white hover:bg-teal-800 disabled:opacity-60">Enviar</button>
      </form>
    </main>
  );
}
