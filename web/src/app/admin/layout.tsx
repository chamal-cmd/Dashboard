import { redirect } from "next/navigation";
import { getUser } from "@/lib/supabase/get-user";
import { createClient } from "@/lib/supabase/server";
import Sidebar from "@/components/Sidebar";
import "@/components/shell-theme.css";

// force-dynamic: without this Next.js could statically cache a render of
// this layout with no user, making the auth check permanently stale.
export const dynamic = "force-dynamic";

const ADMIN_NAV = [
  { href: "/admin", label: "Overview", icon: "🏠" },
  { href: "/admin/users", label: "Users", icon: "👥" },
  { href: "/admin/pods", label: "Pods", icon: "🧩" },
  { href: "/admin/trackers", label: "Asana Trackers", icon: "🗂" },
  { href: "/admin/thresholds", label: "Thresholds", icon: "🎚" },
  { href: "/admin/settings", label: "Settings", icon: "⚙" },
];

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const user = await getUser();
  if (!user) redirect("/login");

  const supabase = await createClient();
  const { data: profile } = await supabase
    .from("profiles")
    .select("full_name, email, role")
    .eq("id", user.id)
    .single();

  if (profile?.role !== "admin") redirect("/dashboard");

  return (
    <div className="shell">
      <Sidebar items={ADMIN_NAV} userName={profile.full_name} userEmail={profile.email} width={220} />
      <main className="shellMain">{children}</main>
    </div>
  );
}
