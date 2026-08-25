import "server-only";
import { getAllPods } from "./pods";
import { createAdminClient } from "@/lib/supabase/admin";
import { mean, median, coefficientOfVariationPct, round1, roundInt } from "@/lib/stats";
import { auTodayISODate, auDateISODate } from "@/lib/business-tz";
import { isoWeekMonday } from "@/lib/iso-week";
import { isExcludedBookkeeper } from "@/lib/asana-client-map";

const DAY_MS = 86400000;

// Permanent data-scope cutoff: every Asana-derived view in this app must
// ignore tasks created before this date, forever — independent of (and
// stacked on top of) the user-facing Today/7d/30d/90d range pickers below,
// which control recency-of-activity windows, not the overall data scope.
//
// Moved back from 2026-01-01 to 2025-07-01 on request (2026-08-07) so the
// scope starts at the beginning of the Australian financial year FY2025/26,
// matching how the compliance trackers are already organised (Jul–Sep is Q1 —
// see fyQuarterOf in asana-cadence.ts). Measured impact of the move against
// live data on the same day: rows in scope 24,171 -> 45,155, open tasks in
// scope 2,189 -> 2,942. Open-task pagination is unaffected (both sides of
// that jump still page in 3 requests), but it does widen every count and
// backlog-age average — a like-for-like comparison against a figure recorded
// before this date will not match, by design.
export const ASANA_CUTOFF_ISO = "2025-07-01T00:00:00Z";

async function getTrackerProjects(admin: ReturnType<typeof createAdminClient>) {
  const { data } = await admin
    .from("asana_trackers")
    .select("key, label, project_name")
    .eq("active", true)
    .order("sort_order");
  if (data && data.length > 0) return data.map((r) => ({ key: r.key, label: r.label, project: r.project_name as string | null }));
  // Fallback to hardcoded if table doesn't exist yet
  return [
    { key: "monthly_reporting", label: "Monthly reporting tracker", project: "GP Bookkeeper- Fathom Reports Tracker" },
    { key: "superannuation",    label: "Superannuation tracker",    project: "GP Bookkeeper- Superannuation Tracker" },
    { key: "bas_lodgement",     label: "BAS lodgement tracker",     project: "GP Bookkeeper- BAS Lodgement Tracker" },
    { key: "eofy",              label: "EOFY tracker",              project: null as string | null },
  ];
}

// Shared by the org-wide overview and the pod drilldown — same tracker
// projects, optionally scoped to one pod's tasks within each project.
// PostgREST filter fragments for the "Progress overrides the checkbox" rule.
// The value is double-quoted because it contains a space — unquoted, PostgREST
// can misparse it and silently match nothing.
const NOT_NA_FILTER = 'progress.is.null,progress.neq."Not Applicable"';
// Open = a Progress field that isn't Completed, OR no Progress field at all
// with the checkbox unticked.
const OPEN_FILTER =
  'and(progress.not.is.null,progress.neq.Completed),and(progress.is.null,completed.is.false)';

export async function getTrackerStats(
  admin: ReturnType<typeof createAdminClient>,
  rangeStartDate: string,
  filter?: { column: "pod_id"; value: string }
): Promise<TrackerStat[]> {
  const TRACKER_PROJECTS = await getTrackerProjects(admin);
  return Promise.all(
    TRACKER_PROJECTS.map(async (t) => {
      if (!t.project) return { key: t.key, label: t.label, open: null, total: null, completedInRange: null, projectId: null, openTasks: [] };
      // The compliance tracker boards record completion in a "Progress" custom
      // field, NOT the task checkbox — on the live boards the checkbox is left
      // unticked on most finished rows (Fathom: 4 ticked vs 69 Progress=
      // Completed; BAS: 13 vs 77), so counting it reported them as ~0%
      // complete. Where `progress` is present it wins; where it's null (the
      // rest of the workspace has no such field) the checkbox still applies.
      // "Not Applicable" rows are excluded from the tracker entirely — that
      // state means the client didn't need the work, so counting it as either
      // done or outstanding would distort the completion rate.
      const base = () => {
        let q = admin.from("asana_tasks").select("id", { count: "exact", head: true }).eq("project_name", t.project!).gte("created_at", ASANA_CUTOFF_ISO);
        if (filter) q = q.eq(filter.column, filter.value);
        return q.or(NOT_NA_FILTER);
      };
      // Actual open task rows for this tracker — so the UI can break them down
      // by bookkeeper (a bare count or flat list isn't actionable). Open counts
      // per tracker are small (tens), so a single page is plenty.
      let openRowsQ = admin.from("asana_tasks").select(TASK_COLS)
        .eq("project_name", t.project!).gte("created_at", ASANA_CUTOFF_ISO)
        .or("progress.is.null,progress.neq.Not Applicable")
        .or(OPEN_FILTER)
        .order("assignee_name", { ascending: true, nullsFirst: false }).order("due_on", { ascending: true, nullsFirst: false }).order("id", { ascending: true });
      if (filter) openRowsQ = openRowsQ.eq(filter.column, filter.value);

      const [{ count: open }, { count: total }, { count: completedInRange }, gidRes, openRowsRes] = await Promise.all([
        base().or(OPEN_FILTER),
        base(),
        // completedInRange still needs a real completion timestamp, and the
        // Progress field carries none — so this stays checkbox-based and is
        // therefore an undercount on the Progress-driven tracker boards.
        base().eq("completed", true).gte("completed_at", rangeStartDate),
        // One row's project_id is the Asana project gid — same for every task
        // in the project — so the tracker can deep-link to the real Asana
        // project (https://app.asana.com/0/{gid}/list) as client-facing proof.
        admin.from("asana_tasks").select("project_id").eq("project_name", t.project!).not("project_id", "is", null).limit(1).maybeSingle(),
        openRowsQ,
      ]);
      return {
        key: t.key,
        label: t.label,
        open: open ?? 0,
        total: total ?? 0,
        completedInRange: completedInRange ?? 0,
        projectId: (gidRes.data?.project_id as string | undefined) ?? null,
        openTasks: ((openRowsRes.data ?? []) as RawTask[]).map(mapTask),
      };
    })
  );
}

export interface TrackerStat {
  key: string;
  label: string;
  open: number | null;
  total: number | null;
  completedInRange: number | null;
  projectId: string | null; // Asana project gid, for deep-linking to the real project
  openTasks: AsanaTask[];    // this tracker's open tasks, for the per-bookkeeper breakdown
}

