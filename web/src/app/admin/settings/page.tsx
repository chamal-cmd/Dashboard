import Link from "next/link";
import { getUser } from "@/lib/supabase/get-user";
import { createClient } from "@/lib/supabase/server";
import ProfileSettings from "@/components/ProfileSettings";
import ClientProjectsAdmin from "./ClientProjectsAdmin";

export const dynamic = "force-dynamic";

export default async function AdminSettingsPage() {
  const user = await getUser();
  const supabase = await createClient();
  const { data: profile } = await supabase
    .from("profiles")
    .select("full_name, email, role")
    .eq("id", user!.id)
    .single();

  return (
    <div className="shellPage">
      <div className="shellPageTitle">Settings</div>
      <div className="shellPageSub">Manage your account details.</div>
      <ProfileSettings
        userId={user!.id}
        initialName={profile?.full_name ?? ""}
        email={profile?.email ?? user!.email ?? ""}
        role={profile?.role ?? "admin"}
      />

      <div style={{ marginTop: 32 }}>
        <div className="shellPageTitle" style={{ fontSize: 16 }}>Client Projects</div>
        <div className="shellPageSub">
          Numbered Asana projects (&quot;04. Kim Ching...&quot;) show up automatically. Register a client here only if their
          project isn&apos;t numbered, or to move a project&apos;s tasks to a different bookkeeper.
        </div>
        <ClientProjectsAdmin />
      </div>

      {/* Adding bookkeepers and reorganising pod members/leaders lives on the
          Pods page (its own member-by-email flow, plus the leader picker
          added alongside this section) rather than duplicated here. */}
      <div style={{ marginTop: 32, fontSize: 12, color: "var(--text-3)" }}>
        Looking to add a bookkeeper, move someone between pods, or change a pod&apos;s leader?
        That&apos;s on the <Link href="/admin/pods" style={{ color: "#4f8ef7" }}>Pods</Link> page.
      </div>
    </div>
  );
}
