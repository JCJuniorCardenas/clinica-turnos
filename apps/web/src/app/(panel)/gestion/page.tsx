"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";
import { Modal } from "../../../components/Modal";
import { Avatar, Button, Card, Chip, EmptyState, Icon, PageHeader, Skeleton, inputCls } from "../../../components/ui";
import { ApiError, apiJson } from "../../../lib-api";
import { useSession } from "../../../lib/session";

type Especialidad = { id: string; nombre: string };
type Doctor = { id: string; nombre: string; especialidadId: string; duracionTurnoMin: number; activo: boolean; especialidad: Especialidad };
type Horario = { id: string; diaSemana: number; horaInicio: string; horaFin: string };

const DIAS = ["Domingo", "Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado"];
const ORDEN_DIAS = [1, 2, 3, 4, 5, 6, 0];

function ErrorBox({ error }: { error: string | null }) {
  return error ? (
    <p role="alert" className="animate-pop-in mt-3 flex items-center gap-2 rounded-xl bg-danger-soft p-3 text-sm text-danger">
      <Icon name="alert" size={18} />
      {error}
    </p>
  ) : null;
}

function SectionTitle({ title, count, children }: { title: string; count?: number; children?: React.ReactNode }) {
  return (
    <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
      <h2 className="flex items-center gap-2 text-base font-semibold">
        {title}
        {count !== undefined && <Chip tone="muted">{count}</Chip>}
      </h2>
      {children}
    </div>
  );
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
    <Card className="animate-fade-up p-5">
      <SectionTitle title="Especialidades" count={especialidades.length} />
      {especialidades.length === 0 && <p className="mb-3 text-sm text-muted">Todavía no hay especialidades. Agregá la primera acá abajo.</p>}
      <ul className="mb-4 divide-y divide-line">
        {especialidades.map((esp) => (
          <li key={esp.id} className="flex flex-wrap items-center gap-2 py-2.5">
            {editando === esp.id ? (
              <form
                className="flex flex-1 flex-wrap gap-2"
                onSubmit={(e) => {
                  e.preventDefault();
                  const nombre = String(new FormData(e.currentTarget).get("nombre")).trim();
                  run(() => apiJson(`/especialidades/${esp.id}`, { method: "PATCH", body: JSON.stringify({ nombre }) }));
                }}
              >
                <input name="nombre" defaultValue={esp.nombre} required minLength={2} autoFocus aria-label="Nombre de la especialidad" className={`${inputCls} min-w-40 flex-1`} />
                <Button variant="soft" size="sm" icon="check">
                  Guardar
                </Button>
                <Button type="button" variant="ghost" size="sm" onClick={() => setEditando(null)}>
                  Cancelar
                </Button>
              </form>
            ) : (
              <>
                <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-accent-soft text-accent">
                  <Icon name="sparkle" size={16} />
                </span>
                <span className="flex-1 font-medium">{esp.nombre}</span>
                <Button variant="ghost" size="sm" icon="edit" onClick={() => setEditando(esp.id)}>
                  Renombrar
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  icon="trash"
                  className="hover:text-danger"
                  onClick={() => confirm(`¿Borrar la especialidad «${esp.nombre}»?`) && run(() => apiJson(`/especialidades/${esp.id}`, { method: "DELETE" }))}
                >
                  Borrar
                </Button>
              </>
            )}
          </li>
        ))}
      </ul>
      <form onSubmit={agregar} className="flex gap-2">
        <input name="nombre" required minLength={2} placeholder="Nueva especialidad" aria-label="Nueva especialidad" className={`${inputCls} flex-1`} />
        <Button variant="primary" icon="plus">
          Agregar
        </Button>
      </form>
      <ErrorBox error={error} />
    </Card>
  );
}

// ---------- Doctores ----------

function DoctorModal({
  doctor,
  especialidades,
  onClose,
  onDone,
}: {
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
    <Modal title={doctor ? "Editar doctor" : "Nuevo doctor"} subtitle={doctor ? doctor.nombre : "Completá los datos del profesional"} onClose={onClose}>
      <form onSubmit={guardar} className="space-y-4">
        <label className="block text-sm font-medium">
          Nombre
          <input name="nombre" required minLength={2} defaultValue={doctor?.nombre} className={`${inputCls} mt-1.5`} />
        </label>
        <label className="block text-sm font-medium">
          Especialidad
          <select name="especialidadId" required defaultValue={doctor?.especialidadId ?? ""} className={`${inputCls} mt-1.5`}>
            <option value="" disabled>
              Elegí una...
            </option>
            {especialidades.map((e) => (
              <option key={e.id} value={e.id}>
                {e.nombre}
              </option>
            ))}
          </select>
        </label>
        <label className="block text-sm font-medium">
          Duración de cada turno (minutos)
          <input name="duracionTurnoMin" type="number" required min={5} max={480} step={5} defaultValue={doctor?.duracionTurnoMin ?? 60} className={`${inputCls} mt-1.5`} />
        </label>
        <Button variant="primary" size="lg" loading={guardando} className="w-full">
          {guardando ? "Guardando..." : "Guardar"}
        </Button>
        <ErrorBox error={error} />
      </form>
    </Modal>
  );
}

