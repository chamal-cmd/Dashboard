import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { getAsanaOverview, getAsanaWeeklyCompletions } from "./asana";
import { getHubstaffOverview, getHubstaffWeeklyTrend } from "./hubstaff";
import { getAllPods } from "./pods";
import { auTodayISODate } from "@/lib/business-tz";
import { lastNWeekMondays } from "@/lib/iso-week";

export interface BookkeeperRow {
  id: string; // asana_members.id (asana gid) — used to link to the existing per-person Asana page
  name: string;
  email: string;
  pod: string | null;
  asanaOpen: number | null;
  asanaOverdue: number | null;
  hubstaffHours: number | null;
  hubstaffActivityPct: number | null;
}

export interface BookkeeperStatsResult {
  bookkeepers: BookkeeperRow[];
  pods: { id: string; name: string }[];
  errors: { asana?: string; hubstaff?: string };
}

// Asana/Hubstaff are fast enough to compute server-side on one page load.
// Hiver is deliberately NOT included here — a full per-bookkeeper
// conversation count needs the same 60-90s sequential inbox sweep
// HiverDashboard does client-side (see useHiverData), which would either
// block this page for a minute or risk the Worker's own execution limit.
// The page component fetches Hiver counts itself, client-side, once loaded.
export async function getBookkeeperStats(days = 7): Promise<BookkeeperStatsResult> {
  const admin = createAdminClient();
  const [{ data: members }, allPods, asana, hubstaff] = await Promise.all([
    admin.from("asana_members").select("id, name, email, pods(name)"),
    getAllPods(),
    getAsanaOverview(days),
    getHubstaffOverview(days, 1),
  ]);

  const asanaOk = !asana.error;
  const hubstaffOk = !hubstaff.error;

  const asanaByAssignee = new Map(asana.byAssignee.map((a) => [a.id, a]));
  const hubstaffByEmail = new Map(hubstaff.members.map((m) => [m.email.toLowerCase(), m]));

  const bookkeepers: BookkeeperRow[] = (members ?? [])
    .map((m) => {
      const id = m.id as string;
      const email = ((m.email as string) ?? "").toLowerCase();
      const pod = (m as unknown as { pods: { name: string } | null }).pods?.name ?? null;
      const asanaStat = asanaByAssignee.get(id);
      const hubStat = hubstaffByEmail.get(email);
      return {
        id,
        name: m.name as string,
        email,
        pod,
        asanaOpen: asanaOk ? (asanaStat?.open ?? 0) : null,
        asanaOverdue: asanaOk ? (asanaStat?.overdue ?? 0) : null,
        hubstaffHours: hubstaffOk ? (hubStat?.hours ?? 0) : null,
        hubstaffActivityPct: hubstaffOk ? (hubStat?.activityPct ?? null) : null,
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));

  return {
    bookkeepers,
    pods: allPods,
    errors: {
      asana: asana.error,
      hubstaff: hubstaff.error,
    },
  };
}

export interface BookkeeperTrendPoint {
  weekStartISO: string;
  asanaCompleted: number | null; // null = Asana fetch failed this run, not "zero"
  hubstaffHours: number | null;
}

export interface BookkeeperTrendSeries {
  id: string; // asana_members.id — same id used to link to the person page
  name: string;
  email: string;
  points: BookkeeperTrendPoint[]; // one entry per week in BookkeeperTrendResult.weeks, same order
}

export interface BookkeeperTrendResult {
  weeks: string[]; // Monday dates, oldest first
  series: BookkeeperTrendSeries[];
  errors: { asana?: string; hubstaff?: string };
}

// Weekly Asana-completions + Hubstaff-hours per bookkeeper, joined on the
// asana_members roster (Hubstaff side matched by email, same join used
// throughout this file). Deliberately NOT part of getBookkeeperStats above —
// a multi-week Asana completions scan and a multi-week Hubstaff activities
// scan are both heavier than the single-window stats it already does, so the
// page fetches this separately (client-side) rather than slowing its first paint.
export async function getBookkeeperTrend(weeksCount = 8): Promise<BookkeeperTrendResult> {
  const admin = createAdminClient();
  const weeks = lastNWeekMondays(weeksCount, auTodayISODate());
  const startDateISO = `${weeks[0]}T00:00:00Z`;

  const [{ data: members }, asanaTrend, hubstaffTrend] = await Promise.all([
    admin.from("asana_members").select("id, name, email"),
    getAsanaWeeklyCompletions(admin, startDateISO),
    getHubstaffWeeklyTrend(weeksCount),
  ]);

  const asanaOk = !asanaTrend.error;
  const hubstaffOk = !hubstaffTrend.error;

  const asanaByAssignee = new Map<string, Map<string, number>>();
  for (const p of asanaTrend.points) {
    const m = asanaByAssignee.get(p.assigneeId) ?? new Map<string, number>();
    m.set(p.weekStartISO, p.count);
    asanaByAssignee.set(p.assigneeId, m);
  }
  const hubstaffByEmail = new Map<string, Map<string, number>>();
  for (const p of hubstaffTrend.points) {
    const m = hubstaffByEmail.get(p.email) ?? new Map<string, number>();
    m.set(p.weekStartISO, (m.get(p.weekStartISO) ?? 0) + p.hours);
    hubstaffByEmail.set(p.email, m);
  }

  const series: BookkeeperTrendSeries[] = (members ?? [])
    .map((m) => {
      const id = m.id as string;
      const email = ((m.email as string) ?? "").toLowerCase();
      const asanaWeeks = asanaByAssignee.get(id);
      const hubWeeks = hubstaffByEmail.get(email);
      const points: BookkeeperTrendPoint[] = weeks.map((w) => ({
        weekStartISO: w,
        asanaCompleted: asanaOk ? (asanaWeeks?.get(w) ?? 0) : null,
        hubstaffHours: hubstaffOk ? (hubWeeks?.get(w) ?? 0) : null,
      }));
      return { id, name: m.name as string, email, points };
    })
    // Drop anyone with zero activity across the whole window on BOTH metrics
    // — otherwise the bookkeeper picker is cluttered with people who have
    // nothing to actually plot.
    .filter((s) => s.points.some((p) => (p.asanaCompleted ?? 0) > 0 || (p.hubstaffHours ?? 0) > 0))
    .sort((a, b) => a.name.localeCompare(b.name));

  return { weeks, series, errors: { asana: asanaTrend.error, hubstaff: hubstaffTrend.error } };
}
