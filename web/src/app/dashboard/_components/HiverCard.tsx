"use client";

import Link from "next/link";
import { InfoTip } from "@/components/InfoTip";
import { useHiverData } from "../hiver/useHiverData";
import "@/components/info-tip.css";

// Self-fetches its own number via the shared inbox sweep (useHiverData),
// exactly like the full Hiver dashboard and Bookkeeper Stats do. The old
// server-side count came from Hiver's global /conversations endpoint, which
// is permanently 503 for this account — so this card used to render a scary
// red "Unavailable — follow up with Hiver support" alarm on every load. The
// per-inbox /v1/ endpoints this hook uses are reliable, so this shows a real
// number instead (loading progressively over the ~1-2 min sweep). The old
// day-preset buttons are gone too: Hiver's API can't filter by date at all
// (see HIVER_DATE_FILTER_NOTE), so they never did anything.
export default function HiverCard() {
  const { conversations, loading, pct, error, failedInboxes } = useHiverData();

  // "Unresolved" = anything not closed (open + pending) — a live snapshot of
  // the current shared-inbox backlog.
  const unresolved = conversations.filter((c) => c.status !== "closed").length;
  const live = !error;

  return (
    <div className={`hubCard ${!live ? "hubCardDim" : ""}`}>
      <div className="hubCardHead">
        <div>
          <div className="hubCardTitle">Hiver</div>
          <div className="hubCardSub">Shared inbox / email</div>
        </div>
        <span className={`hubCardBadge ${live ? "hubCardBadgeLive" : "hubCardBadgeDown"}`}>{live ? "Live" : "Unavailable"}</span>
      </div>

      {error ? (
        <div className="hubUnavailable">Couldn&apos;t reach Hiver right now ({error}).</div>
      ) : (
        <div className="hubMiniStats" style={{ gridTemplateColumns: "1fr" }}>
          <div className="hubMiniStat">
            <div className="hubMiniStatVal">{loading ? `${pct}%` : unresolved}</div>
            <div className="hubMiniStatLbl">
              {loading ? "Loading live snapshot…" : "Open / unresolved (live snapshot)"}
              <InfoTip text="Open and pending conversations across every Hiver inbox right now, counted live from Hiver's per-inbox API. Takes a minute or two to sweep all inboxes." />
            </div>
          </div>
        </div>
      )}

      {!loading && !error && failedInboxes.length > 0 && (
        <div className="hubMiniStatLbl" style={{ color: "#fb923c", marginTop: 4 }}>
          {failedInboxes.length} inbox{failedInboxes.length !== 1 ? "es" : ""} didn&apos;t load — count may be low.
        </div>
      )}

      <Link href="/dashboard/hiver" className="hubExpandBtn" style={{ textDecoration: "none", display: "inline-block" }}>
        Full detail page →
      </Link>
    </div>
  );
}