// The last `n` calendar months as "YYYY-MM", oldest first, ending with the
// month containing `todayISO`.
function lastNMonths(n: number, todayISO: string): string[] {
  const [y, m] = [Number(todayISO.slice(0, 4)), Number(todayISO.slice(5, 7))];
  const out: string[] = [];
  for (let i = n - 1; i >= 0; i--) {
    const total = y * 12 + (m - 1) - i;
    out.push(`${Math.floor(total / 12)}-${String((total % 12) + 1).padStart(2, "0")}`);
  }
  return out;
}

export interface NameCount {
  name: string;
  open: number;
  // Asana assignee gid — present on topAssignees so the UI can link to the
  // per-person drilldown page.
  id?: string;
}

// Every assignee with at least one open task (unlike topAssignees, which is
// capped to 20) — the Bookkeeper Stats page needs everyone, not just the
// busiest, and needs overdue counts topAssignees doesn't track.
export interface AssigneeFullStat {
  id: string;
  name: string;
  open: number;
  overdue: number;
}

export interface PodStat {
  id: string;
  name: string;
  open: number;
  overdue: number;
}

export interface AsanaTask {
  id: string;
  name: string;
  projectName: string | null;
  assigneeId: string | null;
  assigneeName: string | null;
  podId: string | null;
  dueOn: string | null;
  completedAt: string | null;
  createdAt: string;
  modifiedAt: string;
}

export interface AsanaVelocity {
  completedInRange: number;
  createdInRange: number;
  netInRange: number;          // created - completed, within the selected range
  completedPrevPeriod: number; // completions in the equal-length period immediately before the range — the baseline changeVsPrevPeriodPct compares against
}

export interface AsanaOverview {
  openTotal: number | null;           // every open task in the workspace since the cutoff — internal projects included
  openClient: number | null;          // open tasks on real client projects only
  openInternal: number | null;        // open tasks on internal/admin projects + tasks with no project
  overdueClient: number | null;
  overdueInternal: number | null;
  dueSoonClient: number | null;
  dueSoonInternal: number | null;
  overdueCount: number | null;
  dueSoonCount: number | null;
  overdueRatePct: number | null;      // overdue / open — a count alone means nothing without volume context
  avgOpenTaskAgeDays: number | null;  // mean(today - created_at) across all open tasks
  medianOpenTaskAgeDays: number | null;
  avgCycleTimeDays: number | null;    // mean(completed_at - created_at) for tasks completed within the selected range
  medianCycleTimeDays: number | null;
  workloadImbalancePct: number | null; // coefficient of variation of open-task counts across assignees; higher = less evenly distributed
  paceVsPrevPeriodPct: number | null;  // this range's completion count vs the prior equal-length period
  rangeDays: number;
  rangeLabel: string;
  trackers: TrackerStat[];
  topAssignees: NameCount[];
  byAssignee: AssigneeFullStat[]; // every assignee with open work, uncapped — see AssigneeFullStat
  topClients: NameCount[];
  topPods: PodStat[];
  allPods: { id: string; name: string }[]; // every pod, regardless of open-task count — for a fixed pod switcher, unlike topPods which only lists pods that currently have open work
  allMembers: { id: string; name: string }[]; // full bookkeeper roster (asana_members) — lets the UI turn a roster-attributed NAME back into a person link, since tracker rows carry no assignee of their own
  openTasksSample: AsanaTask[]; // every currently open task org-wide, full TASK_COLS shape, uncapped (naming mirrors asana-pod.ts) — the flat "here are the actual tasks" list backing the Open Tasks KPI tile, unlike topAssignees/topClients/topPods which are grouped breakdowns
  overdueTasks: AsanaTask[];
  dueSoonTasks: AsanaTask[];
  recentCompletions: AsanaTask[];
  recentlyModified: AsanaTask[];
  velocity: AsanaVelocity | null;
  clientBreakdown: ClientStat[];        // open + overdue per client project (internal projects excluded), ranked by open
  monthlyThroughput: ThroughputPoint[]; // created vs completed per calendar month since the data cutoff — EMPTY unless the caller passes opts.includeThroughput (it costs 2 subrequests per month; see getAsanaOverview)
  eofyClients: AsanaTask[];             // per-client rows from the "EOFY FY2026 – Client Tracker" pod projects (projectName distinguishes the pods)
  otherProjects: ClientStat[];          // open + overdue per INTERNAL project not already shown as a tracker/EOFY section
  error?: string;
}

export interface ClientStat {
  name: string;
  open: number;
  overdue: number;
  projectId: string | null; // Asana project gid, for deep-linking to the real project
}

export interface ThroughputPoint {
  month: string; // "YYYY-MM"
  created: number;
  completed: number;
}

// Exported: the org-wide overview and the person/pod drilldown pages
// (asana-person.ts, asana-pod.ts) all map rows to the same AsanaTask shape.
export type RawTask = {
  id: string;
  name: string;
  project_name: string | null;
  assignee_id: string | null;
  assignee_name: string | null;
  pod_id: string | null;
  due_on: string | null;
  completed: boolean;
  completed_at: string | null;
  created_at: string;
  modified_at: string;
};

export const TASK_COLS = "id, name, project_name, assignee_id, assignee_name, pod_id, due_on, completed, completed_at, created_at, modified_at";

export function mapTask(r: RawTask): AsanaTask {
  return {
    id: r.id,
    name: r.name,
    projectName: r.project_name,
    assigneeId: r.assignee_id,
    assigneeName: r.assignee_name,
    podId: r.pod_id,
    dueOn: r.due_on,
    completedAt: r.completed_at,
    createdAt: r.created_at,
    modifiedAt: r.modified_at,
  };
}

export interface OpenTaskRow {
  assignee_id: string | null;
  assignee_name: string | null;
  project_name: string | null;
  project_id: string | null;
  pod_id: string | null;
  created_at: string;
  due_on: string | null;
}

// Pages past PostgREST's default 1000-row cap, which silently truncates a
// single `.range()` call no matter how large a range you ask for. Pass
// `filter` to scope to one person/pod's open tasks (drilldown pages); omit
// it for the org-wide fetch the main overview uses.
export async function fetchAllOpenTasks(
  admin: ReturnType<typeof createAdminClient>,
  filter?: { column: "assignee_id" | "pod_id"; value: string }
): Promise<OpenTaskRow[]> {
  const rows: OpenTaskRow[] = [];
  const PAGE = 1000;
  for (let offset = 0; ; offset += PAGE) {
    let query = admin
      .from("asana_tasks")
      .select("assignee_id, assignee_name, project_name, project_id, pod_id, created_at, due_on")
      .eq("completed", false)
      .gte("created_at", ASANA_CUTOFF_ISO);
    if (filter) query = query.eq(filter.column, filter.value);
    const { data, error } = await query.range(offset, offset + PAGE - 1);
    if (error) throw error;
    rows.push(...((data ?? []) as OpenTaskRow[]));
    if (!data || data.length < PAGE) break;
  }
  return rows;
}

