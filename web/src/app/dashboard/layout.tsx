import { redirect } from "next/navigation";
import { getUser } from "@/lib/supabase/get-user";
import { createClient } from "@/lib/supabase/server";
import Sidebar from "@/components/Sidebar";
import "@/components/shell-theme.css";

export const dynamic = "force-dynamic";

const USER_NAV = [
  { href: "/dashboard", label: "Overview" },
  { href: "/dashboard/asana", label: "Asana" },
  { href: "/dashboard/aircall", label: "Aircall" },
  { href: "/dashboard/hiver", label: "Hiver" },
  { href: "/dashboard/hubstaff", label: "Hubstaff" },
  { href: "/dashboard/settings", label: "Settings" },
];

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const user = await getUser();
  if (!user) redirect("/login");
  const supabase = await createClient();
  const { data: profile } = await supabase.from("profiles").select("full_name, email").eq("id", user.id).single();
  return (
    <div className="shell">
      <Sidebar items={USER_NAV} userName={profile?.full_name ?? "User"} userEmail={profile?.email ?? user.email ?? ""} width={200} />
      <main className="shellMain">{children}</main>
    </div>
  );
}
