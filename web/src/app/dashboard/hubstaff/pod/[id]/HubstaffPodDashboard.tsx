"use client";

import { useState, useCallback, useMemo } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import type { HubstaffOverview } from "@/lib/data/hubstaff";
import { mean, median, stdDev, round1 } from "@/lib/stats";
import { LoadingScreen } from "@/components/LoadingScreen";
import { auTodayISODateClient } from "@/lib/business-tz-client";

const PRESETS = [
  { label: "Today",  days: 1  },
  { label: "7 days", days: 7  },
  { label: "Last 2 weeks", days: 14 },
  { label: "30 days",days: 30 },
] as const;

// Hubstaff's own API hard-rejects date ranges over 31 days ("Date range can
// not be more than 31 days") — 90 used to be offered here and would silently
// render as an empty, error-flagged-but-200-OK page instead of the real
// failure.
const MAX_DAYS = 31;

export default function HubstaffPodDashboard({
  podId,
  podName,
  initial,
  allPods,
}: {
  podId: string;
  podName: string;
  initial: HubstaffOverview;
  allPods: { id: string; name: string }[];
}) {
  const router = useRouter();
  const [days, setDays] = useState(7);
  const [custom, setCustom] = useState("");
  const [specificDate, setSpecificDate] = useState("");
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<HubstaffOverview>(initial);
  const [currentPodId, setCurrentPodId] = useState(podId);
  const [currentPodName, setCurrentPodName] = useState(podName);

  // Switching the date range needs a fresh Hubstaff fetch (different day
  // window); switching pods doesn't — the org-wide payload we already have
  // covers every pod, so it's just a client-side refilter.
  const fetchRange = useCallback(async (d: number) => {
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
  }, []);

  const submitCustom = () => {
    const n = Math.floor(Number(custom));
    if (!isNaN(n) && n >= 1) fetchRange(Math.min(n, MAX_DAYS));
  };

  const fetchDate = useCallback(async (date: string) => {
    if (!date) return;
    setLoading(true);
    try {
      const res = await fetch(`/api/hubstaff/overview?date=${date}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setData(await res.json() as HubstaffOverview);
      setSpecificDate(date);
    } catch { /* keep existing data and range */ } finally {
      setLoading(false);
    }
  }, []);

  const switchPod = (nextId: string, nextName: string) => {
    setCurrentPodId(nextId);
    setCurrentPodName(nextName);
    router.replace(`/dashboard/hubstaff/pod/${nextId}`, { scroll: false });
  };

  const podStat = data.pods.find((p) => p.pod === currentPodName) ?? null;
  const podMembers = useMemo(
    () => data.members.filter((m) => m.pod === currentPodName).sort((a, b) => b.hours - a.hours),
    [data.members, currentPodName]
  );

  // "Low" is flagged against THIS pod's own mean/spread, not the org-wide
  // one — a pod that's uniformly quieter than the rest of the org shouldn't
  // have every single member flagged just for being in a slower pod.
  const activityValues = podMembers.filter((m) => m.activityPct != null).map((m) => m.activityPct as number);
  const podMean = activityValues.length > 0 ? mean(activityValues) : null;
  const podMedian = activityValues.length > 0 ? median(activityValues) : null;
  const podStdDev = activityValues.length > 1 ? stdDev(activityValues) : null;

  // Same "mirror every org-wide metric at pod scope" treatment Asana's pod
  // page got — ratios and totals here are all computed from podMembers
  // (already filtered to this pod), not re-derived from the org totals.
  const podHoursSum = podMembers.reduce((s, m) => s + m.hours, 0);
  const podIdleHours = podMembers.reduce((s, m) => s + m.idleHours, 0);
  const podIdleRatioPct = podHoursSum > 0 ? round1((podIdleHours / podHoursSum) * 100) : null;

  // Tile arrays for the three KPI grids below — `always: false` tiles are
  // dropped when their raw value is 0, so a pod with e.g. no idle time
  // doesn't show a meaningless "0h" card. Grid column counts follow the
  // filtered length, not a fixed number.
  const podActivityTiles = [
    { key: "members", color: "#4f8ef7", lbl: "Members tracked", display: String(podMembers.length), raw: podMembers.length, always: true },
    { key: "hours", color: "#a78bfa", lbl: "Hours tracked", display: `${podStat?.hours ?? 0}h`, raw: podStat?.hours ?? 0, always: true },
    { key: "activity", color: "#fb923c", lbl: "Activity", display: podStat?.activityPct != null ? `${podStat.activityPct}%` : "—", raw: podStat?.activityPct ?? 0, always: true },
    { key: "idle", color: "#f87171", lbl: "Idle hrs", display: `${podStat?.idleHours ?? 0}h`, raw: podStat?.idleHours ?? 0, always: false },
  ].filter((t) => t.always || t.raw > 0);

  const consistencyTiles = [
    { key: "median", color: "#fb923c", lbl: "Median activity (typical member)", display: podMedian != null ? `${Math.round(podMedian)}%` : "—", raw: podMedian ?? 0, always: true },
    { key: "stddev", color: "#a78bfa", lbl: "Activity spread (std dev)", display: podStdDev != null ? `±${round1(podStdDev)}%` : "—", raw: podStdDev ?? 0, always: true },
    { key: "idleratio", color: "#f87171", lbl: "Idle / tracked", display: podIdleRatioPct != null ? `${podIdleRatioPct}%` : "—", raw: podIdleRatioPct ?? 0, always: false },
  ].filter((t) => t.always || t.raw > 0);

  const timeBreakdownTiles = [
    { key: "totalhours", color: "#a78bfa", lbl: "Hours tracked", display: `${round1(podHoursSum)}h`, raw: podHoursSum, always: true },
    { key: "idle2", color: "#f87171", lbl: "Idle hrs", display: `${round1(podIdleHours)}h`, raw: podIdleHours, always: false },
  ].filter((t) => t.always || t.raw > 0);

  if (loading) {
    return <LoadingScreen icon="⏱" title="HUBSTAFF" status="Loading Hubstaff data…" color="#4f8ef7" />;
  }

  if (data.error) {
    return (
      <div className="shellPage dpPage">
        <div className="hubUnavailable">Couldn&apos;t reach Hubstaff right now ({data.error}).</div>
      </div>
    );
  }

  return (
    <div className="shellPage dpPage">
      <div className="dpHeader">
        <div className="dpHeaderLeft">
          <div style={{ marginBottom: 6 }}>
            <Link href="/dashboard/hubstaff" style={{ fontSize: 12, color: "#4f8ef7", textDecoration: "none" }}>← Hubstaff overview</Link>
          </div>
          <div className="dpTitle">{currentPodName}</div>
          <div className="dpSub">{podMembers.length} member{podMembers.length !== 1 ? "s" : ""} tracked · Hubstaff activity</div>
        </div>
        <span className="dpBadge dpBadgeLive">Live</span>
      </div>

      {/* ── Pod switcher ─────────────────────────────────── */}
      <div className="acTabBar" style={{ marginBottom: 16 }}>
        {allPods.map((p) => (
          <button
            key={p.id}
            className={`acTab ${p.id === currentPodId ? "acTabActive" : ""}`}
            onClick={() => switchPod(p.id, p.name)}
          >
            {p.name}
          </button>
        ))}
      </div>

      {/* ── Date range picker ──────────────────────────────── */}
      <div className={`acTabBar ${loading ? "hubDateLoading" : ""}`} style={{ marginBottom: 28 }}>
        {PRESETS.map((p) => (
          <button
            key={p.days}
            className={`acTab ${!specificDate && days === p.days ? "acTabActive" : ""}`}
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
          <button className={`acTab ${!specificDate && !PRESETS.some((p) => p.days === days) ? "acTabActive" : ""}`} onClick={submitCustom}>
            days
          </button>
        </span>
        <span className="dpRangeCustom">
          <input
            className="dpRangeInput"
            type="date"
            value={specificDate}
            max={auTodayISODateClient()}
            onChange={(e) => fetchDate(e.target.value)}
          />
        </span>
        {loading && <span style={{ fontSize: 11, color: "var(--text-3)", alignSelf: "center", marginLeft: 8 }}>Loading…</span>}
      </div>

      {/* ── Pod KPIs ─────────────────────────────────────── */}
      {/* Each section's tiles are filtered before rendering — a tile with a
          literal zero value (no idle time, no manual entries, etc.) says
          nothing useful about this pod and just adds clutter, so it's
          dropped rather than shown as "0h". Headline tiles (member count,
          hours, activity, median/spread) always show even at zero, since a
          zero there IS the signal, not an absence of one. */}
      <div className="dpSectionLbl">Pod Activity</div>
      <div className="dpKpiGrid dpKpiGridLast" style={{ gridTemplateColumns: `repeat(${podActivityTiles.length}, 1fr)` }}>
        {podActivityTiles.map((t) => (
          <div key={t.key} className="dpKpi" style={{ "--kpi-accent": t.color } as React.CSSProperties}>
            <div className="dpKpiVal">{t.display}</div>
            <div className="dpKpiLbl">{t.lbl}</div>
          </div>
        ))}
      </div>

      {/* ── Consistency ──────────────────────────────────── */}
      <div className="dpSectionLbl">Consistency</div>
      <div className="dpKpiGrid dpKpiGridLast" style={{ gridTemplateColumns: `repeat(${consistencyTiles.length}, 1fr)` }}>
        {consistencyTiles.map((t) => (
          <div key={t.key} className="dpKpi" style={{ "--kpi-accent": t.color } as React.CSSProperties}>
            <div className="dpKpiVal">{t.display}</div>
            <div className="dpKpiLbl">{t.lbl}</div>
          </div>
        ))}
      </div>

      {/* ── Time breakdown ────────────────────────────────── */}
      <div className="dpSectionLbl">Time breakdown</div>
      <div className="dpKpiGrid dpKpiGridLast" style={{ gridTemplateColumns: `repeat(${timeBreakdownTiles.length}, 1fr)` }}>
        {timeBreakdownTiles.map((t) => (
          <div key={t.key} className="dpKpi" style={{ "--kpi-accent": t.color } as React.CSSProperties}>
            <div className="dpKpiVal">{t.display}</div>
            <div className="dpKpiLbl">{t.lbl}</div>
          </div>
        ))}
      </div>

      {/* ── By Bookkeeper ─────────────────────────────────── */}
      <div className="dpSectionLbl">By Bookkeeper</div>
      {podMembers.length === 0 ? (
        <div className="dpTableWrap" style={{ marginBottom: 32 }}>
          <div className="dpEmpty">No tracked time for this pod in this window.</div>
        </div>
      ) : (
        <div className="dpTileGrid dpTileGridSmall" style={{ marginBottom: 32 }}>
          {podMembers.map((m) => {
            const isLow =
              m.activityPct != null && podMean != null && podStdDev != null &&
              m.activityPct < podMean - podStdDev;
            return (
              <div className="dpPersonTile" key={m.userId}>
                <div className="dpPersonName">
                  {m.name}
                  {isLow && <span title="More than 1 std dev below this pod's average activity" style={{ marginLeft: 6, fontSize: 9, background: "#f8717120", color: "#f87171", borderRadius: 3, padding: "1px 5px", fontWeight: 700 }}>LOW</span>}
                </div>
                <div className="dpPersonEmail">{m.email}</div>
                <div className="dpPersonStats">
                  <div>
                    <div className="dpPersonHours">{m.hours}h</div>
                    <div className="dpTileStatLbl" style={{ color: isLow ? "#f87171" : undefined }}>{m.activityPct != null ? `${m.activityPct}% active` : "—"}</div>
                  </div>
                  <div className="dpPersonMeta">
                    <div>{m.idleHours}h idle</div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
