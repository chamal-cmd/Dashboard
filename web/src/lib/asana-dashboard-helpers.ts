// Shared logic used across the split-up Asana dashboard pages (Overview,
// Trackers, EOFY, People, Tasks, Insights, Projects). Extracted from the
// single AsanaDashboard.tsx these pages replaced, so every page reuses the
// same attribution/aggregation rules instead of re-deriving them.

import type { AsanaOverview, AsanaTask } from "@/lib/data/asana";
import { effectiveBookkeeper, displayName, isExcludedBookkeeper } from "@/lib/asana-client-map";

// Real due-date rules for the priority trackers, confirmed by the team on
// 2026-07-27 (Slack #gpbk-ai-plans) and, for BAS, the ATO quarterly schedule.
// These are calendar rules — no per-task due dates in Asana needed — so the
// "next deadline" shown against each tracker is genuine, not example data.
export const PRIORITY_TRACKER_KEYS = ["monthly_reporting", "bas_lodgement"] as const;

export const TRACKER_DEADLINES: Record<string, { rule: string; next: (today: Date) => Date; source: string }> = {
  monthly_reporting: {
    rule: "Due the 12th of every month",
    next: (t) => {
      const d = new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth(), 12));
      if (d < t) d.setUTCMonth(d.getUTCMonth() + 1);
      return d;
    },
    source: "Team-confirmed cadence",
  },
  bas_lodgement: {
    rule: "Quarterly — 28 Oct, 28 Feb, 28 Apr, 28 Jul (ATO)",
    next: (t) => {
      const y = t.getUTCFullYear();
      const candidates = [
        Date.UTC(y, 1, 28), Date.UTC(y, 3, 28), Date.UTC(y, 6, 28), Date.UTC(y, 9, 28),
        Date.UTC(y + 1, 1, 28),
      ];
      const hit = candidates.find((c) => new Date(c) >= t) ?? candidates[candidates.length - 1];
      return new Date(hit);
    },
    source: "ATO quarterly schedule (agent lodgement may extend)",
  },
};

export function fmtDeadline(d: Date): string {
  const mo = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][d.getUTCMonth()];
  return `${d.getUTCDate()} ${mo} ${d.getUTCFullYear()}`;
}

// Backlog aging buckets: open tasks split by days-since-creation.
export const AGE_BUCKETS = [
  { label: "0–7 days", min: 0, max: 7 },
  { label: "8–30 days", min: 8, max: 30 },
  { label: "31–90 days", min: 31, max: 90 },
  { label: "90+ days", min: 91, max: Infinity },
];
export function computeAgingBuckets(tasks: AsanaTask[]) {
  const nowMs = Date.now();
  return AGE_BUCKETS.map((b) => ({
    id: b.label,
    label: b.label,
    values: {
      count: tasks.filter((t) => {
        const age = (nowMs - new Date(t.createdAt).getTime()) / 86400000;
        return age >= b.min && age <= b.max;
      }).length,
    },
  }));
}

// Groups tracker tasks by their EFFECTIVE bookkeeper: the real Asana
// assignee when present, else the client-roster mapping (PDF), else
// "Unmapped". Tracker tasks are per-client rows with no assignee in Asana,
// so without the roster they'd all pile into one useless bar.
// `idByName` maps a display name back to its Asana member gid. Tracker rows
// are unassigned in Asana and attributed via the client roster, so without
// this only the rare row that HAS an assignee would get a drill-down link —
// everyone else rendered as dead plain text.
export function groupByEffectiveBookkeeper(tasks: AsanaTask[], idByName: Map<string, string>) {
  const byName = new Map<string, { id: string | null; count: number }>();
  for (const t of tasks) {
    const name = effectiveBookkeeper(t.name, t.assigneeName);
    if (isExcludedBookkeeper(name, t.assigneeId)) continue;
    const cur = byName.get(name) ?? { id: t.assigneeId, count: 0 };
    cur.count += 1;
    if (!cur.id && t.assigneeId) cur.id = t.assigneeId;
    byName.set(name, cur);
  }
  return Array.from(byName.entries()).map(([name, v]) => {
    const id = v.id ?? idByName.get(name.toLowerCase()) ?? null;
    return {
      id: id ?? name,
      label: name,
      href: id ? `/dashboard/asana/person/${id}` : undefined,
      values: { open: v.count },
    };
  });
}

// The tasks behind an "Unmapped" bar — client rows the roster doesn't cover
// and Asana hasn't assigned. There's no person page for them, so the
// drill-down lists the clients themselves instead.
export function unmappedTasksOf(tasks: AsanaTask[]) {
  return tasks
    .filter((t) => effectiveBookkeeper(t.name, t.assigneeName) === "Unmapped")
    .sort((a, b) => a.name.localeCompare(b.name));
}

// Display-name -> member gid, so roster-attributed tracker names still get a
// working drill-down link. Built from the full roster plus anyone with open
// work (covers people missing from asana_members, e.g. Melody).
export function buildIdByName(asana: AsanaOverview): Map<string, string> {
  const idByName = new Map<string, string>();
  for (const m of asana.allMembers) idByName.set(displayName(m.name).toLowerCase(), m.id);
  for (const a of asana.byAssignee) idByName.set(displayName(a.name).toLowerCase(), a.id);
  return idByName;
}

// Split the internal-projects bucket: the per-bookkeeper "Finance" trackers
// get their own section (one project per person, so it reads as a
// bookkeeper list), everything else stays under Other Internal Projects.
export function splitInternalProjects(asana: AsanaOverview) {
  const financeProjects = asana.otherProjects
    .filter((p) => /^finance\b/i.test(p.name.trim()))
    .map((p) => ({
      ...p,
      // "Finance - (Thamuditha)" / "Finance (Catherine)" / "Finance- Chamal" → the name
      bookkeeper: p.name.replace(/^finance\s*-?\s*/i, "").replace(/^\(|\)$/g, "").trim() || p.name,
    }));
  const otherInternalProjects = asana.otherProjects.filter((p) => !/^finance\b/i.test(p.name.trim()));
  return { financeProjects, otherInternalProjects };
}

// Completion rate per bookkeeper — completed-in-range joined against current
// open counts. Both are already loaded on the overview, so this is purely
// client-side, no extra fetch.
export function completionRateRowsOf(asana: AsanaOverview, completedByAssignee: { id: string | null; name: string; count: number }[]) {
  const openById = new Map(asana.byAssignee.map((a) => [a.id, a]));
  return completedByAssignee
    .filter((c) => c.id && !isExcludedBookkeeper(c.name, c.id))
    .map((c) => {
      const open = openById.get(c.id!)?.open ?? 0;
      const rate = c.count + open > 0 ? Math.round((c.count / (c.count + open)) * 100) : 0;
      return {
        id: c.id!,
        label: displayName(c.name),
        href: `/dashboard/asana/person/${c.id}`,
        values: { completed: c.count, rate },
      };
    });
}

// Real Asana project URL, for tables that only carry a project name — proof
// that the number came from somewhere real, not just a label.
export function asanaProjectUrl(projectId: string | null): string | null {
  return projectId ? `https://app.asana.com/0/${projectId}/list` : null;
}
