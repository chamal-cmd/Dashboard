"use client";

import { useState, useCallback } from "react";
import Link from "next/link";
import { LoadingScreen } from "@/components/LoadingScreen";

interface AircallAgentStat {
  email: string; name: string; pod: string | null;
  total: number; inbound: number; outboundAnswered: number; outboundUnanswered: number; missedOrVoicemail: number;
}
interface AircallOverview {
  byAgent: AircallAgentStat[];
  error?: string;
}

const PRESETS = [
  { label: "Today", days: 1 },
  { label: "7 days", days: 7 },
  { label: "14 days", days: 14 },
  { label: "30 days", days: 30 },
  { label: "90 days", days: 90 },
] as const;

const MAX_DAYS = 90;

// Aircall has no server-side "give me just this pod's calls" endpoint, so
// this reuses the exact same org-wide /api/aircall/overview fetch as the
// main Aircall page and just filters byAgent down to this pod's agents —
// same approach as Hubstaff's pod page, just recomputed from byAgent instead
// of a members list.
export default function AircallPodDashboard({
  podName,
  initial,
}: {
  podName: string;
  initial: AircallOverview;
}) {
  const [days, setDays] = useState(7);
  const [custom, setCustom] = useState("");
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<AircallOverview>(initial);

  const fetchRange = useCallback(async (d: number) => {
    if (d === days || loading) return;
    setLoading(true);
    try {
      const res = await fetch(`/api/aircall/overview?days=${d}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setData(await res.json() as AircallOverview);
      setDays(d);
    } catch { /* keep existing data and range */ } finally {
      setLoading(false);
    }
  }, [days, loading]);

  const submitCustom = () => {
    const n = Math.floor(Number(custom));
    if (!isNaN(n) && n >= 1) fetchRange(Math.min(n, MAX_DAYS));
  };

  if (loading) {
    return <LoadingScreen icon="☎" title="AIRCALL" status="Loading Aircall data…" color="#34d399" />;
  }

  if (data.error) {
    return (
      <div className="shellPage dpPage">
        <div className="hubUnavailable">Aircall: {data.error}</div>
      </div>
    );
  }

  const podAgents = data.byAgent
    .filter((a) => a.pod === podName)
    .sort((a, b) => b.total - a.total);

  const total = podAgents.reduce((s, a) => s + a.total, 0);
  const inbound = podAgents.reduce((s, a) => s + a.inbound, 0);
  const outboundAnswered = podAgents.reduce((s, a) => s + a.outboundAnswered, 0);
  const outboundUnanswered = podAgents.reduce((s, a) => s + a.outboundUnanswered, 0);
  const missedOrVoicemail = podAgents.reduce((s, a) => s + a.missedOrVoicemail, 0);

  return (
    <div className="shellPage dpPage">
      <div className="dpHeader">
        <div className="dpHeaderLeft">
          <div style={{ marginBottom: 6 }}>
            <Link href="/dashboard/aircall" style={{ fontSize: 12, color: "#34d399", textDecoration: "none" }}>← Aircall overview</Link>
          </div>
          <div className="dpTitle">{podName}</div>
          <div className="dpSub">{podAgents.length} agent{podAgents.length !== 1 ? "s" : ""} · Aircall activity</div>
        </div>
        <span className="dpBadge dpBadgeLive">Live</span>
      </div>

      {/* ── Date range picker ──────────────────────────────── */}
      <div className="acTabBar" style={{ marginBottom: 28 }}>
        {PRESETS.map((p) => (
          <button
            key={p.days}
            className={`acTab ${days === p.days ? "acTabActive" : ""}`}
            onClick={() => fetchRange(p.days)}
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
      </div>

      {/* ── KPIs ─────────────────────────────────────────── */}
      <div className="dpKpiGrid dpKpiGridLast" style={{ gridTemplateColumns: "repeat(5, 1fr)" }}>
        <div className="dpKpi" style={{ "--kpi-accent": "#34d399" } as React.CSSProperties}>
          <div className="dpKpiVal">{total}</div>
          <div className="dpKpiLbl">Total calls</div>
        </div>
        <div className="dpKpi" style={{ "--kpi-accent": "#4f8ef7" } as React.CSSProperties}>
          <div className="dpKpiVal">{inbound}</div>
          <div className="dpKpiLbl">Inbound</div>
        </div>
        <div className="dpKpi" style={{ "--kpi-accent": "#a78bfa" } as React.CSSProperties}>
          <div className="dpKpiVal">{outboundAnswered}</div>
          <div className="dpKpiLbl">Outbound answered</div>
        </div>
        <div className="dpKpi" style={{ "--kpi-accent": "#fbbf24" } as React.CSSProperties}>
          <div className="dpKpiVal">{outboundUnanswered}</div>
          <div className="dpKpiLbl">Outbound unanswered</div>
        </div>
        <div className="dpKpi" style={{ "--kpi-accent": "#f87171" } as React.CSSProperties}>
          <div className="dpKpiVal">{missedOrVoicemail}</div>
          <div className="dpKpiLbl">Missed / voicemail</div>
        </div>
      </div>

      {/* ── By Agent ─────────────────────────────────────── */}
      <div className="dpTableWrap" style={{ marginBottom: 24 }}>
        <div className="dpTableHead">
          <div>
            <div className="dpTableTitle">By Agent</div>
            <div className="dpTableSub">Everyone in this pod who took at least one call in range</div>
          </div>
        </div>
        {podAgents.length === 0 ? (
          <div className="dpEmpty">No calls in this period.</div>
        ) : (
          <table className="dpTable">
            <thead><tr><th>Agent</th><th>Total</th><th>Inbound</th><th>Outbound Answered</th><th>Missed / Voicemail</th></tr></thead>
            <tbody>
              {podAgents.map((a) => (
                <tr key={a.email}>
                  <td className="dpPrimary">{a.name}</td>
                  <td className="dpMuted">{a.total}</td>
                  <td className="dpMuted">{a.inbound}</td>
                  <td style={{ color: "#a78bfa", fontWeight: 700 }}>{a.outboundAnswered}</td>
                  <td style={{ color: a.missedOrVoicemail > 0 ? "#f87171" : "var(--text-3)", fontWeight: a.missedOrVoicemail > 0 ? 700 : 400 }}>{a.missedOrVoicemail}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
