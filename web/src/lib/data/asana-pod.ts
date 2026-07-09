import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { mean, median, round1 } from "@/lib/stats";
import type { AsanaTask } from "./asana";

const DAY_MS = 86400000;

export interface PodProjectCount {
  project: string;
  open: number;
  overdue: number;
}

export interface PodMemberCount {
  assigneeId: string | null;
  name: string;
  open: number;
  overdue: number;
}

export interface AsanaPodDetail {
  podId: string;
  name: string;
  open: number;
  overdue: number;
  dueSoon: number;
  completedThisWeek: number;
  completedThisMonth: number;
  avgOpenTaskAgeDays: number | null;
  medianOpenTaskAgeDays: number | null;
  openByProject: PodProjectCount[];
  byMember: PodMemberCount[];
  overdueTasks: AsanaTask[];
  dueSoonTasks: AsanaTask[];
  recentCompletions: AsanaTask[];
}

type Row = {
  id: string; name: string; project_name: string | null; assignee_name: string | null;
  due_on: string | null; completed_at: string | null; created_at: string; modified_at: string;
};

const TASK_COLS = "id, name, project_name, assignee_name, due_on, completed_at, created_at, modified_at";

function mapTask(r: Row): AsanaTask {
  return {
    id: r.id, name: r.name, projectName: r.project_name, assigneeName: r.assignee_name,
    dueOn: r.due_on, completedAt: r.completed_at, createdAt: r.created_at, modifiedAt: r.modified_at,
  };
}

export async function getAsanaPodDetail(podId: string): Promise<AsanaPodDetail | null> {
  const admin = createAdminClient();

  const today = new Date().toISOString().slice(0, 10);
  const in7   = new Date(Date.now() + 7 * DAY_MS).toISOString().slice(0, 10);
  const week  = new Date(Date.now() - 7 * DAY_MS).toISOString();
  const month = new Date(Date.now() - 30 * DAY_MS).toISOString();

  const { data: pod } = await admin.from("pods").select("name").eq("id", podId).maybeSingle();
  if (!pod) return null;

  const [
    { count: completedWeek },
    { count: completedMonth },
    openRes,
    overdueRes,
    dueSoonRes,
    doneRes,
  ] = await Promise.all([
    admin.from("asana_tasks").select("id", { count: "exact", head: true })
      .eq("pod_id", podId).eq("completed", true).gte("completed_at", week),
    admin.from("asana_tasks").select("id", { count: "exact", head: true })
      .eq("pod_id", podId).eq("completed", true).gte("completed_at", month),
    // All open tasks for this pod (for counts, age stats, and per-project /
    // per-member breakdowns) — one pod's open list comfortably fits in one page.
    admin.from("asana_tasks").select("project_name, due_on, created_at, assignee_id, assignee_name")
      .eq("pod_id", podId).eq("completed", false).range(0, 4999),
    admin.from("asana_tasks").select(TASK_COLS)
      .eq("pod_id", podId).eq("completed", false).lt("due_on", today)
      .order("due_on", { ascending: true }).limit(30),
    admin.from("asana_tasks").select(TASK_COLS)
      .eq("pod_id", podId).eq("completed", false).gte("due_on", today).lte("due_on", in7)
      .order("due_on", { ascending: true }).limit(30),
    admin.from("asana_tasks").select(TASK_COLS)
      .eq("pod_id", podId).eq("completed", true).gte("completed_at", month)
      .order("completed_at", { ascending: false }).limit(20),
  ]);

  const openRows = openRes.data ?? [];
  const overdue = openRows.filter((r) => r.due_on && r.due_on < today).length;
  const dueSoon = openRows.filter((r) => r.due_on && r.due_on >= today && r.due_on <= in7).length;

  const nowMs = Date.now();
  const ages = openRows.map((r) => (nowMs - new Date(r.created_at).getTime()) / DAY_MS);

  const byProject = new Map<string, { open: number; overdue: number }>();
  for (const r of openRows) {
    const key = r.project_name ?? "(no project)";
    const cur = byProject.get(key) ?? { open: 0, overdue: 0 };
    cur.open += 1;
    if (r.due_on && r.due_on < today) cur.overdue += 1;
    byProject.set(key, cur);
  }
  const openByProject = Array.from(byProject.entries())
    .map(([project, v]) => ({ project, ...v }))
    .sort((a, b) => b.open - a.open);

  // Who inside this pod is actually carrying the load — mirrors the org-wide
  // "Open by Bookkeeper" breakdown but scoped to just this pod's tasks.
  const byMemberAgg = new Map<string, { name: string; open: number; overdue: number }>();
  for (const r of openRows) {
    const key = r.assignee_id ?? r.assignee_name ?? "unassigned";
    const cur = byMemberAgg.get(key) ?? { name: r.assignee_name ?? "Unassigned", open: 0, overdue: 0 };
    cur.open += 1;
    if (r.due_on && r.due_on < today) cur.overdue += 1;
    byMemberAgg.set(key, cur);
  }
  const byMember: PodMemberCount[] = Array.from(byMemberAgg.entries())
    .map(([key, v]) => ({ assigneeId: key === "unassigned" ? null : key, name: v.name, open: v.open, overdue: v.overdue }))
    .sort((a, b) => b.open - a.open);

  return {
    podId,
    name: pod.name,
    open: openRows.length,
    overdue,
    dueSoon,
    completedThisWeek: completedWeek ?? 0,
    completedThisMonth: completedMonth ?? 0,
    avgOpenTaskAgeDays: ages.length > 0 ? round1(mean(ages)!) : null,
    medianOpenTaskAgeDays: ages.length > 0 ? round1(median(ages)!) : null,
    openByProject,
    byMember,
    overdueTasks:      ((overdueRes.data ?? []) as Row[]).map(mapTask),
    dueSoonTasks:      ((dueSoonRes.data ?? []) as Row[]).map(mapTask),
    recentCompletions: ((doneRes.data ?? []) as Row[]).map(mapTask),
  };
}
