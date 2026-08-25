import { notFound, redirect } from "next/navigation";
import { getUser } from "@/lib/supabase/get-user";
import { createAdminClient } from "@/lib/supabase/admin";
import { getHubstaffOverview } from "@/lib/data/hubstaff";
import HubstaffPodDashboard from "./HubstaffPodDashboard";
import "@/components/detail-page-theme.css";
import "@/app/dashboard/aircall/aircall-page.css";

// Without this, Next.js can statically cache a render of this page from
// before the latest deploy, serving stale Hubstaff data indefinitely.
export const dynamic = "force-dynamic";

export default async function HubstaffPodPage({ params }: { params: Promise<{ id: string }> }) {
  // Check auth before touching data: the layout also gates, but layout and
  // page render concurrently — without this, an unauthenticated hit aborts
  // the page's queries and surfaces as a 404 instead of the login redirect.
  const user = await getUser();
  if (!user) redirect("/login");

  const { id } = await params;
  const admin = createAdminClient();
  const [{ data: pod }, overview, { data: allPods }] = await Promise.all([
    admin.from("pods").select("name").eq("id", id).maybeSingle(),
    getHubstaffOverview(7, 200),
    admin.from("pods").select("id, name").order("name"),
  ]);
  if (!pod) notFound();

  return (
    <HubstaffPodDashboard
      podId={id}
      podName={pod.name}
      initial={overview}
      allPods={allPods ?? []}
    />
  );
}
