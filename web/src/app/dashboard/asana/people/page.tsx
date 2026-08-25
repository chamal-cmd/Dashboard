import { getAsanaOverview } from "@/lib/data/asana";
import PeopleDashboard from "./PeopleDashboard";
import "@/components/detail-page-theme.css";
import "@/app/dashboard/aircall/aircall-page.css";

export const dynamic = "force-dynamic";

export default async function AsanaPeoplePage() {
  const asana = await getAsanaOverview(7);
  const live = !asana.error;

  return (
    <div className="shellPage dpPage">
      <div className="dpHeader">
        <div className="dpHeaderLeft">
          <div className="dpTitle">Asana — Bookkeepers &amp; Pods</div>
          <div className="dpSub">Open work ranked by person and by pod</div>
        </div>
        <span className={`dpBadge ${live ? "dpBadgeLive" : "dpBadgeDown"}`}>{live ? "Live" : "Unavailable"}</span>
      </div>

      {!live ? (
        <div className="hubUnavailable">Couldn&apos;t load Asana data right now ({asana.error}).</div>
      ) : (
        <PeopleDashboard initial={asana} />
      )}
    </div>
  );
}
