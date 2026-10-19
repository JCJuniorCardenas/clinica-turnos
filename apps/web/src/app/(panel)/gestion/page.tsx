"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";
import { Modal } from "../../../components/Modal";
import { ApiError, apiJson } from "../../../lib-api";
import { useSession } from "../../../lib/session";

type Especialidad = { id: string; nombre: string };
type Doctor = { id: string; nombre: string; especialidadId: string; duracionTurnoMin: number; activo: boolean; especialidad: Especialidad };
type Horario = { id: string; diaSemana: number; horaInicio: string; horaFin: string };

const DIAS = ["Domingo", "Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado"];
const ORDEN_DIAS = [1, 2, 3, 4, 5, 6, 0];
const input = "mt-1 w-full rounded border border-slate-300 bg-white px-3 py-2";
const btnPrimary = "rounded bg-teal-700 px-3 py-2 font-medium text-white hover:bg-teal-800 disabled:opacity-60";
const btnGhost = "rounded border border-slate-300 bg-white px-3 py-1.5 text-sm hover:bg-slate-50";

function ErrorBox({ error }: { error: string | null }) {
  return error ? <p role="alert" className="mt-3 rounded bg-red-50 p-3 text-sm text-red-700">{error}</p> : null;
}

// ---------- Especialidades ----------

function EspecialidadesSection({ especialidades, onChange }: { especialidades: Especialidad[]; onChange: () => void }) {
  const [error, setError] = useState<string | null>(null);
  const [editando, setEditando] = useState<string | null>(null);

  async function run(fn: () => Promise<unknown>) {
    setError(null);
    try {
      await fn();
      setEditando(null);
      onChange();
    } catch (e) {
      setError((e as ApiError).message);
    }
  }

  function agregar(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const nombre = String(new FormData(form).get("nombre")).trim();
    run(async () => {
      await apiJson("/especialidades", { method: "POST", body: JSON.stringify({ nombre }) });
      form.reset();
    });
  }

  return (
    <section className="rounded-lg bg-white p-4 shadow-sm">
      <h2 className="mb-3 font-semibold">Especialidades</h2>
      <ul className="mb-3 divide-y divide-slate-100">
        {especialidades.map((esp) => (
          <li key={esp.id} className="flex items-center gap-2 py-2">
            {editando === esp.id ? (
              <form className="flex flex-1 gap-2" onSubmit={(e) => {
                e.preventDefault();
                const nombre = String(new FormData(e.currentTarget).get("nombre")).trim();
                run(() => apiJson(`/especialidades/${esp.id}`, { method: "PATCH", body: JSON.stringify({ nombre }) }));
              }}>
                <input name="nombre" defaultValue={esp.nombre} required minLength={2} autoFocus className="flex-1 rounded border border-slate-300 px-2 py-1" />
                <button className={btnGhost}>Guardar</button>
                <button type="button" className={btnGhost} onClick={() => setEditando(null)}>Cancelar</button>
              </form>
            ) : (
              <>
                <span className="flex-1">{esp.nombre}</span>
                <button className={btnGhost} onClick={() => setEditando(esp.id)}>Renombrar</button>
                <button className={`${btnGhost} text-red-700`}
                  onClick={() => confirm(`¿Borrar la especialidad «${esp.nombre}»?`) && run(() => apiJson(`/especialidades/${esp.id}`, { method: "DELETE" }))}>
                  Borrar
                </button>
              </>
            )}
          </li>
        ))}
      </ul>
      <form onSubmit={agregar} className="flex gap-2">
        <input name="nombre" required minLength={2} placeholder="Nueva especialidad" aria-label="Nueva especialidad"
          className="flex-1 rounded border border-slate-300 px-3 py-2" />
        <button className={btnPrimary}>Agregar</button>
      </form>
      <ErrorBox error={error} />
    </section>
  );
}

// ---------- Doctores ----------

