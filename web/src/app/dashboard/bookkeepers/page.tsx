import { getBookkeeperStats } from "@/lib/data/bookkeepers";
import BookkeeperStatsDashboard from "./BookkeeperStatsDashboard";
import "@/components/detail-page-theme.css";

// Without this, Next.js can statically cache a render of this page from
// before the latest deploy, serving stale bookkeeper data indefinitely.
export const dynamic = "force-dynamic";

export default async function BookkeeperStatsPage() {
  const stats = await getBookkeeperStats();

  return (
    <div className="shellPage dpPage">
      <div className="dpHeader">
        <div className="dpHeaderLeft">
          <div className="dpTitle">Bookkeeper Stats</div>
          <div className="dpSub">Activity for every bookkeeper across Asana, Hubstaff, and Hiver — grouped by pod</div>
        </div>
        <span className="dpBadge dpBadgeLive">Live</span>
      </div>

      <BookkeeperStatsDashboard initial={stats} />
    </div>
  );
}
