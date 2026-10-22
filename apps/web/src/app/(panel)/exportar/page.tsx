"use client";

import { FormEvent, useEffect, useState } from "react";
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

  useEffect(() => {
    apiJson<{ id: string; nombre: string }[]>("/doctores").then(setDoctores).catch(() => undefined);
  }, []);

  async function descargar(e: FormEvent) {
    e.preventDefault();
    setError(null);
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
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setDescargando(false);
    }
  }

  const input = "mt-1 w-full rounded border border-slate-300 bg-white px-3 py-2";

  return (
    <main className="mx-auto max-w-lg p-4">
      <h1 className="mb-1 text-lg font-semibold">Exportar turnos a Excel</h1>
      <p className="mb-4 text-sm text-slate-600">
        Genera una planilla (.xlsx) que se abre con Excel, Google Sheets o LibreOffice. Para una hoja lista para imprimir,
        usá el botón «Imprimir» de la Agenda.
      </p>
      <form onSubmit={descargar} className="space-y-4 rounded-lg bg-white p-4 shadow-sm">
        <div className="grid grid-cols-2 gap-3">
          <label className="block text-sm">Desde
            <input type="date" required value={desde} onChange={(e) => setDesde(e.target.value)} className={input} />
          </label>
          <label className="block text-sm">Hasta
            <input type="date" required value={hasta} min={desde} onChange={(e) => setHasta(e.target.value)} className={input} />
          </label>
        </div>
        {me.rol !== "DOCTOR" && (
          <label className="block text-sm">Doctor
            <select value={doctorId} onChange={(e) => setDoctorId(e.target.value)} className={input}>
              <option value="">Todos los doctores</option>
              {doctores.map((d) => (
                <option key={d.id} value={d.id}>{d.nombre}</option>
              ))}
            </select>
          </label>
        )}
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={incluirCancelados} onChange={(e) => setIncluirCancelados(e.target.checked)} />
          Incluir turnos cancelados
        </label>
        {error && <p role="alert" className="rounded bg-red-50 p-3 text-sm text-red-700">{error}</p>}
        <button disabled={descargando}
          className="w-full rounded bg-teal-700 px-3 py-2 font-medium text-white hover:bg-teal-800 disabled:opacity-60">
          {descargando ? "Generando..." : "Descargar Excel"}
        </button>
      </form>
    </main>
  );
}
