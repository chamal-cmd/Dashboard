"use client";

import { useState, useCallback } from "react";
import Link from "next/link";
import type { AircallOverview } from "@/lib/data/aircall";
import type { HubstaffOverview } from "@/lib/data/hubstaff";
import { InfoTip } from "@/components/InfoTip";
import { OverallCompletionChart } from "@/components/asana/OverallCompletionChart";
import { OrgWideDueChart } from "@/components/asana/OrgWideDueChart";
import { LastRefreshed } from "@/components/LastRefreshed";

const PRESETS = [
  { label: "Today", days: 1 },
  { label: "7 days", days: 7 },
  { label: "14 days", days: 14 },
  { label: "30 days", days: 30 },
] as const;

function formatDuration(seconds: number) {
  return `${Math.floor(seconds / 60)}:${(seconds % 60).toString().padStart(2, "0")}`;
}

export default function OverviewDashboard({ initialAircall, initialHubstaff }: {
  initialAircall: AircallOverview; initialHubstaff: HubstaffOverview;
}) {
  const [days, setDays] = useState(7);
  const [loading, setLoading] = useState(false);
  const [aircall, setAircall] = useState(initialAircall);
  const [hubstaff, setHubstaff] = useState(initialHubstaff);
  const [lastRefreshed, setLastRefreshed] = useState<Date | null>(null);

  // Re-fetches both Aircall and Hubstaff for a given day count — used by
  // both the preset buttons (which bail on a no-op click) and Refresh
  // (which doesn't), same split as every other range-picker page here.
  const load = useCallback(async (d: number) => {
    setLoading(true);
    try {
      const [aircallRes, hubstaffRes] = await Promise.all([
        fetch(`/api/aircall/overview?days=${d}`),
        fetch(`/api/hubstaff/overview?days=${d}`),
      ]);
      if (!aircallRes.ok || !hubstaffRes.ok) throw new Error("One or more sources failed to load");
      const [aircallJson, hubstaffJson] = await Promise.all([aircallRes.json(), hubstaffRes.json()]);
      setAircall(aircallJson as AircallOverview);
      setHubstaff(hubstaffJson as HubstaffOverview);
      setDays(d);
      setLastRefreshed(new Date());
    } catch { /* keep existing data and range */ } finally {
      setLoading(false);
    }
  }, []);

  const pickPreset = (d: number) => { if (d !== days && !loading) void load(d); };
  const refreshData = () => { if (!loading) void load(days); };

  const live = !aircall.error && !hubstaff.error;

  return (
    <div className="shellPage dpPage">
      <div className="dpHeader">
        <div className="dpHeaderLeft">
          <div className="dpTitle">Overview</div>
          <div className="dpSub">Org-wide, at a glance — Asana, Aircall, Hubstaff</div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <button className="acTab" onClick={refreshData} disabled={loading} title="Re-fetch the latest data for the current range">
            ↻ Refresh
          </button>
          <span className={`dpBadge ${live ? "dpBadgeLive" : "dpBadgeDown"}`}>{live ? "Live" : "Partial data"}</span>
        </div>
      </div>

      {/* ── Date range picker (Aircall + Hubstaff below) ─────────── */}
      <div className={`acTabBar ${loading ? "hubDateLoading" : ""}`}>
        {PRESETS.map((p) => (
          <button key={p.days} className={`acTab ${days === p.days ? "acTabActive" : ""}`} onClick={() => pickPreset(p.days)}>
            {p.label}
          </button>
        ))}
        {loading && <span style={{ fontSize: 11, color: "var(--text-3)", alignSelf: "center", marginLeft: 8 }}>Loading…</span>}
        <LastRefreshed at={lastRefreshed} />
      </div>

      {/* ── Asana — overall completion only, no pod breakdown (request ── */}
      {/* 2026-08-19) — not day-range-driven, same scope as their own pages */}
      <div className="dpSectionLbl">📋 Asana</div>
      <div style={{ display: "flex", gap: 14, flexWrap: "wrap", marginBottom: 14 }}>
        <div className="dpTableWrap" style={{ flex: 1, minWidth: 240, padding: "18px 20px" }}>
          <div className="dpTableTitle" style={{ marginBottom: 14 }}>📊 Fathom Report — overall</div>
          <OverallCompletionChart tracker="fathom" />
        </div>
        <div className="dpTableWrap" style={{ flex: 1, minWidth: 240, padding: "18px 20px" }}>
          <div className="dpTableTitle" style={{ marginBottom: 14 }}>🧾 BAS Lodgement — overall</div>
          <OverallCompletionChart tracker="bas" />
        </div>
      </div>
      <div style={{ marginBottom: 20 }}>
        <OrgWideDueChart />
      </div>

      {/* ── Aircall ───────────────────────────────────────── */}
      <div className="dpSectionLbl">
        ☎ Aircall
        <Link href="/dashboard/aircall" className="dpFilterChip" style={{ marginLeft: "auto" }}>Open dashboard →</Link>
      </div>
      {aircall.error ? (
        <div className="hubUnavailable" style={{ marginBottom: 20 }}>Couldn&apos;t reach Aircall ({aircall.error}).</div>
      ) : (
        <div className="dpKpiGrid dpKpiGridLast">
          <div className="dpKpi" style={{ "--kpi-accent": "#4f8ef7" } as React.CSSProperties}>
            <div className="dpKpiVal">{aircall.total ?? "—"}</div>
            <div className="dpKpiLbl">Calls<InfoTip text="All inbound and outbound calls in the selected date range." /></div>
          </div>
          <div className="dpKpi" style={{ "--kpi-accent": "#34d399" } as React.CSSProperties}>
            <div className="dpKpiVal">{aircall.inboundAnswered ?? "—"}</div>
            <div className="dpKpiLbl">Inbound answered<InfoTip text="Calls that came in from a customer and were actually answered." /></div>
          </div>
          <div className="dpKpi" style={{ "--kpi-accent": "#f87171" } as React.CSSProperties}>
            <div className="dpKpiVal">{aircall.missedOrVoicemail ?? "—"}</div>
            <div className="dpKpiLbl">Missed / voicemail<InfoTip text="Inbound calls that were never answered or went to voicemail." /></div>
          </div>
          <div className="dpKpi" style={{ "--kpi-accent": "#fbbf24" } as React.CSSProperties}>
            <div className="dpKpiVal">{aircall.missedRatePct != null ? `${aircall.missedRatePct}%` : "—"}</div>
            <div className="dpKpiLbl">Missed rate<InfoTip text="Missed or voicemailed calls as a % of all calls in range." /></div>
          </div>
          <div className="dpKpi" style={{ "--kpi-accent": "#a78bfa" } as React.CSSProperties}>
            <div className="dpKpiVal">{aircall.avgDurationSeconds != null ? formatDuration(aircall.avgDurationSeconds) : "—"}</div>
            <div className="dpKpiLbl">Avg call duration<InfoTip text="Mean call length across all calls in range." /></div>
          </div>
        </div>
      )}

      {/* ── Hubstaff ──────────────────────────────────────── */}
      <div className="dpSectionLbl">
        ⏱ Hubstaff
        <Link href="/dashboard/hubstaff" className="dpFilterChip" style={{ marginLeft: "auto" }}>Open dashboard →</Link>
      </div>
      {hubstaff.error ? (
        <div className="hubUnavailable" style={{ marginBottom: 20 }}>Couldn&apos;t reach Hubstaff ({hubstaff.error}).</div>
      ) : (
        <div className="dpKpiGrid dpKpiGridLast">
          <div className="dpKpi" style={{ "--kpi-accent": "#4f8ef7" } as React.CSSProperties}>
            <div className="dpKpiVal">{hubstaff.activeCount ?? "—"}</div>
            <div className="dpKpiLbl">Active members<InfoTip text="Members with any tracked time in the selected range." /></div>
          </div>
          <div className="dpKpi" style={{ "--kpi-accent": "#34d399" } as React.CSSProperties}>
            <div className="dpKpiVal">{hubstaff.hoursTracked != null ? `${hubstaff.hoursTracked}h` : "—"}</div>
            <div className="dpKpiLbl">Hours tracked<InfoTip text="Total time tracked across the whole team in range." /></div>
          </div>
          <div className="dpKpi" style={{ "--kpi-accent": "#a78bfa" } as React.CSSProperties}>
            <div className="dpKpiVal">{hubstaff.avgMemberActivityPct != null ? `${hubstaff.avgMemberActivityPct}%` : "—"}</div>
            <div className="dpKpiLbl">Avg activity<InfoTip text="Mean keyboard/mouse activity level across everyone tracked in range." /></div>
          </div>
          <div className="dpKpi" style={{ "--kpi-accent": "#fbbf24" } as React.CSSProperties}>
            <div className="dpKpiVal">{hubstaff.productivityPct != null ? `${hubstaff.productivityPct}%` : "—"}</div>
            <div className="dpKpiLbl">Productivity<InfoTip text="Billable hours as a % of all hours tracked in range." /></div>
          </div>
        </div>
      )}
    </div>
  );
}