function HorariosPanel({ doctor }: { doctor: Doctor }) {
  const [horarios, setHorarios] = useState<Horario[] | null>(null);
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

  const ordenados = horarios ? ORDEN_DIAS.flatMap((dia) => horarios.filter((h) => h.diaSemana === dia)) : [];

  return (
    <div className="animate-fade-up mt-3 rounded-2xl bg-surface-2 p-4">
      <p className="mb-3 flex items-center gap-2 text-sm font-semibold">
        <Icon name="clock" size={16} />
        Horarios de atención
      </p>
      {horarios === null && <Skeleton className="h-10 rounded-xl" />}
      {horarios && horarios.length === 0 && <p className="mb-3 text-sm text-muted">Todavía no tiene horarios cargados: sin horarios, el asistente no ofrece turnos.</p>}
      <ul className="mb-4 flex flex-wrap gap-2 text-sm">
        {ordenados.map((h) => (
          <li key={h.id} className="group flex items-center gap-2 rounded-full border border-line bg-surface py-1 pl-3 pr-1.5">
            <span className="font-medium">{DIAS[h.diaSemana]}</span>
            <span className="text-muted">
              {h.horaInicio} a {h.horaFin}
            </span>
            <button
              onClick={() => borrar(h.id)}
              aria-label={`Quitar horario del ${DIAS[h.diaSemana]}`}
              className="flex h-6 w-6 items-center justify-center rounded-full text-muted transition hover:bg-danger-soft hover:text-danger"
            >
              <Icon name="x" size={14} />
            </button>
          </li>
        ))}
      </ul>
      <form onSubmit={agregar} className="flex flex-wrap items-end gap-2 text-sm">
        <label className="flex flex-col font-medium">
          Día
          <select name="dia" defaultValue={1} className={`${inputCls} mt-1 !w-auto`}>
            {ORDEN_DIAS.map((d) => (
              <option key={d} value={d}>
                {DIAS[d]}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col font-medium">
          Desde
          <input name="inicio" type="time" required defaultValue="09:00" className={`${inputCls} mt-1 !w-auto`} />
        </label>
        <label className="flex flex-col font-medium">
          Hasta
          <input name="fin" type="time" required defaultValue="13:00" className={`${inputCls} mt-1 !w-auto`} />
        </label>
        <Button variant="soft" icon="plus">
          Agregar franja
        </Button>
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
    <Card className="animate-fade-up p-5" style={{ animationDelay: "80ms" }}>
      <SectionTitle title="Doctores" count={doctores.length}>
        <Button variant="primary" size="sm" icon="plus" disabled={especialidades.length === 0} onClick={() => setModal({ doctor: null })}>
          Nuevo doctor
        </Button>
      </SectionTitle>
      {especialidades.length === 0 && <p className="mb-3 text-sm text-muted">Primero cargá al menos una especialidad.</p>}
      {doctores.length === 0 && especialidades.length > 0 && (
        <EmptyState icon="users" title="Todavía no hay doctores">
          Agregá el primero con el botón «Nuevo doctor».
        </EmptyState>
      )}
      <ul className="divide-y divide-line">
        {doctores.map((d) => (
          <li key={d.id} className="py-3.5">
            <div className="flex flex-wrap items-center gap-3">
              <div className={d.activo ? "" : "opacity-50 grayscale"}>
                <Avatar name={d.nombre} size={44} />
              </div>
              <div className="min-w-48 flex-1">
                <p className={`font-semibold ${d.activo ? "" : "text-muted line-through"}`}>{d.nombre}</p>
                <p className="mt-0.5 flex flex-wrap items-center gap-1.5 text-sm text-muted">
                  <Chip tone="accent">{d.especialidad.nombre}</Chip>
                  <span>turnos de {d.duracionTurnoMin} min</span>
                  {!d.activo && <Chip tone="warn">Inactivo</Chip>}
                </p>
              </div>
              <div className="flex flex-wrap gap-1.5">
                <Button variant={abierto === d.id ? "soft" : "secondary"} size="sm" icon="clock" onClick={() => setAbierto(abierto === d.id ? null : d.id)}>
                  Horarios
                </Button>
                <Button size="sm" icon="edit" onClick={() => setModal({ doctor: d })}>
                  Editar
                </Button>
                <Button variant="ghost" size="sm" onClick={() => alternarActivo(d)}>
                  {d.activo ? "Desactivar" : "Activar"}
                </Button>
              </div>
            </div>
            {abierto === d.id && <HorariosPanel doctor={d} />}
          </li>
        ))}
      </ul>
      <ErrorBox error={error} />
      {modal && (
        <DoctorModal
          doctor={modal.doctor}
          especialidades={especialidades}
          onClose={() => setModal(null)}
          onDone={() => {
            setModal(null);
            onChange();
          }}
        />
      )}
    </Card>
  );
}

// ---------- Página ----------

export default function GestionPage() {
  const me = useSession();
  const [especialidades, setEspecialidades] = useState<Especialidad[] | null>(null);
  const [doctores, setDoctores] = useState<Doctor[] | null>(null);
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

  if (me.rol !== "ADMIN") {
    return (
      <main className="p-8">
        <EmptyState icon="shield" title="Solo para administradores" />
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-3xl space-y-5 p-4 sm:p-6 lg:p-8">
      <PageHeader eyebrow="Administración" title="Gestión de la clínica" description="Doctores, especialidades y horarios de atención. Lo que cargues acá es lo que el asistente y la agenda ofrecen a los pacientes." />
      <ErrorBox error={error} />
      {!especialidades || !doctores ? (
        !error && (
          <div className="space-y-4">
            <Skeleton className="h-48 rounded-2xl" />
            <Skeleton className="h-64 rounded-2xl" />
          </div>
        )
      ) : (
        <>
          <EspecialidadesSection especialidades={especialidades} onChange={cargar} />
          <DoctoresSection doctores={doctores} especialidades={especialidades} onChange={cargar} />
        </>
      )}
    </main>
  );
}
