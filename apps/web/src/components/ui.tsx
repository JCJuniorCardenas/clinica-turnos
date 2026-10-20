"use client";

import { ButtonHTMLAttributes, ReactNode, useEffect, useRef, useState } from "react";

/* ---------------------------------------------------------------------------------------------
 * Small design-system kit: icons, buttons, cards, chips, skeletons and helpers.
 * Everything uses the semantic color tokens from globals.css (so dark mode comes for free).
 * ------------------------------------------------------------------------------------------- */

const PATHS = {
  calendar: "M8 2v4M16 2v4M3 10h18M5 4h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2Z",
  chat: "M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.4A8 8 0 1 1 21 12Z",
  download: "M12 3v12m0 0 4-4m-4 4-4-4M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2",
  gear: "M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6Zm7.4-3a7.4 7.4 0 0 0-.1-1.2l2-1.5-2-3.4-2.3.9a7.5 7.5 0 0 0-2-1.2L14.6 2h-4l-.4 2.6a7.5 7.5 0 0 0-2 1.2l-2.3-.9-2 3.4 2 1.5a7.4 7.4 0 0 0 0 2.4l-2 1.5 2 3.4 2.3-.9a7.5 7.5 0 0 0 2 1.2l.4 2.6h4l.4-2.6a7.5 7.5 0 0 0 2-1.2l2.3.9 2-3.4-2-1.5c.1-.4.1-.8.1-1.2Z",
  whatsapp: "M20 11.5A8.5 8.5 0 0 1 7.3 18.9L3 20l1.2-4.1A8.5 8.5 0 1 1 20 11.5Zm-9.6-3.2c-.2-.4-.4-.4-.6-.4h-.5c-.2 0-.5.1-.7.3-.2.3-.9.9-.9 2.2s.9 2.5 1.1 2.7c.1.2 1.8 2.9 4.5 3.9 2.2.9 2.7.7 3.2.6.5 0 1.5-.6 1.7-1.2.2-.6.2-1.1.2-1.2-.1-.1-.3-.2-.6-.4l-1.8-.9c-.2-.1-.4-.1-.6.1l-.8 1c-.1.2-.3.2-.6.1-.9-.4-1.9-1-2.7-2.3-.1-.2 0-.4.1-.5l.4-.5c.1-.1.2-.3.2-.5l-.9-2.4Z",
  logout: "M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4m7 14 5-5-5-5m5 5H9",
  bell: "M6 8a6 6 0 1 1 12 0c0 7 3 9 3 9H3s3-2 3-9ZM10.3 21a1.9 1.9 0 0 0 3.4 0",
  bellOff: "M13.7 21a1.9 1.9 0 0 1-3.4 0M18 8a6 6 0 0 0-9.3-5M3 3l18 18M6.3 6.3A6 6 0 0 0 6 8c0 7-3 9-3 9h14",
  printer: "M6 9V2h12v7M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2M6 14h12v8H6v-8Z",
  plus: "M12 5v14M5 12h14",
  check: "M5 12.5 10 17.5 19 7",
  x: "M6 6l12 12M18 6 6 18",
  chevronLeft: "m15 18-6-6 6-6",
  chevronRight: "m9 18 6-6-6-6",
  menu: "M4 7h16M4 12h16M4 17h16",
  users: "M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8Zm13 10v-2a4 4 0 0 0-3-3.9M16 3.1a4 4 0 0 1 0 7.8",
  alert: "M12 9v4m0 4h.01M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z",
  send: "m22 2-7 20-4-9-9-4 20-7ZM22 2 11 13",
  sparkle: "M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8L12 3ZM19 16l.8 2.2L22 19l-2.2.8L19 22l-.8-2.2L16 19l2.2-.8L19 16Z",
  clock: "M12 7v5l3 2M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z",
  user: "M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2M12 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8Z",
  phone: "M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1 1 .4 1.9.7 2.8a2 2 0 0 1-.5 2.1L8.1 9.9a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.4c.9.3 1.8.6 2.8.7a2 2 0 0 1 1.7 2Z",
  search: "m21 21-4.3-4.3M17 10.5a6.5 6.5 0 1 1-13 0 6.5 6.5 0 0 1 13 0Z",
  shield: "M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10Z",
  bolt: "M13 2 3 14h9l-1 8 10-12h-9l1-8Z",
  refresh: "M21 12a9 9 0 0 1-15.4 6.3M3 12A9 9 0 0 1 18.4 5.7M21 3v6h-6M3 21v-6h6",
  trash: "M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2m3 0v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6",
  edit: "M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5Z",
} as const;

