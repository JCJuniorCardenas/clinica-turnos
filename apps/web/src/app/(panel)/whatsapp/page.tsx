"use client";

import { useEffect, useState } from "react";
import { Card, Chip, EmptyState, Icon, PageHeader, Skeleton } from "../../../components/ui";
import { ApiError, apiJson } from "../../../lib-api";
import { useSession } from "../../../lib/session";

type Estado = {
  proveedor: "meta" | "baileys" | "console";
  habilitado: boolean;
  estado: "desconectado" | "esperando_qr" | "conectado";
  qr: string | null;
  faltan: string[];
  problema: string | null;
};

const ESTADOS = {
  conectado: { titulo: "Conectado", detalle: "El asistente está recibiendo y respondiendo mensajes.", ring: "bg-ok", soft: "bg-ok-soft text-ok" },
  esperando_qr: { titulo: "Esperando vinculación", detalle: "Escaneá el código con el WhatsApp del chip de la clínica.", ring: "bg-warn", soft: "bg-warn-soft text-warn" },
  desconectado: { titulo: "Desconectado", detalle: "No hay un número vinculado o falta configuración.", ring: "bg-danger", soft: "bg-danger-soft text-danger" },
} as const;

export default function WhatsAppPage() {
  const me = useSession();
  const [data, setData] = useState<Estado | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copiado, setCopiado] = useState(false);

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
    const id = setInterval(cargar, 3000); // the QR (Baileys) rotates every ~20 s
    return () => clearInterval(id);
  }, [me.rol]);

  if (me.rol !== "ADMIN") {
    return (
      <main className="p-8">
        <EmptyState icon="shield" title="Solo para administradores" />
      </main>
    );
  }

  const t = data ? ESTADOS[data.estado] : null;
  const webhookUrl = typeof window === "undefined" ? "" : `${window.location.origin}/api/whatsapp/webhook`;

  async function copiar() {
    try {
      await navigator.clipboard.writeText(webhookUrl);
      setCopiado(true);
      setTimeout(() => setCopiado(false), 2000);
    } catch {
      // clipboard may be blocked; the URL is visible to copy by hand
    }
  }

  return (
    <main className="mx-auto max-w-2xl p-4 sm:p-6 lg:p-8">
      <PageHeader
        eyebrow="Administración"
        title="Conexión de WhatsApp"
        description={
          data?.proveedor === "meta"
            ? "Conectado por la API oficial de WhatsApp (Meta): no hay QR ni celular que vincular. Meta le avisa al sistema cada vez que llega un mensaje."
            : "Vinculá el número del asistente como «dispositivo vinculado» (igual que WhatsApp Web). Usá el chip secundario de la demo, nunca el número principal."
        }
      />

      {error && (
        <p role="alert" className="animate-pop-in mb-4 flex items-center gap-2 rounded-lg bg-danger-soft p-3.5 text-sm text-danger">
          <Icon name="alert" size={18} />
          {error}
        </p>
      )}

      {!data && !error && <Skeleton className="h-40 rounded-lg" />}

      {data && t && (
        <Card className="overflow-hidden">
          <div className="flex items-center gap-4 p-5">
            <span className={`relative flex h-14 w-14 items-center justify-center rounded-lg ${t.soft}`}>
              <Icon name="whatsapp" size={28} />
              <span className="absolute -right-1 -top-1 flex h-4 w-4">
                {data.estado === "conectado" && <span className={`absolute inline-flex h-full w-full animate-ping rounded-full opacity-60 ${t.ring}`} />}
                <span className={`relative inline-flex h-4 w-4 rounded-full border-2 border-surface ${t.ring}`} />
              </span>
            </span>
            <div>
              <p className="text-lg font-semibold">{t.titulo}</p>
              <p className="text-sm text-muted">{t.detalle}</p>
            </div>
            <Chip tone="muted" className="ml-auto">{data.proveedor === "meta" ? "API oficial de Meta" : data.proveedor === "baileys" ? "Baileys (pruebas)" : "Consola"}</Chip>
          </div>

          {(data.problema || !data.habilitado || (data.proveedor === "meta" && data.faltan.length > 0)) && (
            <div className="space-y-2 border-t border-line p-5">
              {data.problema && (
                <p role="alert" className="flex items-start gap-2 rounded-lg bg-danger-soft p-3 text-sm text-danger">
                  <Icon name="alert" size={18} />
                  {data.problema}
                </p>
              )}
              {!data.habilitado && (
                <p className="flex items-start gap-2 rounded-lg bg-warn-soft p-3 text-sm text-warn">
                  <Icon name="alert" size={18} />
                  <span>El bot está apagado en este servidor (<code>BOT_ENABLED</code> no es <code>true</code>).</span>
                </p>
              )}
              {data.proveedor === "meta" && data.faltan.length > 0 && (
                <p className="flex items-start gap-2 rounded-lg bg-warn-soft p-3 text-sm text-warn">
                  <Icon name="alert" size={18} />
                  <span>Faltan estas variables en el servidor: <code>{data.faltan.join(", ")}</code>.</span>
                </p>
              )}
            </div>
          )}

          {data.qr && (
            <div className="border-t border-line p-6 text-center">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={data.qr} alt="Código QR para vincular WhatsApp" width={260} height={260} className="mx-auto rounded-lg bg-white p-3" />
              <p className="mt-3 text-sm text-muted">En el celular: WhatsApp → Dispositivos vinculados → Vincular un dispositivo.</p>
            </div>
          )}

          {data.proveedor === "meta" && (
            <div className="border-t border-line p-5 text-sm">
              <p className="font-medium">Dirección del webhook para el panel de Meta</p>
              <div className="mt-2 flex items-center gap-2 rounded-lg bg-surface-2 p-2.5">
                <code className="min-w-0 flex-1 break-all text-xs">{webhookUrl}</code>
                <button onClick={copiar} className="shrink-0 rounded-lg border border-line bg-surface px-3 py-1.5 text-xs font-medium transition hover:border-accent hover:text-accent">
                  {copiado ? "¡Copiada!" : "Copiar"}
                </button>
              </div>
              <p className="mt-2 text-xs text-muted">
                En Meta: WhatsApp → Configuración → Webhook. Pegá esta dirección y el token de verificación que elegiste, y suscribite al campo «messages».
              </p>
            </div>
          )}
        </Card>
      )}
    </main>
  );
}
