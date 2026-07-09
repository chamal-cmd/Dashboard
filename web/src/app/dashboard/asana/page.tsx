import { getAsanaOverview } from "@/lib/data/asana";
import AsanaDashboard from "./AsanaDashboard";
import "@/components/detail-page-theme.css";
import "@/app/dashboard/aircall/aircall-page.css";

export default async function AsanaPage() {
  const asana = await getAsanaOverview(7);
  const live = !asana.error;

  return (
    <div className="shellPage dpPage">
      <div className="dpHeader">
        <div className="dpHeaderLeft">
          <div className="dpTitle">Asana</div>
          <div className="dpSub">Workflow &amp; compliance trackers</div>
        </div>
        <span className={`dpBadge ${live ? "dpBadgeLive" : "dpBadgeDown"}`}>{live ? "Live" : "Unavailable"}</span>
      </div>

      {!live ? (
        <div className="hubUnavailable">Couldn&apos;t load Asana data right now ({asana.error}).</div>
      ) : (
        <AsanaDashboard initial={asana} />
      )}
    </div>
  );
}
