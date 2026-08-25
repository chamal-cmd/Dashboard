"use client";

import { useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import type { AsanaPodDetail } from "@/lib/data/asana-pod";
import { ByAssigneeTable, groupByAssignee } from "@/components/asana/ByAssigneeTable";
import { TrackerList } from "@/components/asana/TrackerList";
import { NetBadge, PaceBadge, imbalanceLabel } from "@/components/asana/RangeBadges";
import { InfoTip } from "@/components/InfoTip";
import { LoadingScreen } from "@/components/LoadingScreen";
import { displayName } from "@/lib/asana-client-map";
import { LastRefreshed } from "@/components/LastRefreshed";
import "@/components/info-tip.css";

const RANGE_PRESETS = [
  { label: "Day",   days: 1  },
  { label: "Week",  days: 7  },
  { label: "Month", days: 30 },
] as const;

const MAX_DAYS = 90;

export default function PodDashboard({
  initial,
  allPods,
}: {
  initial: AsanaPodDetail;
  allPods: { id: string; name: string }[];
}) {
  const router = useRouter();
  const [days, setDays] = useState(initial.rangeDays);
  const [custom, setCustom] = useState("");
  const [loading, setLoading] = useState(false);
  const [pod, setPod] = useState<AsanaPodDetail>(initial);
  const [lastRefreshed, setLastRefreshed] = useState<Date | null>(null);

  const load = useCallback(async (nextPodId: string, nextDays: number) => {
    setLoading(true);
    try {
      const res = await fetch(`/api/asana/pod/${nextPodId}?days=${nextDays}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json() as AsanaPodDetail;
      setPod(data);
      setDays(nextDays);
      setLastRefreshed(new Date());
      if (nextPodId !== pod.podId) router.replace(`/dashboard/asana/pod/${nextPodId}`, { scroll: false });
    } catch { /* keep existing data */ } finally {
      setLoading(false);
    }
  }, [pod.podId, router]);

  const submitCustom = () => {
    const n = Math.floor(Number(custom));
    if (!isNaN(n) && n >= 1) load(pod.podId, Math.min(n, MAX_DAYS));
  };

  const leader = pod.members.find((m) => m.isLeader);

  const openByAssignee = groupByAssignee(pod.openTasksSample);
  const overdueByAssignee = groupByAssignee(pod.overdueTasks);
  const dueSoonByAssignee = groupByAssignee(pod.dueSoonTasks);
  const completedByAssignee = groupByAssignee(pod.recentCompletions);
  const modifiedByAssignee = groupByAssignee(pod.recentlyModified);

  if (loading) {
    return <LoadingScreen icon="✓" title="ASANA" status="Loading Asana data…" color="#a78bfa" />;
  }

  return (
    <div className="shellPage dpPage">
      <div className="dpHeader">
        <div className="dpHeaderLeft">
          <div style={{ marginBottom: 6 }}>
            <Link href="/dashboard/asana" style={{ fontSize: 12, color: "#4f8ef7", textDecoration: "none" }}>← Asana overview</Link>
          </div>
          <div className="dpTitle">{pod.name}</div>
          <div className="dpSub">{leader ? `Led by ${leader.name}` : "Asana workload"}</div>
        </div>
        <span className="dpBadge dpBadgeLive">Live</span>
      </div>

      {/* ── Pod switcher ─────────────────────────────────── */}
      <div className="acTabBar" style={{ marginBottom: 16 }}>
        {allPods.map((p) => (
          <button
            key={p.id}
            className={`acTab ${p.id === pod.podId ? "acTabActive" : ""}`}
            onClick={() => load(p.id, days)}
          >
            {p.name}
          </button>
        ))}
      </div>

      {/* ── Date range picker ──────────────────────────────── */}
      <div className={`acTabBar ${loading ? "hubDateLoading" : ""}`} style={{ marginBottom: 28 }}>
        {RANGE_PRESETS.map((p) => (
          <button
            key={p.days}
            className={`acTab ${days === p.days ? "acTabActive" : ""}`}
            onClick={() => load(pod.podId, p.days)}
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
          <button className={`acTab ${!RANGE_PRESETS.some((p) => p.days === days) ? "acTabActive" : ""}`} onClick={submitCustom}>
            days
          </button>
        </span>
        <button className="acTab" onClick={() => load(pod.podId, days)} title="Re-fetch the latest data for the current range">
          ↻ Refresh
        </button>
        <LastRefreshed at={lastRefreshed} />
        {loading && <span style={{ fontSize: 11, color: "var(--text-3)", alignSelf: "center", marginLeft: 8 }}>Loading…</span>}
      </div>

      {/* ── Workload KPIs ─────────────────────────────────── */}
      <div className="dpSectionLbl">Workload</div>
      <div className="dpKpiGrid" style={{ gridTemplateColumns: "repeat(4, 1fr)" }}>
        <a className="dpKpi dpKpiLink" href="#section-open" style={{ "--kpi-accent": "#4f8ef7" } as React.CSSProperties}>
          <div className="dpKpiVal">{pod.open}</div>
          <div className="dpKpiLbl">Open tasks<InfoTip text="Every incomplete task currently assigned to this pod — a live count, not tied to the date range." /></div>
        </a>
        <a className="dpKpi dpKpiLink" href="#section-overdue" style={{ "--kpi-accent": "#f87171" } as React.CSSProperties}>
          <div className="dpKpiVal">
            {pod.overdue}
            {pod.overdueRatePct != null && <span style={{ fontSize: 12, color: "var(--text-3)", fontWeight: 400 }}> ({pod.overdueRatePct}% of open)</span>}
          </div>
          <div className="dpKpiLbl">Overdue<InfoTip text="This pod's open tasks whose due date has passed. The % is overdue divided by all open tasks in this pod." /></div>
        </a>
        <a className="dpKpi dpKpiLink" href="#section-duesoon" style={{ "--kpi-accent": "#fbbf24" } as React.CSSProperties}>
          <div className="dpKpiVal">{pod.dueSoon}</div>
          <div className="dpKpiLbl">Due in next 7 days<InfoTip text="This pod's open tasks due within the next 7 days — fixed at a week regardless of the Day/Week/Month picker above." /></div>
        </a>
        <div className="dpKpi" style={{ "--kpi-accent": "#a78bfa" } as React.CSSProperties}>
          <div className="dpKpiVal">{pod.avgOpenTaskAgeDays != null ? `${pod.avgOpenTaskAgeDays}d` : "—"}</div>
          <div className="dpKpiLbl">Avg open task age{pod.medianOpenTaskAgeDays != null ? ` (median ${pod.medianOpenTaskAgeDays}d)` : ""}<InfoTip text="Mean days since creation across this pod's open tasks. Median is shown too since a few very old tasks can skew the average upward." /></div>
        </div>
      </div>

      {/* ── Throughput / Overall completion ───────────────── */}
      <div className="dpSectionLbl" style={{ marginTop: 8 }}>Throughput — {pod.rangeLabel}</div>
      <div className="dpKpiGrid" style={{ gridTemplateColumns: "repeat(4, 1fr)" }}>
        <a className="dpKpi dpKpiLink" href="#section-completed" style={{ "--kpi-accent": "#34d399" } as React.CSSProperties}>
          <div className="dpKpiVal">{pod.completedInRange}</div>
          <div className="dpKpiLbl">Completed<InfoTip text="Tasks this pod marked complete within the selected date range." /></div>
        </a>
        <div className="dpKpi" style={{ "--kpi-accent": "#a78bfa" } as React.CSSProperties}>
          <div className="dpKpiVal">{pod.createdInRange}</div>
          <div className="dpKpiLbl">Created<InfoTip text="New tasks added to this pod within the selected range — compare against Completed to see if its backlog is growing or shrinking." /></div>
        </div>
        <div className="dpKpi" style={{ "--kpi-accent": "var(--text-3)" } as React.CSSProperties}>
          <div className="dpKpiVal">{pod.completedPrevPeriod}</div>
          <div className="dpKpiLbl">Completed, prior period<InfoTip text="This pod's completions in the equal-length period right before the current range — the baseline the Pace badge below compares against." /></div>
        </div>
        <div className="dpKpi" style={{ "--kpi-accent": "#4f8ef7" } as React.CSSProperties}>
          <div className="dpKpiVal">{pod.overallCompletionPct != null ? `${pod.overallCompletionPct}%` : "—"}</div>
          <div className="dpKpiLbl">Overall completion<InfoTip text="Completed-in-range divided by (completed-in-range + still open) — roughly, of the work in play this period, how much of it is actually done." /></div>
        </div>
      </div>

      <div style={{ display: "flex", gap: 24, marginTop: -8, marginBottom: 24, paddingLeft: 4 }}>
        <div style={{ fontSize: 11, color: "var(--text-3)" }}>
          Net: <NetBadge net={pod.netInRange} />
        </div>
        {pod.paceVsPrevPeriodPct != null && (
          <div style={{ fontSize: 11, color: "var(--text-3)" }}>
            Pace: <PaceBadge pct={pod.paceVsPrevPeriodPct} days={days} />
          </div>
        )}
      </div>

      {/* ── Backlog Health ─────────────────────────────────── */}
      <div className="dpSectionLbl">Backlog Health</div>
      <div className="dpKpiGrid dpKpiGridLast" style={{ gridTemplateColumns: "repeat(2, 1fr)" }}>
        <div className="dpKpi" style={{ "--kpi-accent": "#a78bfa" } as React.CSSProperties}>
          <div className="dpKpiVal">{pod.avgCycleTimeDays ?? "—"}<span style={{ fontSize: 13, color: "var(--text-3)" }}>d</span></div>
          <div className="dpKpiLbl">
            Avg cycle time {pod.medianCycleTimeDays != null && <span style={{ opacity: 0.7 }}>({pod.medianCycleTimeDays}d median)</span>}
            <InfoTip text="Mean days from creation to completion, for this pod's tasks completed within the selected range." />
          </div>
        </div>
        <div className="dpKpi" style={{ "--kpi-accent": pod.workloadImbalancePct != null ? imbalanceLabel(pod.workloadImbalancePct).color : "var(--text-3)" } as React.CSSProperties}>
          <div className="dpKpiVal">{pod.workloadImbalancePct ?? "—"}{pod.workloadImbalancePct != null && <span style={{ fontSize: 13, color: "var(--text-3)" }}>%</span>}</div>
          <div className="dpKpiLbl">
            Workload balance {pod.workloadImbalancePct != null && (
              <span style={{ color: imbalanceLabel(pod.workloadImbalancePct).color, opacity: 0.9 }}>({imbalanceLabel(pod.workloadImbalancePct).text})</span>
            )}
            <InfoTip text="How evenly open tasks are spread across this pod's members (coefficient of variation of each person's open-task count). Lower % = more even." />
          </div>
        </div>
      </div>
      <div className="dpNote" style={{ marginTop: -8, marginBottom: 24 }}>
        Workload balance reflects this pod&apos;s current open-task split across its members; cycle time is for tasks completed within the selected range.
      </div>

      {/* ── Compliance Trackers ────────────────────────────── */}
      <div className="dpTableWrap" style={{ marginBottom: 28 }}>
        <div className="dpTableHead">
          <div>
            <div className="dpTableTitle">Compliance Trackers<InfoTip text="This pod's share of every tracker marked active under Admin → Trackers (Fathom, BAS, EOFY, etc.), counting tasks attributed to this pod's members. Expand a row (▾) to see its open tasks by bookkeeper." /></div>
            <div className="dpTableSub">This pod&apos;s share — expand any tracker for its open tasks by bookkeeper</div>
          </div>
        </div>
        <TrackerList trackers={pod.trackers} days={days} />
      </div>

      {/* ── By Bookkeeper (member cards) ──────────────────── */}
      <div className="dpSectionLbl">By Bookkeeper<InfoTip text="One card per pod member. Total is every open task assigned to them; Due Today / Tomorrow / Pending is a strict split of that total (Pending covers everything else — overdue, further out, or no due date — so the four always add up to Total); Completed is within the selected date range." /></div>
      <div className="dpTileGrid" style={{ marginBottom: 32 }}>
        {pod.members.map((m) => (
          <div
            className="dpTile"
            key={m.assigneeId ?? m.name}
            style={{ "--tile-accent": m.isLeader ? "#fb923c" : "#4f8ef7" } as React.CSSProperties}
          >
            <div className="dpTileHead">
              <div>
                <div className="dpTileTitle">
                  {m.assigneeId ? (
                    <Link href={`/dashboard/asana/person/${m.assigneeId}`} style={{ color: "var(--text-1)", textDecoration: "none" }}>
                      {displayName(m.name)} →
                    </Link>
                  ) : displayName(m.name)}
                </div>
                {m.isLeader && <span className="dpBadgeChip dpChipAmber" style={{ marginTop: 4, display: "inline-block" }}>Pod Lead</span>}
              </div>
            </div>
            <div className="dpTileStats" style={{ gridTemplateColumns: "repeat(5, 1fr)" }}>
              <div>
                <div className="dpTileStatVal">{m.total}</div>
                <div className="dpTileStatLbl">Total</div>
              </div>
              <div>
                <div className="dpTileStatVal">{m.dueToday}</div>
                <div className="dpTileStatLbl">Due Today</div>
              </div>
              <div>
                <div className="dpTileStatVal">{m.tomorrow}</div>
                <div className="dpTileStatLbl">Tomorrow</div>
              </div>
              <div>
                <div className="dpTileStatVal">{m.pending}</div>
                <div className="dpTileStatLbl">Pending</div>
              </div>
              <div>
                <div className="dpTileStatVal" style={{ color: "#34d399" }}>{m.completedInRange}</div>
                <div className="dpTileStatLbl">Completed</div>
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* ── Open by Client ────────────────────────────────── */}
      <div className="dpTableWrap" style={{ marginBottom: 28 }}>
        <div className="dpTableHead">
          <div>
            <div className="dpTableTitle">Open by Client / Project<InfoTip text="This pod's open tasks grouped by the client project they belong to. A live snapshot — not affected by the date range." /></div>
            <div className="dpTableSub">{pod.openByProject.length} projects with open tasks</div>
          </div>
        </div>
        {pod.openByProject.length === 0 ? (
          <div className="dpEmpty">No open tasks.</div>
        ) : (
          <table className="dpTable">
            <thead><tr><th>Client / Project</th><th>Open</th><th>Overdue</th></tr></thead>
            <tbody>
              {pod.openByProject.map((p) => (
                <tr key={p.project}>
                  <td className="dpPrimary">{p.project}</td>
                  <td className="dpMuted">{p.open}</td>
                  <td style={{ color: p.overdue > 0 ? "#f87171" : "var(--text-3)", fontSize: 13 }}>{p.overdue}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* ── All open tasks (by bookkeeper, same style as the sections below) ── */}
      <div className="dpTableWrap" style={{ marginBottom: 28 }} id="section-open">
        <div className="dpTableHead">
          <div>
            <div className="dpTableTitle">All Open Tasks<InfoTip text="Every incomplete task assigned to this pod right now, grouped by bookkeeper. A live snapshot — the date range doesn't affect it. Click a name to see that person's actual task list." /></div>
            <div className="dpTableSub">{openByAssignee.length} member{openByAssignee.length !== 1 ? "s" : ""} · {pod.openTasksSample.length} task{pod.openTasksSample.length !== 1 ? "s" : ""} · click a name for details</div>
          </div>
        </div>
        {openByAssignee.length === 0 ? (
          <div className="dpEmpty">No open tasks.</div>
        ) : (
          <ByAssigneeTable rows={openByAssignee} countLabel="Open" />
        )}
      </div>

      {/* ── Overdue ───────────────────────────────────────── */}
      {overdueByAssignee.length > 0 && (
        <div className="dpTableWrap" style={{ marginBottom: 28 }} id="section-overdue">
          <div className="dpTableHead">
            <div>
              <div className="dpTableTitle" style={{ color: "#f87171" }}>Overdue Tasks<InfoTip text="This pod's open tasks whose due date has already passed, grouped by bookkeeper. A live snapshot — not affected by the date range. Click a name for the actual overdue list." /></div>
              <div className="dpTableSub">{overdueByAssignee.length} member{overdueByAssignee.length !== 1 ? "s" : ""} · {pod.overdueTasks.length} task{pod.overdueTasks.length !== 1 ? "s" : ""} · click a name for details</div>
            </div>
          </div>
          <ByAssigneeTable rows={overdueByAssignee} countLabel="Overdue" />
        </div>
      )}

      {/* ── Due soon ──────────────────────────────────────── */}
      {dueSoonByAssignee.length > 0 && (
        <div className="dpTableWrap" style={{ marginBottom: 28 }} id="section-duesoon">
          <div className="dpTableHead">
            <div>
              <div className="dpTableTitle" style={{ color: "#fbbf24" }}>Due in Next 7 Days<InfoTip text="This pod's open tasks due between today and 7 days out, grouped by bookkeeper — fixed at a week regardless of the date range picker above." /></div>
              <div className="dpTableSub">{dueSoonByAssignee.length} member{dueSoonByAssignee.length !== 1 ? "s" : ""} · {pod.dueSoonTasks.length} task{pod.dueSoonTasks.length !== 1 ? "s" : ""} · click a name for details</div>
            </div>
          </div>
          <ByAssigneeTable rows={dueSoonByAssignee} countLabel="Due Soon" />
        </div>
      )}

      {/* ── Recently completed ────────────────────────────── */}
      {completedByAssignee.length > 0 && (
        <div className="dpTableWrap" style={{ marginBottom: 28 }} id="section-completed">
          <div className="dpTableHead">
            <div>
              <div className="dpTableTitle" style={{ color: "#34d399" }}>Recently Completed<InfoTip text="This pod's tasks marked complete within the selected date range, grouped by bookkeeper." /></div>
              <div className="dpTableSub">{completedByAssignee.length} member{completedByAssignee.length !== 1 ? "s" : ""} · {pod.recentCompletions.length} task{pod.recentCompletions.length !== 1 ? "s" : ""}, {pod.rangeLabel}</div>
            </div>
          </div>
          <ByAssigneeTable rows={completedByAssignee} countLabel="Completed" />
        </div>
      )}

      {/* ── Recently modified ─────────────────────────────── */}
      {modifiedByAssignee.length > 0 && (
        <div className="dpTableWrap" style={{ marginBottom: 24 }} id="section-modified">
          <div className="dpTableHead">
            <div>
              <div className="dpTableTitle">Recently Modified<InfoTip text="This pod's open tasks that were touched (edited, commented, re-dated, etc.) in Asana within the selected date range — a proxy for where work is actively happening, even if nothing was completed." /></div>
              <div className="dpTableSub">{modifiedByAssignee.length} member{modifiedByAssignee.length !== 1 ? "s" : ""} · {pod.recentlyModified.length} open task{pod.recentlyModified.length !== 1 ? "s" : ""}, {pod.rangeLabel}</div>
            </div>
          </div>
          <ByAssigneeTable rows={modifiedByAssignee} countLabel="Modified" />
        </div>
      )}
    </div>
  );
}
