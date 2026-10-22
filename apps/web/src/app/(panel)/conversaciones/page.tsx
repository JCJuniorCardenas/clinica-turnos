"use client";

import { useCallback, useEffect, useState } from "react";
import { ApiError, apiJson } from "../../../lib-api";
import { fechaCorta, fechaDe, fmtHora } from "../../../lib/format";
import { useTurnoStream } from "../../../lib/live";
import { useSession } from "../../../lib/session";

type Derivada = { id: string; telefono: string; motivo: string; urgencia: boolean; derivadaEn: string };

export default function ConversacionesPage() {
  const me = useSession();
  const [lista, setLista] = useState<Derivada[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const cargar = useCallback(async () => {
    try {
      setLista(await apiJson<Derivada[]>("/conversaciones/derivadas"));
      setError(null);
    } catch (e) {
      setError((e as ApiError).message);
    }
  }, []);

  useEffect(() => {
    if (me.rol !== "DOCTOR") cargar();
  }, [me.rol, cargar]);

  useTurnoStream((e) => {
    if (e.type === "ready" || e.type.startsWith("conversacion.")) cargar();
  });

  async function liberar(id: string) {
    setError(null);
    try {
      await apiJson(`/conversaciones/${id}/liberar`, { method: "POST" });
      await cargar();
    } catch (e) {
      setError((e as ApiError).message);
    }
  }

  if (me.rol === "DOCTOR") return <p className="p-6 text-slate-600">Esta pantalla es solo para recepción y administración.</p>;

  return (
    <main className="mx-auto max-w-3xl p-4">
      <h1 className="mb-1 text-lg font-semibold">Chats derivados a recepción</h1>
      <p className="mb-4 text-sm text-slate-600">
        Son conversaciones de WhatsApp donde el asistente pidió ayuda de una persona. Mientras estén acá, el asistente no responde ese número:
        contestale desde el celular de la clínica y después tocá «Resuelto» para que el asistente vuelva a atender.
      </p>
      {error && <p role="alert" className="mb-3 rounded bg-red-50 p-3 text-sm text-red-700">{error}</p>}
      {lista && lista.length === 0 && <p className="rounded bg-white p-6 text-center text-slate-500 shadow-sm">No hay chats esperando.</p>}
      <ul className="space-y-3">
        {lista?.map((c) => (
          <li key={c.id} className={`rounded-lg bg-white p-4 shadow-sm ${c.urgencia ? "border-l-4 border-red-500" : ""}`}>
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="font-medium">
                  {c.telefono}
                  {c.urgencia && <span className="ml-2 rounded bg-red-100 px-2 py-0.5 text-xs font-semibold text-red-700">Posible urgencia</span>}
                </p>
                <p className="mt-1 break-words text-sm text-slate-700">{c.motivo}</p>
                <p className="mt-1 text-xs text-slate-500">
                  {fechaCorta(fechaDe(c.derivadaEn))} {fmtHora(c.derivadaEn)}
                </p>
              </div>
              <button onClick={() => liberar(c.id)}
                className="rounded border border-slate-300 px-3 py-1.5 text-sm hover:bg-slate-50">
                Resuelto
              </button>
            </div>
          </li>
        ))}
      </ul>
    </main>
  );
}
