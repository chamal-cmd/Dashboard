import { getAsanaOverview } from "@/lib/data/asana";
import EofyDashboard from "./EofyDashboard";
import "@/components/detail-page-theme.css";
import "@/app/dashboard/aircall/aircall-page.css";

export const dynamic = "force-dynamic";

export default async function AsanaEofyPage() {
  const asana = await getAsanaOverview(7);
  const live = !asana.error;

  return (
    <div className="shellPage dpPage">
      <div className="dpHeader">
        <div className="dpHeaderLeft">
          <div className="dpTitle">Asana — EOFY</div>
          <div className="dpSub">FY2026 client trackers, by pod</div>
        </div>
        <span className={`dpBadge ${live ? "dpBadgeLive" : "dpBadgeDown"}`}>{live ? "Live" : "Unavailable"}</span>
      </div>

      {!live ? (
        <div className="hubUnavailable">Couldn&apos;t load Asana data right now ({asana.error}).</div>
      ) : (
        <EofyDashboard initial={asana} />
      )}
    </div>
  );
}
