import { getAsanaOverview } from "@/lib/data/asana";
import ProjectsDashboard from "./ProjectsDashboard";
import "@/components/detail-page-theme.css";
import "@/app/dashboard/aircall/aircall-page.css";

export const dynamic = "force-dynamic";

export default async function AsanaProjectsPage() {
  const asana = await getAsanaOverview(7);
  const live = !asana.error;

  return (
    <div className="shellPage dpPage">
      <div className="dpHeader">
        <div className="dpHeaderLeft">
          <div className="dpTitle">Asana — Projects</div>
          <div className="dpSub">Bookkeeper Finance trackers &amp; other internal projects</div>
        </div>
        <span className={`dpBadge ${live ? "dpBadgeLive" : "dpBadgeDown"}`}>{live ? "Live" : "Unavailable"}</span>
      </div>

      {!live ? (
        <div className="hubUnavailable">Couldn&apos;t load Asana data right now ({asana.error}).</div>
      ) : (
        <ProjectsDashboard initial={asana} />
      )}
    </div>
  );
}
