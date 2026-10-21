"use client";

import { FormEvent, useEffect, useState } from "react";
import { AgendaDoctor, ApiError, Paciente, Slot, apiJson } from "../lib-api";
import { fechaCorta, fechaDe, fmtHora } from "../lib/format";
import { Modal } from "./Modal";
import { Avatar, Button, Chip, Icon, Spinner, SuccessCheck, inputCls } from "./ui";

type Props = {
  doctor: AgendaDoctor;
  slot: Slot;
  onClose: () => void;
  /** Called after a successful booking (the dialog shows a "done" moment first). */
  onDone: () => void;
  /** Reload the grid without closing the dialog (used after a conflict). */
  onRefresh: () => void;
};

async function buscarPacientes(texto: string): Promise<Paciente[]> {
  const t = texto.trim();
  if (t.length < 2) return [];
  if (/^\+?\d+$/.test(t)) {
    // Digits could be a phone or a DNI: look up both and merge.
    const [porTel, porDni] = await Promise.all([
      apiJson<Paciente[]>(`/pacientes?telefono=${encodeURIComponent(t)}`),
      apiJson<Paciente[]>(`/pacientes?dni=${encodeURIComponent(t)}`),
    ]);
    return [...porTel, ...porDni.filter((p) => !porTel.some((x) => x.id === p.id))];
  }
  return apiJson<Paciente[]>(`/pacientes?q=${encodeURIComponent(t)}`);
}

