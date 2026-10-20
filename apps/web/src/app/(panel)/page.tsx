"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { NuevoTurnoModal } from "../../components/NuevoTurnoModal";
import { TurnoModal } from "../../components/TurnoModal";
import { Avatar, Button, Card, Chip, EmptyState, Icon, IconName, Skeleton, inputCls, useCountUp } from "../../components/ui";
import { Agenda, AgendaDoctor, ApiError, EstadoTurno, Slot, apiJson } from "../../lib-api";
import { addDias, fechaLarga, fmtHora, hoyAR } from "../../lib/format";
import { LiveEvent, beep, isMuted, setMuted, useTurnoStream } from "../../lib/live";
import { useSession } from "../../lib/session";

type Toast = { id: number; titulo: string; texto: string; tipo: "nuevo" | "aviso" | "alerta" };
type Seleccion = { doctor: AgendaDoctor; slot: Slot };

/** Left bar + tinted background per appointment state. */
const ESTILO: Record<EstadoTurno, string> = {
  PENDIENTE: "border-warn bg-warn-soft/70",
  CONFIRMADO: "border-accent bg-accent-soft/70",
  CANCELADO: "border-line bg-surface-2",
  ATENDIDO: "border-ok bg-ok-soft/60",
  AUSENTE: "border-danger bg-danger-soft/60",
};
const ETIQUETA: Record<EstadoTurno, string> = {
  PENDIENTE: "Pendiente",
  CONFIRMADO: "Confirmado",
  CANCELADO: "Cancelado",
  ATENDIDO: "Atendido",
  AUSENTE: "Ausente",
};

const sinTitulo = (nombre: string) => nombre.replace(/^(Dr\.|Dra\.)\s*/, "");

