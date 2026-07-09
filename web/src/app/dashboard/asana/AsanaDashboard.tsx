"use client";

import { useState, useCallback } from "react";
import Link from "next/link";
import type { AsanaOverview, AsanaTask, TrackerStat } from "@/lib/data/asana";

const PRESETS = [
  { label: "Today",  days: 1  },
  { label: "7 days", days: 7  },
  { label: "14 days",days: 14 },
  { label: "30 days",days: 30 },
  { label: "90 days",days: 90 },
] as const;

const MAX_DAYS = 90;
const TODAY = new Date().toISOString().slice(0, 10);

function fmtDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = iso.slice(0, 10);
  const [y, m, mo] = d.split("-");
  const months = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
  const label = `${months[parseInt(m) - 1]} ${parseInt(mo)}`;
  return parseInt(y) !== new Date().getFullYear() ? `${label}, ${y}` : label;
}

function isOverdue(dueOn: string | null): boolean {
  return !!dueOn && dueOn < TODAY;
}

function TaskRow({ task, showCompleted }: { task: AsanaTask; showCompleted?: boolean }) {
  const overdue = !showCompleted && isOverdue(task.dueOn);
  return (
    <tr>
      <td className="dpPrimary" style={{ maxWidth: 320, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
        {task.name || "—"}
      </td>
      <td className="dpMuted" style={{ whiteSpace: "nowrap" }}>{task.assigneeName ?? "—"}</td>
      <td className="dpMuted" style={{ whiteSpace: "nowrap", color: overdue ? "#ef4444" : undefined }}>
        {showCompleted ? fmtDate(task.completedAt) : fmtDate(task.dueOn)}
        {overdue && <span style={{ fontSize: 9, background: "#ef444420", color: "#ef4444", borderRadius: 3, padding: "0 4px", marginLeft: 6 }}>overdue</span>}
      </td>
      <td className="dpMuted" style={{ maxWidth: 180, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontSize: 11 }}>
        {task.projectName ?? "—"}
      </td>
    </tr>
  );
}

function TrackerRow({ t, days }: { t: TrackerStat; days: number }) {
  const pct = t.total && t.total > 0 ? Math.round(((t.total - (t.open ?? 0)) / t.total) * 100) : null;
  return (
    <tr key={t.key}>
      <td className="dpPrimary">{t.label}</td>
      <td style={{ color: (t.open ?? 0) > 0 ? "#f97316" : "#22c55e", fontWeight: 600, fontSize: 13 }}>
        {t.open ?? "—"}
      </td>
      <td className="dpMuted">{t.total ?? (t.open === null ? "—" : "—")}</td>
      <td style={{ color: "#22c55e", fontSize: 12 }}>{t.completedInRange ?? "—"}</td>
      <td className="dpMuted">
        {pct != null ? (
          <span style={{ fontSize: 11 }}>
            <span style={{ display: "inline-block", width: 60, height: 4, background: "#1e2230", borderRadius: 2, verticalAlign: "middle", marginRight: 6, position: "relative", overflow: "hidden" }}>
              <span style={{ position: "absolute", left: 0, top: 0, height: "100%", width: `${pct}%`, background: pct >= 80 ? "#22c55e" : pct >= 50 ? "#f97316" : "#ef4444", borderRadius: 2 }} />
            </span>
            {pct}%
          </span>
        ) : "—"}
      </td>
    </tr>
  );
}

function NetBadge({ net }: { net: number }) {
  if (net === 0) return <span style={{ color: "#6b7280", fontSize: 11 }}>±0</span>;
  const up = net > 0;
  return (
    <span style={{ color: up ? "#ef4444" : "#22c55e", fontSize: 11, fontWeight: 600 }}>
      {up ? "▲" : "▼"} {Math.abs(net)} net {up ? "increase" : "decrease"}
    </span>
  );
}

function PaceBadge({ pct, days }: { pct: number; days: number }) {
  if (Math.abs(pct) < 5) return <span style={{ color: "#6b7280", fontSize: 11 }}>on pace with the prior {days}-day period</span>;
  const ahead = pct > 0;
  return (
    <span style={{ color: ahead ? "#22c55e" : "#ef4444", fontSize: 11, fontWeight: 600 }}>
      {ahead ? "▲" : "▼"} {Math.abs(pct)}% {ahead ? "ahead of" : "behind"} the prior {days}-day period
    </span>
  );
}

function imbalanceLabel(pct: number): { text: string; color: string } {
  if (pct < 30) return { text: "well balanced", color: "#22c55e" };
  if (pct < 60) return { text: "some imbalance", color: "#f97316" };
  return { text: "highly imbalanced", color: "#ef4444" };
}

export default function AsanaDashboard({ initial }: { initial: AsanaOverview }) {
  const [days, setDays] = useState(initial.rangeDays);
  const [custom, setCustom] = useState("");
  const [loading, setLoading] = useState(false);
  const [asana, setAsana] = useState<AsanaOverview>(initial);

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

  return (
    <>
      {/* ── Date range picker ──────────────────────────────── */}
      <div className={`acTabBar ${loading ? "hubDateLoading" : ""}`} style={{ marginBottom: 28 }}>
        {PRESETS.map((p) => (
          <button
            key={p.days}
            className={`acTab ${days === p.days ? "acTabActive" : ""}`}
            onClick={() => pickPreset(p.days)}
          >
            {p.label}
          </button>
        ))}
        <span className="dpRangeCustom">
          <input
            className="dpRangeInput"
            type="number"
            min={1}
            max={MAX_DAYS}
            placeholder="Custom"
            value={custom}
            onChange={(e) => setCustom(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && submitCustom()}
          />
          <button className={`acTab ${!PRESETS.some((p) => p.days === days) ? "acTabActive" : ""}`} onClick={submitCustom}>
            days
          </button>
        </span>
        {loading && <span style={{ fontSize: 11, color: "#6b7280", alignSelf: "center", marginLeft: 8 }}>Loading…</span>}
      </div>

      {/* ── Volume KPIs ─────────────────────────────── */}
      <div className="dpSectionLbl">Open Tasks</div>
      <div className="dpKpiGrid dpKpiGrid3">
        <div className="dpKpi" style={{ "--kpi-accent": "#4f8ef7" } as React.CSSProperties}>
          <div className="dpKpiVal">{asana.openTotal ?? "—"}</div>
          <div className="dpKpiLbl">Open tasks (all clients)</div>
        </div>
        <div className="dpKpi" style={{ "--kpi-accent": "#ef4444" } as React.CSSProperties}>
          <div className="dpKpiVal">
            {asana.overdueCount ?? "—"}
            {asana.overdueRatePct != null && <span style={{ fontSize: 12, color: "#6b7280", fontWeight: 400 }}> ({asana.overdueRatePct}% of open)</span>}
          </div>
          <div className="dpKpiLbl">Overdue</div>
        </div>
        <div className="dpKpi" style={{ "--kpi-accent": "#fbbf24" } as React.CSSProperties}>
          <div className="dpKpiVal">{asana.dueSoonCount ?? "—"}</div>
          <div className="dpKpiLbl">Due in next {days} day{days !== 1 ? "s" : ""}</div>
        </div>
      </div>

      {/* ── Velocity KPIs ───────────────────────────── */}
      <div className="dpSectionLbl" style={{ marginTop: 8 }}>Velocity — {asana.rangeLabel}</div>
      <div className="dpKpiGrid dpKpiGridLast" style={{ gridTemplateColumns: "repeat(3, 1fr)" }}>
        <div className="dpKpi" style={{ "--kpi-accent": "#22c55e" } as React.CSSProperties}>
          <div className="dpKpiVal">{asana.velocity?.completedInRange ?? "—"}</div>
          <div className="dpKpiLbl">Completed</div>
        </div>
        <div className="dpKpi" style={{ "--kpi-accent": "#a78bfa" } as React.CSSProperties}>
          <div className="dpKpiVal">{asana.velocity?.createdInRange ?? "—"}</div>
          <div className="dpKpiLbl">Created</div>
        </div>
        <div className="dpKpi" style={{ "--kpi-accent": "#6b7280" } as React.CSSProperties}>
          <div className="dpKpiVal">{asana.velocity?.completedPrevPeriod ?? "—"}</div>
          <div className="dpKpiLbl">Completed, prior period</div>
        </div>
      </div>

      {asana.velocity && (
        <div style={{ display: "flex", gap: 24, marginTop: -8, marginBottom: 24, paddingLeft: 4 }}>
          <div style={{ fontSize: 11, color: "#6b7280" }}>
            Net: <NetBadge net={asana.velocity.netInRange} />
          </div>
          {asana.paceVsPrevPeriodPct != null && (
            <div style={{ fontSize: 11, color: "#6b7280" }}>
              Pace: <PaceBadge pct={asana.paceVsPrevPeriodPct} days={days} />
            </div>
          )}
        </div>
      )}

      {/* ── Workload & Pace ──────────────────────────── */}
      <div className="dpSectionLbl">Backlog Health</div>
      <div className="dpKpiGrid dpKpiGridLast" style={{ gridTemplateColumns: "repeat(3, 1fr)" }}>
        <div className="dpKpi" style={{ "--kpi-accent": "#4f8ef7" } as React.CSSProperties}>
          <div className="dpKpiVal">{asana.avgOpenTaskAgeDays ?? "—"}<span style={{ fontSize: 13, color: "#6b7280" }}>d</span></div>
          <div className="dpKpiLbl">
            Avg backlog age {asana.medianOpenTaskAgeDays != null && <span style={{ opacity: 0.7 }}>({asana.medianOpenTaskAgeDays}d median)</span>}
          </div>
        </div>
        <div className="dpKpi" style={{ "--kpi-accent": "#a78bfa" } as React.CSSProperties}>
          <div className="dpKpiVal">{asana.avgCycleTimeDays ?? "—"}<span style={{ fontSize: 13, color: "#6b7280" }}>d</span></div>
          <div className="dpKpiLbl">
            Avg cycle time {asana.medianCycleTimeDays != null && <span style={{ opacity: 0.7 }}>({asana.medianCycleTimeDays}d median)</span>}
          </div>
        </div>
        <div className="dpKpi" style={{ "--kpi-accent": asana.workloadImbalancePct != null ? imbalanceLabel(asana.workloadImbalancePct).color : "#6b7280" } as React.CSSProperties}>
          <div className="dpKpiVal">{asana.workloadImbalancePct ?? "—"}{asana.workloadImbalancePct != null && <span style={{ fontSize: 13, color: "#6b7280" }}>%</span>}</div>
          <div className="dpKpiLbl">
            Workload balance {asana.workloadImbalancePct != null && (
              <span style={{ color: imbalanceLabel(asana.workloadImbalancePct).color, opacity: 0.9 }}>({imbalanceLabel(asana.workloadImbalancePct).text})</span>
            )}
          </div>
        </div>
      </div>
      <div className="dpNote" style={{ marginTop: -8, marginBottom: 24 }}>
        Backlog age and workload balance reflect the current board and aren&apos;t affected by the date range above; cycle time is for tasks completed within it.
      </div>

      {/* ── Compliance Trackers ─────────────────────── */}
      <div className="dpTableWrap" style={{ marginBottom: 28 }}>
        <div className="dpTableHead">
          <div>
            <div className="dpTableTitle">Compliance Trackers</div>
            <div className="dpTableSub">Monthly reporting, superannuation, BAS lodgement, EOFY</div>
          </div>
        </div>
        <table className="dpTable">
          <thead>
            <tr>
              <th>Tracker</th>
              <th>Open</th>
              <th>Total</th>
              <th>Completed ({days}d)</th>
              <th>Progress</th>
            </tr>
          </thead>
          <tbody>
            {asana.trackers.map((t) => <TrackerRow key={t.key} t={t} days={days} />)}
          </tbody>
        </table>
      </div>

      {/* ── Overdue Tasks ───────────────────────────── */}
      {asana.overdueTasks.length > 0 && (
        <div className="dpTableWrap" style={{ marginBottom: 28 }}>
          <div className="dpTableHead">
            <div>
              <div className="dpTableTitle" style={{ color: "#ef4444" }}>Overdue Tasks</div>
              <div className="dpTableSub">Oldest first — showing up to {asana.overdueTasks.length}</div>
            </div>
          </div>
          <table className="dpTable">
            <thead>
              <tr><th>Task</th><th>Assignee</th><th>Due</th><th>Project</th></tr>
            </thead>
            <tbody>
              {asana.overdueTasks.map((t) => <TaskRow key={t.id} task={t} />)}
            </tbody>
          </table>
        </div>
      )}

      {/* ── Due Soon ────────────────────────────────── */}
      {asana.dueSoonTasks.length > 0 && (
        <div className="dpTableWrap" style={{ marginBottom: 28 }}>
          <div className="dpTableHead">
            <div>
              <div className="dpTableTitle" style={{ color: "#fbbf24" }}>Due in Next {days} Day{days !== 1 ? "s" : ""}</div>
              <div className="dpTableSub">Earliest first — showing {asana.dueSoonTasks.length}</div>
            </div>
          </div>
          <table className="dpTable">
            <thead>
              <tr><th>Task</th><th>Assignee</th><th>Due</th><th>Project</th></tr>
            </thead>
            <tbody>
              {asana.dueSoonTasks.map((t) => <TaskRow key={t.id} task={t} />)}
            </tbody>
          </table>
        </div>
      )}

      {/* ── Recent Completions ──────────────────────── */}
      {asana.recentCompletions.length > 0 && (
        <div className="dpTableWrap" style={{ marginBottom: 28 }}>
          <div className="dpTableHead">
            <div>
              <div className="dpTableTitle" style={{ color: "#22c55e" }}>Recently Completed</div>
              <div className="dpTableSub">{asana.rangeLabel}, showing {asana.recentCompletions.length}</div>
            </div>
          </div>
          <table className="dpTable">
            <thead>
              <tr><th>Task</th><th>Assignee</th><th>Completed</th><th>Project</th></tr>
            </thead>
            <tbody>
              {asana.recentCompletions.map((t) => <TaskRow key={t.id} task={t} showCompleted />)}
            </tbody>
          </table>
        </div>
      )}

      {/* ── Recently Modified ───────────────────────── */}
      {asana.recentlyModified.length > 0 && (
        <div className="dpTableWrap" style={{ marginBottom: 28 }}>
          <div className="dpTableHead">
            <div>
              <div className="dpTableTitle">Recently Modified</div>
              <div className="dpTableSub">Open tasks, {asana.rangeLabel} — most recently updated first</div>
            </div>
          </div>
          <table className="dpTable">
            <thead>
              <tr><th>Task</th><th>Assignee</th><th>Due</th><th>Project</th></tr>
            </thead>
            <tbody>
              {asana.recentlyModified.map((t) => <TaskRow key={t.id} task={t} />)}
            </tbody>
          </table>
        </div>
      )}

      {/* ── By Pod / By Assignee / By Client ─────── */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 20, marginBottom: 24 }}>

        {asana.topPods.length > 0 && (
          <div className="dpTableWrap">
            <div className="dpTableHead">
              <div>
                <div className="dpTableTitle">Open by Pod</div>
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
                    <td style={{ color: p.overdue > 0 ? "#ef4444" : "#6b7280", fontWeight: p.overdue > 0 ? 600 : 400, fontSize: 13 }}>
                      {p.overdue}
                      {p.open > 0 && <span style={{ fontSize: 11, color: "#6b7280", fontWeight: 400 }}> ({Math.round((p.overdue / p.open) * 100)}%)</span>}
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
              <div className="dpTableTitle">Open by Bookkeeper</div>
              <div className="dpTableSub">Top {asana.topAssignees.length}</div>
            </div>
          </div>
          {asana.topAssignees.length === 0 ? (
            <div className="dpEmpty">No open tasks assigned.</div>
          ) : (
            <table className="dpTable">
              <thead><tr><th>Bookkeeper</th><th>Open</th></tr></thead>
              <tbody>
                {asana.topAssignees.map((a) => (
                  <tr key={a.id ?? a.name}>
                    <td className="dpPrimary">
                      {a.id ? (
                        <Link href={`/dashboard/asana/person/${a.id}`} style={{ color: "#4f8ef7", textDecoration: "none" }}>
                          {a.name} →
                        </Link>
                      ) : a.name}
                    </td>
                    <td className="dpMuted">{a.open}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        <div className="dpTableWrap">
          <div className="dpTableHead">
            <div>
              <div className="dpTableTitle">Open by Client</div>
              <div className="dpTableSub">Top {asana.topClients.length} (excl. internal)</div>
            </div>
          </div>
          {asana.topClients.length === 0 ? (
            <div className="dpEmpty">No open client tasks.</div>
          ) : (
            <table className="dpTable">
              <thead><tr><th>Client / Project</th><th>Open</th></tr></thead>
              <tbody>
                {asana.topClients.map((c) => (
                  <tr key={c.name}>
                    <td className="dpPrimary">{c.name}</td>
                    <td className="dpMuted">{c.open}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </>
  );
}
