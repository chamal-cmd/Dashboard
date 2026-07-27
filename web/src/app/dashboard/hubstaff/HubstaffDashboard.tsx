"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import type { HubstaffOverview } from "@/lib/data/hubstaff";
import { InfoTip } from "@/components/InfoTip";
import { LoadingScreen } from "@/components/LoadingScreen";
import { HubstaffTrendChart } from "@/components/hubstaff/TrendChart";
import { PeriodComparison } from "@/components/hubstaff/PeriodComparison";
import { RankedBarChart } from "@/components/RankedBarChart";
import { LeaveCalendar } from "@/components/hubstaff/LeaveCalendar";
import { ControlPanelShell } from "@/components/ControlPanelShell";
import { auTodayISODateClient } from "@/lib/business-tz-client";
import "@/components/info-tip.css";

const PRESETS = [
  { label: "Today",  days: 1  },
  { label: "7 days", days: 7  },
  { label: "2 weeks", days: 14 },
  { label: "30 days", days: 30 },
] as const;

// Hubstaff's own API hard-rejects date ranges over 31 days.
const MAX_DAYS = 31;

// Every toggleable block on the page, in display order. Charts first (they
// render at the top of the main column); stats and tables below.
const PANELS = [
  { key: "leave", label: "Staff leave & calendar", group: "Charts" },
  { key: "compare", label: "Compare periods (chart)", group: "Charts" },
  { key: "trend", label: "Hours over time (chart)", group: "Charts" },
  { key: "byBkChart", label: "By bookkeeper (chart)", group: "Charts" },
  { key: "activity", label: "Activity", group: "Stats & tables" },
  { key: "consistency", label: "Consistency", group: "Stats & tables" },
  { key: "timeBreakdown", label: "Time breakdown", group: "Stats & tables" },
  { key: "byPod", label: "By pod", group: "Stats & tables" },
  { key: "byBkTable", label: "By bookkeeper (table)", group: "Stats & tables" },
  { key: "byProject", label: "By project", group: "Stats & tables" },
] as const;

type PanelKey = (typeof PANELS)[number]["key"];
const ALL_VISIBLE = Object.fromEntries(PANELS.map((p) => [p.key, true])) as Record<PanelKey, boolean>;
const VIS_STORAGE_KEY = "hubstaff-panel-visibility";