export function NuevoTurnoModal({ doctor, slot, onClose, onDone, onRefresh }: Props) {
  const [texto, setTexto] = useState("");
  const [resultados, setResultados] = useState<Paciente[]>([]);
  const [elegido, setElegido] = useState<Paciente | null>(null);
  const [nuevo, setNuevo] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);
  const [guardando, setGuardando] = useState(false);
  const [buscando, setBuscando] = useState(false);
  const [hecho, setHecho] = useState<Paciente | null>(null);

  useEffect(() => {
    if (nuevo || elegido) return;
    if (texto.trim().length >= 2) setBuscando(true);
    const id = setTimeout(() => {
      buscarPacientes(texto)
        .then(setResultados)
        .catch(() => setResultados([]))
        .finally(() => setBuscando(false));
    }, 300);
    return () => clearTimeout(id);
  }, [texto, nuevo, elegido]);

  // After booking: show the "done" moment for a beat, then close and refresh.
  useEffect(() => {
    if (!hecho) return;
    const id = setTimeout(onDone, 1400);
    return () => clearTimeout(id);
  }, [hecho, onDone]);

  async function reservar(paciente: Paciente) {
    await apiJson("/turnos", { method: "POST", body: JSON.stringify({ doctorId: doctor.id, pacienteId: paciente.id, inicio: slot.inicio }) });
    setHecho(paciente);
  }

  function manejarError(e: unknown) {
    const err = e as ApiError;
    setError(err);
    if (err.status === 409) onRefresh(); // someone took the slot: the grid updates, the dialog stays with the explanation
  }

  async function confirmar() {
    if (!elegido) return;
    setGuardando(true);
    setError(null);
    try {
      await reservar(elegido);
    } catch (e) {
      manejarError(e);
    } finally {
      setGuardando(false);
    }
  }

  async function crearYReservar(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const dni = String(f.get("dni") ?? "").trim();
    setGuardando(true);
    setError(null);
    try {
      const p = await apiJson<Paciente>("/pacientes", {
        method: "POST",
        body: JSON.stringify({
          nombre: String(f.get("nombre")).trim(),
          telefono: String(f.get("telefono")).trim(),
          ...(dni ? { dni } : {}),
        }),
      });
      await reservar(p);
    } catch (err) {
      manejarError(err);
    } finally {
      setGuardando(false);
    }
  }

  if (hecho) {
    return (
      <Modal title="" onClose={onDone}>
        <div className="flex flex-col items-center py-4 text-center">
          <SuccessCheck />
          <h3 className="mt-5 text-xl font-semibold" style={{ animationDelay: "250ms" }}>¡Turno confirmado!</h3>
          <p className="mt-1 text-sm text-muted" style={{ animationDelay: "350ms" }}>
            {hecho.nombre} · {doctor.nombre}
            <br />
            <span className="first-letter:uppercase">{fechaCorta(fechaDe(slot.inicio))}</span> a las {fmtHora(slot.inicio)}
          </p>
        </div>
      </Modal>
    );
  }

  return (
    <Modal title="Nuevo turno" subtitle="Elegí el paciente para reservar este horario." onClose={onClose}>
      <div className="mb-5 flex items-center gap-3 rounded-lg bg-brand-soft p-3">
        <Avatar name={doctor.nombre.replace(/^(Dr\.|Dra\.)\s*/, "")} size={44} />
        <div className="min-w-0">
          <p className="truncate font-semibold">{doctor.nombre}</p>
          <div className="mt-1 flex flex-wrap gap-1.5">
            <Chip tone="brand" icon="calendar">{fechaCorta(fechaDe(slot.inicio))}</Chip>
            <Chip tone="accent" icon="clock">{fmtHora(slot.inicio)} a {fmtHora(slot.fin)}</Chip>
          </div>
        </div>
      </div>

      {elegido ? (
        <div className="animate-pop-in space-y-4">
          <div className="flex items-center gap-3 rounded-lg border border-line p-3">
            <Avatar name={elegido.nombre} size={42} />
            <div className="min-w-0">
              <p className="truncate font-medium">{elegido.nombre}</p>
              <p className="text-sm text-muted">Tel. {elegido.telefono}{elegido.dni ? ` · DNI ${elegido.dni}` : ""}</p>
            </div>
          </div>
          <div className="flex gap-2">
            <Button variant="primary" loading={guardando} onClick={confirmar} className="flex-1" icon="check">
              {guardando ? "Guardando..." : "Confirmar turno"}
            </Button>
            <Button variant="secondary" onClick={() => setElegido(null)}>Cambiar</Button>
          </div>
        </div>
      ) : nuevo ? (
        <form onSubmit={crearYReservar} className="animate-pop-in space-y-3">
          <label className="block text-sm font-medium">Nombre y apellido
            <input name="nombre" required minLength={2} autoFocus className={`${inputCls} mt-1.5`} />
          </label>
          <label className="block text-sm font-medium">Teléfono (solo números)
            <input name="telefono" required pattern="\+?\d{6,20}" inputMode="tel" className={`${inputCls} mt-1.5`} />
          </label>
          <label className="block text-sm font-medium">DNI <span className="font-normal text-muted">(opcional)</span>
            <input name="dni" pattern="\d{6,9}" inputMode="numeric" className={`${inputCls} mt-1.5`} />
          </label>
          <div className="flex gap-2 pt-1">
            <Button variant="primary" loading={guardando} className="flex-1" icon="check">
              {guardando ? "Guardando..." : "Crear y confirmar"}
            </Button>
            <Button type="button" variant="secondary" onClick={() => setNuevo(false)}>Volver</Button>
          </div>
        </form>
      ) : (
        <div className="space-y-3">
          <label className="block text-sm font-medium">Buscar paciente
            <span className="relative mt-1.5 block">
              <Icon name="search" size={18} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-muted" />
              <input autoFocus value={texto} onChange={(e) => setTexto(e.target.value)} placeholder="Nombre, teléfono o DNI"
                className={`${inputCls} pl-10`} />
              {buscando && <span className="absolute right-3.5 top-1/2 -translate-y-1/2 text-muted"><Spinner size={16} /></span>}
            </span>
          </label>

          {(resultados.length > 0 || (texto.trim().length >= 2 && !buscando)) && (
            <ul className="max-h-56 divide-y divide-line overflow-y-auto rounded-lg border border-line">
              {resultados.map((p) => (
                <li key={p.id}>
                  <button onClick={() => setElegido(p)} className="flex w-full items-center gap-3 px-3 py-2.5 text-left transition hover:bg-surface-2">
                    <Avatar name={p.nombre} size={34} />
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-medium">{p.nombre}</span>
                      <span className="block truncate text-xs text-muted">Tel. {p.telefono}{p.dni ? ` · DNI ${p.dni}` : ""}</span>
                    </span>
                  </button>
                </li>
              ))}
              {resultados.length === 0 && <li className="px-3 py-3 text-sm text-muted">Sin resultados.</li>}
            </ul>
          )}

          <Button variant="soft" onClick={() => setNuevo(true)} className="w-full" icon="plus">Paciente nuevo</Button>
        </div>
      )}

      {error && (
        <div role="alert" className="animate-pop-in mt-4 rounded-lg bg-danger-soft p-3.5 text-sm text-danger">
          <p className="flex items-center gap-2 font-medium"><Icon name="alert" size={18} />{error.message}</p>
          {error.alternativas && error.alternativas.length > 0 && (
            <div className="mt-2">
              <p className="mb-1.5 text-xs opacity-80">Horarios libres cercanos:</p>
              <div className="flex flex-wrap gap-1.5">
                {error.alternativas.map((a) => (
                  <Chip key={a.inicio} tone="muted">{fechaCorta(fechaDe(a.inicio))} · {fmtHora(a.inicio)}</Chip>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </Modal>
  );
}
