"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import type { AsanaOverview, AsanaTask } from "@/lib/data/asana";
import { ByAssigneeTable, groupByAssignee } from "@/components/asana/ByAssigneeTable";
import { TrackerList } from "@/components/asana/TrackerList";
import { NetBadge, PaceBadge, imbalanceLabel } from "@/components/asana/RangeBadges";
import { InfoTip } from "@/components/InfoTip";
import { LoadingScreen } from "@/components/LoadingScreen";
import { RankedBarChart } from "@/components/RankedBarChart";
import { MonthlyBars } from "@/components/asana/MonthlyBars";
import { ControlPanelShell } from "@/components/ControlPanelShell";
import { effectiveBookkeeper, displayName } from "@/lib/asana-client-map";
import "@/components/info-tip.css";

const PRESETS = [
  { label: "Today",  days: 1  },
  { label: "7 days", days: 7  },
  { label: "14 days",days: 14 },
  { label: "30 days",days: 30 },
  { label: "90 days",days: 90 },
] as const;

const MAX_DAYS = 90;

// Every toggleable section on the page, in display order. Charts first (they
// render at the top of the main column); stats and tables below.
// Compliance trackers flagged as the priority ones to watch closely — get
// their own charts up top, in addition to appearing in the full collapsible
// Compliance Trackers list below.
// Superannuation was dropped 2026-07-27: payday super makes that board
// redundant, so it's deactivated in asana_trackers too.
const PRIORITY_TRACKER_KEYS = ["monthly_reporting", "bas_lodgement"] as const;

// Real due-date rules for the priority trackers, confirmed by the team on
// 2026-07-27 (Slack #gpbk-ai-plans) and, for BAS, the ATO quarterly schedule.
// These are calendar rules — no per-task due dates in Asana needed — so the
// "next deadline" shown against each tracker is genuine, not example data.
const TRACKER_DEADLINES: Record<string, { rule: string; next: (today: Date) => Date; source: string }> = {
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
    // ATO quarterly BAS: 28th of the month after each quarter ends
    // (28 Oct / 28 Feb / 28 Apr / 28 Jul). Lodging through a registered
    // agent can extend these, so treat it as the baseline deadline.
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

const PANELS = [
  { key: "priorityTrackers", label: "Priority trackers (chart)", group: "Charts" },
  { key: "eofy", label: "EOFY client trackers", group: "Charts" },
  { key: "byBkChart", label: "By bookkeeper (chart)", group: "Charts" },
  { key: "insights", label: "Additional insights", group: "Charts" },
  { key: "financeProjects", label: "Bookkeeper finance trackers", group: "Stats & tables" },
  { key: "otherProjects", label: "Other internal projects", group: "Stats & tables" },
  { key: "openKpis", label: "Open Tasks (KPIs)", group: "Stats & tables" },
  { key: "velocity", label: "Velocity", group: "Stats & tables" },
  { key: "backlogHealth", label: "Backlog Health", group: "Stats & tables" },
  { key: "trackers", label: "Compliance Trackers", group: "Stats & tables" },
  { key: "allOpen", label: "All Open Tasks", group: "Stats & tables" },
  { key: "overdue", label: "Overdue Tasks", group: "Stats & tables" },
  { key: "dueSoon", label: "Due Soon", group: "Stats & tables" },
  { key: "completed", label: "Recently Completed", group: "Stats & tables" },
  { key: "modified", label: "Recently Modified", group: "Stats & tables" },
  { key: "byPodClient", label: "By Pod / Bookkeeper tables", group: "Stats & tables" },
] as const;

function fmtDeadline(d: Date): string {
  const mo = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][d.getUTCMonth()];
  return `${d.getUTCDate()} ${mo} ${d.getUTCFullYear()}`;
}

