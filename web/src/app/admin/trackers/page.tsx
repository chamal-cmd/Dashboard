import { createAdminClient } from "@/lib/supabase/admin";
import TrackersAdmin from "./TrackersAdmin";
import "../admin-theme.css";

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

      <div style={{ marginBottom: 20, marginTop: 20, fontSize: 12, color: "#6b7280" }}>
        The <strong style={{ color: "#9ca3af" }}>Asana Project Name</strong> must match the project name
        in Asana exactly (case-sensitive). Leave it blank if this tracker has no corresponding Asana project yet.
        Toggle <strong style={{ color: "#9ca3af" }}>Active</strong> to show/hide without deleting.
      </div>

      <TrackersAdmin initial={trackers} />
    </div>
  );
}
