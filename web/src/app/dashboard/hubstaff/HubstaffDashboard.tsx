"use client";

import { useState, useCallback } from "react";
import type { HubstaffOverview } from "@/lib/data/hubstaff";

const PRESETS = [
  { label: "Today",  days: 1  },
  { label: "7 days", days: 7  },
  { label: "14 days",days: 14 },
  { label: "30 days",days: 30 },
  { label: "90 days",days: 90 },
] as const;

const POD_COLORS = ["#4f8ef7", "#a78bfa", "#22c55e", "#f59e0b", "#ef4444"];

const MAX_DAYS = 90;

export default function HubstaffDashboard({ initial }: { initial: HubstaffOverview }) {
  const [days, setDays] = useState(7);
  const [custom, setCustom] = useState("");
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<HubstaffOverview>(initial);

  const pickPreset = useCallback(async (d: number) => {
    if (d === days || loading) return;
    setLoading(true);
    try {
      const res = await fetch(`/api/hubstaff/overview?days=${d}`);
      // A non-OK response (401, 500) still parses as JSON — setting it as
      // data would wipe the dashboard, so treat it as a failure instead.
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setData(await res.json() as HubstaffOverview);
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

      {/* ── Activity KPIs ─────────────────────────────────── */}
      <div className="dpSectionLbl">Activity</div>
      <div className="dpKpiGrid dpKpiGrid3">
        <div className="dpKpi" style={{ "--kpi-accent": "#f97316" } as React.CSSProperties}>
          <div className="dpKpiVal">{data.avgMemberActivityPct != null ? `${data.avgMemberActivityPct}%` : "—"}</div>
          <div className="dpKpiLbl">Avg activity (per member)</div>
        </div>
        <div className="dpKpi" style={{ "--kpi-accent": "#4f8ef7" } as React.CSSProperties}>
          <div className="dpKpiVal">{data.productivityPct != null ? `${data.productivityPct}%` : "—"}</div>
          <div className="dpKpiLbl">Org productivity (weighted)</div>
        </div>
        <div className="dpKpi" style={{ "--kpi-accent": "#22c55e" } as React.CSSProperties}>
          <div className="dpKpiVal">{data.activeCount ?? "—"}</div>
          <div className="dpKpiLbl">Active members</div>
        </div>
      </div>

      {/* ── Consistency ──────────────────────────────────── */}
      {/* Mean alone can't tell "everyone steady at 70%" apart from "half at
          95%, half at 45%" — median + spread show which one this actually is. */}
      <div className="dpSectionLbl">Consistency</div>
      <div className="dpKpiGrid dpKpiGridLast" style={{ gridTemplateColumns: "repeat(4, 1fr)" }}>
        <div className="dpKpi" style={{ "--kpi-accent": "#f97316" } as React.CSSProperties}>
          <div className="dpKpiVal">{data.medianMemberActivityPct != null ? `${data.medianMemberActivityPct}%` : "—"}</div>
          <div className="dpKpiLbl">Median activity (typical member)</div>
        </div>
        <div className="dpKpi" style={{ "--kpi-accent": "#a78bfa" } as React.CSSProperties}>
          <div className="dpKpiVal">{data.activityStdDevPct != null ? `±${data.activityStdDevPct}%` : "—"}</div>
          <div className="dpKpiLbl">Activity spread (std dev)</div>
        </div>
        <div className="dpKpi" style={{ "--kpi-accent": "#22c55e" } as React.CSSProperties}>
          <div className="dpKpiVal">{data.billableRatioPct != null ? `${data.billableRatioPct}%` : "—"}</div>
          <div className="dpKpiLbl">Billable / tracked</div>
        </div>
        <div className="dpKpi" style={{ "--kpi-accent": "#ef4444" } as React.CSSProperties}>
          <div className="dpKpiVal">{data.idleRatioPct != null ? `${data.idleRatioPct}%` : "—"}</div>
          <div className="dpKpiLbl">Idle / tracked</div>
        </div>
      </div>

      {/* ── Time breakdown ────────────────────────────────── */}
      <div className="dpSectionLbl">Time breakdown</div>
      <div className="dpKpiGrid dpKpiGridLast" style={{ gridTemplateColumns: "repeat(5, 1fr)" }}>
        <div className="dpKpi" style={{ "--kpi-accent": "#a78bfa" } as React.CSSProperties}>
          <div className="dpKpiVal">{data.hoursTracked ?? "—"}</div>
          <div className="dpKpiLbl">Hours tracked</div>
        </div>
        <div className="dpKpi" style={{ "--kpi-accent": "#22c55e" } as React.CSSProperties}>
          <div className="dpKpiVal">{data.billableHours ?? "—"}</div>
          <div className="dpKpiLbl">Billable hrs</div>
        </div>
        <div className="dpKpi" style={{ "--kpi-accent": "#f59e0b" } as React.CSSProperties}>
          <div className="dpKpiVal">{data.manualHours ?? "—"}</div>
          <div className="dpKpiLbl">Manual hrs</div>
        </div>
        <div className="dpKpi" style={{ "--kpi-accent": "#ef4444" } as React.CSSProperties}>
          <div className="dpKpiVal">{data.idleHours ?? "—"}</div>
          <div className="dpKpiLbl">Idle hrs</div>
        </div>
        <div className="dpKpi" style={{ "--kpi-accent": "#6b7280" } as React.CSSProperties}>
          <div className="dpKpiVal">{data.workBreakHours ?? "—"}</div>
          <div className="dpKpiLbl">Work break hrs</div>
        </div>
      </div>

      {/* ── By Pod ────────────────────────────────────────── */}
      <div className="dpSectionLbl">By Pod</div>
      <div className="dpNote" style={{ marginTop: -4 }}>
        Real pod rosters matched by email against Supabase — Hubstaff&apos;s own team filter doesn&apos;t work.
      </div>
      {data.pods.length === 0 ? (
        <div className="dpTableWrap" style={{ marginBottom: 32 }}>
          <div className="dpEmpty">No pod-matched activity in this window.</div>
        </div>
      ) : (
        <div className="dpTileGrid" style={{ marginBottom: 32 }}>
          {data.pods.map((p, i) => (
            <div className="dpTile" key={p.pod} style={{ "--tile-accent": POD_COLORS[i % POD_COLORS.length] } as React.CSSProperties}>
              <div className="dpTileHead">
                <div>
                  <div className="dpTileTitle">{p.pod}</div>
                  <div className="dpTileSub">{p.memberCount} member{p.memberCount !== 1 ? "s" : ""} active</div>
                </div>
              </div>
              <div className="dpTileStats">
                <div>
                  <div className="dpTileStatVal">{p.hours}h</div>
                  <div className="dpTileStatLbl">Hours tracked</div>
                </div>
                <div>
                  <div className="dpTileStatVal">{p.activityPct != null ? `${p.activityPct}%` : "—"}</div>
                  <div className="dpTileStatLbl">Activity</div>
                </div>
                <div>
                  <div className="dpTileStatVal">{p.billableHours}h</div>
                  <div className="dpTileStatLbl">Billable</div>
                </div>
                <div>
                  <div className="dpTileStatVal">{p.idleHours}h</div>
                  <div className="dpTileStatLbl">Idle</div>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* ── By Bookkeeper ─────────────────────────────────── */}
      <div className="dpSectionLbl">By Bookkeeper</div>
      {data.members.length === 0 ? (
        <div className="dpTableWrap" style={{ marginBottom: 32 }}>
          <div className="dpEmpty">No tracked time in this window.</div>
        </div>
      ) : (
        <div className="dpTileGrid dpTileGridSmall" style={{ marginBottom: 32 }}>
          {data.members.map((m) => {
            // Flag as below-typical only when it's a real outlier (>1 std
            // dev under the mean), not just "below average" — half the team
            // is below average by definition, that's not a signal.
            const isLow =
              m.activityPct != null && data.avgMemberActivityPct != null && data.activityStdDevPct != null &&
              m.activityPct < data.avgMemberActivityPct - data.activityStdDevPct;
            return (
              <div className="dpPersonTile" key={m.userId}>
                <div className="dpPersonName">
                  {m.name}
                  {isLow && <span title="More than 1 std dev below team average activity" style={{ marginLeft: 6, fontSize: 9, background: "#ef444420", color: "#ef4444", borderRadius: 3, padding: "1px 5px", fontWeight: 700 }}>LOW</span>}
                </div>
                <div className="dpPersonEmail">{m.email}</div>
                <div className="dpPersonStats">
                  <div>
                    <div className="dpPersonHours">{m.hours}h</div>
                    <div className="dpTileStatLbl" style={{ color: isLow ? "#ef4444" : undefined }}>{m.activityPct != null ? `${m.activityPct}% active` : "—"}</div>
                  </div>
                  <div className="dpPersonMeta">
                    {m.pod ? <div>{m.pod}</div> : <div>No pod</div>}
                    <div>{m.billableHours}h billable</div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* ── By Project ────────────────────────────────────── */}
      <div className="dpTableWrap" style={{ marginBottom: 24 }}>
        <div className="dpTableHead">
          <div>
            <div className="dpTableTitle">Hours by Project</div>
            <div className="dpTableSub">{data.projects.length} project{data.projects.length !== 1 ? "s" : ""} with tracked time, {data.rangeLabel}</div>
          </div>
        </div>
        {data.projects.length === 0 ? (
          <div className="dpEmpty">No tracked time in this window.</div>
        ) : (
          <table className="dpTable">
            <thead>
              <tr><th>Project / Client</th><th>Hours</th><th>Activity</th></tr>
            </thead>
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

      {data.teams.length > 0 && (
        <div className="dpNote">Hubstaff Teams: {data.teams.map((t) => t.name).join(", ")}</div>
      )}
    </>
  );
}