export interface AsanaWeeklyCompletionPoint {
  assigneeId: string;
  weekStartISO: string; // Monday of that ISO week
  count: number;
}

// Weekly completed-task counts per assignee, from `startDateISO` to now —
// powers the Bookkeeper performance-over-time chart. Unassigned completions
// are skipped: there's no single "bookkeeper" to attribute a trend line to.
// Paginated past PostgREST's 1000-row cap with an `id` tiebreaker (the same
// non-deterministic-tie bug class fixed elsewhere in this file) since a wide
// multi-week window can easily exceed 1000 completions.
export async function getAsanaWeeklyCompletions(
  admin: ReturnType<typeof createAdminClient>,
  startDateISO: string
): Promise<{ points: AsanaWeeklyCompletionPoint[]; error?: string }> {
  try {
    const rows: { assignee_id: string | null; completed_at: string }[] = [];
    const PAGE = 1000;
    for (let offset = 0; ; offset += PAGE) {
      const { data, error } = await admin
        .from("asana_tasks")
        .select("assignee_id, completed_at")
        .eq("completed", true)
        .gte("completed_at", startDateISO)
        .gte("created_at", ASANA_CUTOFF_ISO)
        .order("completed_at", { ascending: true })
        .order("id", { ascending: true })
        .range(offset, offset + PAGE - 1);
      if (error) throw error;
      rows.push(...((data ?? []) as { assignee_id: string | null; completed_at: string }[]));
      if (!data || data.length < PAGE) break;
    }

    const byKey = new Map<string, number>(); // `${assigneeId}:${weekMonday}`
    for (const r of rows) {
      if (!r.assignee_id) continue;
      const key = `${r.assignee_id}:${isoWeekMonday(r.completed_at)}`;
      byKey.set(key, (byKey.get(key) ?? 0) + 1);
    }
    const points: AsanaWeeklyCompletionPoint[] = Array.from(byKey.entries()).map(([key, count]) => {
      const sep = key.indexOf(":");
      return { assigneeId: key.slice(0, sep), weekStartISO: key.slice(sep + 1), count };
    });
    return { points };
  } catch (e) {
    return { points: [], error: e instanceof Error ? e.message : String(e) };
  }
}

// Pages a single filtered/ordered asana_tasks query past PostgREST's default
// 1000-row cap — same page-until-short-page loop as fetchAllOpenTasks above,
// but for full TASK_COLS-shaped rows (id/name/etc.) instead of the narrow
// stats-only shape. Used for every task-detail list on the org overview
// (open/overdue/due-soon/recently-completed/recently-modified) so none of
// them are ever silently capped at a small sample — mirrors the identical
// helper already in asana-person.ts.
async function fetchAllTaskRows(
  queryFactory: (from: number, to: number) => PromiseLike<{ data: RawTask[] | null; error: unknown }>
): Promise<RawTask[]> {
  const rows: RawTask[] = [];
  const PAGE = 1000;
  for (let offset = 0; ; offset += PAGE) {
    const { data, error } = await queryFactory(offset, offset + PAGE - 1);
    if (error) throw error;
    rows.push(...((data ?? []) as RawTask[]));
    if (!data || data.length < PAGE) break;
  }
  return rows;
}

// Internal/non-client project names that must never show up in "Top
// Clients" — confirmed live by grepping the full distinct project_name list
// in asana_tasks (2026-07-22). Two shapes of internal project exist:
//  1. Anything starting with "GP Bookkeeper" (any dash style) — org-wide
//     trackers/meetings, already excluded below.
//  2. Anything starting with "Finance" — every one of these in the live data
//     is a per-bookkeeper internal work tracker (e.g. "Finance - (Ridmal)",
//     "Finance (Catherine)", "Finance- Chamal") in several inconsistent
//     punctuation styles; no real client project name starts with "Finance".
// Everything else that isn't a client but also doesn't match either prefix
// gets caught by this explicit denylist instead.
const INTERNAL_PROJECT_DENYLIST = new Set([
  "test",
  "learning materials",
  "ai automations - chamal",
  "gpbk month-end checklist",
  "onboarding a new client (template)",
  "onboarding a new client (top health)",
  "eofy fy2026 – client tracker- jobelle pod",
  "eofy fy2026 – client tracker- ridmal pod",
]);

function isInternalProjectName(name: string): boolean {
  const n = name.trim().toLowerCase();
  return n.startsWith("gp bookkeeper") || n.startsWith("finance") || INTERNAL_PROJECT_DENYLIST.has(n);
}

function topN(rows: (string | null)[], n: number, exclude?: (name: string) => boolean): NameCount[] {
  const counts = new Map<string, number>();
  for (const raw of rows) {
    if (!raw) continue;
    if (exclude?.(raw)) continue;
    counts.set(raw, (counts.get(raw) ?? 0) + 1);
  }
  return Array.from(counts.entries())
    .map(([name, open]) => ({ name, open }))
    .sort((a, b) => b.open - a.open)
    .slice(0, n);
}

// Shared "count open + overdue per key" aggregator — used for the org-wide
// by-pod breakdown here, and for the by-project/by-member breakdowns in
// asana-person.ts / asana-pod.ts. One place defines what "overdue" means.
export function aggregateOpenTasks<T extends { due_on: string | null }>(
  rows: T[],
  keyFn: (r: T) => string,
  today: string
): Map<string, { open: number; overdue: number }> {
  const agg = new Map<string, { open: number; overdue: number }>();
  for (const r of rows) {
    const key = keyFn(r);
    const cur = agg.get(key) ?? { open: 0, overdue: 0 };
    cur.open += 1;
    if (r.due_on && r.due_on < today) cur.overdue += 1;
    agg.set(key, cur);
  }
  return agg;
}

export interface ClientProjectStat {
  project: string;
  due: number;      // pending tasks whose due date has passed
  upcoming: number; // pending tasks not yet due, or with no due date
  // Overdue-age breakdown of `due` above — always sums back to it. Added for
  // the Bookkeeper Projects bar chart (request 2026-08-19: shades of red by
  // how overdue a task is, not a due/upcoming split).
  due0to2: number;
  due3to7: number;
  due8to14: number;
  due15plus: number;
}
export interface AssigneeClientProjects {
  assigneeId: string;
  projects: ClientProjectStat[];
}

