"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { api, Me } from "../lib-api";

const ROL_LABEL = { ADMIN: "Administrador", DOCTOR: "Doctor", RECEPCION: "Recepción" } as const;

export default function HomePage() {
  const router = useRouter();
  const [me, setMe] = useState<Me | null>(null);

  useEffect(() => {
    api("/auth/me")
      .then((res) => (res.ok ? res.json() : Promise.reject()))
      .then(setMe)
      .catch(() => router.replace("/login"));
  }, [router]);

  async function logout() {
    await api("/auth/logout", { method: "POST" });
    router.replace("/login");
  }

  if (!me) return <p className="p-6 text-slate-500">Cargando...</p>;

  return (
    <div>
      <header className="flex items-center justify-between bg-teal-700 px-6 py-3 text-white">
        <span className="font-semibold">{me.clinica.nombre}</span>
        <div className="flex items-center gap-4 text-sm">
          <span>{me.email} · {ROL_LABEL[me.rol]}</span>
          <button onClick={logout} className="rounded bg-teal-900 px-3 py-1 hover:bg-teal-950">Salir</button>
        </div>
      </header>
      <main className="p-6">
        <h1 className="text-lg font-semibold">Panel</h1>
        <p className="mt-2 text-slate-600">Sesión iniciada como {ROL_LABEL[me.rol]}. La agenda llega en la Fase 3.</p>
      </main>
    </div>
  );
}
