"use client";

import { useState } from "react";
import { useSearchParams } from "next/navigation";
import { FathomPodPreview, type TrackerKey } from "./FathomPodPreview";
import { EofyPodPreview } from "./EofyPodPreview";
import { BookkeeperProjectsPreview } from "./BookkeeperProjectsPreview";
import "@/components/info-tip.css";
import "./fathom-report-section.css";

type PanelKey = TrackerKey | "eofy" | "bookkeeper-projects";

// Was its own top-level "Fathom Tracker" nav item; moved inside the Asana
// section as a button on 2026-07-31 per request — the Fathom report is
// Asana content, not a separate area of the app. The per-client monthly
// Upcoming/Due status (rule confirmed 2026-08-07) lives directly in the
// pod-by-pod breakdown's own month pills, rather than in a second table.
//
// BAS Lodgement joined it on 2026-08-09. Same board layout, same pod
// breakdown, different cadence — Fathom is one report per client per MONTH,
// BAS is one lodgement per client per QUARTER. Only one panel is open at a
// time: each costs a live Asana call that downloads the whole project, so
// opening both at once would double that for no benefit.
// EOFY joined 2026-08-10: no quarters (an annual close, run once), no
// Progress field — completion is which kanban column (Not started -> In
// progress -> Ready for GM review -> Signed off) a client sits in, so it gets
// its own preview component rather than reusing FathomPodPreview's
// quarter/due-date machinery for a tracker that has neither.
const TRACKERS: { key: PanelKey; icon: string; label: string; sub: string }[] = [
  {
    key: "fathom",
    icon: "📊",
    label: "Fathom Report",
    sub: "Pod-by-pod Progress by quarter, with per-client monthly due-date status",
  },
  {
    key: "bas",
    icon: "🧾",
    label: "BAS Lodgement",
    sub: "Pod-by-pod BAS status by quarter — one lodgement per client per quarter, due the 28th after quarter end",
  },
  {
    key: "eofy",
    icon: "📁",
    label: "EOFY",
    sub: "Pod-by-pod, then client-by-client — complete (signed off) vs incomplete, with the bookkeeper in charge of each",
  },
  {
    key: "bookkeeper-projects",
    icon: "👤",
    label: "Bookkeeper Projects",
    sub: "Per bookkeeper — total pending workload, with a due-tasks list for anyone who's behind",
  },
];

const PANEL_KEYS: readonly PanelKey[] = ["fathom", "bas", "eofy", "bookkeeper-projects"];

export function FathomReportSection() {
  // ?panel= opens straight to a card on load (request 2026-08-21) — powers
  // the Nudge Slack message's "View in Ops Hub" link. Read once via a lazy
  // initializer, not an effect: this is a real request-derived value (this
  // page is force-dynamic), so it's identical on the server render and the
  // client hydration pass, no mismatch risk the way a Date.now() seed would have.
  const searchParams = useSearchParams();
  const initialPanel = searchParams.get("panel");
  const [open, setOpen] = useState<PanelKey | null>(
    PANEL_KEYS.includes(initialPanel as PanelKey) ? (initialPanel as PanelKey) : null
  );
  // Bumped by the panel's Refresh button — folded into each preview's `key`
  // below to force a clean remount without touching any of the three
  // preview components (they already remount cleanly on a key change, since
  // that's exactly how switching trackers already works).
  const [refreshTick, setRefreshTick] = useState(0);
  const active = TRACKERS.find((t) => t.key === open) ?? null;

  return (
    <div>
      <div className="asanaCardGrid">
        {TRACKERS.map((t) => (
          <button
            key={t.key}
            type="button"
            className={`asanaCard ${open === t.key ? "asanaCardActive" : ""}`}
            aria-expanded={open === t.key}
            onClick={() => setOpen((cur) => (cur === t.key ? null : t.key))}
          >
            <span className="asanaCardIcon" aria-hidden="true">{t.icon}</span>
            <span className="asanaCardLabel">{t.label}</span>
            <span className="asanaCardSub">{t.sub}</span>
          </button>
        ))}
      </div>

      {active && (
        <div className="dpTableWrap" style={{ marginTop: 16, padding: "18px 20px" }}>
          <div className="dpTableHead">
            <div>
              <div className="dpTableTitle">{active.icon} {active.label}</div>
              <div className="dpTableSub">{active.sub}</div>
            </div>
            <button
              type="button"
              className="acTab"
              onClick={() => setRefreshTick((n) => n + 1)}
              title="Re-fetch the latest data for this board"
            >
              ↻ Refresh
            </button>
          </div>

          {/* key: remount on tracker change (or Refresh click) so no state
              (expanded quarters, FY filter, selected pod) leaks from one
              board to the next, or goes stale after a refresh. */}
          {active.key === "eofy"
            ? <EofyPodPreview key={`eofy-${refreshTick}`} />
            : active.key === "bookkeeper-projects"
            ? <BookkeeperProjectsPreview key={`bookkeeper-projects-${refreshTick}`} />
            : <FathomPodPreview key={`${active.key}-${refreshTick}`} tracker={active.key} />}
        </div>
      )}
    </div>
  );
}
