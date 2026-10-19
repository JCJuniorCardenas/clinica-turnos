// All display formatting is pinned to Argentina time, regardless of the browser's own time zone.
const TZ = "America/Argentina/Buenos_Aires";

export const fmtHora = (iso: string) =>
  new Intl.DateTimeFormat("es-AR", { timeZone: TZ, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(
    new Date(iso),
  );

/** Local calendar date of an instant, as YYYY-MM-DD. */
export const fechaDe = (iso: string) => new Intl.DateTimeFormat("en-CA", { timeZone: TZ }).format(new Date(iso));

export const hoyAR = () => fechaDe(new Date().toISOString());

export function addDias(fecha: string, n: number): string {
  const [y, m, d] = fecha.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

/** "lunes 4 de marzo" */
export const fechaLarga = (fecha: string) =>
  new Intl.DateTimeFormat("es-AR", { timeZone: "UTC", weekday: "long", day: "numeric", month: "long" }).format(
    new Date(`${fecha}T12:00:00Z`),
  );

/** "lun 4 mar" */
export const fechaCorta = (fecha: string) =>
  new Intl.DateTimeFormat("es-AR", { timeZone: "UTC", weekday: "short", day: "numeric", month: "short" }).format(
    new Date(`${fecha}T12:00:00Z`),
  );
