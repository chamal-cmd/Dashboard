import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { mean, median, round1 } from "@/lib/stats";
import { TASK_COLS, mapTask, fetchAllOpenTasks, aggregateOpenTasks, ASANA_CUTOFF_ISO, type AsanaTask, type RawTask } from "./asana";
import { auTodayISODate, auDateISODate } from "@/lib/business-tz";

const DAY_MS = 86400000;

export interface PersonProjectCount {
  project: string;
  open: number;
  overdue: number;
}

export interface AsanaPersonDetail {
  assigneeId: string;
  name: string;
  podName: string | null;
  open: number;
  overdue: number;
  dueSoon: number;
  completedThisWeek: number;
  completedThisMonth: number;
  avgOpenTaskAgeDays: number | null;
  medianOpenTaskAgeDays: number | null;
  openByProject: PersonProjectCount[];
  openTasks: AsanaTask[];
  overdueTasks: AsanaTask[];
  dueSoonTasks: AsanaTask[];
  recentCompletions: AsanaTask[];
  recentlyModified: AsanaTask[];
}

// Pages a single filtered/ordered asana_tasks query past PostgREST's default
// 1000-row cap — same page-until-short-page loop as fetchAllOpenTasks in
// asana.ts, but for full TASK_COLS-shaped rows instead of the narrow
// stats-only shape, so this file's detail lists (open/overdue/due-soon/
// completed/modified) are never silently truncated at a small sample.
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

// Returns null both when the person doesn't exist and when the lookup
// itself fails — either way the page falls back to its 404 state rather
// than crashing on an unhandled Supabase error.
export async function getAsanaPersonDetail(assigneeId: string): Promise<AsanaPersonDetail | null> {
  try {
    const admin = createAdminClient();

    const today = auTodayISODate();
    const in7   = auDateISODate(7);
    const week  = new Date(Date.now() - 7 * DAY_MS).toISOString();
    const month = new Date(Date.now() - 30 * DAY_MS).toISOString();

    // Who is this? Grab one task row for the display name + pod.
    const { data: sample } = await admin
      .from("asana_tasks")
      .select("assignee_name, pod_id")
      .eq("assignee_id", assigneeId)
      .gte("created_at", ASANA_CUTOFF_ISO)
      .limit(1)
      .maybeSingle();
    if (!sample) return null;

    let podName: string | null = null;
    if (sample.pod_id) {
      const { data: pod } = await admin.from("pods").select("name").eq("id", sample.pod_id).maybeSingle();
      podName = pod?.name ?? null;
    }

    const [
      { count: completedWeek },
      { count: completedMonth },
      openRows,
      openTaskRows,
      overdueRows,
      dueSoonRows,
      doneRows,
      modRows,
    ] = await Promise.all([
      admin.from("asana_tasks").select("id", { count: "exact", head: true })
        .eq("assignee_id", assigneeId).eq("completed", true).gte("completed_at", week).gte("created_at", ASANA_CUTOFF_ISO),
      admin.from("asana_tasks").select("id", { count: "exact", head: true })
        .eq("assignee_id", assigneeId).eq("completed", true).gte("completed_at", month).gte("created_at", ASANA_CUTOFF_ISO),
      fetchAllOpenTasks(admin, { column: "assignee_id", value: assigneeId }),
      // Full TASK_COLS shape of every one of this person's open tasks (not
      // just the narrow stats columns fetchAllOpenTasks returns above) — the
      // source for the flat "All Open Tasks" table, so it can render real
      // per-task Asana links.
      fetchAllTaskRows((from, to) =>
        admin.from("asana_tasks").select(TASK_COLS)
          .eq("assignee_id", assigneeId).eq("completed", false).gte("created_at", ASANA_CUTOFF_ISO)
          .order("due_on", { ascending: true, nullsFirst: false })
          // Unique-id secondary sort keeps .range() pages stable across ties
          // (esp. the due_on-null block) so no task is duplicated or dropped.
          .order("id", { ascending: true })
          .range(from, to)
      ),
      fetchAllTaskRows((from, to) =>
        admin.from("asana_tasks").select(TASK_COLS)
          .eq("assignee_id", assigneeId).eq("completed", false).lt("due_on", today).gte("created_at", ASANA_CUTOFF_ISO)
          .order("due_on", { ascending: true })
          .order("id", { ascending: true })
          .range(from, to)
      ),
      fetchAllTaskRows((from, to) =>
        admin.from("asana_tasks").select(TASK_COLS)
          .eq("assignee_id", assigneeId).eq("completed", false).gte("due_on", today).lte("due_on", in7).gte("created_at", ASANA_CUTOFF_ISO)
          .order("due_on", { ascending: true })
          .order("id", { ascending: true })
          .range(from, to)
      ),
      fetchAllTaskRows((from, to) =>
        admin.from("asana_tasks").select(TASK_COLS)
          .eq("assignee_id", assigneeId).eq("completed", true).gte("completed_at", month).gte("created_at", ASANA_CUTOFF_ISO)
          .order("completed_at", { ascending: false })
          .order("id", { ascending: true })
          .range(from, to)
      ),
      fetchAllTaskRows((from, to) =>
        admin.from("asana_tasks").select(TASK_COLS)
          .eq("assignee_id", assigneeId).eq("completed", false).gte("modified_at", month).gte("created_at", ASANA_CUTOFF_ISO)
          .order("modified_at", { ascending: false })
          .order("id", { ascending: true })
          .range(from, to)
      ),
    ]);

    const overdue = openRows.filter((r) => r.due_on && r.due_on < today).length;
    const dueSoon = openRows.filter((r) => r.due_on && r.due_on >= today && r.due_on <= in7).length;

    const nowMs = Date.now();
    const ages = openRows.map((r) => (nowMs - new Date(r.created_at).getTime()) / DAY_MS);

    const byProjectCounts = aggregateOpenTasks(openRows, (r) => r.project_name ?? "(no project)", today);
    const openByProject = Array.from(byProjectCounts.entries())
      .map(([project, v]) => ({ project, ...v }))
      .sort((a, b) => b.open - a.open);

    return {
      assigneeId,
      name: sample.assignee_name ?? "Unknown",
      podName,
      open: openRows.length,
      overdue,
      dueSoon,
      completedThisWeek: completedWeek ?? 0,
      completedThisMonth: completedMonth ?? 0,
      avgOpenTaskAgeDays: ages.length > 0 ? round1(mean(ages)!) : null,
      medianOpenTaskAgeDays: ages.length > 0 ? round1(median(ages)!) : null,
      openByProject,
      openTasks:         openTaskRows.map(mapTask),
      overdueTasks:      overdueRows.map(mapTask),
      dueSoonTasks:      dueSoonRows.map(mapTask),
      recentCompletions: doneRows.map(mapTask),
      recentlyModified:  modRows.map(mapTask),
    };
  } catch {
    return null;
  }
}
