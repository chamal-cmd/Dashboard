import { createAdminClient } from "@/lib/supabase/admin";
import PodsAdmin from "./PodsAdmin";
import "../admin-theme.css";

export const dynamic = "force-dynamic";

async function getPods() {
  const admin = createAdminClient();
  const [podsRes, membersRes] = await Promise.all([
    admin.from("pods").select("id, name, color, leader_member_id").order("name"),
    admin.from("asana_members").select("id, name, email, pod_id").not("pod_id", "is", null),
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

      <div style={{ marginBottom: 20, marginTop: 20, fontSize: 12, color: "var(--text-3)" }}>
        Emails must match exactly what the bookkeeper uses in Hubstaff. Matching is case-insensitive.
        If a person is already in <code style={{ fontFamily: "monospace", color: "var(--text-3)" }}>asana_members</code>,
        adding them here updates their pod assignment.
      </div>

      <PodsAdmin initial={pods} />
    </div>
  );
}
