import { getAircallOverview } from "@/lib/data/aircall";
import AircallDashboard from "./AircallDashboard";
import "@/components/detail-page-theme.css";
import "./aircall-page.css";

export default async function AircallPage() {
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
