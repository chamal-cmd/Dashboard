// Client-safe mirror of auTodayISODate() in business-tz.ts. That file is
// "server-only" and can't be imported from client components, but the same
// UTC-vs-AU-local mismatch applies to any date computed client-side too
// (e.g. the `max` on a date-range picker) — so this duplicates just the
// formatting logic, not the server-only guard.
const AU_ZONE = "Australia/Sydney";

const auDateFormatterClient = new Intl.DateTimeFormat("en-CA", {
  timeZone: AU_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

export function auTodayISODateClient(): string {
  return auDateFormatterClient.format(new Date());
}
