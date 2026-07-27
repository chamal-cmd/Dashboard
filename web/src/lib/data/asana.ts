import "server-only";
import { getAllPods } from "./pods";
import { createAdminClient } from "@/lib/supabase/admin";
import { mean, median, coefficientOfVariationPct, round1, roundInt } from "@/lib/stats";
import { auTodayISODate, auDateISODate } from "@/lib/business-tz";
import { isoWeekMonday } from "@/lib/iso-week";

const DAY_MS = 86400000;

// Permanent data-scope cutoff: every Asana-derived view in this app must
// ignore tasks created before this date, forever — independent of (and
// stacked on top of) the user-facing Today/7d/30d/90d range pickers below,
// which control recency-of-activity windows, not the overall data scope.
export const ASANA_CUTOFF_ISO = "2026-01-01T00:00:00Z";

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
export async function getTrackerStats(
  admin: ReturnType<typeof createAdminClient>,
  rangeStartDate: string,
  filter?: { column: "pod_id"; value: string }
): Promise<TrackerStat[]> {
  const TRACKER_PROJECTS = await getTrackerProjects(admin);
  return Promise.all(
    TRACKER_PROJECTS.map(async (t) => {
      if (!t.project) return { key: t.key, label: t.label, open: null, total: null, completedInRange: null, projectId: null, openTasks: [] };
      const base = () => {
        let q = admin.from("asana_tasks").select("id", { count: "exact", head: true }).eq("project_name", t.project!).gte("created_at", ASANA_CUTOFF_ISO);
        if (filter) q = q.eq(filter.column, filter.value);
        return q;
      };
      // Actual open task rows for this tracker — so the UI can break them down
      // by bookkeeper (a bare count or flat list isn't actionable). Open counts
      // per tracker are small (tens), so a single page is plenty.
      let openRowsQ = admin.from("asana_tasks").select(TASK_COLS)
        .eq("project_name", t.project!).eq("completed", false).gte("created_at", ASANA_CUTOFF_ISO)
        .order("assignee_name", { ascending: true, nullsFirst: false }).order("due_on", { ascending: true, nullsFirst: false }).order("id", { ascending: true });
      if (filter) openRowsQ = openRowsQ.eq(filter.column, filter.value);

      const [{ count: open }, { count: total }, { count: completedInRange }, gidRes, openRowsRes] = await Promise.all([
        base().eq("completed", false),
        base(),
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
  openTotal: number | null;
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
  openTasksSample: AsanaTask[]; // every currently open task org-wide, full TASK_COLS shape, uncapped (naming mirrors asana-pod.ts) — the flat "here are the actual tasks" list backing the Open Tasks KPI tile, unlike topAssignees/topClients/topPods which are grouped breakdowns
  overdueTasks: AsanaTask[];
  dueSoonTasks: AsanaTask[];
  recentCompletions: AsanaTask[];
  recentlyModified: AsanaTask[];
  velocity: AsanaVelocity | null;
  clientBreakdown: ClientStat[];        // open + overdue per client project (internal projects excluded), ranked by open
  monthlyThroughput: ThroughputPoint[]; // created vs completed per calendar month since the data cutoff
  eofyClients: AsanaTask[];             // per-client rows from the "EOFY FY2026 – Client Tracker" pod projects (projectName distinguishes the pods)
  otherProjects: ClientStat[];          // open + overdue per INTERNAL project not already shown as a tracker/EOFY section
  error?: string;
}

export interface ClientStat {
  name: string;
  open: number;
  overdue: number;
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
      .select("assignee_id, assignee_name, project_name, pod_id, created_at, due_on")
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

// `days` sizes every time-windowed stat: the forward-looking "due soon"
// window, and the backward-looking created/completed/modified windows and
// their prior-period comparison. Snapshot stats (overdue, backlog age,
// workload balance, top-N breakdowns) are about the current state of the
// board and don't have a "window" to filter by, so `days` doesn't touch them.
export async function getAsanaOverview(days = 7): Promise<AsanaOverview> {
  const admin = createAdminClient();
  const rangeLabel = days === 1 ? "today" : `last ${days} days`;
  const EMPTY: AsanaOverview = {
    openTotal: null, overdueCount: null, dueSoonCount: null,
    overdueRatePct: null, avgOpenTaskAgeDays: null, medianOpenTaskAgeDays: null,
    avgCycleTimeDays: null, medianCycleTimeDays: null,
    workloadImbalancePct: null, paceVsPrevPeriodPct: null,
    rangeDays: days, rangeLabel,
    trackers: [], topAssignees: [], byAssignee: [], topClients: [], topPods: [], allPods: [],
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
    const [trackers, eofyRowsRes, trackerProjectList, monthlyThroughput, allPods] = await Promise.all([
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
      Promise.all(
        throughputMonths.map(async (month): Promise<ThroughputPoint> => {
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
    ]);
    const eofyClients = ((eofyRowsRes.data ?? []) as RawTask[]).map(mapTask);

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
      .map(([name, v]) => ({ name, ...v }))
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

    const topClients = topN(openRows.map((r) => r.project_name), 15, isInternalProjectName);

    // Client-level open + overdue (internal projects excluded) — reuses the
    // openRows already fetched, so no extra queries.
    const clientAgg = aggregateOpenTasks(
      openRows.filter((r) => r.project_name && !isInternalProjectName(r.project_name)),
      (r) => r.project_name!,
      today
    );
    const clientBreakdown: ClientStat[] = Array.from(clientAgg.entries())
      .map(([name, v]) => ({ name, ...v }))
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
