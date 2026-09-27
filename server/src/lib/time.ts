/** Canonical timestamp format used across the database: ISO-8601 UTC with milliseconds. */
export function nowIso(): string {
  return new Date().toISOString();
}

export function toIso(value: Date | string | number): string {
  return new Date(value).toISOString();
}

/** Calendar day (YYYY-MM-DD) in UTC — used for diary entry dates and photo dates. */
export function toDayKey(value: Date | string | number): string {
  return new Date(value).toISOString().slice(0, 10);
}

export function addDays(date: Date, days: number): Date {
  const next = new Date(date);
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}
