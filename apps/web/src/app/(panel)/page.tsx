"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { NuevoTurnoModal } from "../../components/NuevoTurnoModal";
import { TurnoModal } from "../../components/TurnoModal";
import { Agenda, AgendaDoctor, ApiError, EstadoTurno, Slot, apiJson } from "../../lib-api";
import { addDias, fechaLarga, fmtHora, hoyAR } from "../../lib/format";
import { LiveEvent, beep, isMuted, setMuted, useTurnoStream } from "../../lib/live";
import { useSession } from "../../lib/session";

type Toast = { id: number; texto: string };
type Seleccion = { doctor: AgendaDoctor; slot: Slot };

const ESTILO: Record<EstadoTurno, string> = {
  PENDIENTE: "border-amber-300 bg-amber-50",
  CONFIRMADO: "border-teal-300 bg-teal-50",
  CANCELADO: "border-slate-200 bg-slate-100",
  ATENDIDO: "border-slate-300 bg-slate-100 text-slate-600",
  AUSENTE: "border-orange-300 bg-orange-50",
};
const ETIQUETA: Record<EstadoTurno, string> = {
  PENDIENTE: "Pendiente",
  CONFIRMADO: "Confirmado",
  CANCELADO: "Cancelado",
  ATENDIDO: "Atendido",
  AUSENTE: "Ausente",
};

