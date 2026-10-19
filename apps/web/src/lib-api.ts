export const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001";

export type Rol = "ADMIN" | "DOCTOR" | "RECEPCION";

export type Me = {
  id: string;
  email: string;
  rol: Rol;
  doctorId: string | null;
  clinica: { id: string; nombre: string };
};

export type Paciente = { id: string; nombre: string; telefono: string; dni: string | null };
export type EstadoTurno = "PENDIENTE" | "CONFIRMADO" | "CANCELADO" | "ATENDIDO" | "AUSENTE";
export type SlotTurno = { id: string; estado: EstadoTurno; origen: string; paciente: Paciente };
export type Slot = { inicio: string; fin: string; pasado: boolean; turno: SlotTurno | null };
export type AgendaDoctor = {
  id: string;
  nombre: string;
  especialidad: string;
  duracionTurnoMin: number;
  slots: Slot[];
};
export type Agenda = { fecha: string; timezone: string; doctores: AgendaDoctor[] };

export type ApiError = { status: number; message: string; alternativas?: { inicio: string }[] };

// The JWT lives in an httpOnly cookie, so every call must send credentials.
export function api(path: string, init: RequestInit = {}) {
  return fetch(`${API_URL}${path}`, {
    ...init,
    credentials: "include",
    headers: { "Content-Type": "application/json", ...init.headers },
  });
}

/** Calls the API and returns parsed JSON, or throws an ApiError with a readable message. */
export async function apiJson<T>(path: string, init: RequestInit = {}): Promise<T> {
  let res: Response;
  try {
    res = await api(path, init);
  } catch {
    throw { status: 0, message: "No se pudo conectar con el servidor." } satisfies ApiError;
  }
  const body = await res.json().catch(() => null);
  if (!res.ok) {
    const raw = body?.message;
    const message = Array.isArray(raw) ? raw.join(". ") : (raw ?? "Ocurrió un error.");
    throw { status: res.status, message, alternativas: body?.alternativas } satisfies ApiError;
  }
  return body as T;
}
