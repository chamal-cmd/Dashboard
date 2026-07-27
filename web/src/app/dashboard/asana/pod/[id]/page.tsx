import { notFound, redirect } from "next/navigation";
import { getUser } from "@/lib/supabase/get-user";
import { createAdminClient } from "@/lib/supabase/admin";
import { getAsanaPodDetail } from "@/lib/data/asana-pod";
import PodDashboard from "./PodDashboard";
import "@/components/detail-page-theme.css";
import "@/app/dashboard/aircall/aircall-page.css";

export const dynamic = "force-dynamic";

export default async function AsanaPodPage({ params }: { params: Promise<{ id: string }> }) {
  // Check auth before touching data: the layout also gates, but layout and
  // page render concurrently — without this, an unauthenticated hit aborts
  // the page's queries and surfaces as a 404 instead of the login redirect.
  const user = await getUser();
  if (!user) redirect("/login");

  const { id } = await params;
  const admin = createAdminClient();
  const [pod, { data: allPods }] = await Promise.all([
    getAsanaPodDetail(id, 7),
    admin.from("pods").select("id, name").order("name"),
  ]);
  if (!pod) notFound();

  return <PodDashboard initial={pod} allPods={allPods ?? []} />;
}
