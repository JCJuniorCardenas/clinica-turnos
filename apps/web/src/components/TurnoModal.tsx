"use client";

import { useEffect, useState } from "react";
import { AgendaDoctor, ApiError, EstadoTurno, Slot, apiJson } from "../lib-api";
import { addDias, fechaCorta, fechaDe, fechaLarga, fmtHora, hoyAR } from "../lib/format";
import { useSession } from "../lib/session";
import { Modal } from "./Modal";
import { Avatar, Button, Chip, Icon, SuccessCheck } from "./ui";

type Props = { doctor: AgendaDoctor; slot: Slot; onClose: () => void; onDone: () => void; onRefresh: () => void };
type Libre = { inicio: string; fin: string };

const ESTADO_CHIP: Record<EstadoTurno, { tone: "accent" | "warn" | "ok" | "danger" | "muted"; label: string }> = {
  PENDIENTE: { tone: "warn", label: "Pendiente" },
  CONFIRMADO: { tone: "accent", label: "Confirmado" },
  CANCELADO: { tone: "muted", label: "Cancelado" },
  ATENDIDO: { tone: "ok", label: "Atendido" },
  AUSENTE: { tone: "danger", label: "Ausente" },
};

export function TurnoModal({ doctor, slot, onClose, onDone, onRefresh }: Props) {
  const me = useSession();
  const turno = slot.turno!;
  const activo = turno.estado === "CONFIRMADO" || turno.estado === "PENDIENTE";
  const puedeGestionar = me.rol === "ADMIN" || me.rol === "RECEPCION";

  const [paso, setPaso] = useState<"detalle" | "cancelar" | "reprogramar">("detalle");
  const [libres, setLibres] = useState<Libre[] | null>(null);
  const [nuevo, setNuevo] = useState("");
  const [error, setError] = useState<ApiError | null>(null);
  const [trabajando, setTrabajando] = useState(false);
  const [hecho, setHecho] = useState<string | null>(null);

  // Show a short "done" moment, then close and refresh.
  useEffect(() => {
    if (!hecho) return;
    const id = setTimeout(onDone, 1200);
    return () => clearTimeout(id);
  }, [hecho, onDone]);

  async function ejecutar(fn: () => Promise<unknown>, mensaje: string) {
    setTrabajando(true);
    setError(null);
    try {
      await fn();
      setHecho(mensaje);
    } catch (e) {
      setError(e as ApiError);
      if ((e as ApiError).status === 409) onRefresh();
    } finally {
      setTrabajando(false);
    }
  }

  async function abrirReprogramar() {
    setPaso("reprogramar");
    setError(null);
    try {
      const hoy = hoyAR();
      const r = await apiJson<{ slots: Libre[] }>(`/disponibilidad?doctorId=${doctor.id}&desde=${hoy}&hasta=${addDias(hoy, 14)}`);
      setLibres(r.slots);
    } catch (e) {
      setError(e as ApiError);
    }
  }

  const porDia = (libres ?? []).reduce<Record<string, Libre[]>>((acc, s) => {
    (acc[fechaDe(s.inicio)] ??= []).push(s);
    return acc;
  }, {});

  if (hecho) {
    return (
      <Modal title="" onClose={onDone}>
        <div className="flex flex-col items-center py-4 text-center">
          <SuccessCheck />
          <h3 className="animate-fade-up mt-5 text-xl font-semibold" style={{ animationDelay: "250ms" }}>{hecho}</h3>
        </div>
      </Modal>
    );
  }

  const estado = ESTADO_CHIP[turno.estado];

  return (
    <Modal title="Turno" onClose={onClose}>
      <div className="mb-5 flex items-center gap-3">
        <Avatar name={turno.paciente.nombre} size={52} />
        <div className="min-w-0">
          <p className="truncate text-lg font-semibold leading-tight">{turno.paciente.nombre}</p>
          <p className="text-sm text-muted">Tel. {turno.paciente.telefono}{turno.paciente.dni ? ` · DNI ${turno.paciente.dni}` : ""}</p>
        </div>
      </div>

      <div className="mb-5 space-y-2 rounded-2xl bg-surface-2 p-3.5 text-sm">
        <p className="flex items-center gap-2"><Icon name="user" size={16} className="text-muted" />{doctor.nombre} <span className="text-muted">· {doctor.especialidad}</span></p>
        <p className="flex items-center gap-2"><Icon name="calendar" size={16} className="text-muted" /><span className="first-letter:uppercase">{fechaLarga(fechaDe(slot.inicio))}</span></p>
        <p className="flex items-center gap-2"><Icon name="clock" size={16} className="text-muted" />{fmtHora(slot.inicio)} a {fmtHora(slot.fin)}</p>
        <div className="flex flex-wrap gap-1.5 pt-1">
          <Chip tone={estado.tone}>{estado.label}</Chip>
          <Chip tone={turno.origen === "BOT" ? "accent" : "muted"} icon={turno.origen === "BOT" ? "whatsapp" : "edit"}>
            {turno.origen === "BOT" ? "Por WhatsApp" : "Cargado en el panel"}
          </Chip>
        </div>
      </div>

      {paso === "detalle" && activo && (
        <div className="grid gap-2 sm:grid-cols-2">
          <Button variant="primary" loading={trabajando} icon="check"
            onClick={() => ejecutar(() => apiJson(`/turnos/${turno.id}/estado`, { method: "PATCH", body: JSON.stringify({ estado: "ATENDIDO" }) }), "Marcado como atendido")}>
            Marcar atendido
          </Button>
          <Button variant="secondary" loading={trabajando}
            onClick={() => ejecutar(() => apiJson(`/turnos/${turno.id}/estado`, { method: "PATCH", body: JSON.stringify({ estado: "AUSENTE" }) }), "Marcado como ausente")}>
            Marcar ausente
          </Button>
          {puedeGestionar && (
            <>
              <Button variant="soft" icon="refresh" onClick={abrirReprogramar}>Reprogramar</Button>
              <Button variant="danger" icon="trash" onClick={() => setPaso("cancelar")}>Cancelar turno</Button>
            </>
          )}
        </div>
      )}

      {paso === "cancelar" && (
        <div className="animate-pop-in space-y-3">
          <p className="rounded-2xl bg-danger-soft p-3.5 text-sm text-danger">
            ¿Cancelar el turno de <strong>{turno.paciente.nombre}</strong>? El horario quedará libre para otro paciente.
          </p>
          <div className="flex gap-2">
            <Button variant="danger" loading={trabajando} className="flex-1" onClick={() => ejecutar(() => apiJson(`/turnos/${turno.id}/cancelar`, { method: "PATCH" }), "Turno cancelado")}>
              Sí, cancelar
            </Button>
            <Button variant="secondary" onClick={() => setPaso("detalle")}>No</Button>
          </div>
        </div>
      )}

      {paso === "reprogramar" && (
        <div className="animate-pop-in space-y-3">
          <p className="text-sm font-medium">Elegí el nuevo horario</p>
          {libres === null && !error && <p className="text-sm text-muted">Buscando horarios libres...</p>}
          {libres !== null && libres.length === 0 && <p className="text-sm text-muted">No hay horarios libres en los próximos 14 días.</p>}
          <div className="max-h-56 space-y-3 overflow-y-auto pr-1">
            {Object.entries(porDia).map(([dia, slots]) => (
              <div key={dia}>
                <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted">{fechaCorta(dia)}</p>
                <div className="flex flex-wrap gap-1.5">
                  {slots.map((s) => (
                    <button key={s.inicio} onClick={() => setNuevo(s.inicio)}
                      className={`rounded-xl border px-3 py-1.5 text-sm font-medium transition ${
                        nuevo === s.inicio ? "brand-gradient border-transparent text-white shadow-card" : "border-line bg-surface hover:border-accent hover:text-accent"
                      }`}>
                      {fmtHora(s.inicio)}
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>
          <div className="flex gap-2">
            <Button variant="primary" disabled={!nuevo} loading={trabajando} className="flex-1" icon="check"
              onClick={() => ejecutar(() => apiJson(`/turnos/${turno.id}/reprogramar`, { method: "PATCH", body: JSON.stringify({ nuevaFechaHora: nuevo }) }), "Turno reprogramado")}>
              Confirmar cambio
            </Button>
            <Button variant="secondary" onClick={() => setPaso("detalle")}>Volver</Button>
          </div>
        </div>
      )}

      {error && (
        <div role="alert" className="animate-pop-in mt-4 rounded-2xl bg-danger-soft p-3.5 text-sm text-danger">
          <p className="flex items-center gap-2 font-medium"><Icon name="alert" size={18} />{error.message}</p>
          {error.alternativas && error.alternativas.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {error.alternativas.map((a) => (
                <Chip key={a.inicio} tone="muted">{fechaCorta(fechaDe(a.inicio))} · {fmtHora(a.inicio)}</Chip>
              ))}
            </div>
          )}
        </div>
      )}
    </Modal>
  );
}
