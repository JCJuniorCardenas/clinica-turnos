"use client";

import { useEffect, useState } from "react";
import { ApiError, apiJson } from "../../../lib-api";
import { useSession } from "../../../lib/session";

type Estado = { habilitado: boolean; estado: "desconectado" | "esperando_qr" | "conectado"; qr: string | null };

const TEXTO = {
  conectado: { titulo: "Conectado", detalle: "El asistente está recibiendo y respondiendo mensajes.", color: "bg-green-500" },
  esperando_qr: { titulo: "Esperando vinculación", detalle: "Escaneá el código con el WhatsApp del chip de la clínica.", color: "bg-amber-500" },
  desconectado: { titulo: "Desconectado", detalle: "No hay un número vinculado o se perdió la conexión.", color: "bg-red-500" },
} as const;

export default function WhatsAppPage() {
  const me = useSession();
  const [data, setData] = useState<Estado | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (me.rol !== "ADMIN") return;
    const cargar = () =>
      apiJson<Estado>("/whatsapp/estado")
        .then((d) => {
          setData(d);
          setError(null);
        })
        .catch((e) => setError((e as ApiError).message));
    cargar();
    const id = setInterval(cargar, 3000); // the QR rotates every ~20 s
    return () => clearInterval(id);
  }, [me.rol]);

  if (me.rol !== "ADMIN") return <p className="p-6 text-slate-600">Esta pantalla es solo para administradores.</p>;

  const t = data ? TEXTO[data.estado] : null;

  return (
    <main className="mx-auto max-w-md p-4">
      <h1 className="mb-1 text-lg font-semibold">Conexión de WhatsApp</h1>
      <p className="mb-4 text-sm text-slate-600">
        Vinculá el número del asistente como «dispositivo vinculado» (igual que WhatsApp Web). Usá el chip secundario de la demo, nunca el número principal.
      </p>
      {error && <p role="alert" className="mb-3 rounded bg-red-50 p-3 text-sm text-red-700">{error}</p>}
      {data && t && (
        <div className="rounded-lg bg-white p-5 shadow-sm">
          <p className="flex items-center gap-2 font-medium">
            <span className={`h-3 w-3 rounded-full ${t.color}`} /> {t.titulo}
          </p>
          <p className="mt-1 text-sm text-slate-600">{t.detalle}</p>
          {!data.habilitado && (
            <p className="mt-3 rounded bg-amber-50 p-3 text-sm text-amber-800">
              El bot está apagado en este servidor (<code>BOT_ENABLED</code> no es <code>true</code>).
            </p>
          )}
          {data.qr && (
            <div className="mt-4 text-center">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={data.qr} alt="Código QR para vincular WhatsApp" width={280} height={280} className="mx-auto" />
              <p className="mt-2 text-xs text-slate-500">En el celular: WhatsApp → Dispositivos vinculados → Vincular un dispositivo.</p>
            </div>
          )}
        </div>
      )}
    </main>
  );
}
