"use client";

import { useState, useCallback } from "react";
import Link from "next/link";
import type { AircallCall } from "@/lib/data/aircall";

const PRESETS = [
  { label: "Today", days: 1 },
  { label: "7d",    days: 7 },
  { label: "30d",   days: 30 },
] as const;

type CardData = {
  total: number | null;
  inbound: number | null;
  outboundAnswered: number | null;
  outboundUnanswered: number | null;
  missedOrVoicemail: number | null;
  recentCalls: AircallCall[];
};

function formatDuration(seconds: number) {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

export default function AircallCard(props: CardData & { live: boolean }) {
  const [expanded, setExpanded] = useState(false);
  const [days, setDays] = useState(7);
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<CardData>({
    total: props.total,
    inbound: props.inbound,
    outboundAnswered: props.outboundAnswered,
    outboundUnanswered: props.outboundUnanswered,
    missedOrVoicemail: props.missedOrVoicemail,
    recentCalls: props.recentCalls,
  });

  const pickPreset = useCallback(async (d: number) => {
    if (d === days || loading) return;
    setDays(d);
    setLoading(true);
    try {
      const res = await fetch(`/api/aircall/overview?days=${d}`);
      const json = await res.json();
      setData({
        total: json.total,
        inbound: json.inbound,
        outboundAnswered: json.outboundAnswered,
        outboundUnanswered: json.outboundUnanswered,
        missedOrVoicemail: json.missedOrVoicemail,
        recentCalls: json.recentCalls ?? [],
      });
    } catch { /* keep current data */ } finally {
      setLoading(false);
    }
  }, [days, loading]);

  const outbound =
    data.outboundAnswered != null && data.outboundUnanswered != null
      ? data.outboundAnswered + data.outboundUnanswered
      : null;

  return (
    <div className={`hubCard ${!props.live ? "hubCardDim" : ""}`}>
      <div className="hubCardHead">
        <div>
          <div className="hubCardTitle">Aircall</div>
          <div className="hubCardSub">Calls &amp; messaging</div>
        </div>
        <span className={`hubCardBadge ${props.live ? "hubCardBadgeLive" : "hubCardBadgeDown"}`}>{props.live ? "Live" : "Unavailable"}</span>
      </div>

      {props.live && (
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

      {!props.live ? (
        <div className="hubUnavailable">Couldn&apos;t reach Aircall right now.</div>
      ) : (
        <>
          <div className="hubMiniStats hubMiniStats2x2">
            <div className="hubMiniStat">
              <div className="hubMiniStatVal">{data.total ?? "—"}</div>
              <div className="hubMiniStatLbl">Total Calls</div>
            </div>
            <div className="hubMiniStat">
              <div className="hubMiniStatVal">{data.inbound ?? "—"}</div>
              <div className="hubMiniStatLbl">Inbound</div>
            </div>
            <div className="hubMiniStat">
              <div className="hubMiniStatVal">{outbound ?? "—"}</div>
              <div className="hubMiniStatLbl">Outbound</div>
            </div>
            <div className="hubMiniStat">
              <div className="hubMiniStatVal">{data.missedOrVoicemail ?? "—"}</div>
              <div className="hubMiniStatLbl">Missed / Voicemail</div>
            </div>
          </div>

          <div style={{ display: "flex", gap: 8 }}>
            <button className="hubExpandBtn" onClick={() => setExpanded((v) => !v)}>
              {expanded ? "Hide recent calls ▴" : "Show recent calls ▾"}
            </button>
            <Link href="/dashboard/aircall" className="hubExpandBtn" style={{ textDecoration: "none" }}>
              Full detail page →
            </Link>
          </div>

          {expanded && (
            <div className="hubDetailList">
              {data.recentCalls.length === 0 ? (
                <div className="hubUnavailable">No calls in this period.</div>
              ) : (
                data.recentCalls.map((c) => (
                  <div className="hubDetailRow" key={c.id}>
                    <div className="hubDetailRowMain">
                      <span className="hubDetailRowTitle">{c.contactName ?? c.number}</span>
                      <span className="hubDetailRowSub">
                        {c.contactName ? `${c.number} · ` : ""}{c.direction} · {c.status}{c.agent ? ` · ${c.agent}` : ""}
                      </span>
                    </div>
                    <div className="hubDetailRowRight">{formatDuration(c.duration)}</div>
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