// Real per-client Asana projects (e.g. "04. Kim Ching- Northeast General
// Practice Services Pty Ltd") are a DIFFERENT thing from the Fathom/BAS/EOFY
// compliance trackers — they're where the actual bookkeeping task volume
// lives, and a client's tracker row doesn't reliably name-match their project
// (checked live: most EOFY client names had zero or multiple spurious
// matches against the project list).
//
// Three patterns cover it, all verified live: the leading "NN. " numbering
// every per-client project has (e.g. "04. Kim Ching..."); "Finance -
// (Name)" / "Finance (Name)" — initially assumed to be an internal admin
// board and excluded (2026-08-10), which was wrong: checked live 2026-08-11
// across 5 bookkeepers and it holds the BULK of their real client task
// volume (999/1000, 979/1000, 848/1000 sampled tasks respectively) — for
// anyone without a numbered project per client, this is their one catch-all
// board covering several clients at once, not a single client's own project
// (see displayProjectLabel in BookkeeperProjectsPreview.tsx, which relabels
// it accordingly rather than showing a person's name as if it were a
// client); and "automation" (e.g. "AI automations - Chamal") — also
// initially assumed non-billable/excluded, also corrected on request
// (2026-08-11): it counts as this bookkeeper's work too. The rest of the
// org's genuinely internal/personal projects (campaign/template/scratch
// names) still don't match any of the three.
//
// The Finance branch spells its word-boundary out as a character class
// rather than using \b. This is a fix for a real, previously-live bug found
// 2026-08-13: PostgREST's `match` filter runs through Postgres's own regex
// engine (POSIX/ARE), where \b does NOT mean word-boundary the way it does
// in JavaScript — confirmed live that `project_name ~ '^Finance\b'` matched
// ZERO rows against every single Finance board tested, including ones long
// assumed working (verified against "Finance (Catherine)", "Finance -
// (John)", "Finance- Chamal"). Since this regex only ever ran against
// Postgres (via PostgREST) and not in JS, the \b mistake was invisible
// everywhere except a live query — every Finance board has been silently
// excluded from Bookkeeper Projects since the 2026-08-11 fix that was meant
// to include them. Postgres's own word-boundary escape is \y, but \y is not
// valid in JavaScript regex (silently becomes a literal "y", since this same
// constant also gets run through `new RegExp()` locally in this file and in
// admin/client-projects/candidates/route.ts) — so neither \b nor \y works in
// both places at once. A negated character class (non-alnum-or-underscore,
// or end of string) means the same thing as \b/\y in both regex dialects
// without relying on either engine's own boundary escape, so it works
// identically in both — verified live against Postgres and locally in JS.
export const CLIENT_PROJECT_REGEX = "^[0-9]+\\.|^Finance([^A-Za-z0-9_]|$)|[Aa]utomation";

