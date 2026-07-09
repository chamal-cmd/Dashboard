import { redirect } from "next/navigation";
import { getUser } from "@/lib/supabase/get-user";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export default async function RootPage() {
  const user = await getUser();
  if (!user) redirect("/login");

  const supabase = await createClient();
  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .single();

  redirect(profile?.role === "admin" ? "/admin" : "/dashboard");
}
