/** True when a Prisma/Postgres error is a unique-constraint violation (including the partial index on Turno). */
export function isUniqueViolation(e: unknown): boolean {
  const err = e as { code?: string; message?: string; meta?: unknown } | null;
  if (!err) return false;
  if (err.code === "P2002") return true;
  const haystack = `${err.message ?? ""} ${JSON.stringify(err.meta ?? {})}`;
  return /23505|unique constraint|duplicate key|turno_doctor_inicio_activo/i.test(haystack);
}
