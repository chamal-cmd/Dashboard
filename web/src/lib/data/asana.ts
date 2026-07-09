import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { mean, median, coefficientOfVariationPct, round1, roundInt } from "@/lib/stats";

const DAY_MS = 86400000;

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

export interface TrackerStat {
  key: string;
  label: string;
  open: number | null;
  total: number | null;
  completedInRange: number | null;
}

export interface NameCount {
  name: string;
  open: number;
  // Asana assignee gid — present on topAssignees so the UI can link to the
  // per-person drilldown page.
  id?: string;
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
  assigneeName: string | null;
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
  topClients: NameCount[];
  topPods: PodStat[];
  overdueTasks: AsanaTask[];
  dueSoonTasks: AsanaTask[];
  recentCompletions: AsanaTask[];
  recentlyModified: AsanaTask[];
  velocity: AsanaVelocity | null;
  error?: string;
}

type RawTask = {
  id: string;
  name: string;
  project_name: string | null;
  assignee_name: string | null;
  pod_id: string | null;
  due_on: string | null;
  completed: boolean;
  completed_at: string | null;
  created_at: string;
  modified_at: string;
};

function mapTask(r: RawTask): AsanaTask {
  return {
    id: r.id,
    name: r.name,
    projectName: r.project_name,
    assigneeName: r.assignee_name,
    dueOn: r.due_on,
    completedAt: r.completed_at,
    createdAt: r.created_at,
    modifiedAt: r.modified_at,
  };
}

// Page through all open tasks for aggregate counts (PostgREST cap = 1000).
// Pulls created_at + due_on too so age/workload/overdue-by-pod stats need no extra query.
async function fetchAllOpenTasks(admin: ReturnType<typeof createAdminClient>) {
  const rows: { assignee_id: string | null; assignee_name: string | null; project_name: string | null; pod_id: string | null; created_at: string; due_on: string | null }[] = [];
  const PAGE = 1000;
  for (let offset = 0; ; offset += PAGE) {
    const { data, error } = await admin
      .from("asana_tasks")
      .select("assignee_id, assignee_name, project_name, pod_id, created_at, due_on")
      .eq("completed", false)
      .range(offset, offset + PAGE - 1);
    if (error) throw error;
    rows.push(...(data ?? []));
    if (!data || data.length < PAGE) break;
  }
  return rows;
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
    trackers: [], topAssignees: [], topClients: [], topPods: [],
    overdueTasks: [], dueSoonTasks: [], recentCompletions: [], recentlyModified: [],
    velocity: null,
  };

  try {
    const today = new Date().toISOString().slice(0, 10);
    const dueSoonEnd    = new Date(Date.now() + days * DAY_MS).toISOString().slice(0, 10);
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
      overdueRes,
      dueSoonRes,
      recentDoneRes,
      recentModRes,
    ] = await Promise.all([
      admin.from("asana_tasks").select("id", { count: "exact", head: true }).eq("completed", false),
      admin.from("asana_tasks").select("id", { count: "exact", head: true }).eq("completed", false).lt("due_on", today),
      admin.from("asana_tasks").select("id", { count: "exact", head: true }).eq("completed", false).gte("due_on", today).lte("due_on", dueSoonEnd),
      admin.from("asana_tasks").select("id", { count: "exact", head: true }).eq("completed", true).gte("completed_at", rangeStart),
      admin.from("asana_tasks").select("id", { count: "exact", head: true }).gte("created_at", rangeStart),
      admin.from("asana_tasks").select("id", { count: "exact", head: true }).eq("completed", true).gte("completed_at", prevRangeStart).lt("completed_at", rangeStart),
      fetchAllOpenTasks(admin),
      // Overdue task details
      admin.from("asana_tasks")
        .select("id, name, project_name, assignee_name, pod_id, due_on, completed, completed_at, created_at, modified_at")
        .eq("completed", false)
        .lt("due_on", today)
        .order("due_on", { ascending: true })
        .limit(30),
      // Due soon task details
      admin.from("asana_tasks")
        .select("id, name, project_name, assignee_name, pod_id, due_on, completed, completed_at, created_at, modified_at")
        .eq("completed", false)
        .gte("due_on", today)
        .lte("due_on", dueSoonEnd)
        .order("due_on", { ascending: true })
        .limit(30),
      // Recently completed, within the selected range
      admin.from("asana_tasks")
        .select("id, name, project_name, assignee_name, pod_id, due_on, completed, completed_at, created_at, modified_at")
        .eq("completed", true)
        .gte("completed_at", rangeStart)
        .order("completed_at", { ascending: false })
        .limit(30),
      // Recently modified open tasks, within the selected range
      admin.from("asana_tasks")
        .select("id, name, project_name, assignee_name, pod_id, due_on, completed, completed_at, created_at, modified_at")
        .eq("completed", false)
        .gte("modified_at", rangeStart)
        .order("modified_at", { ascending: false })
        .limit(20),
    ]);

    // Tracker stats — include completions within the selected range
    const TRACKER_PROJECTS = await getTrackerProjects(admin);
    const trackers = await Promise.all(
      TRACKER_PROJECTS.map(async (t) => {
        if (!t.project) return { key: t.key, label: t.label, open: null, total: null, completedInRange: null };
        const [{ count: open }, { count: total }, { count: completedInRange }] = await Promise.all([
          admin.from("asana_tasks").select("id", { count: "exact", head: true }).eq("project_name", t.project).eq("completed", false),
          admin.from("asana_tasks").select("id", { count: "exact", head: true }).eq("project_name", t.project),
          admin.from("asana_tasks").select("id", { count: "exact", head: true }).eq("project_name", t.project).eq("completed", true).gte("completed_at", rangeStartDate),
        ]);
        return { key: t.key, label: t.label, open: open ?? 0, total: total ?? 0, completedInRange: completedInRange ?? 0 };
      })
    );

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

    const topClients = topN(openRows.map((r) => r.project_name), 15, (n) => n.toLowerCase().startsWith("gp bookkeeper"));

    // pod_id is a uuid — resolve to pod names for display, but key the
    // aggregation by id so the UI can link through to /dashboard/asana/pod/[id].
    const { data: podRows } = await admin.from("pods").select("id, name");
    const podNames = new Map((podRows ?? []).map((p) => [p.id as string, p.name as string]));
    const podAgg = new Map<string, { name: string; open: number; overdue: number }>();
    for (const r of openRows) {
      if (!r.pod_id) continue;
      const podName = podNames.get(r.pod_id);
      if (!podName) continue;
      const cur = podAgg.get(r.pod_id) ?? { name: podName, open: 0, overdue: 0 };
      cur.open += 1;
      if (r.due_on && r.due_on < today) cur.overdue += 1;
      podAgg.set(r.pod_id, cur);
    }
    const topPods: PodStat[] = Array.from(podAgg.entries())
      .map(([id, v]) => ({ id, ...v }))
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
    const doneRows = (recentDoneRes.data ?? []) as RawTask[];
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
      topClients,
      topPods,
      overdueTasks:      (overdueRes.data  ?? []).map(mapTask),
      dueSoonTasks:      (dueSoonRes.data  ?? []).map(mapTask),
      recentCompletions: (recentDoneRes.data ?? []).map(mapTask),
      recentlyModified:  (recentModRes.data  ?? []).map(mapTask),
      velocity: {
        completedInRange: completedN,
        createdInRange: createdN,
        netInRange: createdN - completedN,
        completedPrevPeriod: completedPrevN,
      },
    };
  } catch {
    return { ...EMPTY, error: "Could not load Asana data" };
  }
}
