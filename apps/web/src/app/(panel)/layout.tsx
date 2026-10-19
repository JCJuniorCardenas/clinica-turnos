"use client";

import { useRouter } from "next/navigation";
import { api } from "../../lib-api";
import { SessionGate, useSession } from "../../lib/session";

const ROL_LABEL = { ADMIN: "Administrador", DOCTOR: "Doctor", RECEPCION: "Recepción" } as const;

function Header() {
  const me = useSession();
  const router = useRouter();

  async function logout() {
    await api("/auth/logout", { method: "POST" });
    router.replace("/login");
  }

  return (
    <header className="flex flex-wrap items-center justify-between gap-2 bg-teal-700 px-4 py-3 text-white print:hidden">
      <span className="font-semibold">{me.clinica.nombre}</span>
      <div className="flex items-center gap-3 text-sm">
        <span className="hidden sm:inline">{me.email} · {ROL_LABEL[me.rol]}</span>
        <button onClick={logout} className="rounded bg-teal-900 px-3 py-1 hover:bg-teal-950">Salir</button>
      </div>
    </header>
  );
}

export default function PanelLayout({ children }: { children: React.ReactNode }) {
  return (
    <SessionGate>
      <Header />
      {children}
    </SessionGate>
  );
}
