import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { mean, median, coefficientOfVariationPct, round1, roundInt } from "@/lib/stats";
import {
  TASK_COLS, mapTask, fetchAllOpenTasks, aggregateOpenTasks, getTrackerStats, ASANA_CUTOFF_ISO,
  type AsanaTask, type RawTask, type TrackerStat,
} from "./asana";
import { auTodayISODate, auDateISODate } from "@/lib/business-tz";

const DAY_MS = 86400000;

export interface PodProjectCount {
  project: string;
  open: number;
  overdue: number;
}

// Pages past PostgREST's default 1000-row cap for the completed-in-range
// query, same pattern as fetchAllOpenTasks in asana.ts — a flat .limit(20)
// here silently dropped every completion outside the 20 most recent
// org/pod-wide, so busy pods showed 0 completions for most members even
// though hundreds of tasks were actually completed in range.
async function fetchAllCompletedInRange(
  admin: ReturnType<typeof createAdminClient>,
  podId: string,
  rangeStart: string
): Promise<RawTask[]> {
  const rows: RawTask[] = [];
  const PAGE = 1000;
  for (let offset = 0; ; offset += PAGE) {
    const { data, error } = await admin
      .from("asana_tasks")
      .select(TASK_COLS)
      .eq("pod_id", podId)
      .eq("completed", true)
      .gte("completed_at", rangeStart)
      .gte("created_at", ASANA_CUTOFF_ISO)
      .order("completed_at", { ascending: false })
      .order("id", { ascending: true })
      .range(offset, offset + PAGE - 1);
    if (error) throw error;
    rows.push(...((data ?? []) as RawTask[]));
    if (!data || data.length < PAGE) break;
  }
  return rows;
}

// Same pagination pattern as fetchAllCompletedInRange above, applied to the
// other three flat task lists on this page (overdue / due soon / recently
// modified) — each of these used to be a flat `.limit(20..30)`, which
// silently capped the list at that many rows org/pod-wide while the KPI
// tile above it (Overdue / Due in next 7 days) came from the fully-paginated
// `openRows` count, so a busy pod's list and its own tile count diverged
// once the pod had more than 20-30 matching tasks.
async function fetchAllOverdueTasks(
  admin: ReturnType<typeof createAdminClient>,
  podId: string,
  today: string
): Promise<RawTask[]> {
  const rows: RawTask[] = [];
  const PAGE = 1000;
  for (let offset = 0; ; offset += PAGE) {
    const { data, error } = await admin
      .from("asana_tasks")
      .select(TASK_COLS)
      .eq("pod_id", podId)
      .eq("completed", false)
      .lt("due_on", today)
      .gte("created_at", ASANA_CUTOFF_ISO)
      .order("due_on", { ascending: true })
      .order("id", { ascending: true })
      .range(offset, offset + PAGE - 1);
    if (error) throw error;
    rows.push(...((data ?? []) as RawTask[]));
    if (!data || data.length < PAGE) break;
  }
  return rows;
}

async function fetchAllDueSoonTasks(
  admin: ReturnType<typeof createAdminClient>,
  podId: string,
  today: string,
  in7: string
): Promise<RawTask[]> {
  const rows: RawTask[] = [];
  const PAGE = 1000;
  for (let offset = 0; ; offset += PAGE) {
    const { data, error } = await admin
      .from("asana_tasks")
      .select(TASK_COLS)
      .eq("pod_id", podId)
      .eq("completed", false)
      .gte("due_on", today)
      .lte("due_on", in7)
      .gte("created_at", ASANA_CUTOFF_ISO)
      .order("due_on", { ascending: true })
      .order("id", { ascending: true })
      .range(offset, offset + PAGE - 1);
    if (error) throw error;
    rows.push(...((data ?? []) as RawTask[]));
    if (!data || data.length < PAGE) break;
  }
  return rows;
}

