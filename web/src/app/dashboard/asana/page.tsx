import { FathomReportSection } from "@/components/asana/FathomReportSection";
import "@/components/detail-page-theme.css";

// Rebuilding this section from scratch (2026-07-31); the old full dashboard
// is disconnected, not deleted — AsanaDashboard.tsx, the data layer
// (lib/data/asana.ts, asana-cadence.ts) and every tracker/EOFY/insights
// component are still in the repo, ready to be wired back in or rebuilt from.
// Fathom Report is the first piece back in: it used to be its own top-level
// "Fathom Tracker" nav item, moved here as a button since it's Asana content.
export const dynamic = "force-dynamic";

export default function AsanaPage() {
  // Wider + left-aligned, not centered like a normal shellPage (changed on
  // request 2026-08-10): the Fathom/BAS quarter row needs the extra width so
  // more (ideally all 4) cards fit without scrolling, and centering was
  // leaving a dead gap between the sidebar and Q1.
  return (
    <div className="shellPage dpPage" style={{ maxWidth: 1600, margin: 0 }}>
      <div className="dpHeader">
        <div className="dpHeaderLeft">
          <div className="dpTitle">Asana</div>
          <div className="dpSub">Compliance trackers, EOFY, and bookkeeper workload — pod by pod</div>
        </div>
      </div>

      <FathomReportSection />
    </div>
  );
}
