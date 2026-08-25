import { getAsanaOverview } from "@/lib/data/asana";
import TasksDashboard from "./TasksDashboard";
import "@/components/detail-page-theme.css";
import "@/app/dashboard/aircall/aircall-page.css";

export const dynamic = "force-dynamic";

export default async function AsanaTasksPage() {
  const asana = await getAsanaOverview(7);
  const live = !asana.error;

  return (
    <div className="shellPage dpPage">
      <div className="dpHeader">
        <div className="dpHeaderLeft">
          <div className="dpTitle">Asana — Task Lists</div>
          <div className="dpSub">Open, overdue, due soon, completed, and recently modified — by bookkeeper</div>
        </div>
        <span className={`dpBadge ${live ? "dpBadgeLive" : "dpBadgeDown"}`}>{live ? "Live" : "Unavailable"}</span>
      </div>

      {!live ? (
        <div className="hubUnavailable">Couldn&apos;t load Asana data right now ({asana.error}).</div>
      ) : (
        <TasksDashboard initial={asana} />
      )}
    </div>
  );
}
