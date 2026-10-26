"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { api, apiJson } from "../../lib-api";
import { useTurnoStream } from "../../lib/live";
import { SessionGate, useSession } from "../../lib/session";

const ROL_LABEL = { ADMIN: "Administrador", DOCTOR: "Doctor", RECEPCION: "Recepción" } as const;

/** Red counter with the number of WhatsApp chats waiting for a person. Refreshes live. */
function DerivadasBadge() {
  const [n, setN] = useState(0);
  const cargar = useCallback(() => {
    apiJson<unknown[]>("/conversaciones/derivadas").then((r) => setN(r.length)).catch(() => undefined);
  }, []);
  useEffect(() => {
    cargar();
    const id = setInterval(cargar, 30_000);
    return () => clearInterval(id);
  }, [cargar]);
  useTurnoStream((e) => {
    if (e.type === "ready" || e.type.startsWith("conversacion.")) cargar();
  });
  return n > 0 ? (
    <span className="ml-1.5 rounded-full bg-red-500 px-1.5 py-0.5 text-xs font-semibold text-white" aria-label={`${n} chats derivados`}>{n}</span>
  ) : null;
}

function Header() {
  const me = useSession();
  const [demo, setDemo] = useState(false);
  useEffect(() => {
    apiJson<{ demoMode: boolean }>("/demo/estado").then((r) => setDemo(r.demoMode)).catch(() => undefined);
  }, []);
  const router = useRouter();
  const pathname = usePathname();

  async function logout() {
    await api("/auth/logout", { method: "POST" });
    router.replace("/login");
  }

  const links = [
    { href: "/", label: "Agenda" },
    ...(me.rol !== "DOCTOR" ? [{ href: "/conversaciones", label: "Chats derivados" }] : []),
    { href: "/exportar", label: "Exportar" },
    ...(demo && me.rol !== "DOCTOR" ? [{ href: "/simulador", label: "Simulador WhatsApp" }] : []),
    ...(me.rol === "ADMIN"
      ? [
          { href: "/whatsapp", label: "WhatsApp" },
          { href: "/gestion", label: "Gestión" },
        ]
      : []),
  ];

  return (
    <>
    {demo && me.rol === "DOCTOR" && (
      <p className="bg-amber-100 px-4 py-1.5 text-center text-sm text-amber-900 print:hidden">Demo: acceso de solo lectura de un doctor</p>
    )}
    <header className="flex flex-wrap items-center justify-between gap-2 bg-teal-700 px-4 py-3 text-white print:hidden">
      <div className="flex items-center gap-5">
        <span className="font-semibold">{me.clinica.nombre}</span>
        <nav className="flex gap-1 text-sm">
          {links.map((l) => (
            <Link key={l.href} href={l.href}
              className={`rounded px-3 py-1 ${pathname === l.href ? "bg-teal-900" : "hover:bg-teal-800"}`}>
              {l.label}
              {l.href === "/conversaciones" && <DerivadasBadge />}
            </Link>
          ))}
        </nav>
      </div>
      <div className="flex items-center gap-3 text-sm">
        <span className="hidden sm:inline">{me.email} · {ROL_LABEL[me.rol]}</span>
        <button onClick={logout} className="rounded bg-teal-900 px-3 py-1 hover:bg-teal-950">Salir</button>
      </div>
    </header>
    </>
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
