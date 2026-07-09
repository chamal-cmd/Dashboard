"use client";

import { useState, useCallback } from "react";
import Link from "next/link";
import type { HubstaffProjectStat } from "@/lib/data/hubstaff";

const PRESETS = [
  { label: "Today", days: 1 },
  { label: "7d",    days: 7 },
  { label: "30d",   days: 30 },
] as const;

type CardData = {
  productivityPct: number | null;
  avgMemberActivityPct: number | null;
  activeCount: number | null;
  hoursTracked: number | null;
  projects: HubstaffProjectStat[];
};

export default function HubstaffCard({
  activeCount,
  productivityPct,
  avgMemberActivityPct,
  hoursTracked,
  projects,
  live,
}: CardData & { live: boolean }) {
  const [expanded, setExpanded] = useState(false);
  const [days, setDays] = useState(7);
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<CardData>({ productivityPct, avgMemberActivityPct, activeCount, hoursTracked, projects });

  const pickPreset = useCallback(async (d: number) => {
    if (d === days || loading) return;
    setDays(d);
    setLoading(true);
    try {
      const res = await fetch(`/api/hubstaff/overview?days=${d}`);
      const json = await res.json();
      setData({
        productivityPct: json.productivityPct,
        avgMemberActivityPct: json.avgMemberActivityPct,
        activeCount: json.activeCount,
        hoursTracked: json.hoursTracked,
        projects: json.projects ?? [],
      });
    } catch { /* keep current data */ } finally {
      setLoading(false);
    }
  }, [days, loading]);

  return (
    <div className={`hubCard ${!live ? "hubCardDim" : ""}`}>
      <div className="hubCardHead">
        <div>
          <div className="hubCardTitle">Hubstaff</div>
          <div className="hubCardSub">Org-wide activity &amp; hours</div>
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
        <div className="hubUnavailable">Couldn&apos;t reach Hubstaff right now.</div>
      ) : (
        <>
          <div className="hubMiniStats" style={{ gridTemplateColumns: "repeat(2, 1fr)" }}>
            <div className="hubMiniStat">
              <div className="hubMiniStatVal">{data.avgMemberActivityPct != null ? `${data.avgMemberActivityPct}%` : "—"}</div>
              <div className="hubMiniStatLbl">Avg activity (per member)</div>
            </div>
            <div className="hubMiniStat">
              <div className="hubMiniStatVal">{data.productivityPct != null ? `${data.productivityPct}%` : "—"}</div>
              <div className="hubMiniStatLbl">Org productivity</div>
            </div>
            <div className="hubMiniStat">
              <div className="hubMiniStatVal">{data.activeCount ?? "—"}</div>
              <div className="hubMiniStatLbl">Active members</div>
            </div>
            <div className="hubMiniStat">
              <div className="hubMiniStatVal">{data.hoursTracked ?? "—"}h</div>
              <div className="hubMiniStatLbl">Hours tracked</div>
            </div>
          </div>

          <div style={{ display: "flex", gap: 8 }}>
            <button className="hubExpandBtn" onClick={() => setExpanded((v) => !v)}>
              {expanded ? "Hide projects ▴" : "Show projects ▾"}
            </button>
            <Link href="/dashboard/hubstaff" className="hubExpandBtn" style={{ textDecoration: "none" }}>
              Full detail page →
            </Link>
          </div>

          {expanded && (
            <div className="hubDetailList">
              {data.projects.length === 0 ? (
                <div className="hubUnavailable">No tracked time in this period.</div>
              ) : (
                data.projects.map((p) => (
                  <div className="hubDetailRow" key={p.projectId}>
                    <div className="hubDetailRowMain">
                      <span className="hubDetailRowTitle">{p.name}</span>
                      <span className="hubDetailRowSub">{p.activityPct != null ? `${p.activityPct}% activity` : "—"}</span>
                    </div>
                    <div className="hubDetailRowRight">{p.hours}h</div>
                  </div>
                ))
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}