function Kpi({ icon, label, value, tone, delay }: { icon: IconName; label: string; value: number; tone: string; delay: number }) {
  const n = useCountUp(value);
  return (
    <Card className="animate-fade-up flex items-center gap-4 p-4 transition-shadow hover:shadow-pop" style={{ animationDelay: `${delay}ms` }}>
      <span className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl ${tone}`}>
        <Icon name={icon} size={24} />
      </span>
      <div>
        <p className="text-3xl font-semibold leading-none tracking-tight tabular-nums">{n}</p>
        <p className="mt-1 text-sm text-muted">{label}</p>
      </div>
    </Card>
  );
}

function ToastCard({ t }: { t: Toast }) {
  const estilo = {
    nuevo: { icon: "sparkle" as const, bar: "bg-accent", chip: "bg-accent-soft text-accent" },
    aviso: { icon: "refresh" as const, bar: "bg-warn", chip: "bg-warn-soft text-warn" },
    alerta: { icon: "alert" as const, bar: "bg-danger", chip: "bg-danger-soft text-danger" },
  }[t.tipo];
  return (
    <div className="animate-slide-in relative overflow-hidden rounded-2xl border border-line bg-surface p-3.5 shadow-modal">
      <div className="flex items-start gap-3">
        <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl ${estilo.chip}`}>
          <Icon name={estilo.icon} size={18} />
        </span>
        <div className="min-w-0">
          <p className="text-sm font-semibold">{t.titulo}</p>
          <p className="text-sm text-muted">{t.texto}</p>
        </div>
      </div>
      <span className={`absolute bottom-0 left-0 h-1 w-full origin-left ${estilo.bar}`} style={{ animation: `progress ${t.tipo === "alerta" ? 12 : 8}s linear forwards` }} />
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
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="text-sm font-medium text-muted">Agenda</p>
            <h1 className="text-2xl font-semibold tracking-tight first-letter:uppercase sm:text-3xl">{fechaLarga(fecha)}</h1>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              {esHoy && <Chip tone="accent" icon="sparkle">Hoy</Chip>}
              <span className="flex items-center gap-1.5 text-xs text-muted" title="Conexión para ver los cambios al instante">
                <span className="relative flex h-2.5 w-2.5">
                  {conexion === "online" && <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-ok opacity-60" />}
                  <span className={`relative inline-flex h-2.5 w-2.5 rounded-full ${conexion === "online" ? "bg-ok" : "bg-warn"}`} />
                </span>
                {conexion === "online" ? "En vivo" : "Reconectando..."}
              </span>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <div className="flex items-center rounded-xl border border-line bg-surface p-0.5 shadow-card">
              <button onClick={() => setFecha(addDias(fecha, -1))} aria-label="Día anterior" className="rounded-lg p-2 text-muted transition hover:bg-surface-2 hover:text-ink">
                <Icon name="chevronLeft" size={18} />
              </button>
              <input type="date" value={fecha} onChange={(e) => e.target.value && setFecha(e.target.value)} aria-label="Fecha"
                className="bg-transparent px-1 text-sm font-medium outline-none" />
              <button onClick={() => setFecha(addDias(fecha, 1))} aria-label="Día siguiente" className="rounded-lg p-2 text-muted transition hover:bg-surface-2 hover:text-ink">
                <Icon name="chevronRight" size={18} />
              </button>
            </div>
            <Button variant={esHoy ? "soft" : "secondary"} onClick={() => setFecha(hoyAR())}>Hoy</Button>
            {me.rol !== "DOCTOR" && (
              <select value={doctorId} onChange={(e) => setDoctorId(e.target.value)} aria-label="Filtrar por doctor" className={`${inputCls} w-auto py-2`}>
                <option value="">Todos los doctores</option>
                {todosLosDoctores.map((d) => (
                  <option key={d.id} value={d.id}>{d.nombre}</option>
                ))}
              </select>
            )}
            <Button variant="secondary" icon="printer" onClick={() => window.print()}>Imprimir</Button>
            <button onClick={alternarSonido} aria-pressed={silenciado} title={silenciado ? "Sonido apagado" : "Sonido activado"}
              className={`rounded-xl border border-line p-2.5 transition hover:bg-surface-2 ${silenciado ? "text-muted" : "text-accent"}`}>
              <Icon name={silenciado ? "bellOff" : "bell"} size={18} />
            </button>
          </div>
        </div>

        {/* Day summary */}
        <div className="mt-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
          {agenda ? (
            <>
              <Kpi icon="calendar" label="Turnos del día" value={conTurno.length} tone="bg-brand-soft text-brand" delay={0} />
              <Kpi icon="clock" label="Horarios libres" value={libres} tone="bg-accent-soft text-accent" delay={70} />
              <Kpi icon="check" label="Atendidos" value={atendidos} tone="bg-ok-soft text-ok" delay={140} />
              <Kpi icon="whatsapp" label="Por WhatsApp" value={porWhatsapp} tone="bg-warn-soft text-warn" delay={210} />
            </>
          ) : (
            Array.from({ length: 4 }, (_, i) => <Skeleton key={i} className="h-[84px] rounded-2xl" />)
          )}
        </div>
      </div>

      {error && (
        <p role="alert" className="animate-pop-in mt-5 flex items-center gap-2 rounded-2xl bg-danger-soft p-3.5 text-sm text-danger print:hidden">
          <Icon name="alert" size={18} /> {error}
        </p>
      )}

      {/* Grid */}
      <div className="mt-6">
        {!agenda && !error && (
          <Card className="overflow-hidden p-4">
            <Skeleton className="mb-4 h-10 w-full" />
            {Array.from({ length: 5 }, (_, i) => <Skeleton key={i} className="mb-3 h-14 w-full" />)}
          </Card>
        )}

        {agenda && doctores.length === 0 && (
          <EmptyState icon="calendar" title="Nadie atiende este día"
            action={!esHoy ? <Button variant="soft" onClick={() => setFecha(hoyAR())}>Volver a hoy</Button> : undefined}>
            Probá con otro día o revisá los horarios de los doctores en Gestión.
          </EmptyState>
        )}

        {doctores.length > 0 && (
          <Card className="animate-fade-up overflow-x-auto print:overflow-visible print:border-0 print:shadow-none">
            <table className="w-full min-w-max border-collapse text-sm">
              <thead>
                <tr className="border-b border-line bg-surface-2/60">
                  <th className="sticky left-0 z-10 w-20 bg-surface-2 px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-muted">Hora</th>
                  {doctores.map((d) => {
                    const ocupados = d.slots.filter((s) => s.turno).length;
                    const pct = Math.round((ocupados / d.slots.length) * 100);
                    return (
                      <th key={d.id} className="min-w-56 px-3 py-3 text-left font-normal">
                        <div className="flex items-center gap-3">
                          <Avatar name={sinTitulo(d.nombre)} size={36} />
                          <div className="min-w-0 flex-1">
                            <p className="truncate font-semibold">{d.nombre}</p>
                            <p className="truncate text-xs text-muted">{d.especialidad} · {ocupados}/{d.slots.length} turnos</p>
                          </div>
                        </div>
                        <div className="mt-2 h-1 overflow-hidden rounded-full bg-line print:hidden" aria-hidden="true">
                          <div className="brand-gradient h-full rounded-full transition-all duration-700" style={{ width: `${pct}%` }} />
                        </div>
                      </th>
                    );
                  })}
                </tr>
              </thead>
              <tbody>
                {horas.map((hora) => {
                  const ahora = esHoy && Number(hora.slice(0, 2)) === horaActual;
                  return (
                    <tr key={hora} className={`border-b border-line/70 align-top last:border-0 ${ahora ? "bg-brand-soft/50" : ""}`}>
                      <td className={`sticky left-0 z-10 px-4 py-3 text-sm font-semibold tabular-nums ${ahora ? "bg-brand-soft text-brand-strong" : "bg-surface text-muted"}`}>
                        {hora}
                        {ahora && <span className="mt-1 block text-[10px] font-semibold uppercase tracking-wide">Ahora</span>}
                      </td>
                      {doctores.map((d) => {
                        const slot = celda(d, hora);
                        if (!slot) return <td key={d.id} className="bg-surface-2/40 px-2 py-2" />;
                        if (slot.turno) {
                          const t = slot.turno;
                          const nuevoTurno = destacados.includes(t.id);
                          return (
                            <td key={d.id} className="px-2 py-2">
                              <button onClick={() => setDetalle({ doctor: d, slot })}
                                className={`w-full rounded-xl border-l-4 px-3 py-2 text-left transition hover:-translate-y-0.5 hover:shadow-pop ${ESTILO[t.estado]} ${nuevoTurno ? "animate-glow" : ""}`}>
                                <span className="flex items-center gap-2">
                                  <Avatar name={t.paciente.nombre} size={26} />
                                  <span className="min-w-0 flex-1">
                                    <span className="block truncate font-medium leading-tight">{t.paciente.nombre}</span>
                                    <span className="block truncate text-xs text-muted">{t.paciente.telefono}</span>
                                  </span>
                                  {t.origen === "BOT" && <Icon name="whatsapp" size={15} className="text-brand" />}
                                </span>
                                {t.estado !== "CONFIRMADO" && <span className="mt-1.5 block text-xs font-medium">{ETIQUETA[t.estado]}</span>}
                              </button>
                            </td>
                          );
                        }
                        if (slot.pasado || !puedeAgendar) {
                          return <td key={d.id} className="px-4 py-3 text-xs text-muted/60">{slot.pasado ? "—" : "Libre"}</td>;
                        }
                        return (
                          <td key={d.id} className="px-2 py-2">
                            <button onClick={() => setNuevo({ doctor: d, slot })}
                              className="group flex w-full items-center gap-2 rounded-xl border border-dashed border-line px-3 py-2.5 text-left text-muted/70 transition hover:border-accent hover:bg-accent-soft/50 hover:text-accent">
                              <Icon name="plus" size={16} className="transition-transform group-hover:rotate-90" />
                              <span className="text-xs font-medium">Libre</span>
                            </button>
                          </td>
                        );
                      })}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </Card>
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
