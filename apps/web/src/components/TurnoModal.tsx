"use client";

import { useState } from "react";
import { AgendaDoctor, ApiError, Slot, apiJson } from "../lib-api";
import { addDias, fechaCorta, fechaDe, fechaLarga, fmtHora, hoyAR } from "../lib/format";
import { useSession } from "../lib/session";
import { Modal } from "./Modal";

type Props = { doctor: AgendaDoctor; slot: Slot; onClose: () => void; onDone: () => void };
type Libre = { inicio: string; fin: string };

export function TurnoModal({ doctor, slot, onClose, onDone }: Props) {
  const me = useSession();
  const turno = slot.turno!;
  const activo = turno.estado === "CONFIRMADO" || turno.estado === "PENDIENTE";
  const puedeGestionar = me.rol === "ADMIN" || me.rol === "RECEPCION";

  const [paso, setPaso] = useState<"detalle" | "cancelar" | "reprogramar">("detalle");
  const [libres, setLibres] = useState<Libre[] | null>(null);
  const [nuevo, setNuevo] = useState("");
  const [error, setError] = useState<ApiError | null>(null);
  const [trabajando, setTrabajando] = useState(false);

  async function ejecutar(fn: () => Promise<unknown>) {
    setTrabajando(true);
    setError(null);
    try {
      await fn();
      onDone();
    } catch (e) {
      setError(e as ApiError);
      if ((e as ApiError).status === 409) onDone();
    } finally {
      setTrabajando(false);
    }
  }

  async function abrirReprogramar() {
    setPaso("reprogramar");
    setError(null);
    try {
      const hoy = hoyAR();
      const r = await apiJson<{ slots: Libre[] }>(
        `/disponibilidad?doctorId=${doctor.id}&desde=${hoy}&hasta=${addDias(hoy, 14)}`,
      );
      setLibres(r.slots);
    } catch (e) {
      setError(e as ApiError);
    }
  }

  const porDia = (libres ?? []).reduce<Record<string, Libre[]>>((acc, s) => {
    (acc[fechaDe(s.inicio)] ??= []).push(s);
    return acc;
  }, {});

  const btn = "rounded px-3 py-2 font-medium disabled:opacity-60";

  return (
    <Modal title="Turno" onClose={onClose}>
      <div className="mb-4 space-y-1 text-sm">
        <p className="text-base font-medium">{turno.paciente.nombre}</p>
        <p className="text-slate-600">
          Tel. {turno.paciente.telefono}{turno.paciente.dni ? ` · DNI ${turno.paciente.dni}` : ""}
        </p>
        <p>{doctor.nombre} · {doctor.especialidad}</p>
        <p className="first-letter:uppercase">{fechaLarga(fechaDe(slot.inicio))} · {fmtHora(slot.inicio)} a {fmtHora(slot.fin)}</p>
        <p className="text-slate-500">
          {turno.estado.charAt(0) + turno.estado.slice(1).toLowerCase()} · cargado por {turno.origen === "BOT" ? "WhatsApp" : "el panel"}
        </p>
      </div>

      {paso === "detalle" && activo && (
        <div className="flex flex-wrap gap-2">
          <button disabled={trabajando} className={`${btn} bg-teal-700 text-white hover:bg-teal-800`}
            onClick={() => ejecutar(() => apiJson(`/turnos/${turno.id}/estado`, { method: "PATCH", body: JSON.stringify({ estado: "ATENDIDO" }) }))}>
            Marcar atendido
          </button>
          <button disabled={trabajando} className={`${btn} border border-slate-300 hover:bg-slate-50`}
            onClick={() => ejecutar(() => apiJson(`/turnos/${turno.id}/estado`, { method: "PATCH", body: JSON.stringify({ estado: "AUSENTE" }) }))}>
            Marcar ausente
          </button>
          {puedeGestionar && (
            <>
              <button className={`${btn} border border-slate-300 hover:bg-slate-50`} onClick={abrirReprogramar}>Reprogramar</button>
              <button className={`${btn} border border-red-300 text-red-700 hover:bg-red-50`} onClick={() => setPaso("cancelar")}>Cancelar turno</button>
            </>
          )}
        </div>
      )}

      {paso === "cancelar" && (
        <div className="space-y-3">
          <p className="text-sm">¿Cancelar el turno de <strong>{turno.paciente.nombre}</strong>? El horario quedará libre.</p>
          <div className="flex gap-2">
            <button disabled={trabajando} className={`${btn} bg-red-600 text-white hover:bg-red-700`}
              onClick={() => ejecutar(() => apiJson(`/turnos/${turno.id}/cancelar`, { method: "PATCH" }))}>
              Sí, cancelar
            </button>
            <button className={`${btn} border border-slate-300`} onClick={() => setPaso("detalle")}>No</button>
          </div>
        </div>
      )}

      {paso === "reprogramar" && (
        <div className="space-y-3">
          {libres === null && !error && <p className="text-sm text-slate-500">Buscando horarios libres...</p>}
          {libres !== null && libres.length === 0 && <p className="text-sm text-slate-500">No hay horarios libres en los próximos 14 días.</p>}
          <div className="max-h-56 space-y-2 overflow-y-auto">
            {Object.entries(porDia).map(([dia, slots]) => (
              <div key={dia}>
                <p className="text-xs font-medium uppercase text-slate-500">{fechaCorta(dia)}</p>
                <div className="mt-1 flex flex-wrap gap-1">
                  {slots.map((s) => (
                    <button key={s.inicio} onClick={() => setNuevo(s.inicio)}
                      className={`rounded border px-2 py-1 text-sm ${nuevo === s.inicio ? "border-teal-700 bg-teal-700 text-white" : "border-slate-300 hover:bg-slate-50"}`}>
                      {fmtHora(s.inicio)}
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>
          <div className="flex gap-2">
            <button disabled={!nuevo || trabajando} className={`${btn} bg-teal-700 text-white hover:bg-teal-800`}
              onClick={() => ejecutar(() => apiJson(`/turnos/${turno.id}/reprogramar`, { method: "PATCH", body: JSON.stringify({ nuevaFechaHora: nuevo }) }))}>
              Confirmar cambio
            </button>
            <button className={`${btn} border border-slate-300`} onClick={() => setPaso("detalle")}>Volver</button>
          </div>
        </div>
      )}

      {error && (
        <div role="alert" className="mt-3 rounded bg-red-50 p-3 text-sm text-red-700">
          <p>{error.message}</p>
          {error.alternativas && error.alternativas.length > 0 && (
            <p className="mt-1">
              Horarios libres cercanos:{" "}
              {error.alternativas.map((a) => `${fechaCorta(fechaDe(a.inicio))} ${fmtHora(a.inicio)}`).join(" · ")}
            </p>
          )}
        </div>
      )}
    </Modal>
  );
}
