"use client";

import { useState } from "react";
import Link from "next/link";

const PRESETS = [
  { label: "Today", days: 1 },
  { label: "7d",    days: 7 },
  { label: "30d",   days: 30 },
] as const;

export default function HiverCard({
  openUnresolved,
  live,
  error,
}: {
  openUnresolved: number | null;
  live: boolean;
  error?: string;
}) {
  const [days, setDays] = useState(7);

  return (
    <div className={`hubCard ${!live ? "hubCardDim" : ""}`}>
      <div className="hubCardHead">
        <div>
          <div className="hubCardTitle">Hiver</div>
          <div className="hubCardSub">Shared inbox / email</div>
        </div>
        <span className={`hubCardBadge ${live ? "hubCardBadgeLive" : "hubCardBadgeDown"}`}>{live ? "Live" : "Unavailable"}</span>
      </div>

      {live && (
        <div className="hubDateBar">
          {PRESETS.map((p) => (
            <button
              key={p.days}
              className={`hubDateBtn ${days === p.days ? "hubDateBtnActive" : ""}`}
              onClick={() => setDays(p.days)}
            >
              {p.label}
            </button>
          ))}
        </div>
      )}

      {!live ? (
        <div className="hubUnavailable">
          Hiver&apos;s API is returning errors for this account right now ({error ?? "unknown error"}) — this needs
          following up with Hiver support, not something fixable from here.
        </div>
      ) : (
        <div className="hubMiniStats" style={{ gridTemplateColumns: "1fr" }}>
          <div className="hubMiniStat">
            <div className="hubMiniStatVal">{openUnresolved ?? "—"}</div>
            <div className="hubMiniStatLbl">Open / unresolved (live snapshot)</div>
          </div>
        </div>
      )}

      <Link href="/dashboard/hiver" className="hubExpandBtn" style={{ textDecoration: "none", display: "inline-block" }}>
        Full detail page →
      </Link>
    </div>
  );
}