// Some client boards (checked live 2026-08-12: 43 pending tasks across 3
// projects — "34. Linsey King- Mokare Unit Trust", "05. Prajna Kosaraju-
// The Trustee for KSP Medical Services", "48. Caitlin Crowden- Plantagenet
// Medical") never use Asana's own due-date field at all — instead each
// recurring task is named after its own period, e.g. "17 July 2026" or "08
// Aug 2025". Every one of the 43 sampled turned out to already be overdue
// once that date is recovered, so treating them as "no due date" (the
// previous behaviour) was silently hiding real overdue work as Upcoming.
// Anchored to the WHOLE (trimmed) name so a normal task that merely
// mentions a date in passing is never affected — only fires when the name
// contains nothing but a date.
const MONTH_NAMES: Record<string, number> = {
  jan: 0, january: 0, feb: 1, february: 1, mar: 2, march: 2, apr: 3, april: 3,
  may: 4, jun: 5, june: 5, jul: 6, july: 6, aug: 7, august: 7,
  sep: 8, sept: 8, september: 8, oct: 9, october: 9, nov: 10, november: 10, dec: 11, december: 11,
};
function parseDateFromTaskName(name: string): string | null {
  const m = name.trim().match(/^(\d{1,2})\s+([A-Za-z]{3,9})\.?\s+(\d{4})$/);
  if (!m) return null;
  const day = Number(m[1]);
  const month = MONTH_NAMES[m[2].toLowerCase()];
  const year = Number(m[3]);
  if (month === undefined || day < 1 || day > 31) return null;
  return `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

type ClientTaskRow = { assignee_id: string | null; project_name: string | null; due_on: string | null; name: string };

interface ProjectOwnership {
  due: number;
  upcoming: number;
  due0to2: number;
  due3to7: number;
  due8to14: number;
  due15plus: number;
  owner: string | null;
}

// Whole days between two YYYY-MM-DD date strings (today minus dueOn) — both
// are plain calendar dates with no time component, so this is exact and
// timezone-independent as long as callers pass dates from the same clock
// (auTodayISODate everywhere else in this file).
function daysOverdue(todayISO: string, dueOnISO: string): number {
  const [ty, tm, td] = todayISO.split("-").map(Number);
  const [dy, dm, dd] = dueOnISO.split("-").map(Number);
  return Math.round((Date.UTC(ty, tm - 1, td) - Date.UTC(dy, dm - 1, dd)) / 86400000);
}

// Attributes each client project WHOLE to one bookkeeper, rather than
// splitting it task-by-task by individual assignee. Necessary because most
// client projects have the bulk of their tasks unassigned in Asana (checked
// live 2026-08-11 across all 21 numbered projects: 13 of them are
// majority-unassigned, several over 99% — "15. Emma Johns" is 3764/3805) —
// per-task grouping was silently dropping nearly all of a project's real
// volume, visible only for the small sliver anyone happened to be assigned.
// Ownership priority: (1) an explicit settings -> Client Projects
// registration always wins; (2) otherwise, whoever holds the most of
// whatever tasks DO have an assignee in that project — even a small assigned
// fraction reliably points at the real owner; (3) a project with neither
// (no registration, zero assigned tasks) has no signal at all and is left
// unattributed rather than guessed at.
async function resolveClientProjectOwnership(admin: ReturnType<typeof createAdminClient>): Promise<Map<string, ProjectOwnership>> {
  // Missing table (migration not run yet) just means no overrides, not a
  // broken page — data stays null rather than throwing.
  const { data: registered } = await admin.from("client_projects").select("asana_project_name, bookkeeper_member_id");
  const registeredNames = (registered ?? []).map((r) => r.asana_project_name as string);
  const overrideByProject = new Map(
    (registered ?? [])
      .filter((r) => r.bookkeeper_member_id)
      .map((r) => [r.asana_project_name as string, r.bookkeeper_member_id as string])
  );

  // Pending only (completed=false) — completed tasks were previously fetched
  // too but immediately discarded (due/upcoming never counted them; only
  // assigneeCounts did). Filtering at the query fixed a real production
  // outage found live 2026-08-13: the day this file's Finance-board regex
  // was corrected (see CLIENT_PROJECT_REGEX above), the matched row count
  // jumped from ~8.5k to ~45.7k — of which only ~1.9k were pending — so
  // paginating ALL of them here (46 sequential pages instead of 2) blew well
  // past Cloudflare's 50-subrequest-per-invocation cap on this Worker's plan
  // and took the whole Bookkeeper Projects tab down. Ownership resolution
  // (assigneeCounts below) now reflects each project's CURRENT pending
  // assignee distribution rather than its full all-time history — a better
  // signal for "who owns this client's work right now" anyway, not just a
  // performance tradeoff.
  const rows: ClientTaskRow[] = [];
  const PAGE = 1000;
  for (let offset = 0; ; offset += PAGE) {
    const { data, error } = await admin
      .from("asana_tasks")
      .select("assignee_id, project_name, due_on, name")
      .filter("project_name", "match", CLIENT_PROJECT_REGEX)
      .eq("completed", false)
      .gte("created_at", ASANA_CUTOFF_ISO)
      .range(offset, offset + PAGE - 1);
    if (error) throw error;
    rows.push(...((data ?? []) as ClientTaskRow[]));
    if (!data || data.length < PAGE) break;
  }
  // Registered names the regex above wouldn't have caught — the whole reason
  // they need registering.
  const regex = new RegExp(CLIENT_PROJECT_REGEX);
  const unregexed = registeredNames.filter((n) => !regex.test(n));
  if (unregexed.length > 0) {
    for (let offset = 0; ; offset += PAGE) {
      const { data, error } = await admin
        .from("asana_tasks")
        .select("assignee_id, project_name, due_on, name")
        .in("project_name", unregexed)
        .eq("completed", false)
        .gte("created_at", ASANA_CUTOFF_ISO)
        .range(offset, offset + PAGE - 1);
      if (error) throw error;
      rows.push(...((data ?? []) as ClientTaskRow[]));
      if (!data || data.length < PAGE) break;
    }
  }

  // Every row here is already pending (filtered at the query above) — mirrors
  // the BookkeeperModal drill-down's own classification exactly, so the bar
  // charts and the task list they expand into always agree.
  const today = auTodayISODate();
  const byProject = new Map<string, {
    due0to2: number; due3to7: number; due8to14: number; due15plus: number; upcoming: number;
    assigneeCounts: Map<string, number>;
  }>();
  for (const r of rows) {
    const project = r.project_name ?? "(no project)";
    const entry = byProject.get(project) ?? { due0to2: 0, due3to7: 0, due8to14: 0, due15plus: 0, upcoming: 0, assigneeCounts: new Map<string, number>() };
    const dueOn = r.due_on ?? parseDateFromTaskName(r.name);
    if (dueOn && dueOn < today) {
      const age = daysOverdue(today, dueOn);
      if (age <= 2) entry.due0to2 += 1;
      else if (age <= 7) entry.due3to7 += 1;
      else if (age <= 14) entry.due8to14 += 1;
      else entry.due15plus += 1;
    } else {
      entry.upcoming += 1;
    }
    // Departed/excluded people (isExcludedBookkeeper — Ranindu, Shehan, Ryan
    // Sela, etc.) never count toward ownership, even where they're the
    // majority assignee: a project whose ONLY signal is an excluded person
    // is exactly what should disappear from the dashboard, not be kept alive
    // by attributing it to someone no longer here. Falls through to the next
    // real bookkeeper's count if there is one, or stays unattributed if not.
    if (r.assignee_id && !isExcludedBookkeeper(null, r.assignee_id)) {
      entry.assigneeCounts.set(r.assignee_id, (entry.assigneeCounts.get(r.assignee_id) ?? 0) + 1);
    }
    byProject.set(project, entry);
  }

  const result = new Map<string, ProjectOwnership>();
  for (const [project, stats] of byProject.entries()) {
    let owner = overrideByProject.get(project) ?? null;
    if (!owner) {
      let bestCount = 0;
      for (const [assigneeId, count] of stats.assigneeCounts.entries()) {
        if (count > bestCount) { owner = assigneeId; bestCount = count; }
      }
    }
    const due = stats.due0to2 + stats.due3to7 + stats.due8to14 + stats.due15plus;
    result.set(project, {
      due, upcoming: stats.upcoming, owner,
      due0to2: stats.due0to2, due3to7: stats.due3to7, due8to14: stats.due8to14, due15plus: stats.due15plus,
    });
  }
  return result;
}

// Matches a bookkeeper's own catch-all board (e.g. "Finance - (Thamuditha)",
// "Finance (Luisa)", "Finance Task List (Jinelle)") — the Finance branch of
// CLIENT_PROJECT_REGEX, isolated so `personalOnly` can filter down to just
// these without touching the numbered-client-project branch.
const FINANCE_PROJECT_REGEX = /^Finance([^A-Za-z0-9_]|$)/i;

// `personalOnly`: restricts to each bookkeeper's OWN Finance board, dropping
// numbered client projects they merely happen to be majority-assignee on
// (changed on request 2026-08-17 — the Bookkeeper Projects tab was mixing a
// bookkeeper's real personal workload with other clients' work attributed to
// them by the majority-assignee heuristic; e.g. Thamuditha's due count was
// 92 across 7 projects, only 47 of which were in her own Finance board).
// Only the two Bookkeeper Projects API routes pass this — getBookkeeperStats
// calls this with no options and keeps the full per-client breakdown it
// explicitly asked for.
export async function getClientProjectBreakdown(opts?: { personalOnly?: boolean }): Promise<{ rows: AssigneeClientProjects[]; error?: string }> {
  try {
    const admin = createAdminClient();
    const ownership = await resolveClientProjectOwnership(admin);

    const byAssignee = new Map<string, Map<string, Omit<ClientProjectStat, "project">>>();
    for (const [project, { due, upcoming, due0to2, due3to7, due8to14, due15plus, owner }] of ownership.entries()) {
      if (!owner) continue; // no registration and no assigned tasks — genuinely unattributable
      if (opts?.personalOnly && !FINANCE_PROJECT_REGEX.test(project)) continue;
      const projects = byAssignee.get(owner) ?? new Map<string, Omit<ClientProjectStat, "project">>();
      projects.set(project, { due, upcoming, due0to2, due3to7, due8to14, due15plus });
      byAssignee.set(owner, projects);
    }

    const result: AssigneeClientProjects[] = Array.from(byAssignee.entries()).map(([assigneeId, projects]) => ({
      assigneeId,
      projects: Array.from(projects.entries())
        .map(([project, counts]) => ({ project, ...counts }))
        .sort((a, b) => a.project.localeCompare(b.project)),
    }));
    return { rows: result };
  } catch (e) {
    return { rows: [], error: e instanceof Error ? e.message : String(e) };
  }
}

export interface ClientProjectTask {
  id: string;
  name: string;
  project: string;
  dueOn: string | null;
}

// Raw PENDING task list behind one bookkeeper's client-project bar charts —
// fetched lazily (only when their row is clicked). Completed tasks are
// excluded at the query itself (changed on request 2026-08-11: the drill-
// down only needs to answer "what's upcoming vs. overdue right now", so
// there's no reason to pull done work over the wire at all). Uses the same
// whole-project ownership as getClientProjectBreakdown (not this
// bookkeeper's own assignee_id) so the popup always matches what the bar
// charts summed: every task in a project they own, including the ones
// nobody individually assigned.
export async function getClientProjectTasksForBookkeeper(assigneeId: string, opts?: { personalOnly?: boolean }): Promise<{ tasks: ClientProjectTask[]; error?: string }> {
  try {
    const admin = createAdminClient();
    const ownership = await resolveClientProjectOwnership(admin);
    const ownedProjects = Array.from(ownership.entries())
      .filter(([project, v]) => v.owner === assigneeId && (!opts?.personalOnly || FINANCE_PROJECT_REGEX.test(project)))
      .map(([project]) => project);
    if (ownedProjects.length === 0) return { tasks: [] };

    const tasks: ClientProjectTask[] = [];
    const PAGE = 1000;
    for (let offset = 0; ; offset += PAGE) {
      const { data, error } = await admin
        .from("asana_tasks")
        .select("id, name, project_name, due_on")
        .in("project_name", ownedProjects)
        .eq("completed", false)
        .gte("created_at", ASANA_CUTOFF_ISO)
        .range(offset, offset + PAGE - 1);
      if (error) throw error;
      const rows = (data ?? []) as { id: string; name: string; project_name: string | null; due_on: string | null }[];
      for (const r of rows) {
        tasks.push({ id: r.id, name: r.name, project: r.project_name ?? "", dueOn: r.due_on ?? parseDateFromTaskName(r.name) });
      }
      if (!data || data.length < PAGE) break;
    }
    return { tasks };
  } catch (e) {
    return { tasks: [], error: e instanceof Error ? e.message : String(e) };
  }
}

// `days` sizes every time-windowed stat: the forward-looking "due soon"
// window, and the backward-looking created/completed/modified windows and
// their prior-period comparison. Snapshot stats (overdue, backlog age,
// workload balance, top-N breakdowns) are about the current state of the
// board and don't have a "window" to filter by, so `days` doesn't touch them.
// `opts.includeThroughput` gates the per-calendar-month created/completed
// series, which costs TWO head-count subrequests per month in the window and
// is the single most expensive thing in this function. It's off by default:
// moving ASANA_CUTOFF_ISO back to 2025-07-01 stopped the cutoff from
// truncating the 12-month window (8 months in scope before, 12 after), taking
// this block from 16 to 24 subrequests on every caller — including the
// combined /dashboard overview, which also fetches Aircall and Hubstaff in
// the same invocation and is already close to the Workers subrequest ceiling
// (see the note in ONBOARDING.md). Only the Insights page renders the series,
// so only it opts in; every other caller now gets `monthlyThroughput: []`.
export async function getAsanaOverview(
  days = 7,
  opts?: { includeThroughput?: boolean }
): Promise<AsanaOverview> {
  const admin = createAdminClient();
  const rangeLabel = days === 1 ? "today" : `last ${days} days`;
  const EMPTY: AsanaOverview = {
    openTotal: null, openClient: null, openInternal: null,
    overdueClient: null, overdueInternal: null, dueSoonClient: null, dueSoonInternal: null, overdueCount: null, dueSoonCount: null,
    overdueRatePct: null, avgOpenTaskAgeDays: null, medianOpenTaskAgeDays: null,
    avgCycleTimeDays: null, medianCycleTimeDays: null,
    workloadImbalancePct: null, paceVsPrevPeriodPct: null,
    rangeDays: days, rangeLabel,
    trackers: [], topAssignees: [], byAssignee: [], topClients: [], topPods: [], allPods: [], allMembers: [],
    openTasksSample: [], overdueTasks: [], dueSoonTasks: [], recentCompletions: [], recentlyModified: [],
    velocity: null, clientBreakdown: [], monthlyThroughput: [], eofyClients: [], otherProjects: [],
  };

  try {
    const today = auTodayISODate();
    const dueSoonEnd    = auDateISODate(days);
    const rangeStart     = new Date(Date.now() - days * DAY_MS).toISOString();
    const rangeStartDate = rangeStart.slice(0, 10);
    const prevRangeStart = new Date(Date.now() - 2 * days * DAY_MS).toISOString();

    const [
      { count: openTotal },
      { count: overdueCount },
      { count: dueSoonCount },
      { count: completedInRange },
      { count: createdInRange },
      { count: completedPrevPeriod },
      openRows,
      openTaskRows,
      overdueRows,
      dueSoonRows,
      doneRows,
      modRows,
    ] = await Promise.all([
      admin.from("asana_tasks").select("id", { count: "exact", head: true }).eq("completed", false).gte("created_at", ASANA_CUTOFF_ISO),
      admin.from("asana_tasks").select("id", { count: "exact", head: true }).eq("completed", false).lt("due_on", today).gte("created_at", ASANA_CUTOFF_ISO),
      admin.from("asana_tasks").select("id", { count: "exact", head: true }).eq("completed", false).gte("due_on", today).lte("due_on", dueSoonEnd).gte("created_at", ASANA_CUTOFF_ISO),
      admin.from("asana_tasks").select("id", { count: "exact", head: true }).eq("completed", true).gte("completed_at", rangeStart).gte("created_at", ASANA_CUTOFF_ISO),
      admin.from("asana_tasks").select("id", { count: "exact", head: true }).gte("created_at", rangeStart).gte("created_at", ASANA_CUTOFF_ISO),
      admin.from("asana_tasks").select("id", { count: "exact", head: true }).eq("completed", true).gte("completed_at", prevRangeStart).lt("completed_at", rangeStart).gte("created_at", ASANA_CUTOFF_ISO),
      fetchAllOpenTasks(admin),
      // Full TASK_COLS shape of every currently open task, org-wide — source
      // for the flat "All Open Tasks" table so every row can link to Asana.
      // Fully paginated (see fetchAllTaskRows), never capped.
      fetchAllTaskRows((from, to) =>
        admin.from("asana_tasks")
          .select(TASK_COLS)
          .eq("completed", false)
          .gte("created_at", ASANA_CUTOFF_ISO)
          .order("due_on", { ascending: true, nullsFirst: false })
          // Secondary sort on the unique id: without it, the huge block of
          // due_on-null (and same-due_on) rows has no deterministic order, so
          // tied rows straddling a .range() page boundary get duplicated on
          // one page and dropped from the next — silently losing real tasks.
          .order("id", { ascending: true })
          .range(from, to)
      ),
      // Overdue task details — fully paginated, never capped.
      fetchAllTaskRows((from, to) =>
        admin.from("asana_tasks")
          .select(TASK_COLS)
          .eq("completed", false)
          .lt("due_on", today)
          .gte("created_at", ASANA_CUTOFF_ISO)
          .order("due_on", { ascending: true })
          .order("id", { ascending: true })
          .range(from, to)
      ),
      // Due soon task details — fully paginated, never capped.
      fetchAllTaskRows((from, to) =>
        admin.from("asana_tasks")
          .select(TASK_COLS)
          .eq("completed", false)
          .gte("due_on", today)
          .lte("due_on", dueSoonEnd)
          .gte("created_at", ASANA_CUTOFF_ISO)
          .order("due_on", { ascending: true })
          .order("id", { ascending: true })
          .range(from, to)
      ),
      // Recently completed, within the selected range — fully paginated, never capped.
      fetchAllTaskRows((from, to) =>
        admin.from("asana_tasks")
          .select(TASK_COLS)
          .eq("completed", true)
          .gte("completed_at", rangeStart)
          .gte("created_at", ASANA_CUTOFF_ISO)
          .order("completed_at", { ascending: false })
          .order("id", { ascending: true })
          .range(from, to)
      ),
      // Recently modified open tasks, within the selected range — fully paginated, never capped.
      fetchAllTaskRows((from, to) =>
        admin.from("asana_tasks")
          .select(TASK_COLS)
          .eq("completed", false)
          .gte("modified_at", rangeStart)
          .gte("created_at", ASANA_CUTOFF_ISO)
          .order("modified_at", { ascending: false })
          .order("id", { ascending: true })
          .range(from, to)
      ),
    ]);

    // Five independent fetch groups — trackers, EOFY rows, the tracker
    // config, monthly throughput counts, and the pod roster. They used to
    // run one-after-another, which added whole seconds to every page render;
    // nothing here depends on anything else, so they run as one batch.
    const throughputMonths = lastNMonths(12, today).filter((m) => m >= ASANA_CUTOFF_ISO.slice(0, 7));
    const [trackers, eofyRowsRes, trackerProjectList, monthlyThroughput, allPods, membersRes] = await Promise.all([
      // Tracker stats — include completions within the selected range
      getTrackerStats(admin, rangeStartDate),
      // EOFY per-client tracker rows (one task per client, split across the
      // pod-scoped "EOFY FY2026 – Client Tracker- <Pod>" projects). No cutoff
      // filter: these projects are small (~35 rows) and some rows predate it.
      admin
        .from("asana_tasks")
        .select(TASK_COLS)
        .ilike("project_name", "%EOFY%Client Tracker%")
        .order("project_name", { ascending: true })
        .order("name", { ascending: true }),
      getTrackerProjects(admin),
      // Org throughput per calendar month since the data cutoff — cheap
      // head-count pairs per month rather than pulling tens of thousands of rows.
      // (A single scan of created_at/completed_at over the same window would be
      // ~45k rows / 46 pages against the 2025-07-01 cutoff, so the per-month
      // head counts really are the cheaper shape here — they're just skipped
      // entirely unless a caller asks for them. See opts.includeThroughput.)
      Promise.all(
        (opts?.includeThroughput ? throughputMonths : []).map(async (month): Promise<ThroughputPoint> => {
          const [y, mo] = [Number(month.slice(0, 4)), Number(month.slice(5, 7))];
          const start = `${month}-01T00:00:00Z`;
          const end = `${mo === 12 ? y + 1 : y}-${String(mo === 12 ? 1 : mo + 1).padStart(2, "0")}-01T00:00:00Z`;
          const [{ count: created }, { count: completed }] = await Promise.all([
            admin.from("asana_tasks").select("id", { count: "exact", head: true }).gte("created_at", start).lt("created_at", end),
            admin.from("asana_tasks").select("id", { count: "exact", head: true }).eq("completed", true).gte("completed_at", start).lt("completed_at", end).gte("created_at", ASANA_CUTOFF_ISO),
          ]);
          return { month, created: created ?? 0, completed: completed ?? 0 };
        })
      ),
      getAllPods(),
      // Full bookkeeper roster — used to turn a roster-attributed name back
      // into a person link on the tracker charts (those rows have no assignee).
      admin.from("asana_members").select("id, name"),
    ]);
    const eofyClients = ((eofyRowsRes.data ?? []) as RawTask[]).map(mapTask);
    const allMembers = ((membersRes.data ?? []) as { id: string; name: string }[]).map((m) => ({ id: m.id, name: m.name }));

    // project_name -> project_id, so client/project tables can deep-link to
    // the real Asana project rather than showing a name with no proof behind
    // it. Built once from openRows (first id seen per name wins — a project's
    // gid doesn't change, so this is stable).
    const projectIdByName = new Map<string, string>();
    for (const r of openRows) {
      if (r.project_name && r.project_id && !projectIdByName.has(r.project_name)) {
        projectIdByName.set(r.project_name, r.project_id);
      }
    }

    // Internal projects with open work that aren't already surfaced as a
    // tracker or the EOFY client trackers — the "everything else" bucket.
    const trackerProjectNames = new Set(
      trackerProjectList.map((t) => t.project).filter((p): p is string => !!p)
    );
    const otherAgg = aggregateOpenTasks(
      openRows.filter((r) =>
        r.project_name &&
        isInternalProjectName(r.project_name) &&
        !trackerProjectNames.has(r.project_name) &&
        !/eofy.*client tracker/i.test(r.project_name)
      ),
      (r) => r.project_name!,
      today
    );
    const otherProjects: ClientStat[] = Array.from(otherAgg.entries())
      .map(([name, v]) => ({ name, ...v, projectId: projectIdByName.get(name) ?? null }))
      .sort((a, b) => b.open - a.open);

    // Assignees keyed by gid so the UI can link to /dashboard/asana/person/[id].
    const assigneeAgg = new Map<string, { name: string; open: number }>();
    for (const r of openRows) {
      if (!r.assignee_id || !r.assignee_name) continue;
      const cur = assigneeAgg.get(r.assignee_id) ?? { name: r.assignee_name, open: 0 };
      cur.open += 1;
      assigneeAgg.set(r.assignee_id, cur);
    }
    const topAssignees: NameCount[] = Array.from(assigneeAgg.entries())
      .map(([id, v]) => ({ id, name: v.name, open: v.open }))
      .sort((a, b) => b.open - a.open)
      .slice(0, 20);

    // Uncapped version of the above, with overdue counts too — topAssignees
    // stays as-is (only ever used for a top-20 display) since it's already
    // wired into the main overview page.
    const assigneeOverdueCounts = aggregateOpenTasks(
      openRows.filter((r): r is typeof r & { assignee_id: string } => !!r.assignee_id),
      (r) => r.assignee_id,
      today
    );
    const byAssignee: AssigneeFullStat[] = Array.from(assigneeAgg.entries())
      .map(([id, v]) => ({ id, name: v.name, open: v.open, overdue: assigneeOverdueCounts.get(id)?.overdue ?? 0 }))
      .sort((a, b) => b.open - a.open);

    // Client vs internal split. The headline "open tasks" figure was counting
    // everything in the workspace — and ~3/4 of it is internal: each
    // bookkeeper has a personal "Finance (Name)" project (1,200+ open items
    // on its own), plus meeting trackers, onboarding, a "test" project and
    // loose tasks with no project at all. Lumping those in under a label
    // saying "all clients" materially overstated client workload, so the
    // counts are split here. Derived from openRows — no extra queries.
    const isClientRow = (r: OpenTaskRow) => !!r.project_name && !isInternalProjectName(r.project_name);
    const clientRows = openRows.filter(isClientRow);
    const internalRows = openRows.filter((r) => !isClientRow(r)); // includes project-less tasks
    const countOverdue = (rows: OpenTaskRow[]) => rows.filter((r) => r.due_on && r.due_on < today).length;
    const countDueSoon = (rows: OpenTaskRow[]) => rows.filter((r) => r.due_on && r.due_on >= today && r.due_on <= dueSoonEnd).length;

    const split = {
      openClient: clientRows.length,
      openInternal: internalRows.length,
      overdueClient: countOverdue(clientRows),
      overdueInternal: countOverdue(internalRows),
      dueSoonClient: countDueSoon(clientRows),
      dueSoonInternal: countDueSoon(internalRows),
    };

    const topClients = topN(openRows.map((r) => r.project_name), 15, isInternalProjectName);

    // Client-level open + overdue (internal projects excluded) — reuses the
    // openRows already fetched, so no extra queries.
    const clientAgg = aggregateOpenTasks(
      openRows.filter((r) => r.project_name && !isInternalProjectName(r.project_name)),
      (r) => r.project_name!,
      today
    );
    const clientBreakdown: ClientStat[] = Array.from(clientAgg.entries())
      .map(([name, v]) => ({ name, ...v, projectId: projectIdByName.get(name) ?? null }))
      .sort((a, b) => b.open - a.open)
      .slice(0, 20);

    // pod_id is a uuid — resolve to pod names for display, but key the
    // aggregation by id so the UI can link through to /dashboard/asana/pod/[id].
    const podNames = new Map(allPods.map((p) => [p.id, p.name]));
    const podCounts = aggregateOpenTasks(
      openRows.filter((r) => r.pod_id && podNames.has(r.pod_id)),
      (r) => r.pod_id!,
      today
    );
    const topPods: PodStat[] = Array.from(podCounts.entries())
      .map(([id, v]) => ({ id, name: podNames.get(id)!, ...v }))
      .sort((a, b) => b.open - a.open)
      .slice(0, 10);

    const completedN = completedInRange ?? 0;
    const createdN = createdInRange ?? 0;
    const completedPrevN = completedPrevPeriod ?? 0;

    // Overdue count alone is meaningless without knowing the total pool it's
    // drawn from — 10 overdue out of 15 open is a fire, 10 out of 500 isn't.
    const overdueRatePct = openTotal && openTotal > 0 ? round1(((overdueCount ?? 0) / openTotal) * 100) : null;

    // Age of every currently-open task (backlog staleness) — reuses the same
    // rows already pulled for top-assignee/client/pod counts.
    const nowMs = Date.now();
    const openAgesDays = openRows.map((r) => (nowMs - new Date(r.created_at).getTime()) / DAY_MS);
    const avgOpenTaskAgeDays = openAgesDays.length > 0 ? round1(mean(openAgesDays)!) : null;
    const medianOpenTaskAgeDays = openAgesDays.length > 0 ? round1(median(openAgesDays)!) : null;

    // Cycle time (creation → completion) for tasks actually finished in the
    // last 30 days — how long work takes in practice, not just how much of
    // it gets done.
    const cycleTimesDays = doneRows
      .filter((r) => r.completed_at)
      .map((r) => (new Date(r.completed_at!).getTime() - new Date(r.created_at).getTime()) / DAY_MS)
      .filter((d) => d >= 0);
    const avgCycleTimeDays = cycleTimesDays.length > 0 ? round1(mean(cycleTimesDays)!) : null;
    const medianCycleTimeDays = cycleTimesDays.length > 0 ? round1(median(cycleTimesDays)!) : null;

    // Workload balance across the FULL assignee list (not just the top-20
    // slice used for display) — coefficient of variation normalizes spread
    // by team size so a 5-person pod and a 15-person pod are comparable.
    const openCountsByAssignee = new Map<string, number>();
    for (const r of openRows) {
      if (!r.assignee_name) continue;
      openCountsByAssignee.set(r.assignee_name, (openCountsByAssignee.get(r.assignee_name) ?? 0) + 1);
    }
    const workloadImbalancePct = openCountsByAssignee.size > 1
      ? round1(coefficientOfVariationPct(Array.from(openCountsByAssignee.values()))!)
      : null;

    // Is this range's completion count ahead of or behind the equal-length
    // period right before it? Generalizes to any custom range, unlike a
    // fixed week-vs-trailing-month comparison.
    const paceVsPrevPeriodPct = completedPrevN > 0 ? roundInt(((completedN / completedPrevN) - 1) * 100) : null;

    return {
      openTotal: openTotal ?? 0,
      ...split,
      overdueCount: overdueCount ?? 0,
      dueSoonCount: dueSoonCount ?? 0,
      overdueRatePct,
      avgOpenTaskAgeDays,
      medianOpenTaskAgeDays,
      avgCycleTimeDays,
      medianCycleTimeDays,
      workloadImbalancePct,
      paceVsPrevPeriodPct,
      rangeDays: days,
      rangeLabel,
      trackers,
      topAssignees,
      byAssignee,
      topClients,
      topPods,
      allPods,
      allMembers,
      openTasksSample:   openTaskRows.map(mapTask),
      overdueTasks:      overdueRows.map(mapTask),
      dueSoonTasks:      dueSoonRows.map(mapTask),
      recentCompletions: doneRows.map(mapTask),
      recentlyModified:  modRows.map(mapTask),
      velocity: {
        completedInRange: completedN,
        createdInRange: createdN,
        netInRange: createdN - completedN,
        completedPrevPeriod: completedPrevN,
      },
      clientBreakdown,
      monthlyThroughput,
      eofyClients,
      otherProjects,
    };
  } catch {
    return { ...EMPTY, error: "Could not load Asana data" };
  }
}
