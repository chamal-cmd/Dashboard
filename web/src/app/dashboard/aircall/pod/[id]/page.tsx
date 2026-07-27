import { notFound, redirect } from "next/navigation";
import { getUser } from "@/lib/supabase/get-user";
import { createAdminClient } from "@/lib/supabase/admin";
import { getAircallOverview } from "@/lib/data/aircall";
import AircallPodDashboard from "./AircallPodDashboard";
import "@/components/detail-page-theme.css";
import "../../aircall-page.css";

// Without this, Next.js can statically cache a render of this page from
// before the latest deploy, serving stale Aircall data indefinitely.
export const dynamic = "force-dynamic";

export default async function AircallPodPage({ params }: { params: Promise<{ id: string }> }) {
  // Check auth before touching data: the layout also gates, but layout and
  // page render concurrently — without this, an unauthenticated hit aborts
  // the page's queries and surfaces as a 404 instead of the login redirect.
  const user = await getUser();
  if (!user) redirect("/login");

  const { id } = await params;
  const admin = createAdminClient();
  const [{ data: pod }, overview] = await Promise.all([
    admin.from("pods").select("name").eq("id", id).maybeSingle(),
    getAircallOverview(1, 7, { skipContacts: true }),
  ]);
  if (!pod) notFound();

  return (
    <AircallPodDashboard
      podName={pod.name as string}
      initial={overview}
    />
  );
}
