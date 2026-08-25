import { notFound, redirect } from "next/navigation";
import { getUser } from "@/lib/supabase/get-user";
import { createAdminClient } from "@/lib/supabase/admin";
import HiverPodDashboard from "./HiverPodDashboard";

export const dynamic = "force-dynamic";

export default async function HiverPodPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await getUser();
  if (!user) redirect("/login");

  const { id } = await params;
  const admin = createAdminClient();
  const { data: pod } = await admin.from("pods").select("name").eq("id", id).single();
  if (!pod) notFound();

  return <HiverPodDashboard podName={pod.name as string} />;
}
