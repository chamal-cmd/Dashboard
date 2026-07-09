import { createAdminClient } from "@/lib/supabase/admin";
import PodsAdmin from "./PodsAdmin";
import "../admin-theme.css";

async function getPods() {
  const admin = createAdminClient();
  const [podsRes, membersRes] = await Promise.all([
    admin.from("pods").select("id, name, color").order("name"),
    admin.from("asana_members").select("id, email, pod_id").not("pod_id", "is", null),
  ]);
  return (podsRes.data ?? []).map((p) => ({
    ...p,
    members: (membersRes.data ?? []).filter((m) => m.pod_id === p.id),
  }));
}

export default async function PodsPage() {
  const pods = await getPods().catch(() => []);

  return (
    <div className="shellPage">
      <div className="shellPageTitle">Pod Management</div>
      <div className="shellPageSub">
        Pods drive the Hubstaff &quot;By Pod&quot; breakdown. Members are matched by email address.
      </div>

      <div style={{ marginBottom: 20, marginTop: 20, fontSize: 12, color: "#6b7280" }}>
        Emails must match exactly what the bookkeeper uses in Hubstaff. Matching is case-insensitive.
        If a person is already in <code style={{ fontFamily: "monospace", color: "#9ca3af" }}>asana_members</code>,
        adding them here updates their pod assignment.
      </div>

      <PodsAdmin initial={pods} />
    </div>
  );
}