// Backlog aging buckets: open tasks split by days-since-creation. Kept at
// module level (not in render) so the wall-clock read stays out of the
// component body, mirroring TaskRow's isOverdue pattern.
const AGE_BUCKETS = [
  { label: "0–7 days", min: 0, max: 7 },
  { label: "8–30 days", min: 8, max: 30 },
  { label: "31–90 days", min: 31, max: 90 },
  { label: "90+ days", min: 91, max: Infinity },
];
function computeAgingBuckets(tasks: AsanaTask[]) {
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
function groupByEffectiveBookkeeper(tasks: AsanaTask[]) {
  const byName = new Map<string, { id: string | null; count: number }>();
  for (const t of tasks) {
    const name = effectiveBookkeeper(t.name, t.assigneeName);
    const cur = byName.get(name) ?? { id: t.assigneeId, count: 0 };
    cur.count += 1;
    if (!cur.id && t.assigneeId) cur.id = t.assigneeId;
    byName.set(name, cur);
  }
  return Array.from(byName.entries()).map(([name, v]) => ({
    id: v.id ?? name,
    label: name,
    href: v.id ? `/dashboard/asana/person/${v.id}` : undefined,
    values: { open: v.count },
  }));
}

type PanelKey = (typeof PANELS)[number]["key"];
const ALL_VISIBLE = Object.fromEntries(PANELS.map((p) => [p.key, true])) as Record<PanelKey, boolean>;
const VIS_STORAGE_KEY = "asana-panel-visibility";

// Section views — the button bar at the top of the page. "Full overview"
// renders everything; each other view renders only its slice of the page,
// which keeps the DOM light and the page snappy to scroll and interact with.
const VIEWS = [
  { key: "all", label: "Full overview" },
  { key: "overview", label: "KPIs" },
  { key: "trackers", label: "Trackers" },
  { key: "eofy", label: "EOFY" },
  { key: "people", label: "Bookkeepers & Pods" },
  { key: "tasks", label: "Task Lists" },
  { key: "insights", label: "Insights" },
  { key: "projects", label: "Projects" },
] as const;
type ViewKey = (typeof VIEWS)[number]["key"];

const PANEL_VIEW: Record<PanelKey, Exclude<ViewKey, "all">> = {
  priorityTrackers: "trackers",
  eofy: "eofy",
  byBkChart: "people",
  insights: "insights",
  financeProjects: "projects",
  otherProjects: "projects",
  openKpis: "overview",
  velocity: "overview",
  backlogHealth: "overview",
  trackers: "trackers",
  allOpen: "tasks",
  overdue: "tasks",
  dueSoon: "tasks",
  completed: "tasks",
  modified: "tasks",
  byPodClient: "people",
};

export default function AsanaDashboard({ initial }: { initial: AsanaOverview }) {
  const [days, setDays] = useState(initial.rangeDays);
  const [custom, setCustom] = useState("");
  const [loading, setLoading] = useState(false);
  const [asana, setAsana] = useState<AsanaOverview>(initial);
  const [visible, setVisible] = useState<Record<PanelKey, boolean>>(ALL_VISIBLE);
  const [view, setView] = useState<ViewKey>("all");

  // A panel renders when its control-panel checkbox is on AND it belongs to
  // the currently selected view (or Full overview is selected).
  const show = (key: PanelKey) => visible[key] && (view === "all" || PANEL_VIEW[key] === view);

  // Restore saved show/hide choices after mount (localStorage is client-only;
  // starting all-visible keeps SSR and first client render identical).
  useEffect(() => {
    try {
      const raw = localStorage.getItem(VIS_STORAGE_KEY);
      if (raw) {
        const saved = JSON.parse(raw) as Partial<Record<PanelKey, boolean>>;
        // eslint-disable-next-line react-hooks/set-state-in-effect
        setVisible((v) => ({ ...v, ...saved }));
      }
    } catch { /* ignore */ }
  }, []);

  const togglePanel = (key: PanelKey) => {
    setVisible((prev) => {
      const next = { ...prev, [key]: !prev[key] };
      try { localStorage.setItem(VIS_STORAGE_KEY, JSON.stringify(next)); } catch { /* ignore */ }
      return next;
    });
  };

  const pickPreset = useCallback(async (d: number) => {
    if (d === days || loading) return;
    setLoading(true);
    try {
      const res = await fetch(`/api/asana/overview?days=${d}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setAsana(await res.json() as AsanaOverview);
      setDays(d);
    } catch { /* keep existing data and range */ } finally {
      setLoading(false);
    }
  }, [days, loading]);

  const submitCustom = () => {
    const n = Math.floor(Number(custom));
    if (!isNaN(n) && n >= 1) pickPreset(Math.min(n, MAX_DAYS));
  };

  // Re-fetch the current range on demand — unlike pickPreset, this doesn't
  // bail out when the day count is unchanged.
  const refreshData = useCallback(async () => {
    if (loading) return;
    setLoading(true);
    try {
      const res = await fetch(`/api/asana/overview?days=${days}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setAsana(await res.json() as AsanaOverview);
    } catch { /* keep existing data */ } finally {
      setLoading(false);
    }
  }, [days, loading]);

  const openByAssignee = groupByAssignee(asana.openTasksSample);
  const overdueByAssignee = groupByAssignee(asana.overdueTasks);
  const dueSoonByAssignee = groupByAssignee(asana.dueSoonTasks);
  const completedByAssignee = groupByAssignee(asana.recentCompletions);
  const modifiedByAssignee = groupByAssignee(asana.recentlyModified);

  // Backlog aging buckets — how stale the open board is, at a glance.
  const agingRows = computeAgingBuckets(asana.openTasksSample);

  // Split the internal-projects bucket: the per-bookkeeper "Finance" trackers
  // get their own section (one project per person, so it reads as a
  // bookkeeper list), everything else stays under Other Internal Projects.
  const financeProjects = asana.otherProjects
    .filter((p) => /^finance\b/i.test(p.name.trim()))
    .map((p) => ({
      ...p,
      // "Finance - (Thamuditha)" / "Finance (Catherine)" / "Finance- Chamal" → the name
      bookkeeper: p.name.replace(/^finance\s*-?\s*/i, "").replace(/^\(|\)$/g, "").trim() || p.name,
    }));
  const otherInternalProjects = asana.otherProjects.filter((p) => !/^finance\b/i.test(p.name.trim()));

  // Completion rate per bookkeeper — completed-in-range joined against
  // current open counts (both already loaded, so purely client-side).
  const openById = new Map(asana.byAssignee.map((a) => [a.id, a]));
  const completionRateRows = completedByAssignee
    .filter((c) => c.id)
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

  if (loading) {
    return <LoadingScreen icon="✓" title="ASANA" status="Loading Asana data…" color="#a78bfa" />;
  }

  return (
    <div style={{ display: "flex", gap: 24, alignItems: "flex-start", flexWrap: "wrap" }}>
      {/* ══ Main column ══════════════════════════════════════ */}
      <main style={{ flex: 1, minWidth: 340 }}>
        {/* ── Section switcher ──────────────────────────── */}
        <div className="acTabBar" style={{ marginBottom: 14, position: "sticky", top: 0, zIndex: 30, background: "rgba(20,21,42,0.92)", backdropFilter: "blur(6px)", padding: "10px 0", marginTop: -10 }}>
          {VIEWS.map((v) => (
            <button key={v.key} className={`acTab ${view === v.key ? "acTabActive" : ""}`} onClick={() => setView(v.key)}>
              {v.label}
            </button>
          ))}
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 18, flexWrap: "wrap" }}>
          <div style={{ display: "inline-flex", alignItems: "center", gap: 8, background: "rgba(167,139,250,0.13)", border: "1px solid rgba(167,139,250,0.35)", color: "#c4b5fd", borderRadius: 999, padding: "6px 14px", fontSize: 12, fontWeight: 600 }}>
            <span style={{ width: 7, height: 7, borderRadius: "50%", background: "#a78bfa" }} />
            Showing {asana.rangeLabel}
          </div>
          <button className="acTab" onClick={refreshData} title="Re-fetch the latest data for the current range">
            ↻ Refresh
          </button>
        </div>

        {/* ── Graphs on top ─────────────────────────────── */}
        {show("priorityTrackers") && (
          <div className="dpTableWrap" style={{ marginBottom: 20 }}>
            <div className="dpTableHead">
              <div>
                <div className="dpTableTitle" style={{ color: "#f87171" }}>
                  Priority Trackers: Fathom · BAS
                  <InfoTip text="The three compliance trackers flagged as most important. Each tracker is an Asana project with one task per client. Progress = completed ÷ total tasks (created since 1 Jan 2026). The tasks carry no assignee in Asana, so the by-bookkeeper bars attribute each client to its bookkeeper using the client roster; anything not on the roster shows as Unmapped. The months chart is a labelled DRAFT with example data." />
                </div>
                <div className="dpTableSub">Open tasks broken down by bookkeeper · attribution uses the client roster where Asana has no assignee</div>
              </div>
            </div>
            {PRIORITY_TRACKER_KEYS.map((key, idx) => {
              const t = asana.trackers.find((tr) => tr.key === key);
              if (!t) return null;
              const deadline = TRACKER_DEADLINES[key];
              const byBk = groupByEffectiveBookkeeper(t.openTasks);
              const done = (t.total ?? 0) - (t.open ?? 0);
              const pct = t.total && t.total > 0 ? Math.round((done / t.total) * 100) : null;
              return (
                <div key={key} style={{ marginBottom: 28, paddingTop: idx > 0 ? 20 : 0, borderTop: idx > 0 ? "1px solid var(--surface-2)" : undefined }}>
                  {/* Progress header — "X / Y complete" with a fill bar */}
                  <div style={{ display: "flex", alignItems: "baseline", gap: 12, marginBottom: 6, flexWrap: "wrap" }}>
                    <span style={{ fontWeight: 700, fontSize: 14 }}>{t.label}</span>
                    <span style={{ fontSize: 13, color: "var(--text-2)" }}><strong>{done}</strong> / {t.total ?? "—"} complete{pct != null && <span style={{ color: "var(--text-3)" }}> · {pct}%</span>}</span>
                    <span style={{ fontSize: 12, color: (t.open ?? 0) > 0 ? "#fb923c" : "#34d399", fontWeight: 700 }}>{t.open ?? 0} open</span>
                  </div>
                  <div style={{ height: 8, background: "var(--surface-2)", borderRadius: 4, marginBottom: 16, overflow: "hidden" }}>
                    <div style={{ height: "100%", width: `${pct ?? 0}%`, background: pct != null && pct >= 75 ? "#34d399" : pct != null && pct >= 40 ? "#fbbf24" : "#f87171", borderRadius: 4 }} />
                  </div>

                  <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: 24 }}>
                    <div>
                      <div className="dpTableSub" style={{ marginBottom: 8 }}>Open by Bookkeeper</div>
                      {byBk.length === 0 ? <div className="dpEmpty">No open tasks.</div> : <RankedBarChart rows={byBk} metrics={[{ key: "open", label: "Open", color: "#f87171" }]} />}
                    </div>
                    {deadline && (
                      <div style={{ border: "1px solid var(--border)", borderRadius: 8, padding: "12px 14px", background: "var(--surface-2)" }}>
                        <div className="dpTableSub" style={{ marginBottom: 10 }}>Deadline</div>
                        <div style={{ fontSize: 13, fontWeight: 700, color: "var(--text-1)", marginBottom: 4 }}>{deadline.rule}</div>
                        <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginBottom: 10 }}>
                          <span style={{ fontSize: 24, fontWeight: 750, color: "#4f8ef7", letterSpacing: "-0.5px" }}>{fmtDeadline(deadline.next(new Date()))}</span>
                          <span style={{ fontSize: 11, color: "var(--text-3)" }}>next due</span>
                        </div>
                        <div style={{ fontSize: 11, color: "var(--text-3)", lineHeight: 1.5 }}>
                          {deadline.source}.
                          <br />
                          A month-by-month <em>due vs completed</em> chart still isn&apos;t possible from this tracker: it holds
                          one row per client (not one per month) and has almost no completions recorded in Asana, so there is
                          nothing per-month to count. Making the tracker recurring monthly in Asana would unlock it.
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* ── EOFY Client Trackers ─────────────────────── */}
        {show("eofy") && asana.eofyClients.length > 0 && (
          <div className="dpTableWrap" style={{ marginBottom: 20 }}>
            <div className="dpTableHead">
              <div>
                <div className="dpTableTitle" style={{ color: "#2dd4bf" }}>
                  EOFY Client Trackers — FY2026
                  <InfoTip text="Live from the two pod-level 'EOFY FY2026 – Client Tracker' Asana projects (Jobelle Pod and Ridmal Pod). One task per client: ✓ means that client's EOFY work is marked complete in Asana, ✗ means still outstanding. Bookkeeper under each client is the Asana assignee, or the client roster if unassigned. Clicking a chip opens the task in Asana. The bar chart counts outstanding clients per bookkeeper." />
                </div>
                <div className="dpTableSub">One row per client, from the pod EOFY tracker projects · ✓ done, ✗ outstanding · names from the client roster</div>
              </div>
            </div>

            {/* Per-pod progress + client chips */}
            {Array.from(new Set(asana.eofyClients.map((t) => t.projectName))).sort().map((proj) => {
              const rows = asana.eofyClients.filter((t) => t.projectName === proj);
              const done = rows.filter((t) => !!t.completedAt).length;
              const pct = rows.length > 0 ? Math.round((done / rows.length) * 100) : 0;
              const podLabel = (proj ?? "").replace(/.*Client Tracker-?\s*/i, "") || proj;
              return (
                <div key={proj ?? "?"} style={{ marginBottom: 20 }}>
                  <div style={{ display: "flex", alignItems: "baseline", gap: 12, marginBottom: 6, flexWrap: "wrap" }}>
                    <span style={{ fontWeight: 700, fontSize: 14 }}>{podLabel}</span>
                    <span style={{ fontSize: 13, color: "var(--text-2)" }}><strong>{done}</strong> / {rows.length} clients complete <span style={{ color: "var(--text-3)" }}>· {pct}%</span></span>
                  </div>
                  <div style={{ height: 8, background: "var(--surface-2)", borderRadius: 4, marginBottom: 12, overflow: "hidden" }}>
                    <div style={{ height: "100%", width: `${pct}%`, background: pct >= 75 ? "#34d399" : pct >= 40 ? "#fbbf24" : "#f87171", borderRadius: 4 }} />
                  </div>
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(190px, 1fr))", gap: 6 }}>
                    {rows.map((t) => {
                      const isDone = !!t.completedAt;
                      const bk = effectiveBookkeeper(t.name, t.assigneeName);
                      return (
                        <a
                          key={t.id}
                          href={`https://app.asana.com/0/0/${t.id}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          title={`${t.name} · ${bk} · ${isDone ? "done" : "outstanding"}`}
                          style={{
                            display: "flex", alignItems: "center", gap: 7, padding: "6px 9px", borderRadius: 6,
                            border: `1px solid ${isDone ? "rgba(52,211,153,0.35)" : "rgba(248,113,113,0.35)"}`, background: isDone ? "rgba(52,211,153,0.10)" : "rgba(248,113,113,0.10)",
                            textDecoration: "none", minWidth: 0,
                          }}
                        >
                          <span style={{ fontSize: 12, fontWeight: 700, color: isDone ? "#34d399" : "#f87171", flexShrink: 0 }}>{isDone ? "✓" : "✗"}</span>
                          <span style={{ minWidth: 0, overflow: "hidden" }}>
                            <span style={{ display: "block", fontSize: 12, fontWeight: 600, color: "var(--text-1)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{t.name}</span>
                            <span style={{ display: "block", fontSize: 10, color: "var(--text-3)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{bk}</span>
                          </span>
                        </a>
                      );
                    })}
                  </div>
                </div>
              );
            })}

            {/* Outstanding EOFY clients per bookkeeper */}
            <div style={{ maxWidth: 560 }}>
              <div className="dpTableSub" style={{ marginBottom: 8 }}>Outstanding clients by bookkeeper</div>
              {(() => {
                const openOnes = asana.eofyClients.filter((t) => !t.completedAt);
                const rows = groupByEffectiveBookkeeper(openOnes);
                return rows.length === 0
                  ? <div className="dpEmpty">All EOFY client trackers complete. 🎉</div>
                  : <RankedBarChart rows={rows} metrics={[{ key: "open", label: "Outstanding", color: "#2dd4bf" }]} />;
              })()}
            </div>
          </div>
        )}

        {show("byBkChart") && asana.byAssignee.length > 0 && (
          <div className="dpTableWrap" style={{ marginBottom: 20 }}>
            <div className="dpTableHead">
              <div>
                <div className="dpTableTitle">
                  By Bookkeeper
                  <InfoTip text="Every currently-open Asana task that has an assignee, grouped per bookkeeper and ranked highest-first. Toggle between total open tasks and overdue only (due date already passed). A live snapshot of the whole board — not affected by the date range. Click a name for that person's full drill-down page." />
                </div>
                <div className="dpTableSub">Open and overdue tasks per bookkeeper · click a name for their full breakdown</div>
              </div>
            </div>
            <RankedBarChart
              rows={asana.byAssignee.map((a) => ({
                id: a.id,
                label: displayName(a.name),
                href: `/dashboard/asana/person/${a.id}`,
                values: { open: a.open, overdue: a.overdue },
              }))}
              metrics={[
                { key: "open", label: "Open tasks", color: "#4f8ef7" },
                { key: "overdue", label: "Overdue", color: "#f87171" },
              ]}
            />
          </div>
        )}

        {/* ── Additional Insights ─────────────────────── */}
        {show("insights") && (
          <div className="dpTableWrap" style={{ marginBottom: 20 }}>
            <div className="dpTableHead">
              <div>
                <div className="dpTableTitle">
                  Additional Insights
                  <InfoTip text="Four deeper views computed from the full task data: Backlog age (open tasks bucketed by days since creation), Monthly throughput (tasks created vs completed each calendar month since Jan 2026), Completion by bookkeeper (tasks each person finished in the selected date range, with a clear-rate %), and Client workload (open + overdue per client project, internal projects excluded)." />
                </div>
                <div className="dpTableSub">Backlog age · monthly throughput · completion rates · client workload</div>
              </div>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))", gap: 28 }}>
              <div>
                <div className="dpTableSub" style={{ marginBottom: 8 }}>Backlog age — how old the open tasks are</div>
                <RankedBarChart ordered rows={agingRows} metrics={[{ key: "count", label: "Open tasks", color: "#4f8ef7" }]} />
                <div style={{ fontSize: 11, color: "var(--text-3)", marginTop: 8 }}>Counted from each task&apos;s creation date. A growing 90+ band means old work is piling up.</div>
              </div>

              <div>
                <div className="dpTableSub" style={{ marginBottom: 8 }}>Monthly throughput — created vs completed</div>
                <MonthlyBars
                  data={asana.monthlyThroughput}
                  series={[
                    { key: "created", label: "Created", color: "#4f8ef7" },
                    { key: "completed", label: "Completed", color: "#34d399" },
                  ]}
                  height={140}
                />
                <div style={{ fontSize: 11, color: "var(--text-3)", marginTop: 8 }}>Completed above Created = the backlog shrank that month.</div>
              </div>

              <div>
                <div className="dpTableSub" style={{ marginBottom: 8 }}>Completion by bookkeeper — {asana.rangeLabel}</div>
                {completionRateRows.length === 0 ? <div className="dpEmpty">No completions in range.</div> : (
                  <RankedBarChart
                    rows={completionRateRows}
                    metrics={[
                      { key: "completed", label: "Completed", color: "#34d399" },
                      { key: "rate", label: "Clear rate", unit: "%", color: "#a78bfa" },
                    ]}
                  />
                )}
                <div style={{ fontSize: 11, color: "var(--text-3)", marginTop: 8 }}>Clear rate = completed ÷ (completed + still open) — how much of their queue each person cleared.</div>
              </div>

              <div>
                <div className="dpTableSub" style={{ marginBottom: 8 }}>Client workload — open &amp; overdue per client</div>
                {asana.clientBreakdown.length === 0 ? <div className="dpEmpty">No open client tasks.</div> : (
                  <table className="dpTable">
                    <thead><tr><th>Client</th><th>Open</th><th>Overdue</th></tr></thead>
                    <tbody>
                      {asana.clientBreakdown.map((c) => (
                        <tr key={c.name}>
                          <td className="dpPrimary" style={{ fontSize: 12 }}>{c.name}</td>
                          <td className="dpMuted">{c.open}</td>
                          <td style={{ color: c.overdue > 0 ? "#f87171" : "var(--text-3)", fontWeight: c.overdue > 0 ? 700 : 400, fontSize: 13 }}>
                            {c.overdue}{c.open > 0 && c.overdue > 0 && <span style={{ fontSize: 11, color: "var(--text-3)", fontWeight: 400 }}> ({Math.round((c.overdue / c.open) * 100)}%)</span>}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
                <div style={{ fontSize: 11, color: "var(--text-3)", marginTop: 8 }}>Internal (non-client) projects excluded.</div>
              </div>
            </div>
          </div>
        )}

        {/* ── Volume KPIs ─────────────────────────────── */}
        {show("openKpis") && (<>
          <div className="dpSectionLbl">Open Tasks</div>
          <div className="dpKpiGrid dpKpiGrid3">
            <a className="dpKpi dpKpiLink" href="#section-open" style={{ "--kpi-accent": "#4f8ef7" } as React.CSSProperties}>
              <div className="dpKpiVal">{asana.openTotal ?? "—"}</div>
              <div className="dpKpiLbl">Open tasks (all clients)<InfoTip text="Every incomplete task across all clients and pods right now — a live count, not tied to the date range." /></div>
            </a>
            <a className="dpKpi dpKpiLink" href="#section-overdue" style={{ "--kpi-accent": "#f87171" } as React.CSSProperties}>
              <div className="dpKpiVal">
                {asana.overdueCount ?? "—"}
                {asana.overdueRatePct != null && <span style={{ fontSize: 12, color: "var(--text-3)", fontWeight: 400 }}> ({asana.overdueRatePct}% of open)</span>}
              </div>
              <div className="dpKpiLbl">Overdue<InfoTip text="Open tasks whose due date has already passed. The % is overdue tasks divided by all open tasks, so you can tell a real fire from a rounding error." /></div>
            </a>
            <a className="dpKpi dpKpiLink" href="#section-duesoon" style={{ "--kpi-accent": "#fbbf24" } as React.CSSProperties}>
              <div className="dpKpiVal">{asana.dueSoonCount ?? "—"}</div>
              <div className="dpKpiLbl">Due in next {days} day{days !== 1 ? "s" : ""}<InfoTip text="Open tasks due between today and the end of the selected date range — a forward-looking window, separate from Overdue." /></div>
            </a>
          </div>
        </>)}

        {/* ── Velocity KPIs ───────────────────────────── */}
        {show("velocity") && (<>
          <div className="dpSectionLbl" style={{ marginTop: 8 }}>Velocity — {asana.rangeLabel}</div>
          <div className="dpKpiGrid dpKpiGridLast" style={{ gridTemplateColumns: "repeat(3, 1fr)" }}>
            <a className="dpKpi dpKpiLink" href="#section-completed" style={{ "--kpi-accent": "#34d399" } as React.CSSProperties}>
              <div className="dpKpiVal">{asana.velocity?.completedInRange ?? "—"}</div>
              <div className="dpKpiLbl">Completed<InfoTip text="Tasks marked complete within the selected date range, across every pod and client." /></div>
            </a>
            <div className="dpKpi" style={{ "--kpi-accent": "#a78bfa" } as React.CSSProperties}>
              <div className="dpKpiVal">{asana.velocity?.createdInRange ?? "—"}</div>
              <div className="dpKpiLbl">Created<InfoTip text="New tasks added within the selected date range — compare against Completed to see if the backlog is growing or shrinking." /></div>
            </div>
            <div className="dpKpi" style={{ "--kpi-accent": "var(--text-3)" } as React.CSSProperties}>
              <div className="dpKpiVal">{asana.velocity?.completedPrevPeriod ?? "—"}</div>
              <div className="dpKpiLbl">Completed, prior period<InfoTip text="Completions in the equal-length period immediately before the current range — the baseline the Pace badge below compares against." /></div>
            </div>
          </div>

          {asana.velocity && (
            <div style={{ display: "flex", gap: 24, marginTop: -8, marginBottom: 24, paddingLeft: 4 }}>
              <div style={{ fontSize: 11, color: "var(--text-3)" }}>
                Net: <NetBadge net={asana.velocity.netInRange} />
              </div>
              {asana.paceVsPrevPeriodPct != null && (
                <div style={{ fontSize: 11, color: "var(--text-3)" }}>
                  Pace: <PaceBadge pct={asana.paceVsPrevPeriodPct} days={days} />
                </div>
              )}
            </div>
          )}
        </>)}

        {/* ── Workload & Pace ──────────────────────────── */}
        {show("backlogHealth") && (<>
          <div className="dpSectionLbl">Backlog Health</div>
          <div className="dpKpiGrid dpKpiGridLast" style={{ gridTemplateColumns: "repeat(3, 1fr)" }}>
            <div className="dpKpi" style={{ "--kpi-accent": "#4f8ef7" } as React.CSSProperties}>
              <div className="dpKpiVal">{asana.avgOpenTaskAgeDays ?? "—"}<span style={{ fontSize: 13, color: "var(--text-3)" }}>d</span></div>
              <div className="dpKpiLbl">
                Avg backlog age {asana.medianOpenTaskAgeDays != null && <span style={{ opacity: 0.7 }}>({asana.medianOpenTaskAgeDays}d median)</span>}
                <InfoTip text="Mean days since creation across every currently-open task. Median is shown alongside since a few very old tasks can skew the average upward." />
              </div>
            </div>
            <div className="dpKpi" style={{ "--kpi-accent": "#a78bfa" } as React.CSSProperties}>
              <div className="dpKpiVal">{asana.avgCycleTimeDays ?? "—"}<span style={{ fontSize: 13, color: "var(--text-3)" }}>d</span></div>
              <div className="dpKpiLbl">
                Avg cycle time {asana.medianCycleTimeDays != null && <span style={{ opacity: 0.7 }}>({asana.medianCycleTimeDays}d median)</span>}
                <InfoTip text="Mean days from creation to completion, for tasks completed within the selected date range — how long work actually takes in practice." />
              </div>
            </div>
            <div className="dpKpi" style={{ "--kpi-accent": asana.workloadImbalancePct != null ? imbalanceLabel(asana.workloadImbalancePct).color : "var(--text-3)" } as React.CSSProperties}>
              <div className="dpKpiVal">{asana.workloadImbalancePct ?? "—"}{asana.workloadImbalancePct != null && <span style={{ fontSize: 13, color: "var(--text-3)" }}>%</span>}</div>
              <div className="dpKpiLbl">
                Workload balance {asana.workloadImbalancePct != null && (
                  <span style={{ color: imbalanceLabel(asana.workloadImbalancePct).color, opacity: 0.9 }}>({imbalanceLabel(asana.workloadImbalancePct).text})</span>
                )}
                <InfoTip text="How evenly open tasks are spread across bookkeepers (coefficient of variation of each person's open-task count). Lower % = more even; above ~60% means a few people are carrying most of the load." />
              </div>
            </div>
          </div>
          <div className="dpNote" style={{ marginTop: -8, marginBottom: 24 }}>
            Backlog age and workload balance reflect the current board and aren&apos;t affected by the date range above; cycle time is for tasks completed within it.
          </div>
        </>)}

        {/* ── Compliance Trackers ─────────────────────── */}
        {show("trackers") && (
          <div className="dpTableWrap" style={{ marginBottom: 28 }}>
            <div className="dpTableHead">
              <div>
                <div className="dpTableTitle">
                  Compliance Trackers
                  <InfoTip text="Every tracker marked active under Admin → Trackers (Fathom, BAS, EOFY, Pod Leaders, Client Meetings…). Each row shows open / total / completed-in-range / progress for that Asana project, counting tasks created since 1 Jan 2026. Expand a row (▾) to see its open tasks grouped by bookkeeper, each linking to the real Asana task; the tracker name links to the Asana project. Superannuation was retired in July 2026 (payday super) — re-activate it in Admin → Trackers if that changes." />
                </div>
                <div className="dpTableSub">Expand any tracker to see its open tasks broken down by bookkeeper · each links to Asana</div>
              </div>
            </div>
            <TrackerList trackers={asana.trackers} days={days} />
          </div>
        )}

        {/* ── Bookkeeper Finance Trackers ──────────────── */}
        {show("financeProjects") && financeProjects.length > 0 && (
          <div className="dpTableWrap" style={{ marginBottom: 28 }}>
            <div className="dpTableHead">
              <div>
                <div className="dpTableTitle">
                  Bookkeeper Finance Trackers
                  <InfoTip text="Each bookkeeper's personal 'Finance' project in Asana — their individual work tracker, one project per person. Counts every open task in that project (tasks created since 1 Jan 2026); Overdue means the task's due date has already passed. The bars rank who currently has the most open finance work." />
                </div>
                <div className="dpTableSub">Each bookkeeper&apos;s own Finance project · open &amp; overdue work per person</div>
              </div>
            </div>
            <RankedBarChart
              rows={financeProjects.map((p) => ({
                id: p.name,
                label: p.bookkeeper,
                values: { open: p.open, overdue: p.overdue },
              }))}
              metrics={[
                { key: "open", label: "Open tasks", color: "#22d3ee" },
                { key: "overdue", label: "Overdue", color: "#f87171" },
              ]}
            />
          </div>
        )}

        {/* ── Other Internal Projects ──────────────────── */}
        {show("otherProjects") && otherInternalProjects.length > 0 && (
          <div className="dpTableWrap" style={{ marginBottom: 28 }}>
            <div className="dpTableHead">
              <div>
                <div className="dpTableTitle">
                  Other Internal Projects
                  <InfoTip text="Internal (non-client) Asana projects that aren't already shown elsewhere on this page — e.g. the Month-End Checklist, EOFY Key Tasks, onboarding templates, and one-off internal projects. Client projects live in Client Workload (Additional Insights); the compliance trackers and per-bookkeeper Finance projects have their own sections above. Counts open tasks created since 1 Jan 2026." />
                </div>
                <div className="dpTableSub">Everything internal that isn&apos;t a tracker, EOFY, or Finance project</div>
              </div>
            </div>
            <table className="dpTable">
              <thead><tr><th>Project</th><th>Open</th><th>Overdue</th></tr></thead>
              <tbody>
                {otherInternalProjects.map((p) => (
                  <tr key={p.name}>
                    <td className="dpPrimary">{p.name}</td>
                    <td className="dpMuted">{p.open}</td>
                    <td style={{ color: p.overdue > 0 ? "#f87171" : "var(--text-3)", fontWeight: p.overdue > 0 ? 700 : 400, fontSize: 13 }}>{p.overdue}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* ── All Open Tasks (by bookkeeper, same style as the sections below) ── */}
        {show("allOpen") && (
          <div className="dpTableWrap" style={{ marginBottom: 28 }} id="section-open">
            <div className="dpTableHead">
              <div>
                <div className="dpTableTitle">
                  All Open Tasks
                  <InfoTip text="Every incomplete Asana task across all clients and projects right now (created since 1 Jan 2026), grouped by bookkeeper. Unassigned tasks group under 'Unassigned'. A live snapshot — the date range doesn't affect it. Click a name to see that person's actual task list." />
                </div>
                <div className="dpTableSub">{openByAssignee.length} bookkeeper{openByAssignee.length !== 1 ? "s" : ""} · {asana.openTasksSample.length} task{asana.openTasksSample.length !== 1 ? "s" : ""} · click a name for details</div>
              </div>
            </div>
            {openByAssignee.length === 0 ? (
              <div className="dpEmpty">No open tasks.</div>
            ) : (
              <ByAssigneeTable rows={openByAssignee} countLabel="Open" />
            )}
          </div>
        )}

        {/* ── Overdue Tasks ───────────────────────────── */}
        {show("overdue") && overdueByAssignee.length > 0 && (
          <div className="dpTableWrap" style={{ marginBottom: 28 }} id="section-overdue">
            <div className="dpTableHead">
              <div>
                <div className="dpTableTitle" style={{ color: "#f87171" }}>
                  Overdue Tasks
                  <InfoTip text="Open tasks whose due date has already passed (vs today, Australian time), grouped by bookkeeper. Tasks without a due date can never be overdue. A live snapshot — not affected by the date range. Click a name for the actual overdue list." />
                </div>
                <div className="dpTableSub">{overdueByAssignee.length} bookkeeper{overdueByAssignee.length !== 1 ? "s" : ""} · {asana.overdueTasks.length} task{asana.overdueTasks.length !== 1 ? "s" : ""} · click a name for details</div>
              </div>
            </div>
            <ByAssigneeTable rows={overdueByAssignee} countLabel="Overdue" />
          </div>
        )}

        {/* ── Due Soon ────────────────────────────────── */}
        {show("dueSoon") && dueSoonByAssignee.length > 0 && (
          <div className="dpTableWrap" style={{ marginBottom: 28 }} id="section-duesoon">
            <div className="dpTableHead">
              <div>
                <div className="dpTableTitle" style={{ color: "#fbbf24" }}>
                  Due in Next {days} Day{days !== 1 ? "s" : ""}
                  <InfoTip text="Open tasks due between today and the end of the selected date range — the forward-looking pipeline, separate from Overdue. Changing the range in the control panel changes this window. Grouped by bookkeeper; click a name for the task list." />
                </div>
                <div className="dpTableSub">{dueSoonByAssignee.length} bookkeeper{dueSoonByAssignee.length !== 1 ? "s" : ""} · {asana.dueSoonTasks.length} task{asana.dueSoonTasks.length !== 1 ? "s" : ""} · click a name for details</div>
              </div>
            </div>
            <ByAssigneeTable rows={dueSoonByAssignee} countLabel="Due Soon" />
          </div>
        )}

        {/* ── Recent Completions ──────────────────────── */}
        {show("completed") && completedByAssignee.length > 0 && (
          <div className="dpTableWrap" style={{ marginBottom: 28 }} id="section-completed">
            <div className="dpTableHead">
              <div>
                <div className="dpTableTitle" style={{ color: "#34d399" }}>
                  Recently Completed
                  <InfoTip text="Tasks marked complete in Asana within the selected date range, grouped by whoever they were assigned to. Follows the date range in the control panel. Click a name to see exactly which tasks they finished." />
                </div>
                <div className="dpTableSub">{completedByAssignee.length} bookkeeper{completedByAssignee.length !== 1 ? "s" : ""} · {asana.recentCompletions.length} task{asana.recentCompletions.length !== 1 ? "s" : ""}, {asana.rangeLabel}</div>
              </div>
            </div>
            <ByAssigneeTable rows={completedByAssignee} countLabel="Completed" />
          </div>
        )}

        {/* ── Recently Modified ───────────────────────── */}
        {show("modified") && modifiedByAssignee.length > 0 && (
          <div className="dpTableWrap" style={{ marginBottom: 28 }} id="section-modified">
            <div className="dpTableHead">
              <div>
                <div className="dpTableTitle">
                  Recently Modified
                  <InfoTip text="Open tasks that were touched (edited, commented, re-dated, etc.) in Asana within the selected date range — a proxy for where work is actively happening, even if nothing was completed. Grouped by bookkeeper; follows the date range." />
                </div>
                <div className="dpTableSub">{modifiedByAssignee.length} bookkeeper{modifiedByAssignee.length !== 1 ? "s" : ""} · {asana.recentlyModified.length} open task{asana.recentlyModified.length !== 1 ? "s" : ""}, {asana.rangeLabel}</div>
              </div>
            </div>
            <ByAssigneeTable rows={modifiedByAssignee} countLabel="Modified" />
          </div>
        )}

        {/* ── By Pod / By Assignee / By Client ─────── */}
        {show("byPodClient") && (
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20, marginBottom: 24 }}>

            {asana.topPods.length > 0 && (
              <div className="dpTableWrap">
                <div className="dpTableHead">
                  <div>
                    <div className="dpTableTitle">
                      Open by Pod
                      <InfoTip text="Open tasks grouped by the pod each task belongs to (matched via the client's pod in Supabase). Overdue = due date passed, with the % of that pod's open work it represents. Click a pod for its full drill-down page." />
                    </div>
                    <div className="dpTableSub">{asana.topPods.length} pods</div>
                  </div>
                </div>
                <table className="dpTable">
                  <thead><tr><th>Pod</th><th>Open</th><th>Overdue</th></tr></thead>
                  <tbody>
                    {asana.topPods.map((p) => (
                      <tr key={p.id}>
                        <td className="dpPrimary">
                          <Link href={`/dashboard/asana/pod/${p.id}`} style={{ color: "#4f8ef7", textDecoration: "none" }}>
                            {p.name} →
                          </Link>
                        </td>
                        <td className="dpMuted">{p.open}</td>
                        <td style={{ color: p.overdue > 0 ? "#f87171" : "var(--text-3)", fontWeight: p.overdue > 0 ? 600 : 400, fontSize: 13 }}>
                          {p.overdue}
                          {p.open > 0 && <span style={{ fontSize: 11, color: "var(--text-3)", fontWeight: 400 }}> ({Math.round((p.overdue / p.open) * 100)}%)</span>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            <div className="dpTableWrap">
              <div className="dpTableHead">
                <div>
                  <div className="dpTableTitle">
                    Open by Bookkeeper
                    <InfoTip text="The bookkeepers with the most open tasks right now (top 20 by open count). Same data as the By Bookkeeper chart above, in table form. Click a name for their full page." />
                  </div>
                  <div className="dpTableSub">Top {asana.topAssignees.length}</div>
                </div>
              </div>
              {asana.topAssignees.length === 0 ? (
                <div className="dpEmpty">No open tasks assigned.</div>
              ) : (
                <ByAssigneeTable
                  rows={asana.topAssignees.map((a) => ({ id: a.id ?? null, name: a.name, count: a.open }))}
                  countLabel="Open"
                />
              )}
            </div>

          </div>
        )}
      </main>

      {/* ══ Control panel (sidebar) ══════════════════════════ */}
      <ControlPanelShell storageKey="asana">
        <div className="dpSectionLbl" style={{ marginTop: 0 }}>Date range</div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 10 }}>
          {PRESETS.map((p) => (
            <button key={p.days} className={`acTab ${days === p.days ? "acTabActive" : ""}`} onClick={() => pickPreset(p.days)}>{p.label}</button>
          ))}
        </div>
        <div style={{ display: "flex", gap: 6 }}>
          <input className="dpRangeInput" type="number" min={1} max={MAX_DAYS} placeholder="Custom days" value={custom} onChange={(e) => setCustom(e.target.value)} onKeyDown={(e) => e.key === "Enter" && submitCustom()} style={{ flex: 1, minWidth: 0 }} />
          <button className={`acTab ${!PRESETS.some((p) => p.days === days) ? "acTabActive" : ""}`} onClick={submitCustom}>Go</button>
        </div>
        {loading && <div style={{ fontSize: 11, color: "var(--text-3)", marginTop: 8 }}>Loading…</div>}

        <div className="dpSectionLbl" style={{ marginTop: 16 }}>Show / hide</div>
        {["Charts", "Stats & tables"].map((group) => (
          <div key={group} style={{ marginBottom: 8 }}>
            <div style={{ fontSize: 10, color: "var(--text-3)", textTransform: "uppercase", letterSpacing: ".5px", margin: "6px 0 3px" }}>{group}</div>
            {PANELS.filter((p) => p.group === group).map((p) => (
              <label key={p.key} style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 12, padding: "3px 0", cursor: "pointer", color: "var(--text-2)" }}>
                <input type="checkbox" checked={visible[p.key]} onChange={() => togglePanel(p.key)} />
                {p.label}
              </label>
            ))}
          </div>
        ))}

        {asana.allPods.length > 0 && (
          <>
            <div className="dpSectionLbl" style={{ marginTop: 14 }}>Jump to pod</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {asana.allPods.map((p) => (
                <Link key={p.id} href={`/dashboard/asana/pod/${p.id}`} className="acTab" style={{ textDecoration: "none", textAlign: "center" }}>{p.name} →</Link>
              ))}
            </div>
          </>
        )}
      </ControlPanelShell>
    </div>
  );
}
