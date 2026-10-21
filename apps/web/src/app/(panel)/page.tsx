"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { NuevoTurnoModal } from "../../components/NuevoTurnoModal";
import { TurnoModal } from "../../components/TurnoModal";
import { Button, Card, EmptyState, Icon, Skeleton, inputCls } from "../../components/ui";
import { Agenda, AgendaDoctor, ApiError, EstadoTurno, Slot, apiJson } from "../../lib-api";
import { addDias, fechaLarga, fmtHora, hoyAR } from "../../lib/format";
import { LiveEvent, beep, isMuted, setMuted, useTurnoStream } from "../../lib/live";
import { useSession } from "../../lib/session";

type Toast = { id: number; titulo: string; texto: string; tipo: "nuevo" | "aviso" | "alerta" };
type Seleccion = { doctor: AgendaDoctor; slot: Slot };

/** Left bar + light background per appointment state. */
const ESTILO: Record<EstadoTurno, string> = {
  PENDIENTE: "border-warn bg-warn-soft",
  CONFIRMADO: "border-accent bg-accent-soft",
  CANCELADO: "border-line bg-surface-2",
  ATENDIDO: "border-ok bg-ok-soft",
  AUSENTE: "border-danger bg-danger-soft",
};
const ETIQUETA: Record<EstadoTurno, string> = {
  PENDIENTE: "Pendiente",
  CONFIRMADO: "Confirmado",
  CANCELADO: "Cancelado",
  ATENDIDO: "Atendido",
  AUSENTE: "Ausente",
};

