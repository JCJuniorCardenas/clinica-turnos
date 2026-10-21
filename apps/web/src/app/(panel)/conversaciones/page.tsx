"use client";

import { useCallback, useEffect, useState } from "react";
import { Avatar, Button, Card, Chip, EmptyState, Icon, PageHeader, Skeleton } from "../../../components/ui";
import { ApiError, apiJson } from "../../../lib-api";
import { fechaCorta, fechaDe, fmtHora } from "../../../lib/format";
import { useTurnoStream } from "../../../lib/live";
import { useSession } from "../../../lib/session";

type Derivada = { id: string; telefono: string; motivo: string; urgencia: boolean; derivadaEn: string };

export default function ConversacionesPage() {
  const me = useSession();
  const [lista, setLista] = useState<Derivada[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [resolviendo, setResolviendo] = useState<string | null>(null);

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
    setResolviendo(id);
    try {
      await apiJson(`/conversaciones/${id}/liberar`, { method: "POST" });
      await cargar();
    } catch (e) {
      setError((e as ApiError).message);
    } finally {
      setResolviendo(null);
    }
  }

  if (me.rol === "DOCTOR") {
    return (
      <main className="p-8">
        <EmptyState icon="shield" title="Solo para recepción y administración" />
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-4xl p-4 sm:p-6 lg:p-8">
      <PageHeader
        eyebrow="WhatsApp"
        title="Chats derivados a recepción"
        description="Conversaciones donde el asistente pidió ayuda de una persona. Mientras estén acá, el asistente no responde ese número: contestale desde el celular de la clínica y después tocá «Resuelto»."
      />

      {error && (
        <p role="alert" className="animate-pop-in mb-4 flex items-center gap-2 rounded-lg bg-danger-soft p-3.5 text-sm text-danger">
          <Icon name="alert" size={18} />
          {error}
        </p>
      )}

      {lista === null && !error && (
        <div className="space-y-3">
          {[0, 1].map((i) => (
            <Skeleton key={i} className="h-24 rounded-lg" />
          ))}
        </div>
      )}

      {lista && lista.length === 0 && (
        <EmptyState icon="check" title="Todo al día">
          No hay chats esperando a una persona. Cuando el asistente derive uno, va a aparecer acá con un aviso.
        </EmptyState>
      )}

      <ul className="space-y-3">
        {lista?.map((c, i) => (
          <li key={c.id} className="animate-fade-up" style={{ animationDelay: `${i * 60}ms` }}>
            <Card className={`flex flex-wrap items-start justify-between gap-4 p-4 ${c.urgencia ? "border-danger/50 bg-danger-soft/30" : ""}`}>
              <div className="flex min-w-0 items-start gap-3">
                <Avatar name={c.telefono.replace(/\D/g, "").slice(-4)} size={44} />
                <div className="min-w-0">
                  <p className="flex flex-wrap items-center gap-2 font-semibold">
                    {c.telefono}
                    {c.urgencia && (
                      <Chip tone="danger" icon="alert">
                        Posible urgencia
                      </Chip>
                    )}
                  </p>
                  <p className="mt-1 break-words text-sm">{c.motivo}</p>
                  <p className="mt-1.5 flex items-center gap-1.5 text-xs text-muted">
                    <Icon name="clock" size={13} />
                    {fechaCorta(fechaDe(c.derivadaEn))} · {fmtHora(c.derivadaEn)}
                  </p>
                </div>
              </div>
              <Button variant="soft" icon="check" loading={resolviendo === c.id} onClick={() => liberar(c.id)}>
                Resuelto
              </Button>
            </Card>
          </li>
        ))}
      </ul>
    </main>
  );
}
