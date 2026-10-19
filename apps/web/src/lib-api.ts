export const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001";

export type Me = {
  id: string;
  email: string;
  rol: "ADMIN" | "DOCTOR" | "RECEPCION";
  doctorId: string | null;
  clinica: { id: string; nombre: string };
};

// The JWT lives in an httpOnly cookie, so every call must send credentials.
export function api(path: string, init: RequestInit = {}) {
  return fetch(`${API_URL}${path}`, {
    ...init,
    credentials: "include",
    headers: { "Content-Type": "application/json", ...init.headers },
  });
}
