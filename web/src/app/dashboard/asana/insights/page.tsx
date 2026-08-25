import { getAsanaOverview } from "@/lib/data/asana";
import InsightsDashboard from "./InsightsDashboard";
import "@/components/detail-page-theme.css";
import "@/app/dashboard/aircall/aircall-page.css";

export const dynamic = "force-dynamic";

export default async function AsanaInsightsPage() {
  // The only caller that renders monthlyThroughput, so the only one that pays
  // for it — see the opts.includeThroughput note in lib/data/asana.ts.
  const asana = await getAsanaOverview(7, { includeThroughput: true });
  const live = !asana.error;

  return (
    <div className="shellPage dpPage">
      <div className="dpHeader">
        <div className="dpHeaderLeft">
          <div className="dpTitle">Asana — Insights</div>
          <div className="dpSub">Backlog age, throughput, completion rates, client workload</div>
        </div>
        <span className={`dpBadge ${live ? "dpBadgeLive" : "dpBadgeDown"}`}>{live ? "Live" : "Unavailable"}</span>
      </div>

      {!live ? (
        <div className="hubUnavailable">Couldn&apos;t load Asana data right now ({asana.error}).</div>
      ) : (
        <InsightsDashboard initial={asana} />
      )}
    </div>
  );
}
