import { createAdminClient } from "@/lib/supabase/admin";
import TrackersAdmin from "./TrackersAdmin";
import "../admin-theme.css";

export const dynamic = "force-dynamic";

async function getTrackers() {
  const admin = createAdminClient();
  const { data } = await admin.from("asana_trackers").select("*").order("sort_order");
  return data ?? [];
}

export default async function TrackersPage() {
  const trackers = await getTrackers().catch(() => []);

  return (
    <div className="shellPage">
      <div className="shellPageTitle">Asana Tracker Projects</div>
      <div className="shellPageSub">
        Configure which Asana projects appear as compliance trackers on the dashboard.
      </div>

      <div style={{ marginBottom: 20, marginTop: 20, fontSize: 12, color: "var(--text-3)" }}>
        The <strong style={{ color: "var(--text-3)" }}>Asana Project Name</strong> must match the project name
        in Asana exactly (case-sensitive). Leave it blank if this tracker has no corresponding Asana project yet.
        Toggle <strong style={{ color: "var(--text-3)" }}>Active</strong> to show/hide without deleting.
      </div>

      <TrackersAdmin initial={trackers} />
    </div>
  );
}