export type IconName = keyof typeof PATHS;

export function Icon({ name, size = 20, className = "" }: { name: IconName; size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8}
      strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className={`shrink-0 ${className}`}>
      <path d={PATHS[name]} />
    </svg>
  );
}

/** Brand mark: a calendar with a medical cross, on the brand gradient. */
export function LogoMark({ size = 36 }: { size?: number }) {
  return (
    <span className="brand-gradient inline-flex items-center justify-center rounded-xl text-white shadow-pop"
      style={{ width: size, height: size }} aria-hidden="true">
      <svg width={size * 0.58} height={size * 0.58} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
        <rect x="3.5" y="4.5" width="17" height="16" rx="3" />
        <path d="M8 2.5v4M16 2.5v4" />
        <path d="M12 10.5v6M9 13.5h6" />
      </svg>
    </span>
  );
}

/* ----------------------------------------------------------------------------- Buttons */

type Variant = "primary" | "secondary" | "ghost" | "danger" | "soft";
const VARIANT: Record<Variant, string> = {
  primary: "brand-gradient text-white shadow-card hover:shadow-pop hover:-translate-y-px active:translate-y-0 active:scale-[0.98]",
  secondary: "bg-surface text-ink border border-line hover:bg-surface-2 hover:border-brand/40 active:scale-[0.98]",
  ghost: "text-muted hover:text-ink hover:bg-surface-2",
  danger: "bg-danger-soft text-danger border border-danger/25 hover:bg-danger hover:text-white active:scale-[0.98]",
  soft: "bg-brand-soft text-brand-strong hover:bg-brand/20 active:scale-[0.98]",
};

export function Button({
  variant = "secondary",
  size = "md",
  loading = false,
  icon,
  className = "",
  children,
  disabled,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: "sm" | "md" | "lg"; loading?: boolean; icon?: IconName; children?: ReactNode }) {
  const pad = size === "sm" ? "px-3 py-1.5 text-sm" : size === "lg" ? "px-5 py-3 text-base" : "px-4 py-2 text-sm";
  return (
    <button
      {...rest}
      disabled={disabled || loading}
      className={`inline-flex items-center justify-center gap-2 rounded-xl font-medium transition-all duration-200 disabled:cursor-not-allowed disabled:opacity-55 disabled:hover:translate-y-0 ${pad} ${VARIANT[variant]} ${className}`}
    >
      {loading ? <Spinner size={16} /> : icon ? <Icon name={icon} size={size === "sm" ? 16 : 18} /> : null}
      {children}
    </button>
  );
}

export function Spinner({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" className="animate-spin" aria-label="Cargando" role="status">
      <circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" strokeWidth="3" opacity="0.25" />
      <path d="M21 12a9 9 0 0 0-9-9" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}

/* ------------------------------------------------------------------------------ Surfaces */

export function Card({ className = "", children, ...rest }: { className?: string; children: ReactNode } & React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div {...rest} className={`rounded-2xl border border-line bg-surface shadow-card ${className}`}>
      {children}
    </div>
  );
}

type Tone = "brand" | "accent" | "ok" | "warn" | "danger" | "muted";
const TONE: Record<Tone, string> = {
  brand: "bg-brand-soft text-brand-strong",
  accent: "bg-accent-soft text-accent",
  ok: "bg-ok-soft text-ok",
  warn: "bg-warn-soft text-warn",
  danger: "bg-danger-soft text-danger",
  muted: "bg-surface-2 text-muted",
};

