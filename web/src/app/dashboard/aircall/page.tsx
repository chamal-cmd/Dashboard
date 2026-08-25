import { getAircallOverview } from "@/lib/data/aircall";
import AircallDashboard from "./AircallDashboard";
import "@/components/detail-page-theme.css";
import "./aircall-page.css";

export const dynamic = "force-dynamic";

export default async function AircallPage() {
  // Contact names enabled on request 2026-08-13 (previously skipped for load
  // time — resolving every unique number in the whole date range could mean
  // dozens+ of extra Aircall requests). getAircallOverview now only resolves
  // names for numbers that are actually displayed (the visible recent-calls
  // slice + top repeat callers), capped at 40 lookups regardless, so this is
  // safe even for the wider day-range presets on this page.
  const aircall = await getAircallOverview(200, 7);
  const live = !aircall.error;

  return (
    <div className="shellPage dpPage">
      <div className="dpHeader">
        <div className="dpHeaderLeft">
          <div className="dpTitle">Aircall</div>
          <div className="dpSub">{aircall.lines.length > 0 ? aircall.lines.join(", ") : "Call centre"}</div>
        </div>
        <span className={`dpBadge ${live ? "dpBadgeLive" : "dpBadgeDown"}`}>{live ? "Live" : "Unavailable"}</span>
      </div>

      {!live ? (
        <div className="hubUnavailable">Couldn&apos;t reach Aircall right now ({aircall.error}).</div>
      ) : (
        <AircallDashboard initial={aircall} />
      )}
    </div>
  );
}