export default function HubstaffDashboard({ initial }: { initial: HubstaffOverview }) {
  const [days, setDays] = useState(7);
  const [custom, setCustom] = useState("");
  const [specificDate, setSpecificDate] = useState("");
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<HubstaffOverview>(initial);
  const [visible, setVisible] = useState<Record<PanelKey, boolean>>(ALL_VISIBLE);

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
    if ((d === days && !specificDate) || loading) return;
    setLoading(true);
    try {
      const res = await fetch(`/api/hubstaff/overview?days=${d}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setData(await res.json() as HubstaffOverview);
      setDays(d);
      setSpecificDate("");
    } catch { /* keep existing data and range */ } finally {
      setLoading(false);
    }
  }, [days, specificDate, loading]);

  const submitCustom = () => {
    const n = Math.floor(Number(custom));
    if (!isNaN(n) && n >= 1) pickPreset(Math.min(n, MAX_DAYS));
  };

  // Re-fetch whatever range is currently shown — unlike pickPreset, no
  // bail-out when the selection is unchanged.
  const refreshData = useCallback(async () => {
    if (loading) return;
    setLoading(true);
    try {
      const url = specificDate ? `/api/hubstaff/overview?date=${specificDate}` : `/api/hubstaff/overview?days=${days}`;
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setData(await res.json() as HubstaffOverview);
    } catch { /* keep existing data */ } finally {
      setLoading(false);
    }
  }, [days, specificDate, loading]);

  const pickDate = useCallback(async (date: string) => {
    if (!date || loading) return;
    setLoading(true);
    try {
      const res = await fetch(`/api/hubstaff/overview?date=${date}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setData(await res.json() as HubstaffOverview);
      setSpecificDate(date);
    } catch { /* keep existing data and range */ } finally {
      setLoading(false);
    }
  }, [loading]);

  if (loading) {
    return <LoadingScreen icon="⏱" title="HUBSTAFF" status="Loading Hubstaff data…" color="#4f8ef7" />;
  }

  if (data.error) {
    return <div className="hubUnavailable">Couldn&apos;t reach Hubstaff right now ({data.error}).</div>;
  }

  return (
    <div style={{ display: "flex", gap: 24, alignItems: "flex-start", flexWrap: "wrap" }}>
      {/* ══ Main column ══════════════════════════════════════ */}
      <main style={{ flex: 1, minWidth: 340 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 18, flexWrap: "wrap" }}>
          <div style={{ display: "inline-flex", alignItems: "center", gap: 8, background: "rgba(79,142,247,0.13)", border: "1px solid rgba(79,142,247,0.35)", color: "#93c5fd", borderRadius: 999, padding: "6px 14px", fontSize: 12, fontWeight: 600 }}>
            <span style={{ width: 7, height: 7, borderRadius: "50%", background: "#4f8ef7" }} />
            Showing {specificDate ? specificDate : data.rangeLabel} · weekdays only
          </div>
          <button className="acTab" onClick={refreshData} title="Re-fetch the latest data for the current range">
            ↻ Refresh
          </button>
        </div>

        {/* ── Graphs on top ─────────────────────────────── */}
        {visible.leave && (
          <div className="dpTableWrap" style={{ marginBottom: 20 }}>
            <div className="dpTableHead">
              <div>
                <div className="dpTableTitle">
                  Staff Leave
                  <InfoTip text="Approved time-off requests from Hubstaff's Time Off module (Annual, Sick, Compassionate, TOIL). 'Currently on leave' = requests covering today; the calendar shades each day by how many people are out (click a day for names); Upcoming and Past list future and historical approved leave. Denied requests are excluded." />
                </div>
                <div className="dpTableSub">Who&apos;s on leave now, upcoming, past history, and a calendar view — from Hubstaff&apos;s Time Off module</div>
              </div>
            </div>
            <LeaveCalendar />
          </div>
        )}

        {visible.compare && (
          <div className="dpTableWrap" style={{ marginBottom: 20 }}>
            <div className="dpTableHead"><div>
              <div className="dpTableTitle">
                Compare time periods
                <InfoTip text="Pick up to 6 time periods (presets like Last 7 days / Last month, or any custom date range) and compare total tracked hours across them, as bars or a pie. Weekdays only, straight from Hubstaff's daily activity data; hover or check the table for each period's activity %." />
              </div>
              <div className="dpTableSub">Pick any periods (presets or a custom range) and compare tracked hours — bar or pie</div>
            </div></div>
            <PeriodComparison />
          </div>
        )}

        {visible.trend && (
          <div className="dpTableWrap" style={{ marginBottom: 20 }}>
            <div className="dpTableHead"><div>
              <div className="dpTableTitle">
                Tracked hours over time
                <InfoTip text="Total tracked hours across the whole team for each weekday (or ISO week, via the toggle) inside the currently selected date range. Weekends are excluded. Hover a bar for that day's activity %. Change the date range in the control panel to widen or narrow the window." />
              </div>
              <div className="dpTableSub">Day-by-day (or week-by-week) trend within the selected range</div>
            </div></div>
            <HubstaffTrendChart trend={data.trend} />
          </div>
        )}

        {visible.byBkChart && data.members.length > 0 && (
          <div className="dpTableWrap" style={{ marginBottom: 20 }}>
            <div className="dpTableHead"><div>
              <div className="dpTableTitle">
                Tracked hours by bookkeeper
                <InfoTip text="Each person's total tracked hours (or activity %, via the toggle) within the selected date range, ranked highest-first. Weekdays only. Activity % is Hubstaff's keyboard/mouse activity measure relative to time tracked." />
              </div>
              <div className="dpTableSub">Ranked highest-first · toggle between tracked hours and activity %</div>
            </div></div>
            <RankedBarChart
              rows={data.members.map((m) => ({ id: String(m.userId), label: m.name, values: { hours: m.hours, activity: m.activityPct ?? 0 } }))}
              metrics={[
                { key: "hours", label: "Tracked hours", unit: "h", color: "#4f8ef7" },
                { key: "activity", label: "Activity", unit: "%", color: "#34d399" },
              ]}
            />
          </div>
        )}

        {/* ── Activity KPIs ─────────────────────────────── */}
        {visible.activity && (<>
          <div className="dpSectionLbl">Activity</div>
          <div className="dpKpiGrid dpKpiGrid3">
            <div className="dpKpi" style={{ "--kpi-accent": "#fb923c" } as React.CSSProperties}>
              <div className="dpKpiVal">{data.avgMemberActivityPct != null ? `${data.avgMemberActivityPct}%` : "—"}</div>
              <div className="dpKpiLbl">Avg activity (per member)<InfoTip text="Arithmetic mean of each active member's own activity % — every person counts equally, regardless of how many hours they logged." /></div>
            </div>
            <div className="dpKpi" style={{ "--kpi-accent": "#4f8ef7" } as React.CSSProperties}>
              <div className="dpKpiVal">{data.productivityPct != null ? `${data.productivityPct}%` : "—"}</div>
              <div className="dpKpiLbl">Org productivity (weighted)<InfoTip text="Total active time divided by total tracked time across everyone — hours-weighted, so people who tracked more time count for more." /></div>
            </div>
            <div className="dpKpi" style={{ "--kpi-accent": "#34d399" } as React.CSSProperties}>
              <div className="dpKpiVal">{data.activeCount ?? "—"}</div>
              <div className="dpKpiLbl">Active members<InfoTip text="Number of distinct people with at least some tracked time in the selected date range." /></div>
            </div>
          </div>
        </>)}

        {/* ── Consistency ───────────────────────────────── */}
        {visible.consistency && (<>
          <div className="dpSectionLbl">Consistency</div>
          <div className="dpKpiGrid dpKpiGridLast" style={{ gridTemplateColumns: "repeat(3, 1fr)" }}>
            <div className="dpKpi" style={{ "--kpi-accent": "#fb923c" } as React.CSSProperties}>
              <div className="dpKpiVal">{data.medianMemberActivityPct != null ? `${data.medianMemberActivityPct}%` : "—"}</div>
              <div className="dpKpiLbl">Median activity (typical member)<InfoTip text="The middle value of everyone's activity % — less skewed by a few outliers than the average above." /></div>
            </div>
            <div className="dpKpi" style={{ "--kpi-accent": "#a78bfa" } as React.CSSProperties}>
              <div className="dpKpiVal">{data.activityStdDevPct != null ? `±${data.activityStdDevPct}%` : "—"}</div>
              <div className="dpKpiLbl">Activity spread (std dev)<InfoTip text="How much individual activity % varies across the team. A low number means everyone's close to the average; a high number means some people are far above or below it." /></div>
            </div>
            <div className="dpKpi" style={{ "--kpi-accent": "#f87171" } as React.CSSProperties}>
              <div className="dpKpiVal">{data.idleRatioPct != null ? `${data.idleRatioPct}%` : "—"}</div>
              <div className="dpKpiLbl">Idle / tracked<InfoTip text="Idle hours as a percentage of total tracked hours." /></div>
            </div>
          </div>
        </>)}

        {/* ── Time breakdown ────────────────────────────── */}
        {visible.timeBreakdown && (<>
          <div className="dpSectionLbl">Time breakdown</div>
          <div className="dpKpiGrid dpKpiGridLast" style={{ gridTemplateColumns: "repeat(2, 1fr)" }}>
            <div className="dpKpi" style={{ "--kpi-accent": "#a78bfa" } as React.CSSProperties}>
              <div className="dpKpiVal">{data.hoursTracked ?? "—"}</div>
              <div className="dpKpiLbl">Hours tracked<InfoTip text="Total hours logged by everyone in the selected date range, across all projects." /></div>
            </div>
            <div className="dpKpi" style={{ "--kpi-accent": "#f87171" } as React.CSSProperties}>
              <div className="dpKpiVal">{data.idleHours ?? "—"}</div>
              <div className="dpKpiLbl">Idle hrs<InfoTip text="Tracked time with no keyboard/mouse activity detected." /></div>
            </div>
          </div>
        </>)}

        {/* ── By Pod ────────────────────────────────────── */}
        {visible.byPod && (<>
          <div className="dpSectionLbl">By Pod<InfoTip text="Tracked hours, activity % and idle hours per pod within the selected range. People are matched to pods by email against the Supabase pod roster (Hubstaff's own team filter is unreliable). Click a pod for its drill-down page." /></div>
          <div className="dpNote" style={{ marginTop: -4 }}>Real pod rosters matched by email against Supabase — Hubstaff&apos;s own team filter doesn&apos;t work.</div>
          <div className="dpTableWrap" style={{ marginBottom: 24 }}>
            {data.pods.length === 0 ? (
              <div className="dpEmpty">No pod-matched activity in this window.</div>
            ) : (
              <table className="dpTable">
                <thead><tr><th>Pod</th><th>Members</th><th>Hours</th><th>Activity</th><th>Idle</th></tr></thead>
                <tbody>
                  {data.pods.map((p) => (
                    <tr key={p.pod}>
                      <td className="dpPrimary">{p.podId ? <Link href={`/dashboard/hubstaff/pod/${p.podId}`}>{p.pod} →</Link> : p.pod}</td>
                      <td className="dpMuted">{p.memberCount}</td>
                      <td className="dpMuted">{p.hours}h</td>
                      <td className="dpMuted">{p.activityPct != null ? `${p.activityPct}%` : "—"}</td>
                      <td className="dpMuted">{p.idleHours}h</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </>)}

        {/* ── By Bookkeeper (table) ─────────────────────── */}
        {visible.byBkTable && (<>
          <div className="dpSectionLbl">By Bookkeeper<InfoTip text="Per-person table: pod, tracked hours and activity % within the selected range (weekdays only). A red LOW badge marks anyone more than one standard deviation below the team's average activity — a real outlier, not just below average." /></div>
          <div className="dpTableWrap" style={{ marginBottom: 24 }}>
            {data.members.length === 0 ? (
              <div className="dpEmpty">No tracked time in this window.</div>
            ) : (
              <table className="dpTable">
                <thead><tr><th>Bookkeeper</th><th>Pod</th><th>Hours</th><th>Activity</th></tr></thead>
                <tbody>
                  {data.members.map((m) => {
                    const isLow = m.activityPct != null && data.avgMemberActivityPct != null && data.activityStdDevPct != null && m.activityPct < data.avgMemberActivityPct - data.activityStdDevPct;
                    const memberPodId = data.pods.find((p) => p.pod === m.pod)?.podId;
                    return (
                      <tr key={m.userId}>
                        <td className="dpPrimary">
                          {m.name}
                          {isLow && <span title="More than 1 std dev below team average activity" style={{ marginLeft: 6, fontSize: 9, background: "#f8717120", color: "#f87171", borderRadius: 3, padding: "1px 5px", fontWeight: 700 }}>LOW</span>}
                        </td>
                        <td className="dpMuted">{m.pod ? (memberPodId ? <Link href={`/dashboard/hubstaff/pod/${memberPodId}`}>{m.pod}</Link> : m.pod) : "No pod"}</td>
                        <td className="dpMuted">{m.hours}h</td>
                        <td className="dpMuted" style={{ color: isLow ? "#f87171" : undefined }}>{m.activityPct != null ? `${m.activityPct}%` : "—"}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>
        </>)}

        {/* ── By Project ────────────────────────────────── */}
        {visible.byProject && (
          <div className="dpTableWrap" style={{ marginBottom: 24 }}>
            <div className="dpTableHead"><div>
              <div className="dpTableTitle">
                Hours by Project
                <InfoTip text="Tracked hours and activity % per Hubstaff project (usually one project per client) within the selected range, weekdays only, top 10 by hours." />
              </div>
              <div className="dpTableSub">{data.projects.length} project{data.projects.length !== 1 ? "s" : ""} with tracked time, {data.rangeLabel}</div>
            </div></div>
            {data.projects.length === 0 ? (
              <div className="dpEmpty">No tracked time in this window.</div>
            ) : (
              <table className="dpTable">
                <thead><tr><th>Project / Client</th><th>Hours</th><th>Activity</th></tr></thead>
                <tbody>
                  {data.projects.map((p) => (
                    <tr key={p.projectId}>
                      <td className="dpPrimary">{p.name}</td>
                      <td className="dpMuted">{p.hours}h</td>
                      <td className="dpMuted">{p.activityPct != null ? `${p.activityPct}%` : "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        )}

        {data.teams.length > 0 && <div className="dpNote">Hubstaff Teams: {data.teams.map((t) => t.name).join(", ")}</div>}
      </main>

      {/* ══ Control panel (sidebar) ══════════════════════════ */}
      <ControlPanelShell storageKey="hubstaff">
        <div className="dpSectionLbl" style={{ marginTop: 0 }}>Date range</div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 10 }}>
          {PRESETS.map((p) => (
            <button key={p.days} className={`acTab ${!specificDate && days === p.days ? "acTabActive" : ""}`} onClick={() => pickPreset(p.days)}>{p.label}</button>
          ))}
        </div>
        <div style={{ display: "flex", gap: 6, marginBottom: 8 }}>
          <input className="dpRangeInput" type="number" min={1} max={MAX_DAYS} placeholder="Custom days" value={custom} onChange={(e) => setCustom(e.target.value)} onKeyDown={(e) => e.key === "Enter" && submitCustom()} style={{ flex: 1, minWidth: 0 }} />
          <button className={`acTab ${!specificDate && !PRESETS.some((p) => p.days === days) ? "acTabActive" : ""}`} onClick={submitCustom}>Go</button>
        </div>
        <input className="dpRangeInput" type="date" value={specificDate} max={auTodayISODateClient()} onChange={(e) => pickDate(e.target.value)} style={{ width: "100%" }} title="Jump to a specific day" />

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

        {data.allPods.length > 0 && (
          <>
            <div className="dpSectionLbl" style={{ marginTop: 14 }}>Jump to pod</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {data.allPods.map((p) => (
                <Link key={p.id} href={`/dashboard/hubstaff/pod/${p.id}`} className="acTab" style={{ textDecoration: "none", textAlign: "center" }}>{p.name} →</Link>
              ))}
            </div>
          </>
        )}
      </ControlPanelShell>
    </div>
  );
}
