import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { getAsanaWeeklyCompletions, getClientProjectBreakdown } from "./asana";
import { getHubstaffOverview, getHubstaffWeeklyTrend } from "./hubstaff";
import { getAllPods } from "./pods";
import { auTodayISODate } from "@/lib/business-tz";
import { lastNWeekMondays } from "@/lib/iso-week";

export interface BookkeeperClientProjectStat {
  project: string;
  due: number;      // pending tasks whose due date has passed
  upcoming: number;  // pending tasks not yet due, or with no due date
  // Overdue-age breakdown of `due` above — always sums back to it (request
  // 2026-08-19: Bookkeeper Stats' due bar chart now buckets by age, same as
  // Bookkeeper Projects). Passed straight through from getClientProjectBreakdown.
  due0to2: number;
  due3to7: number;
  due8to14: number;
  due15plus: number;
}

export interface BookkeeperRow {
  id: string; // asana_members.id (asana gid) — used to link to the existing per-person Asana page
  name: string;
  email: string;
  pod: string | null;
  clientProjects: BookkeeperClientProjectStat[]; // same whole-project ownership as Bookkeeper Projects
  hubstaffHoursToday: number | null;
  hubstaffActivityPctToday: number | null;
}

export interface BookkeeperStatsResult {
  bookkeepers: BookkeeperRow[];
  pods: { id: string; name: string }[];
  asOfISO: string; // AU business date this snapshot reflects — due/upcoming and "today" are both relative to this
  errors: { asana?: string; hubstaff?: string };
}

// Asana/Hubstaff are fast enough to compute server-side on one page load.
// Hiver is deliberately NOT included here — a full per-bookkeeper
// conversation count needs the same 60-90s sequential inbox sweep
// HiverDashboard does client-side (see useHiverData), which would either
// block this page for a minute or risk the Worker's own execution limit.
// The page component fetches Hiver counts itself, client-side, once loaded.
//
// Rebuilt 2026-08-13 on request to merge Asana and Hubstaff per bookkeeper:
// client-project due/upcoming counts replace the old org-wide open/overdue
// totals (getClientProjectBreakdown is the same whole-project-ownership model
// Bookkeeper Projects uses, so a client's due/upcoming here always matches
// what that section shows), and Hubstaff is pinned to today specifically
// (not a configurable trailing window) per explicit request.
export async function getBookkeeperStats(): Promise<BookkeeperStatsResult> {
  const admin = createAdminClient();
  const [{ data: members }, allPods, clientProjects, hubstaff] = await Promise.all([
    admin.from("asana_members").select("id, name, email, pods!asana_members_pod_id_fkey(name)"),
    getAllPods(),
    getClientProjectBreakdown(),
    getHubstaffOverview(1, 1),
  ]);

  const asanaOk = !clientProjects.error;
  const hubstaffOk = !hubstaff.error;

  const projectsByAssignee = new Map(clientProjects.rows.map((r) => [r.assigneeId, r.projects]));
  const hubstaffByEmail = new Map(hubstaff.members.map((m) => [m.email.toLowerCase(), m]));

  const bookkeepers: BookkeeperRow[] = (members ?? [])
    .map((m) => {
      const id = m.id as string;
      const email = ((m.email as string) ?? "").toLowerCase();
      const pod = (m as unknown as { pods: { name: string } | null }).pods?.name ?? null;
      const hubStat = hubstaffByEmail.get(email);
      return {
        id,
        name: m.name as string,
        email,
        pod,
        clientProjects: asanaOk ? (projectsByAssignee.get(id) ?? []) : [],
        hubstaffHoursToday: hubstaffOk ? (hubStat?.hours ?? 0) : null,
        hubstaffActivityPctToday: hubstaffOk ? (hubStat?.activityPct ?? null) : null,
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));

  return {
    bookkeepers,
    pods: allPods,
    asOfISO: auTodayISODate(),
    errors: {
      asana: clientProjects.error,
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
