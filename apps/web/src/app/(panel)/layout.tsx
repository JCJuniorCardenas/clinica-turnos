"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { Avatar, Chip, Icon, IconName, LogoMark } from "../../components/ui";
import { api, apiJson } from "../../lib-api";
import { useTurnoStream } from "../../lib/live";
import { SessionGate, useSession } from "../../lib/session";

const ROL_LABEL = { ADMIN: "Administrador", DOCTOR: "Doctor", RECEPCION: "Recepción" } as const;

/** Counter with the number of WhatsApp chats waiting for a person. Refreshes live and pulses to catch the eye. */
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
  if (n === 0) return null;
  return (
    <span className="relative ml-auto flex h-5 min-w-5 items-center justify-center" aria-label={`${n} chats derivados`}>
      <span className="absolute inset-0 animate-ping rounded-full bg-danger/40" aria-hidden="true" />
      <span className="relative rounded-full bg-danger px-1.5 text-xs font-semibold leading-5 text-white">{n}</span>
    </span>
  );
}

type NavItem = { href: string; label: string; icon: IconName };

function useNav(): { grupo: string; items: NavItem[] }[] {
  const me = useSession();
  const [demo, setDemo] = useState(false);
  useEffect(() => {
    apiJson<{ demoMode: boolean }>("/demo/estado").then((r) => setDemo(r.demoMode)).catch(() => undefined);
  }, []);
  const noDoctor = me.rol !== "DOCTOR";
  const grupos: { grupo: string; items: NavItem[] }[] = [
    {
      grupo: "Principal",
      items: [
        { href: "/", label: "Agenda", icon: "calendar" },
        ...(noDoctor ? [{ href: "/conversaciones", label: "Chats derivados", icon: "chat" as const }] : []),
      ],
    },
    {
      grupo: "Herramientas",
      items: [
        { href: "/exportar", label: "Exportar", icon: "download" },
        ...(demo && noDoctor ? [{ href: "/simulador", label: "Simulador WhatsApp", icon: "send" as const }] : []),
      ],
    },
  ];
  if (me.rol === "ADMIN") {
    grupos.push({
      grupo: "Administración",
      items: [
        { href: "/whatsapp", label: "Conexión WhatsApp", icon: "whatsapp" },
        { href: "/gestion", label: "Gestión", icon: "gear" },
      ],
    });
  }
  return grupos;
}

function NavList({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname();
  const grupos = useNav();
  return (
    <nav className="space-y-6" aria-label="Principal">
      {grupos.map((g) => (
        <div key={g.grupo}>
          <p className="mb-2 px-3 text-[11px] font-semibold uppercase tracking-wider text-muted">{g.grupo}</p>
          <ul className="space-y-1">
            {g.items.map((l) => {
              const activo = pathname === l.href;
              return (
                <li key={l.href}>
                  <Link href={l.href} onClick={onNavigate} aria-current={activo ? "page" : undefined}
                    className={`flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors ${
                      activo ? "bg-brand-soft text-brand-strong" : "text-muted hover:bg-surface-2 hover:text-ink"
                    }`}>
                    <Icon name={l.icon} size={18} />
                    {l.label}
                    {l.href === "/conversaciones" && <DerivadasBadge />}
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </nav>
  );
}

function SidebarContent({ onNavigate }: { onNavigate?: () => void }) {
  const me = useSession();
  const router = useRouter();

  async function logout() {
    await api("/auth/logout", { method: "POST" });
    router.replace("/login");
  }

  return (
    <div className="flex h-full flex-col gap-6 p-4">
      <div className="flex items-center gap-3 px-2 pt-1">
        <LogoMark size={38} />
        <div className="min-w-0 leading-tight">
          <p className="truncate font-semibold">{me.clinica.nombre}</p>
          <p className="text-xs text-muted">Agenda de turnos</p>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        <NavList onNavigate={onNavigate} />
      </div>

      <div className="border-t border-line pt-3">
        <div className="min-w-0">
          <p className="truncate text-sm font-medium">{me.email}</p>
          <p className="text-xs text-muted">{ROL_LABEL[me.rol]}</p>
        </div>
        <button onClick={logout}
          className="mt-3 flex w-full items-center justify-center gap-2 rounded-md border border-line bg-surface py-1.5 text-sm font-medium text-muted transition-colors hover:border-danger/40 hover:text-danger">
          <Icon name="logout" size={16} />
          Cerrar sesión
        </button>
      </div>
    </div>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  const me = useSession();
  const pathname = usePathname();
  const [abierto, setAbierto] = useState(false);

  // Close the mobile drawer whenever the page changes.
  useEffect(() => setAbierto(false), [pathname]);

  return (
    <div className="min-h-screen">
      {/* Desktop sidebar */}
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-64 border-r border-line bg-surface print:hidden lg:block">
        <SidebarContent />
      </aside>

      {/* Mobile top bar */}
      <header className="sticky top-0 z-30 flex items-center justify-between border-b border-line bg-surface/90 px-4 py-3 backdrop-blur print:hidden lg:hidden">
        <div className="flex items-center gap-3">
          <LogoMark size={32} />
          <span className="font-semibold">{me.clinica.nombre}</span>
        </div>
        <button onClick={() => setAbierto(true)} aria-label="Abrir menú"
          className="rounded-xl border border-line p-2 text-muted hover:bg-surface-2 hover:text-ink">
          <Icon name="menu" size={22} />
        </button>
      </header>

      {/* Mobile drawer */}
      {abierto && (
        <div className="fixed inset-0 z-40 lg:hidden print:hidden" role="dialog" aria-modal="true" aria-label="Menú">
          <div className="animate-fade-in absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={() => setAbierto(false)} />
          <aside className="animate-slide-left absolute inset-y-0 left-0 w-72 max-w-[85vw] border-r border-line bg-surface shadow-modal">
            <button onClick={() => setAbierto(false)} aria-label="Cerrar menú" className="absolute right-3 top-3 rounded-lg p-1.5 text-muted hover:bg-surface-2">
              <Icon name="x" size={20} />
            </button>
            <SidebarContent onNavigate={() => setAbierto(false)} />
          </aside>
        </div>
      )}

      <div className="lg:pl-64 print:pl-0">{children}</div>
    </div>
  );
}

export default function PanelLayout({ children }: { children: React.ReactNode }) {
  return (
    <SessionGate>
      <Shell>{children}</Shell>
    </SessionGate>
  );
}