function DoctorModal({ doctor, especialidades, onClose, onDone }: {
  doctor: Doctor | null;
  especialidades: Especialidad[];
  onClose: () => void;
  onDone: () => void;
}) {
  const [error, setError] = useState<string | null>(null);
  const [guardando, setGuardando] = useState(false);

  async function guardar(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const body = {
      nombre: String(f.get("nombre")).trim(),
      especialidadId: String(f.get("especialidadId")),
      duracionTurnoMin: Number(f.get("duracionTurnoMin")),
    };
    setGuardando(true);
    setError(null);
    try {
      await apiJson(doctor ? `/doctores/${doctor.id}` : "/doctores", { method: doctor ? "PATCH" : "POST", body: JSON.stringify(body) });
      onDone();
    } catch (err) {
      setError((err as ApiError).message);
    } finally {
      setGuardando(false);
    }
  }

  return (
    <Modal title={doctor ? "Editar doctor" : "Nuevo doctor"} onClose={onClose}>
      <form onSubmit={guardar} className="space-y-3">
        <label className="block text-sm">Nombre
          <input name="nombre" required minLength={2} defaultValue={doctor?.nombre} className={input} />
        </label>
        <label className="block text-sm">Especialidad
          <select name="especialidadId" required defaultValue={doctor?.especialidadId ?? ""} className={input}>
            <option value="" disabled>Elegí una...</option>
            {especialidades.map((e) => <option key={e.id} value={e.id}>{e.nombre}</option>)}
          </select>
        </label>
        <label className="block text-sm">Duración de cada turno (minutos)
          <input name="duracionTurnoMin" type="number" required min={5} max={480} step={5} defaultValue={doctor?.duracionTurnoMin ?? 60} className={input} />
        </label>
        <button disabled={guardando} className={`${btnPrimary} w-full`}>{guardando ? "Guardando..." : "Guardar"}</button>
        <ErrorBox error={error} />
      </form>
    </Modal>
  );
}

function HorariosPanel({ doctor }: { doctor: Doctor }) {
  const [horarios, setHorarios] = useState<Horario[]>([]);
  const [error, setError] = useState<string | null>(null);

  const cargar = useCallback(
    () => apiJson<Horario[]>(`/doctores/${doctor.id}/horarios`).then(setHorarios).catch((e) => setError((e as ApiError).message)),
    [doctor.id],
  );
  useEffect(() => {
    cargar();
  }, [cargar]);

  async function agregar(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const f = new FormData(form);
    setError(null);
    try {
      await apiJson(`/doctores/${doctor.id}/horarios`, {
        method: "POST",
        body: JSON.stringify({ diaSemana: Number(f.get("dia")), horaInicio: f.get("inicio"), horaFin: f.get("fin") }),
      });
      await cargar();
    } catch (err) {
      setError((err as ApiError).message);
    }
  }

  async function borrar(id: string) {
    setError(null);
    try {
      await apiJson(`/horarios/${id}`, { method: "DELETE" });
      await cargar();
    } catch (err) {
      setError((err as ApiError).message);
    }
  }

  return (
    <div className="mt-2 rounded bg-slate-50 p-3">
      <p className="mb-2 text-sm font-medium">Horarios de atención de {doctor.nombre}</p>
      {horarios.length === 0 && <p className="mb-2 text-sm text-slate-500">Todavía no tiene horarios cargados.</p>}
      <ul className="mb-3 space-y-1 text-sm">
        {ORDEN_DIAS.flatMap((dia) => horarios.filter((h) => h.diaSemana === dia)).map((h) => (
          <li key={h.id} className="flex items-center gap-2">
            <span className="w-24">{DIAS[h.diaSemana]}</span>
            <span>{h.horaInicio} a {h.horaFin}</span>
            <button className="ml-auto text-red-700 hover:underline" onClick={() => borrar(h.id)}>Quitar</button>
          </li>
        ))}
      </ul>
      <form onSubmit={agregar} className="flex flex-wrap items-end gap-2 text-sm">
        <label>Día
          <select name="dia" defaultValue={1} className="mt-1 block rounded border border-slate-300 bg-white px-2 py-1.5">
            {ORDEN_DIAS.map((d) => <option key={d} value={d}>{DIAS[d]}</option>)}
          </select>
        </label>
        <label>Desde
          <input name="inicio" type="time" required defaultValue="09:00" className="mt-1 block rounded border border-slate-300 bg-white px-2 py-1.5" />
        </label>
        <label>Hasta
          <input name="fin" type="time" required defaultValue="13:00" className="mt-1 block rounded border border-slate-300 bg-white px-2 py-1.5" />
        </label>
        <button className={btnGhost}>Agregar franja</button>
      </form>
      <ErrorBox error={error} />
    </div>
  );
}

