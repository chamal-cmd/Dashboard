import { getHubstaffOverview } from "@/lib/data/hubstaff";
import HubstaffDashboard from "./HubstaffDashboard";
import "@/components/detail-page-theme.css";
import "@/app/dashboard/aircall/aircall-page.css";

export default async function HubstaffPage() {
  const hubstaff = await getHubstaffOverview(7, 100);
  const live = !hubstaff.error;

  return (
    <div className="shellPage dpPage">
      <div className="dpHeader">
        <div className="dpHeaderLeft">
          <div className="dpTitle">Hubstaff</div>
          <div className="dpSub">{hubstaff.orgName ?? "Org-wide"}</div>
        </div>
        <span className={`dpBadge ${live ? "dpBadgeLive" : "dpBadgeDown"}`}>{live ? "Live" : "Unavailable"}</span>
      </div>

      {!live ? (
        <div className="hubUnavailable">Couldn&apos;t reach Hubstaff right now ({hubstaff.error}).</div>
      ) : (
        <HubstaffDashboard initial={hubstaff} />
      )}
    </div>
  );
}
