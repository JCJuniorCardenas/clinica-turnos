"use client";

import { useRouter } from "next/navigation";
import { FormEvent, useState } from "react";
import { Button, Icon, IconName, LogoMark, inputCls } from "../../components/ui";
import { api } from "../../lib-api";

const FEATURES: { icon: IconName; title: string; text: string }[] = [
  { icon: "bolt", title: "Agenda en vivo", text: "Cada turno nuevo aparece al instante, sin recargar." },
  { icon: "whatsapp", title: "Asistente por WhatsApp", text: "Agenda, cambia y cancela turnos hablando normal." },
  { icon: "shield", title: "Cero doble reserva", text: "Dos pacientes nunca quedan en el mismo horario." },
];

export default function LoginPage() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [verClave, setVerClave] = useState(false);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    const form = new FormData(e.currentTarget);
    try {
      const res = await api("/auth/login", {
        method: "POST",
        body: JSON.stringify({ email: form.get("email"), password: form.get("password") }),
      });
      if (res.ok) return router.replace("/");
      if (res.status === 401) setError("Email o contraseña incorrectos.");
      else if (res.status === 429) setError("Demasiados intentos. Probá en un minuto.");
      else setError("Error del servidor. Intentá de nuevo.");
    } catch {
      setError("No se pudo conectar con el servidor.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="grid min-h-screen lg:grid-cols-[1.05fr_1fr]">
      {/* Brand side */}
      <section className="brand-gradient bg-dots relative hidden overflow-hidden p-12 text-white lg:flex lg:flex-col lg:justify-between">
        <div className="absolute -right-24 -top-24 h-96 w-96 rounded-full bg-white/10 blur-3xl" aria-hidden="true" />
        <div className="absolute -bottom-32 -left-20 h-[28rem] w-[28rem] rounded-full bg-black/20 blur-3xl" aria-hidden="true" />

        <div className="relative flex items-center gap-3 text-lg font-semibold">
          <LogoMark size={42} />
          Clínica Turnos
        </div>

        <div className="relative">
          <h1 className="animate-fade-up text-4xl font-semibold leading-tight tracking-tight xl:text-5xl">
            La agenda de tu clínica,
            <br />
            siempre al día.
          </h1>
          <p className="animate-fade-up mt-4 max-w-md text-lg text-white/80" style={{ animationDelay: "80ms" }}>
            Reemplazá la hoja de papel por una agenda viva que además atiende por WhatsApp.
          </p>

          <ul className="mt-10 space-y-4">
            {FEATURES.map((f, i) => (
              <li key={f.title} className="animate-fade-up flex items-start gap-4" style={{ animationDelay: `${180 + i * 110}ms` }}>
                <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-white/15 ring-1 ring-white/25 backdrop-blur">
                  <Icon name={f.icon} size={22} />
                </span>
                <span>
                  <span className="block font-semibold">{f.title}</span>
                  <span className="block text-sm text-white/75">{f.text}</span>
                </span>
              </li>
            ))}
          </ul>
        </div>

        {/* Decorative floating "appointment" cards */}
        <div className="relative hidden h-24 xl:block" aria-hidden="true">
          <div className="animate-float absolute left-0 top-0 flex items-center gap-3 rounded-2xl bg-white/95 px-4 py-3 text-ink shadow-modal">
            <span className="flex h-9 w-9 items-center justify-center rounded-full bg-ok-soft text-ok"><Icon name="check" size={18} /></span>
            <span className="text-sm"><b>Turno confirmado</b><br /><span className="text-muted">Hoy · 12:00</span></span>
          </div>
          <div className="animate-float absolute left-64 top-8 flex items-center gap-3 rounded-2xl bg-white/95 px-4 py-3 text-ink shadow-modal" style={{ animationDelay: "-3s" }}>
            <span className="flex h-9 w-9 items-center justify-center rounded-full bg-accent-soft text-accent"><Icon name="whatsapp" size={18} /></span>
            <span className="text-sm"><b>Nuevo por WhatsApp</b><br /><span className="text-muted">hace un momento</span></span>
          </div>
        </div>
      </section>

      {/* Form side */}
      <section className="flex items-center justify-center px-5 py-10 sm:px-10">
        <div className="animate-fade-up w-full max-w-sm">
          <div className="mb-8 flex items-center gap-3 lg:hidden">
            <LogoMark size={40} />
            <span className="text-lg font-semibold">Clínica Turnos</span>
          </div>

          <h2 className="text-2xl font-semibold tracking-tight">Bienvenido/a</h2>
          <p className="mt-1 text-sm text-muted">Ingresá para ver y gestionar la agenda.</p>

          <form onSubmit={onSubmit} className="mt-8 space-y-4">
            <label className="block text-sm font-medium">
              Email
              <span className="relative mt-1.5 block">
                <Icon name="user" size={18} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-muted" />
                <input name="email" type="email" required autoComplete="username" placeholder="tu@clinica.com"
                  className={`${inputCls} pl-10`} />
              </span>
            </label>

            <label className="block text-sm font-medium">
              Contraseña
              <span className="relative mt-1.5 block">
                <Icon name="shield" size={18} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-muted" />
                <input name="password" type={verClave ? "text" : "password"} required autoComplete="current-password"
                  placeholder="••••••••" className={`${inputCls} pl-10 pr-16`} />
                <button type="button" onClick={() => setVerClave((v) => !v)}
                  className="absolute right-2 top-1/2 -translate-y-1/2 rounded-lg px-2 py-1 text-xs font-medium text-muted hover:bg-surface-2 hover:text-ink">
                  {verClave ? "Ocultar" : "Ver"}
                </button>
              </span>
            </label>

            {error && (
              <p role="alert" className="animate-pop-in flex items-center gap-2 rounded-xl bg-danger-soft px-3.5 py-2.5 text-sm text-danger">
                <Icon name="alert" size={18} />
                {error}
              </p>
            )}

            <Button variant="primary" size="lg" loading={loading} className="w-full">
              {loading ? "Ingresando..." : "Ingresar"}
            </Button>
          </form>

          <p className="mt-8 text-center text-xs text-muted">
            Acceso para el personal de la clínica. ¿Problemas para entrar? Consultá con recepción.
          </p>
        </div>
      </section>
    </main>
  );
}
