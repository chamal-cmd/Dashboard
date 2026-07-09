import { getUser } from "@/lib/supabase/get-user";
import { createClient } from "@/lib/supabase/server";
import ProfileSettings from "@/components/ProfileSettings";

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
    </div>
  );
}
