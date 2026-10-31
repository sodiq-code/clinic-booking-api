// ISO-8601 (UTC, with Z suffix) formatting helpers.
// Prisma stores DateTime; we always emit UTC strings on the wire.

/**
 * Format a Date (or ISO string) as ISO-8601 UTC with a trailing `Z`,
 * e.g. "2026-12-10T09:00:00.000Z".
 */
export function toIsoUtc(value: Date | string | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString();
}

/** Current time as a Date in UTC. */
export function nowUtc(): Date {
  return new Date();
}