function DoctoresSection({ doctores, especialidades, onChange }: { doctores: Doctor[]; especialidades: Especialidad[]; onChange: () => void }) {
  const [modal, setModal] = useState<{ doctor: Doctor | null } | null>(null);
  const [abierto, setAbierto] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function alternarActivo(d: Doctor) {
    setError(null);
    try {
      await apiJson(`/doctores/${d.id}`, { method: "PATCH", body: JSON.stringify({ activo: !d.activo }) });
      onChange();
    } catch (e) {
      setError((e as ApiError).message);
    }
  }

  return (
    <section className="rounded-lg bg-white p-4 shadow-sm">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="font-semibold">Doctores</h2>
        <button className={btnPrimary} disabled={especialidades.length === 0} onClick={() => setModal({ doctor: null })}>+ Nuevo doctor</button>
      </div>
      {especialidades.length === 0 && <p className="mb-2 text-sm text-slate-500">Primero cargá al menos una especialidad.</p>}
      <ul className="divide-y divide-slate-100">
        {doctores.map((d) => (
          <li key={d.id} className="py-3">
            <div className="flex flex-wrap items-center gap-2">
              <div className="min-w-48 flex-1">
                <p className={`font-medium ${d.activo ? "" : "text-slate-400 line-through"}`}>{d.nombre}</p>
                <p className="text-sm text-slate-500">{d.especialidad.nombre} · turnos de {d.duracionTurnoMin} min{d.activo ? "" : " · inactivo"}</p>
              </div>
              <button className={btnGhost} onClick={() => setAbierto(abierto === d.id ? null : d.id)}>Horarios</button>
              <button className={btnGhost} onClick={() => setModal({ doctor: d })}>Editar</button>
              <button className={btnGhost} onClick={() => alternarActivo(d)}>{d.activo ? "Desactivar" : "Activar"}</button>
            </div>
            {abierto === d.id && <HorariosPanel doctor={d} />}
          </li>
        ))}
      </ul>
      <ErrorBox error={error} />
      {modal && (
        <DoctorModal doctor={modal.doctor} especialidades={especialidades} onClose={() => setModal(null)}
          onDone={() => { setModal(null); onChange(); }} />
      )}
    </section>
  );
}

// ---------- Página ----------

export default function GestionPage() {
  const me = useSession();
  const [especialidades, setEspecialidades] = useState<Especialidad[]>([]);
  const [doctores, setDoctores] = useState<Doctor[]>([]);
  const [error, setError] = useState<string | null>(null);

  const cargar = useCallback(async () => {
    try {
      const [e, d] = await Promise.all([apiJson<Especialidad[]>("/especialidades"), apiJson<Doctor[]>("/doctores")]);
      setEspecialidades(e);
      setDoctores(d);
    } catch (err) {
      setError((err as ApiError).message);
    }
  }, []);

  useEffect(() => {
    if (me.rol === "ADMIN") cargar();
  }, [me.rol, cargar]);

  if (me.rol !== "ADMIN") return <p className="p-6 text-slate-600">Esta pantalla es solo para administradores.</p>;

  return (
    <main className="mx-auto max-w-3xl space-y-4 p-4">
      <h1 className="text-lg font-semibold">Gestión de la clínica</h1>
      <ErrorBox error={error} />
      <EspecialidadesSection especialidades={especialidades} onChange={cargar} />
      <DoctoresSection doctores={doctores} especialidades={especialidades} onChange={cargar} />
    </main>
  );
}