export function Chip({ tone = "muted", icon, children, className = "" }: { tone?: Tone; icon?: IconName; children: ReactNode; className?: string }) {
  return (
    <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${TONE[tone]} ${className}`}>
      {icon && <Icon name={icon} size={12} />}
      {children}
    </span>
  );
}

export function Skeleton({ className = "" }: { className?: string }) {
  return <div className={`skeleton ${className}`} aria-hidden="true" />;
}

export function EmptyState({ icon, title, children, action }: { icon: IconName; title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex animate-fade-up flex-col items-center rounded-2xl border border-dashed border-line bg-surface px-6 py-14 text-center">
      <span className="mb-4 flex h-16 w-16 animate-float items-center justify-center rounded-2xl bg-brand-soft text-brand">
        <Icon name={icon} size={30} />
      </span>
      <h2 className="text-base font-semibold">{title}</h2>
      {children && <p className="mt-1 max-w-sm text-sm text-muted">{children}</p>}
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}

/** Initials in a soft colored circle; the color is stable per name. */
export function Avatar({ name, size = 32 }: { name: string; size?: number }) {
  const initials = name.split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0]?.toUpperCase()).join("");
  const tones = ["bg-brand-soft text-brand-strong", "bg-accent-soft text-accent", "bg-ok-soft text-ok", "bg-warn-soft text-warn"];
  const hash = Array.from(name).reduce((a, c) => a + c.charCodeAt(0), 0);
  return (
    <span className={`inline-flex shrink-0 items-center justify-center rounded-full font-semibold ${tones[hash % tones.length]}`}
      style={{ width: size, height: size, fontSize: size * 0.38 }} aria-hidden="true">
      {initials || "?"}
    </span>
  );
}

/* --------------------------------------------------------------------------------- Hooks */

/** Counts from the previous value to the new one, so numbers "tick up" when they load or change. */
export function useCountUp(target: number, duration = 700): number {
  const [value, setValue] = useState(0);
  const from = useRef(0);
  useEffect(() => {
    const start = performance.now();
    const origin = from.current;
    let raf = 0;
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / duration);
      const eased = 1 - Math.pow(1 - t, 3);
      setValue(Math.round(origin + (target - origin) * eased));
      if (t < 1) raf = requestAnimationFrame(tick);
      else from.current = target;
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target, duration]);
  return value;
}

/** Animated check mark inside a ring: the "done!" moment after booking something. */
export function SuccessCheck({ size = 72 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 72 72" aria-hidden="true" style={{ animation: "ring-pop 0.5s cubic-bezier(0.22,1,0.36,1) both" }}>
      <circle cx="36" cy="36" r="32" fill="var(--ok-soft)" stroke="var(--ok)" strokeWidth="3" />
      <path d="M22 37 32 47 51 26" fill="none" stroke="var(--ok)" strokeWidth="5" strokeLinecap="round" strokeLinejoin="round"
        strokeDasharray="40" style={{ animation: "check-draw 0.45s 0.25s ease-out both" }} />
    </svg>
  );
}

/** Consistent page title block: small eyebrow, big title, optional description and right-aligned actions. */
export function PageHeader({ eyebrow, title, description, actions }: { eyebrow?: string; title: string; description?: string; actions?: ReactNode }) {
  return (
    <div className="animate-fade-up mb-6 flex flex-wrap items-end justify-between gap-4">
      <div>
        {eyebrow && <p className="text-sm font-medium text-muted">{eyebrow}</p>}
        <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">{title}</h1>
        {description && <p className="mt-1 max-w-2xl text-sm text-muted">{description}</p>}
      </div>
      {actions}
    </div>
  );
}

export const inputCls =
  "w-full rounded-xl border border-line bg-surface px-3.5 py-2.5 text-sm text-ink placeholder:text-muted/70 outline-none transition focus:border-accent focus:ring-4 focus:ring-accent/15";
