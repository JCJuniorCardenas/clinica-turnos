"use client";

import { FormEvent, useEffect, useState } from "react";
import { AgendaDoctor, ApiError, Paciente, Slot, apiJson } from "../lib-api";
import { fechaLarga, fechaDe, fmtHora } from "../lib/format";
import { Modal } from "./Modal";

type Props = {
  doctor: AgendaDoctor;
  slot: Slot;
  onClose: () => void;
  /** Called after a successful booking, or after a conflict so the grid can be refreshed. */
  onDone: () => void;
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

export function NuevoTurnoModal({ doctor, slot, onClose, onDone }: Props) {
  const [texto, setTexto] = useState("");
  const [resultados, setResultados] = useState<Paciente[]>([]);
  const [elegido, setElegido] = useState<Paciente | null>(null);
  const [nuevo, setNuevo] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);
  const [guardando, setGuardando] = useState(false);
  const [buscando, setBuscando] = useState(false);

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

  async function reservar(pacienteId: string) {
    await apiJson("/turnos", { method: "POST", body: JSON.stringify({ doctorId: doctor.id, pacienteId, inicio: slot.inicio }) });
    onDone();
  }

  async function confirmar() {
    if (!elegido) return;
    setGuardando(true);
    setError(null);
    try {
      await reservar(elegido.id);
    } catch (e) {
      setError(e as ApiError);
      if ((e as ApiError).status === 409) onDone();
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
      await reservar(p.id);
    } catch (err) {
      setError(err as ApiError);
      if ((err as ApiError).status === 409) onDone();
    } finally {
      setGuardando(false);
    }
  }

  const input = "mt-1 w-full rounded border border-slate-300 px-3 py-2";

  return (
    <Modal title="Nuevo turno" onClose={onClose}>
      <div className="mb-4 rounded bg-teal-50 p-3 text-sm">
        <p className="font-medium">{doctor.nombre}</p>
        <p className="block text-slate-600 first-letter:uppercase">
          {fechaLarga(fechaDe(slot.inicio))} · {fmtHora(slot.inicio)} a {fmtHora(slot.fin)}
        </p>
      </div>

      {elegido ? (
        <div className="space-y-3">
          <div className="rounded border border-slate-200 p-3 text-sm">
            <p className="font-medium">{elegido.nombre}</p>
            <p className="text-slate-600">Tel. {elegido.telefono}{elegido.dni ? ` · DNI ${elegido.dni}` : ""}</p>
          </div>
          <div className="flex gap-2">
            <button onClick={confirmar} disabled={guardando}
              className="flex-1 rounded bg-teal-700 px-3 py-2 font-medium text-white hover:bg-teal-800 disabled:opacity-60">
              {guardando ? "Guardando..." : "Confirmar turno"}
            </button>
            <button onClick={() => setElegido(null)} className="rounded border border-slate-300 px-3 py-2">Cambiar</button>
          </div>
        </div>
      ) : nuevo ? (
        <form onSubmit={crearYReservar} className="space-y-3">
          <label className="block text-sm">Nombre y apellido
            <input name="nombre" required minLength={2} className={input} />
          </label>
          <label className="block text-sm">Teléfono (solo números)
            <input name="telefono" required pattern="\+?\d{6,20}" inputMode="tel" className={input} />
          </label>
          <label className="block text-sm">DNI (opcional)
            <input name="dni" pattern="\d{6,9}" inputMode="numeric" className={input} />
          </label>
          <div className="flex gap-2">
            <button disabled={guardando}
              className="flex-1 rounded bg-teal-700 px-3 py-2 font-medium text-white hover:bg-teal-800 disabled:opacity-60">
              {guardando ? "Guardando..." : "Crear paciente y confirmar turno"}
            </button>
            <button type="button" onClick={() => setNuevo(false)} className="rounded border border-slate-300 px-3 py-2">Volver</button>
          </div>
        </form>
      ) : (
        <div className="space-y-3">
          <label className="block text-sm">Buscar paciente por nombre, teléfono o DNI
            <input autoFocus value={texto} onChange={(e) => setTexto(e.target.value)} className={input} />
          </label>
          <ul className="max-h-48 divide-y divide-slate-100 overflow-y-auto rounded border border-slate-200">
            {resultados.map((p) => (
              <li key={p.id}>
                <button onClick={() => setElegido(p)} className="w-full px-3 py-2 text-left text-sm hover:bg-slate-50">
                  <span className="font-medium">{p.nombre}</span>
                  <span className="block text-slate-500">Tel. {p.telefono}{p.dni ? ` · DNI ${p.dni}` : ""}</span>
                </button>
              </li>
            ))}
            {texto.trim().length >= 2 && !buscando && resultados.length === 0 && (
              <li className="px-3 py-2 text-sm text-slate-500">Sin resultados.</li>
            )}
          </ul>
          <button onClick={() => setNuevo(true)} className="w-full rounded border border-teal-700 px-3 py-2 text-teal-800 hover:bg-teal-50">
            + Paciente nuevo
          </button>
        </div>
      )}

      {error && (
        <div role="alert" className="mt-3 rounded bg-red-50 p-3 text-sm text-red-700">
          <p>{error.message}</p>
          {error.alternativas && error.alternativas.length > 0 && (
            <p className="mt-1">
              Horarios libres cercanos:{" "}
              {error.alternativas.map((a) => `${fechaLarga(fechaDe(a.inicio))} ${fmtHora(a.inicio)}`).join(" · ")}
            </p>
          )}
        </div>
      )}
    </Modal>
  );
}
