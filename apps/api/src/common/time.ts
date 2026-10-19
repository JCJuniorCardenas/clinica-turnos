// Date helpers. The DB stores UTC; clinic-local wall-clock times are converted with Intl (no extra deps).

export const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
export const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function toMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
}

/** Offset (minutes) of `tz` relative to UTC at the given instant. */
export function tzOffsetMinutes(utc: Date, tz: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(utc);
  const p: Record<string, number> = {};
  for (const x of parts) if (x.type !== "literal") p[x.type] = Number(x.value);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return Math.round((asUtc - Math.floor(utc.getTime() / 1000) * 1000) / 60000);
}

/** Clinic-local date ("YYYY-MM-DD") + time ("HH:mm") -> UTC instant. */
export function localToUtc(date: string, time: string, tz: string): Date {
  const [y, m, d] = date.split("-").map(Number);
  const [hh, mm] = time.split(":").map(Number);
  const guess = Date.UTC(y, m - 1, d, hh, mm);
  let result = guess - tzOffsetMinutes(new Date(guess), tz) * 60000;
  // Second pass fixes the case where the offset differs at the resulting instant (DST edges).
  result = guess - tzOffsetMinutes(new Date(result), tz) * 60000;
  return new Date(result);
}

/** UTC instant -> clinic-local date and time. */
export function utcToLocal(utc: Date, tz: string): { date: string; time: string } {
  const shifted = new Date(utc.getTime() + tzOffsetMinutes(utc, tz) * 60000);
  const iso = shifted.toISOString();
  return { date: iso.slice(0, 10), time: iso.slice(11, 16) };
}

export function addDays(date: string, n: number): string {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

/** Day of week of a calendar date: 0 = Sunday ... 6 = Saturday. */
export function weekdayOf(date: string): number {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

/** Inclusive list of dates from `desde` to `hasta`. */
export function dateRange(desde: string, hasta: string): string[] {
  const out: string[] = [];
  for (let d = desde; d <= hasta; d = addDays(d, 1)) out.push(d);
  return out;
}

export function isValidDate(date: string): boolean {
  if (!DATE_RE.test(date)) return false;
  return addDays(date, 0) === date;
}
