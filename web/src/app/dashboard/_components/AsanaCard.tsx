"use client";

import { useState, useCallback } from "react";
import Link from "next/link";
import type { TrackerStat, AsanaVelocity } from "@/lib/data/asana";

const PRESETS = [
  { label: "Today", days: 1 },
  { label: "7d",    days: 7 },
  { label: "30d",   days: 30 },
] as const;

type CardData = {
  openTotal: number | null;
  overdueCount: number | null;
  dueSoonCount: number | null;
  velocity: AsanaVelocity | null;
  trackers: TrackerStat[];
};

export default function AsanaCard({
  openTotal,
  overdueCount,
  dueSoonCount,
  velocity,
  trackers,
}: CardData) {
  const [expanded, setExpanded] = useState(false);
  const [days, setDays] = useState(7);
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<CardData>({ openTotal, overdueCount, dueSoonCount, velocity, trackers });
  const live = data.openTotal !== null;

  const pickPreset = useCallback(async (d: number) => {
    if (d === days || loading) return;
    setLoading(true);
    try {
      const res = await fetch(`/api/asana/overview?days=${d}`);
      const json = await res.json();
      setData({
        openTotal: json.openTotal,
        overdueCount: json.overdueCount,
        dueSoonCount: json.dueSoonCount,
        velocity: json.velocity ?? null,
        trackers: json.trackers ?? [],
      });
      setDays(d);
    } catch { /* keep current data */ } finally {
      setLoading(false);
    }
  }, [days, loading]);

  const net = data.velocity ? data.velocity.netInRange : null;

  return (
    <div className={`hubCard ${!live ? "hubCardDim" : ""}`}>
      <div className="hubCardHead">
        <div>
          <div className="hubCardTitle">Asana</div>
          <div className="hubCardSub">Workflow &amp; compliance trackers</div>
        </div>
        <span className={`hubCardBadge ${live ? "hubCardBadgeLive" : "hubCardBadgeDown"}`}>{live ? "Live" : "Unavailable"}</span>
      </div>

      {live && (
        <div className={`hubDateBar ${loading ? "hubDateLoading" : ""}`}>
          {PRESETS.map((p) => (
            <button
              key={p.days}
              className={`hubDateBtn ${days === p.days ? "hubDateBtnActive" : ""}`}
              onClick={() => pickPreset(p.days)}
            >
              {p.label}
            </button>
          ))}
        </div>
      )}

      {!live ? (
        <div className="hubUnavailable">Couldn&apos;t reach the Asana data right now.</div>
      ) : (
        <>
          <div className="hubMiniStats" style={{ gridTemplateColumns: "1fr 1fr 1fr" }}>
            <div className="hubMiniStat">
              <div className="hubMiniStatVal">{data.openTotal}</div>
              <div className="hubMiniStatLbl">Open tasks</div>
            </div>
            <div className="hubMiniStat">
              <div className="hubMiniStatVal" style={{ color: (data.overdueCount ?? 0) > 0 ? "#ef4444" : undefined }}>{data.overdueCount ?? "—"}</div>
              <div className="hubMiniStatLbl">Overdue</div>
            </div>
            <div className="hubMiniStat">
              <div className="hubMiniStatVal" style={{ color: "#fbbf24" }}>{data.dueSoonCount ?? "—"}</div>
              <div className="hubMiniStatLbl">Due in {days}d</div>
            </div>
          </div>

          {data.velocity && (
            <div className="hubMiniStats" style={{ gridTemplateColumns: "1fr 1fr 1fr", marginTop: 0 }}>
              <div className="hubMiniStat">
                <div className="hubMiniStatVal" style={{ color: "#22c55e" }}>{data.velocity.completedInRange}</div>
                <div className="hubMiniStatLbl">Completed ({days}d)</div>
              </div>
              <div className="hubMiniStat">
                <div className="hubMiniStatVal">{data.velocity.createdInRange}</div>
                <div className="hubMiniStatLbl">Created ({days}d)</div>
              </div>
              <div className="hubMiniStat">
                <div className="hubMiniStatVal" style={{ color: net == null ? undefined : net > 0 ? "#ef4444" : "#22c55e" }}>
                  {net == null ? "—" : net > 0 ? `+${net}` : net}
                </div>
                <div className="hubMiniStatLbl">Net ({days}d)</div>
              </div>
            </div>
          )}

          <div style={{ display: "flex", gap: 8 }}>
            <button className="hubExpandBtn" onClick={() => setExpanded((v) => !v)}>
              {expanded ? "Hide trackers ▴" : "Show trackers ▾"}
            </button>
            <Link href="/dashboard/asana" className="hubExpandBtn" style={{ textDecoration: "none" }}>
              Full detail page →
            </Link>
          </div>

          {expanded && (
            <div className="hubDetailList">
              {data.trackers.map((t) => (
                <div className="hubDetailRow" key={t.key}>
                  <div className="hubDetailRowMain">
                    <span className="hubDetailRowTitle">{t.label}</span>
                  </div>
                  <div className="hubDetailRowRight">
                    {t.open === null ? "no active project" : `${t.open} open / ${t.total} total`}
                  </div>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
