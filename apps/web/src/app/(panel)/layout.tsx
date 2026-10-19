"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { api } from "../../lib-api";
import { SessionGate, useSession } from "../../lib/session";

const ROL_LABEL = { ADMIN: "Administrador", DOCTOR: "Doctor", RECEPCION: "Recepción" } as const;

function Header() {
  const me = useSession();
  const router = useRouter();
  const pathname = usePathname();

  async function logout() {
    await api("/auth/logout", { method: "POST" });
    router.replace("/login");
  }

  const links = [
    { href: "/", label: "Agenda" },
    { href: "/exportar", label: "Exportar" },
    ...(me.rol === "ADMIN" ? [{ href: "/gestion", label: "Gestión" }] : []),
  ];

  return (
    <header className="flex flex-wrap items-center justify-between gap-2 bg-teal-700 px-4 py-3 text-white print:hidden">
      <div className="flex items-center gap-5">
        <span className="font-semibold">{me.clinica.nombre}</span>
        <nav className="flex gap-1 text-sm">
          {links.map((l) => (
            <Link key={l.href} href={l.href}
              className={`rounded px-3 py-1 ${pathname === l.href ? "bg-teal-900" : "hover:bg-teal-800"}`}>
              {l.label}
            </Link>
          ))}
        </nav>
      </div>
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