async function fetchAllRecentlyModified(
  admin: ReturnType<typeof createAdminClient>,
  podId: string,
  rangeStart: string
): Promise<RawTask[]> {
  const rows: RawTask[] = [];
  const PAGE = 1000;
  for (let offset = 0; ; offset += PAGE) {
    const { data, error } = await admin
      .from("asana_tasks")
      .select(TASK_COLS)
      .eq("pod_id", podId)
      .eq("completed", false)
      .gte("modified_at", rangeStart)
      .gte("created_at", ASANA_CUTOFF_ISO)
      .order("modified_at", { ascending: false })
      .order("id", { ascending: true })
      .range(offset, offset + PAGE - 1);
    if (error) throw error;
    rows.push(...((data ?? []) as RawTask[]));
    if (!data || data.length < PAGE) break;
  }
  return rows;
}

// Full AsanaTask-shaped (TASK_COLS) rows for every open task in this pod —
// separate from fetchAllOpenTasks in asana.ts, which only selects the narrow
// columns needed for the aggregation above and doesn't carry `id`/`name`, so
// it can't back a real task list with working Asana deep links. Kept local
// to this file for now; if fetchAllOpenTasks gets broadened to return full
// AsanaTask-shaped rows, this can be dropped in favor of that shared helper.
async function fetchAllOpenTaskRows(
  admin: ReturnType<typeof createAdminClient>,
  podId: string
): Promise<RawTask[]> {
  const rows: RawTask[] = [];
  const PAGE = 1000;
  for (let offset = 0; ; offset += PAGE) {
    const { data, error } = await admin
      .from("asana_tasks")
      .select(TASK_COLS)
      .eq("pod_id", podId)
      .eq("completed", false)
      .gte("created_at", ASANA_CUTOFF_ISO)
      .order("due_on", { ascending: true, nullsFirst: false })
      .order("id", { ascending: true })
      .range(offset, offset + PAGE - 1);
    if (error) throw error;
    rows.push(...((data ?? []) as RawTask[]));
    if (!data || data.length < PAGE) break;
  }
  return rows;
}

export interface PodMemberStat {
  assigneeId: string | null;
  name: string;
  isLeader: boolean;
  total: number;         // open tasks assigned to them
  dueToday: number;
  tomorrow: number;
  pending: number;       // total - dueToday - tomorrow (overdue, later, or no due date)
  completedInRange: number;
}

// Mirrors every metric on AsanaOverview (src/lib/data/asana.ts), scoped to
// one pod. The only org-wide fields deliberately NOT reproduced here are
// topPods (a cross-pod comparison, meaningless inside a single pod's own
// page) and topAssignees/topClients (superseded by `members` and
// `openByProject`, which already carry the same facts with more detail —
// per-person breakdown instead of a flat open count, overdue counts per
// project instead of just open).
export interface AsanaPodDetail {
  podId: string;
  name: string;
  rangeDays: number;
  rangeLabel: string;
  open: number;
  overdue: number;
  overdueRatePct: number | null;
  dueSoon: number;
  completedInRange: number;
  createdInRange: number;
  netInRange: number;                 // created - completed, within the selected range
  completedPrevPeriod: number;
  paceVsPrevPeriodPct: number | null; // this range's completions vs the prior equal-length period
  overallCompletionPct: number | null; // completedInRange / (completedInRange + open)
  avgOpenTaskAgeDays: number | null;
  medianOpenTaskAgeDays: number | null;
  avgCycleTimeDays: number | null;    // mean(completed_at - created_at) for tasks completed within the range
  medianCycleTimeDays: number | null;
  workloadImbalancePct: number | null; // coefficient of variation of open-task counts across this pod's members
  trackers: TrackerStat[];
  openByProject: PodProjectCount[];
  members: PodMemberStat[];
  // Full (uncapped) flat list of every open task in this pod — count always
  // matches `open` above exactly, so it can back a real "click the tile, see
  // every task" list. Named to mirror whatever field AsanaOverview lands on
  // for the equivalent org-wide list (asana.ts); reconcile the name if that
  // ends up different once both land.
  openTasksSample: AsanaTask[];
  overdueTasks: AsanaTask[];
  dueSoonTasks: AsanaTask[];
  recentCompletions: AsanaTask[];
  recentlyModified: AsanaTask[];
}

