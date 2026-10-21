"use client";

import { FormEvent, useEffect, useState } from "react";
import { Button, Card, Icon, PageHeader, SuccessCheck, inputCls } from "../../../components/ui";
import { API_URL, apiJson } from "../../../lib-api";
import { addDias, hoyAR } from "../../../lib/format";
import { useSession } from "../../../lib/session";

export default function ExportarPage() {
  const me = useSession();
  const [desde, setDesde] = useState(hoyAR());
  const [hasta, setHasta] = useState(addDias(hoyAR(), 6));
  const [doctorId, setDoctorId] = useState("");
  const [incluirCancelados, setIncluirCancelados] = useState(false);
  const [doctores, setDoctores] = useState<{ id: string; nombre: string }[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [descargando, setDescargando] = useState(false);
  const [listo, setListo] = useState(false);

  useEffect(() => {
    apiJson<{ id: string; nombre: string }[]>("/doctores").then(setDoctores).catch(() => undefined);
  }, []);

  const rangos = [
    { label: "Hoy", d: hoyAR(), h: hoyAR() },
    { label: "Próximos 7 días", d: hoyAR(), h: addDias(hoyAR(), 6) },
    { label: "Próximos 30 días", d: hoyAR(), h: addDias(hoyAR(), 29) },
  ];

  async function descargar(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setListo(false);
    setDescargando(true);
    try {
      const qs = new URLSearchParams({ desde, hasta, incluirCancelados: String(incluirCancelados) });
      if (doctorId) qs.set("doctorId", doctorId);
      const res = await fetch(`${API_URL}/turnos/exportar?${qs}`, { credentials: "include" });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(Array.isArray(body?.message) ? body.message.join(". ") : (body?.message ?? "No se pudo exportar."));
      }
      const url = URL.createObjectURL(await res.blob());
      const a = document.createElement("a");
      a.href = url;
      a.download = `turnos_${desde}${hasta !== desde ? `_a_${hasta}` : ""}.xlsx`;
      a.click();
      URL.revokeObjectURL(url);
      setListo(true);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setDescargando(false);
    }
  }

  return (
    <main className="mx-auto max-w-2xl p-4 sm:p-6 lg:p-8">
      <PageHeader
        eyebrow="Herramientas"
        title="Exportar turnos a Excel"
        description="Genera una planilla (.xlsx) que abre con Excel, Google Sheets o LibreOffice. Para una hoja lista para imprimir, usá el botón «Imprimir» de la Agenda."
      />

      <Card className="p-5 sm:p-6" style={{ animationDelay: "80ms" }}>
        <form onSubmit={descargar} className="space-y-5">
          <div>
            <p className="mb-2 text-sm font-medium">Atajos</p>
            <div className="flex flex-wrap gap-2">
              {rangos.map((r) => {
                const activo = desde === r.d && hasta === r.h;
                return (
                  <button
                    key={r.label}
                    type="button"
                    onClick={() => {
                      setDesde(r.d);
                      setHasta(r.h);
                    }}
                    className={`rounded-full border px-3.5 py-1.5 text-sm font-medium transition ${
                      activo ? "brand-gradient border-transparent text-white" : "border-line hover:border-accent hover:text-accent"
                    }`}
                  >
                    {r.label}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <label className="block text-sm font-medium">
              Desde
              <input type="date" required value={desde} onChange={(e) => setDesde(e.target.value)} className={`${inputCls} mt-1.5`} />
            </label>
            <label className="block text-sm font-medium">
              Hasta
              <input type="date" required value={hasta} min={desde} onChange={(e) => setHasta(e.target.value)} className={`${inputCls} mt-1.5`} />
            </label>
          </div>

          {me.rol !== "DOCTOR" && (
            <label className="block text-sm font-medium">
              Doctor
              <select value={doctorId} onChange={(e) => setDoctorId(e.target.value)} className={`${inputCls} mt-1.5`}>
                <option value="">Todos los doctores</option>
                {doctores.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.nombre}
                  </option>
                ))}
              </select>
            </label>
          )}

          <label className="flex cursor-pointer items-center gap-3 rounded-lg border border-line p-3 text-sm transition hover:bg-surface-2">
            <input type="checkbox" checked={incluirCancelados} onChange={(e) => setIncluirCancelados(e.target.checked)} className="h-4 w-4 accent-[var(--accent)]" />
            Incluir turnos cancelados
          </label>

          {error && (
            <p role="alert" className="animate-pop-in flex items-center gap-2 rounded-lg bg-danger-soft p-3 text-sm text-danger">
              <Icon name="alert" size={18} />
              {error}
            </p>
          )}

          {listo && (
            <div className="animate-pop-in flex items-center gap-3 rounded-lg bg-ok-soft p-3 text-sm text-ok">
              <SuccessCheck size={36} />
              <span className="font-medium">¡Listo! La planilla se descargó.</span>
            </div>
          )}

          <Button variant="primary" size="lg" icon="download" loading={descargando} className="w-full">
            {descargando ? "Generando..." : "Descargar Excel"}
          </Button>
        </form>
      </Card>
    </main>
  );
}
