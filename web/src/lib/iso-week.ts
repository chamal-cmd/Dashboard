// Pure ISO-week (Monday-start) date bucketing shared by the Asana and
// Hubstaff weekly-trend data layers, plus the client chart that renders them
// — one bucketing rule everywhere keeps a task's week and an hour's week
// aligned even though they come from two different APIs.

export function isoWeekMonday(dateISO: string): string {
  const d = new Date(`${dateISO.slice(0, 10)}T00:00:00Z`);
  const day = d.getUTCDay() === 0 ? 7 : d.getUTCDay(); // Mon=1..Sun=7
  d.setUTCDate(d.getUTCDate() - (day - 1));
  return d.toISOString().slice(0, 10);
}

// The last `n` Mondays, oldest first, ending with the Monday of `todayISO`'s
// own week — a fixed x-axis so a week with zero activity for everyone still
// appears as a real (empty) point rather than silently vanishing.
export function lastNWeekMondays(n: number, todayISO: string): string[] {
  const thisMonday = isoWeekMonday(todayISO);
  const base = new Date(`${thisMonday}T00:00:00Z`);
  const out: string[] = [];
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(base);
    d.setUTCDate(base.getUTCDate() - i * 7);
    out.push(d.toISOString().slice(0, 10));
  }
  return out;
}
