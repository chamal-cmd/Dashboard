import { NextResponse } from "next/server";
import { getUser } from "@/lib/supabase/get-user";
import { getEofyPodBreakdown } from "@/lib/data/asana-cadence";

// Pod-by-pod EOFY breakdown, client-fetched so this live Asana call doesn't
// slow the dashboard's first paint (see asana-cadence.ts). Same "everything
// inside try/catch" reasoning as fathom-pod-preview: an uncaught error on
// Cloudflare tears the request down with no HTTP response at all, which the
// browser can only report as an opaque "Failed to fetch".
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const user = await getUser();
    if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

    const data = await getEofyPodBreakdown();
    return NextResponse.json(data);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    console.error("eofy-pod-preview failed:", message);
    return NextResponse.json({ pods: [], error: message }, { status: 500 });
  }
}