function ToastCard({ t }: { t: Toast }) {
  const borde = { nuevo: "border-accent", aviso: "border-warn", alerta: "border-danger" }[t.tipo];
  return (
    <div className={`rounded-md border border-line border-l-4 bg-surface px-3.5 py-3 shadow-pop ${borde}`}>
      <p className="text-sm font-semibold">{t.titulo}</p>
      <p className="text-sm text-muted">{t.texto}</p>
    </div>
  );
}

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
  const [destacados, setDestacados] = useState<string[]>([]); // ids of appointments that just arrived or moved
  const [reloj, setReloj] = useState(0); // re-render each minute so the "now" marker moves

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
  useEffect(() => {
    const id = setInterval(() => setReloj((r) => r + 1), 60_000);
    return () => clearInterval(id);
  }, []);

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

  const avisar = useCallback((t: Omit<Toast, "id">, ms: number) => {
    const id = Date.now() + Math.random();
    setToasts((x) => [...x, { ...t, id }]);
    setTimeout(() => setToasts((x) => x.filter((y) => y.id !== id)), ms);
    if (!silenciadoRef.current) beep();
  }, []);

  const onEvent = useCallback(
    (e: LiveEvent) => {
      cargar();
      // A freshly booked or moved appointment flashes for a few seconds, whoever did it.
      if ((e.type === "turno.creado" || e.type === "turno.reprogramado") && e.turnoId) {
        const id = e.turnoId;
        setDestacados((d) => [...d, id]);
        setTimeout(() => setDestacados((d) => d.filter((x) => x !== id)), 7000);
      }
      if (e.type === "conversacion.derivada") {
        avisar({ tipo: "alerta", titulo: "Chat derivado a recepción", texto: "Un paciente necesita a una persona. Mirá «Chats derivados»." }, 12000);
        return;
      }
      // Only announce changes made by someone else (the user already sees their own).
      if (e.type === "conversacion.liberada" || e.type === "ready" || e.type === "turno.estado" || e.actor === me.id || !e.inicio) return;
      const doctor = agendaRef.current?.doctores.find((d) => d.id === e.doctorId)?.nombre ?? "un doctor";
      const titulo = e.type === "turno.creado" ? "¡Nuevo turno!" : e.type === "turno.cancelado" ? "Turno cancelado" : "Turno reprogramado";
      const dia = new Intl.DateTimeFormat("es-AR", { timeZone: "America/Argentina/Buenos_Aires", day: "numeric", month: "short" }).format(new Date(e.inicio));
      avisar({ tipo: e.type === "turno.creado" ? "nuevo" : "aviso", titulo, texto: `${dia} · ${fmtHora(e.inicio)} con ${doctor}` }, 8000);
    },
    [cargar, me.id, avisar],
  );
  const conexion = useTurnoStream(onEvent);

  function alternarSonido() {
    setMuted(!silenciado);
    setSilenciado(!silenciado);
  }

  // Grid rows = every distinct start time across the doctors who work that day.
  const doctores = (agenda?.doctores ?? []).filter((d) => d.slots.length > 0);
  const horas = Array.from(new Set(doctores.flatMap((d) => d.slots.map((s) => fmtHora(s.inicio))))).sort();
  const celda = (d: AgendaDoctor, hora: string) => d.slots.find((s) => fmtHora(s.inicio) === hora);

  // Day summary
  const todos = doctores.flatMap((d) => d.slots);
  const conTurno = todos.filter((s) => s.turno);
  const libres = todos.filter((s) => !s.turno && !s.pasado).length;
  const atendidos = conTurno.filter((s) => s.turno!.estado === "ATENDIDO").length;
  const porWhatsapp = conTurno.filter((s) => s.turno!.origen === "BOT").length;

  const esHoy = fecha === hoyAR();
  const horaActual = Number(fmtHora(new Date().toISOString()).slice(0, 2));
  void reloj;

  function cerrarYRecargar() {
    setNuevo(null);
    setDetalle(null);
    cargar();
  }

  return (
    <main className="p-4 sm:p-6 lg:p-8 print:p-0">
      {/* Only visible on paper: the screen controls are hidden when printing. */}
      <div className="mb-3 hidden print:block">
        <h1 className="text-xl font-bold">{me.clinica.nombre} · Agenda del día</h1>
        <p className="first-letter:uppercase">
          {fechaLarga(fecha)}
          {doctorId ? ` · ${todosLosDoctores.find((d) => d.id === doctorId)?.nombre ?? ""}` : ""}
        </p>
      </div>

      {/* Header */}
      <div className="print:hidden">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h1 className="text-xl font-semibold first-letter:uppercase">{fechaLarga(fecha)}</h1>

          <div className="flex flex-wrap items-center gap-2">
            <div className="flex items-center rounded-lg border border-line bg-surface">
              <button onClick={() => setFecha(addDias(fecha, -1))} aria-label="Día anterior" className="rounded-l-lg p-2 text-muted hover:bg-surface-2 hover:text-ink">
                <Icon name="chevronLeft" size={18} />
              </button>
              <input type="date" value={fecha} onChange={(e) => e.target.value && setFecha(e.target.value)} aria-label="Fecha"
                className="bg-transparent px-1 text-sm outline-none" />
              <button onClick={() => setFecha(addDias(fecha, 1))} aria-label="Día siguiente" className="rounded-r-lg p-2 text-muted hover:bg-surface-2 hover:text-ink">
                <Icon name="chevronRight" size={18} />
              </button>
            </div>
            <Button variant="secondary" disabled={esHoy} onClick={() => setFecha(hoyAR())}>Hoy</Button>
            {me.rol !== "DOCTOR" && (
              <select value={doctorId} onChange={(e) => setDoctorId(e.target.value)} aria-label="Filtrar por doctor" className={`${inputCls} w-auto`}>
                <option value="">Todos los doctores</option>
                {todosLosDoctores.map((d) => (
                  <option key={d.id} value={d.id}>{d.nombre}</option>
                ))}
              </select>
            )}
            <Button variant="secondary" icon="printer" onClick={() => window.print()}>Imprimir</Button>
            <button onClick={alternarSonido} aria-pressed={silenciado} title={silenciado ? "Sonido apagado" : "Sonido activado"}
              className="rounded-lg border border-line p-2 text-muted hover:bg-surface-2 hover:text-ink">
              <Icon name={silenciado ? "bellOff" : "bell"} size={18} />
            </button>
          </div>
        </div>

        {/* Day summary: one plain line instead of cards */}
        <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted">
          {agenda ? (
            <>
              <span><strong className="font-semibold text-ink">{conTurno.length}</strong> turnos</span>
              <span><strong className="font-semibold text-ink">{libres}</strong> libres</span>
              <span><strong className="font-semibold text-ink">{atendidos}</strong> atendidos</span>
              <span><strong className="font-semibold text-ink">{porWhatsapp}</strong> por WhatsApp</span>
            </>
          ) : (
            <Skeleton className="h-5 w-72" />
          )}
          <span className="flex items-center gap-1.5 text-xs" title="Conexión para ver los cambios al instante">
            <span className={`inline-block h-2 w-2 rounded-full ${conexion === "online" ? "bg-ok" : "bg-warn"}`} />
            {conexion === "online" ? "En vivo" : "Reconectando..."}
          </span>
        </div>
      </div>

      {error && (
        <p role="alert" className="mt-4 flex items-center gap-2 rounded-lg bg-danger-soft p-3 text-sm text-danger print:hidden">
          <Icon name="alert" size={18} /> {error}
        </p>
      )}

      {/* Grid */}
      <div className="mt-4">
        {!agenda && !error && (
          <Card className="overflow-hidden p-4">
            <Skeleton className="mb-4 h-10 w-full" />
            {Array.from({ length: 5 }, (_, i) => <Skeleton key={i} className="mb-3 h-12 w-full" />)}
          </Card>
        )}

        {agenda && doctores.length === 0 && (
          <EmptyState icon="calendar" title="Nadie atiende este día"
            action={!esHoy ? <Button variant="soft" onClick={() => setFecha(hoyAR())}>Volver a hoy</Button> : undefined}>
            Probá con otro día o revisá los horarios de los doctores en Gestión.
          </EmptyState>
        )}

        {doctores.length > 0 && (
          <div className="overflow-x-auto rounded-lg border border-line bg-surface print:overflow-visible print:border-0">
            <table className="w-full min-w-max border-collapse text-sm">
              <thead>
                <tr className="bg-surface-2">
                  <th className="sticky left-0 z-10 w-16 border-b border-r border-line bg-surface-2 px-3 py-2 text-left text-xs font-semibold text-muted">Hora</th>
                  {doctores.map((d) => {
                    const ocupados = d.slots.filter((s) => s.turno).length;
                    return (
                      <th key={d.id} className="min-w-52 border-b border-r border-line px-3 py-2 text-left font-normal last:border-r-0">
                        <p className="truncate font-semibold">{d.nombre}</p>
                        <p className="truncate text-xs text-muted">{d.especialidad} · {ocupados}/{d.slots.length}</p>
                      </th>
                    );
                  })}
                </tr>
              </thead>
              <tbody>
                {horas.map((hora) => {
                  const ahora = esHoy && Number(hora.slice(0, 2)) === horaActual;
                  return (
                    <tr key={hora} className="align-top">
                      <td className={`sticky left-0 z-10 border-b border-r border-line px-3 py-2 text-sm tabular-nums ${ahora ? "bg-brand-soft font-semibold text-brand-strong" : "bg-surface text-muted"}`}>
                        {hora}
                        {ahora && <span className="block text-[10px] font-medium uppercase">Ahora</span>}
                      </td>
                      {doctores.map((d) => {
                        const slot = celda(d, hora);
                        const base = "border-b border-r border-line last:border-r-0";
                        if (!slot) return <td key={d.id} className={`${base} bg-surface-2`} />;
                        if (slot.turno) {
                          const t = slot.turno;
                          const nuevoTurno = destacados.includes(t.id);
                          return (
                            <td key={d.id} className={`${base} p-1`}>
                              <button onClick={() => setDetalle({ doctor: d, slot })}
                                className={`block w-full rounded-sm border-l-4 px-2.5 py-1.5 text-left hover:brightness-95 ${ESTILO[t.estado]} ${nuevoTurno ? "outline outline-2 outline-warn" : ""}`}>
                                <span className="flex items-center gap-2">
                                  <span className="min-w-0 flex-1">
                                    <span className="block truncate font-medium leading-tight">{t.paciente.nombre}</span>
                                    <span className="block truncate text-xs text-muted">{t.paciente.telefono}</span>
                                  </span>
                                  {t.origen === "BOT" && <span title="Sacado por WhatsApp"><Icon name="whatsapp" size={14} className="text-muted" /></span>}
                                </span>
                                {t.estado !== "CONFIRMADO" && <span className="block text-xs font-medium">{ETIQUETA[t.estado]}</span>}
                              </button>
                            </td>
                          );
                        }
                        if (slot.pasado || !puedeAgendar) {
                          return <td key={d.id} className={`${base} px-3 py-2 text-xs text-muted/60`}>{slot.pasado ? "—" : "Libre"}</td>;
                        }
                        return (
                          <td key={d.id} className={`${base} p-1`}>
                            <button onClick={() => setNuevo({ doctor: d, slot })}
                              className="block w-full rounded-sm px-2.5 py-2 text-left text-xs text-muted/70 hover:bg-brand-soft hover:text-brand-strong">
                              Libre
                            </button>
                          </td>
                        );
                      })}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {nuevo && (
        <NuevoTurnoModal doctor={nuevo.doctor} slot={nuevo.slot} onClose={() => setNuevo(null)} onDone={cerrarYRecargar} onRefresh={cargar} />
      )}
      {detalle && (
        <TurnoModal doctor={detalle.doctor} slot={detalle.slot} onClose={() => setDetalle(null)} onDone={cerrarYRecargar} onRefresh={cargar} />
      )}

      <div className="fixed bottom-4 right-4 z-50 w-80 max-w-[calc(100vw-2rem)] space-y-2 print:hidden" aria-live="polite">
        {toasts.map((t) => (
          <ToastCard key={t.id} t={t} />
        ))}
      </div>
    </main>
  );
}