export default function AgendaPage() {
  const me = useSession();
  const puedeAgendar = me.rol === "ADMIN" || me.rol === "RECEPCION";

  const [fecha, setFecha] = useState(hoyAR());
  const [agenda, setAgenda] = useState<Agenda | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [nuevo, setNuevo] = useState<Seleccion | null>(null);
  const [detalle, setDetalle] = useState<Seleccion | null>(null);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [silenciado, setSilenciado] = useState(false);

  const [doctorId, setDoctorId] = useState("");
  const [todosLosDoctores, setTodosLosDoctores] = useState<{ id: string; nombre: string }[]>([]);

  const fechaRef = useRef(fecha);
  fechaRef.current = fecha;
  const doctorRef = useRef(doctorId);
  doctorRef.current = doctorId;
  const agendaRef = useRef<Agenda | null>(null);
  agendaRef.current = agenda;
  const silenciadoRef = useRef(silenciado);
  silenciadoRef.current = silenciado;

  useEffect(() => setSilenciado(isMuted()), []);

  const cargar = useCallback(async () => {
    try {
      const filtro = doctorRef.current ? `&doctorId=${doctorRef.current}` : "";
      setAgenda(await apiJson<Agenda>(`/agenda?fecha=${fechaRef.current}${filtro}`));
      setError(null);
    } catch (e) {
      setError((e as ApiError).message);
    }
  }, []);

  useEffect(() => {
    cargar();
  }, [fecha, doctorId, cargar]);

  useEffect(() => {
    apiJson<{ id: string; nombre: string }[]>("/doctores").then(setTodosLosDoctores).catch(() => undefined);
  }, []);

  // Safety net: if the live connection silently dies, the grid still refreshes every 30 s.
  useEffect(() => {
    const id = setInterval(cargar, 30_000);
    return () => clearInterval(id);
  }, [cargar]);

  const onEvent = useCallback(
    (e: LiveEvent) => {
      cargar();
      if (e.type === "conversacion.derivada") {
        const id = Date.now() + Math.random();
        setToasts((t) => [...t, { id, texto: "Un chat de WhatsApp fue derivado a recepción. Mirá la sección Chats derivados." }]);
        setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 12000);
        if (!silenciadoRef.current) beep();
        return;
      }
      // Only announce changes made by someone else (the user already sees their own).
      if (e.type === "conversacion.liberada" || e.type === "ready" || e.type === "turno.estado" || e.actor === me.id || !e.inicio) return;
      const doctor = agendaRef.current?.doctores.find((d) => d.id === e.doctorId)?.nombre ?? "un doctor";
      const verbo =
        e.type === "turno.creado" ? "Nuevo turno" : e.type === "turno.cancelado" ? "Turno cancelado" : "Turno reprogramado";
      const dia = new Intl.DateTimeFormat("es-AR", { timeZone: "America/Argentina/Buenos_Aires", day: "numeric", month: "short" }).format(new Date(e.inicio));
      const id = Date.now() + Math.random();
      setToasts((t) => [...t, { id, texto: `${verbo}: ${dia} ${fmtHora(e.inicio!)} con ${doctor}` }]);
      setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 8000);
      if (!silenciadoRef.current) beep();
    },
    [cargar, me.id],
  );
  const estado = useTurnoStream(onEvent);

  function alternarSonido() {
    setMuted(!silenciado);
    setSilenciado(!silenciado);
  }

  // Grid rows = every distinct start time across the doctors who work that day.
  const doctores = (agenda?.doctores ?? []).filter((d) => d.slots.length > 0);
  const horas = Array.from(new Set(doctores.flatMap((d) => d.slots.map((s) => fmtHora(s.inicio))))).sort();
  const celda = (d: AgendaDoctor, hora: string) => d.slots.find((s) => fmtHora(s.inicio) === hora);

  function cerrarYRecargar() {
    setNuevo(null);
    setDetalle(null);
    cargar();
  }

  return (
    <main className="p-4 print:p-0">
      {/* Only visible on paper: the screen controls are hidden when printing. */}
      <div className="mb-3 hidden print:block">
        <h1 className="text-xl font-bold">{me.clinica.nombre} · Agenda del día</h1>
        <p className="first-letter:uppercase">
          {fechaLarga(fecha)}
          {doctorId ? ` · ${todosLosDoctores.find((d) => d.id === doctorId)?.nombre ?? ""}` : ""}
        </p>
      </div>
      <div className="mb-4 flex flex-wrap items-center gap-2 print:hidden">
        <button onClick={() => setFecha(addDias(fecha, -1))} aria-label="Día anterior"
          className="rounded border border-slate-300 bg-white px-3 py-2 hover:bg-slate-50">‹</button>
        <input type="date" value={fecha} onChange={(e) => e.target.value && setFecha(e.target.value)}
          className="rounded border border-slate-300 bg-white px-3 py-2" aria-label="Fecha" />
        <button onClick={() => setFecha(addDias(fecha, 1))} aria-label="Día siguiente"
          className="rounded border border-slate-300 bg-white px-3 py-2 hover:bg-slate-50">›</button>
        <button onClick={() => setFecha(hoyAR())} className="rounded border border-slate-300 bg-white px-3 py-2 hover:bg-slate-50">Hoy</button>
        <h1 className="ml-2 block text-lg font-semibold first-letter:uppercase print:hidden">{fechaLarga(fecha)}</h1>
        {me.rol !== "DOCTOR" && (
          <select value={doctorId} onChange={(e) => setDoctorId(e.target.value)} aria-label="Filtrar por doctor"
            className="rounded border border-slate-300 bg-white px-3 py-2">
            <option value="">Todos los doctores</option>
            {todosLosDoctores.map((d) => (
              <option key={d.id} value={d.id}>{d.nombre}</option>
            ))}
          </select>
        )}
        <button onClick={() => window.print()} className="rounded border border-slate-300 bg-white px-3 py-2 hover:bg-slate-50">
          🖨 Imprimir
        </button>
        <div className="ml-auto flex items-center gap-3 text-sm">
          <button onClick={alternarSonido} className="rounded border border-slate-300 bg-white px-2 py-1 hover:bg-slate-50"
            aria-pressed={silenciado}>
            {silenciado ? "🔕 Sonido apagado" : "🔔 Sonido activado"}
          </button>
          <span className="flex items-center gap-1" title="Conexión para ver los cambios al instante">
            <span className={`h-2.5 w-2.5 rounded-full ${estado === "online" ? "bg-green-500" : "bg-amber-500"}`} />
            {estado === "online" ? "En vivo" : "Reconectando..."}
          </span>
        </div>
      </div>

      {error && <p role="alert" className="mb-3 rounded bg-red-50 p-3 text-sm text-red-700">{error}</p>}
      {!agenda && !error && <p className="text-slate-500">Cargando agenda...</p>}
      {agenda && doctores.length === 0 && (
        <p className="rounded bg-white p-6 text-center text-slate-500 shadow-sm">Ningún doctor atiende este día.</p>
      )}

      {doctores.length > 0 && (
        <div className="overflow-x-auto rounded-lg bg-white shadow-sm print:overflow-visible print:shadow-none">
          <table className="w-full min-w-max border-collapse text-sm">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50">
                <th className="sticky left-0 w-16 bg-slate-50 px-3 py-2 text-left font-medium text-slate-500">Hora</th>
                {doctores.map((d) => (
                  <th key={d.id} className="min-w-44 px-3 py-2 text-left">
                    <span className="block font-semibold">{d.nombre}</span>
                    <span className="block text-xs font-normal text-slate-500">{d.especialidad}</span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {horas.map((hora) => (
                <tr key={hora} className="border-b border-slate-100 align-top">
                  <td className="sticky left-0 bg-white px-3 py-2 font-medium text-slate-600">{hora}</td>
                  {doctores.map((d) => {
                    const slot = celda(d, hora);
                    if (!slot) return <td key={d.id} className="bg-slate-50/60 px-2 py-1.5" />;
                    if (slot.turno) {
                      return (
                        <td key={d.id} className="px-2 py-1.5">
                          <button onClick={() => setDetalle({ doctor: d, slot })}
                            className={`w-full rounded border px-2 py-1.5 text-left hover:brightness-95 ${ESTILO[slot.turno.estado]}`}>
                            <span className="block truncate font-medium">{slot.turno.paciente.nombre}</span>
                            <span className="block truncate text-xs text-slate-600">
                              {slot.turno.paciente.telefono}
                              {slot.turno.origen === "BOT" ? " · WhatsApp" : ""}
                            </span>
                            {slot.turno.estado !== "CONFIRMADO" && (
                              <span className="block text-xs font-medium">{ETIQUETA[slot.turno.estado]}</span>
                            )}
                          </button>
                        </td>
                      );
                    }
                    if (slot.pasado || !puedeAgendar) {
                      return <td key={d.id} className="px-2 py-1.5 text-slate-300">{slot.pasado ? "—" : "Libre"}</td>;
                    }
                    return (
                      <td key={d.id} className="px-2 py-1.5">
                        <button onClick={() => setNuevo({ doctor: d, slot })}
                          className="w-full rounded border border-dashed border-slate-300 px-2 py-1.5 text-left text-slate-400 hover:border-teal-600 hover:bg-teal-50 hover:text-teal-700">
                          Libre
                        </button>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {nuevo && <NuevoTurnoModal doctor={nuevo.doctor} slot={nuevo.slot} onClose={() => setNuevo(null)} onDone={cerrarYRecargar} />}
      {detalle && <TurnoModal doctor={detalle.doctor} slot={detalle.slot} onClose={() => setDetalle(null)} onDone={cerrarYRecargar} />}

      <div className="fixed bottom-4 right-4 z-50 w-72 space-y-2 print:hidden" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className="rounded-lg bg-slate-900 px-4 py-3 text-sm text-white shadow-lg">{t.texto}</div>
        ))}
      </div>
    </main>
  );
}