// Returns null both when the pod doesn't exist and when the lookup itself
// fails — either way the page falls back to its 404 state rather than
// crashing on an unhandled Supabase error.
export async function getAsanaPodDetail(podId: string, days = 7): Promise<AsanaPodDetail | null> {
  try {
    const admin = createAdminClient();
    const rangeLabel = days === 1 ? "today" : `last ${days} days`;

    const today = auTodayISODate();
    const tomorrow = auDateISODate(1);
    const in7 = auDateISODate(7);
    const rangeStart = new Date(Date.now() - days * DAY_MS).toISOString();
    const rangeStartDate = rangeStart.slice(0, 10);
    const prevRangeStart = new Date(Date.now() - 2 * days * DAY_MS).toISOString();

    const { data: pod } = await admin.from("pods").select("name, leader_member_id").eq("id", podId).maybeSingle();
    if (!pod) return null;

    const [
      { count: completedInRange },
      { count: createdInRange },
      { count: completedPrevPeriod },
      openRows,
      openTaskRows,
      overdueRows,
      dueSoonRows,
      completedRows,
      recentModRows,
      trackers,
    ] = await Promise.all([
      admin.from("asana_tasks").select("id", { count: "exact", head: true })
        .eq("pod_id", podId).eq("completed", true).gte("completed_at", rangeStart).gte("created_at", ASANA_CUTOFF_ISO),
      admin.from("asana_tasks").select("id", { count: "exact", head: true })
        .eq("pod_id", podId).gte("created_at", rangeStart).gte("created_at", ASANA_CUTOFF_ISO),
      admin.from("asana_tasks").select("id", { count: "exact", head: true })
        .eq("pod_id", podId).eq("completed", true).gte("completed_at", prevRangeStart).lt("completed_at", rangeStart).gte("created_at", ASANA_CUTOFF_ISO),
      fetchAllOpenTasks(admin, { column: "pod_id", value: podId }),
      fetchAllOpenTaskRows(admin, podId),
      fetchAllOverdueTasks(admin, podId, today),
      fetchAllDueSoonTasks(admin, podId, today, in7),
      fetchAllCompletedInRange(admin, podId, rangeStart),
      fetchAllRecentlyModified(admin, podId, rangeStart),
      getTrackerStats(admin, rangeStartDate, { column: "pod_id", value: podId }),
    ]);

    const overdue = openRows.filter((r) => r.due_on && r.due_on < today).length;
    const dueSoon = openRows.filter((r) => r.due_on && r.due_on >= today && r.due_on <= in7).length;

    const nowMs = Date.now();
    const ages = openRows.map((r) => (nowMs - new Date(r.created_at).getTime()) / DAY_MS);

    const byProjectCounts = aggregateOpenTasks(openRows, (r) => r.project_name ?? "(no project)", today);
    const openByProject = Array.from(byProjectCounts.entries())
      .map(([project, v]) => ({ project, ...v }))
      .sort((a, b) => b.open - a.open);

    // Total/DueToday/Tomorrow/Pending is a strict partition of each
    // member's open tasks — Pending is deliberately "everything else"
    // (overdue, further out, or no due date) so the four numbers always
    // add up to Total with no gaps or double-counting.
    const memberKey = (r: { assignee_id: string | null; assignee_name: string | null }) => r.assignee_id ?? r.assignee_name ?? "unassigned";

    // Per-member completed-in-range needs its own query (open-task rows
    // can't tell us about completed tasks), scoped to this pod + range.
    // Keyed by the SAME memberKey used for the open-task aggregation below —
    // keying by raw assignee_name here (as this used to) silently produced 0
    // for real completions whenever the same person's assignee_name string
    // varied across synced rows (e.g. short name vs full name for the same
    // assignee_id), which happens for real bookkeepers in the live data.
    const completedByAssignee = new Map<string, number>();
    for (const r of completedRows) {
      const key = memberKey(r);
      completedByAssignee.set(key, (completedByAssignee.get(key) ?? 0) + 1);
    }
    const memberAgg = new Map<string, { name: string; total: number; dueToday: number; tomorrow: number }>();
    for (const r of openRows) {
      const key = memberKey(r);
      const cur = memberAgg.get(key) ?? { name: r.assignee_name ?? "Unassigned", total: 0, dueToday: 0, tomorrow: 0 };
      cur.total += 1;
      if (r.due_on === today) cur.dueToday += 1;
      if (r.due_on === tomorrow) cur.tomorrow += 1;
      memberAgg.set(key, cur);
    }
    const leaderAssigneeId = pod.leader_member_id as string | null;
    const members: PodMemberStat[] = Array.from(memberAgg.entries())
      .map(([key, v]) => ({
        assigneeId: key === "unassigned" ? null : key,
        name: v.name,
        isLeader: key === leaderAssigneeId,
        total: v.total,
        dueToday: v.dueToday,
        tomorrow: v.tomorrow,
        pending: v.total - v.dueToday - v.tomorrow,
        completedInRange: completedByAssignee.get(key) ?? 0,
      }))
      .sort((a, b) => (b.isLeader ? 1 : 0) - (a.isLeader ? 1 : 0) || b.total - a.total);

    const completedN = completedInRange ?? 0;
    const createdN = createdInRange ?? 0;
    const completedPrevN = completedPrevPeriod ?? 0;

    const overdueRatePct = openRows.length > 0 ? round1((overdue / openRows.length) * 100) : null;

    const overallCompletionPct = completedN + openRows.length > 0
      ? round1((completedN / (completedN + openRows.length)) * 100)
      : null;

    // Cycle time (creation → completion) for tasks this pod actually
    // finished within the selected range.
    const cycleTimesDays = completedRows
      .filter((r) => r.completed_at)
      .map((r) => (new Date(r.completed_at!).getTime() - new Date(r.created_at).getTime()) / DAY_MS)
      .filter((d) => d >= 0);
    const avgCycleTimeDays = cycleTimesDays.length > 0 ? round1(mean(cycleTimesDays)!) : null;
    const medianCycleTimeDays = cycleTimesDays.length > 0 ? round1(median(cycleTimesDays)!) : null;

    // Workload balance across this pod's own members — same coefficient-of-
    // variation measure the org-wide overview uses across all assignees.
    const memberTotals = members.map((m) => m.total);
    const workloadImbalancePct = memberTotals.length > 1
      ? round1(coefficientOfVariationPct(memberTotals)!)
      : null;

    const paceVsPrevPeriodPct = completedPrevN > 0 ? roundInt(((completedN / completedPrevN) - 1) * 100) : null;

    return {
      podId,
      name: pod.name,
      rangeDays: days,
      rangeLabel,
      open: openRows.length,
      overdue,
      overdueRatePct,
      dueSoon,
      completedInRange: completedN,
      createdInRange: createdN,
      netInRange: createdN - completedN,
      completedPrevPeriod: completedPrevN,
      paceVsPrevPeriodPct,
      overallCompletionPct,
      avgOpenTaskAgeDays: ages.length > 0 ? round1(mean(ages)!) : null,
      medianOpenTaskAgeDays: ages.length > 0 ? round1(median(ages)!) : null,
      avgCycleTimeDays,
      medianCycleTimeDays,
      workloadImbalancePct,
      trackers,
      openByProject,
      members,
      openTasksSample: openTaskRows.map(mapTask),
      overdueTasks:      overdueRows.map(mapTask),
      dueSoonTasks:      dueSoonRows.map(mapTask),
      // Full in-range set (paginated) — every task counted in
      // `completedInRange` above is now present here too, not just the 20
      // most recent.
      recentCompletions: completedRows.map(mapTask),
      recentlyModified:  recentModRows.map(mapTask),
    };
  } catch {
    return null;
  }
}
