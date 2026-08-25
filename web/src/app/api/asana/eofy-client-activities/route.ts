import { NextResponse } from "next/server";
import { getUser } from "@/lib/supabase/get-user";
import { getEofyClientActivities } from "@/lib/data/asana-cadence";

// Client-level drill-down, fetched on demand (one client at a time, only when
// its row is clicked) rather than folded into eofy-pod-preview — that would
// mean one subtasks call per client on every panel load. Same "everything
// inside try/catch" reasoning as the other Asana routes: an uncaught error on
// Cloudflare tears the request down with no HTTP response at all.
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const user = await getUser();
    if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

    const taskGid = new URL(request.url).searchParams.get("taskGid");
    if (!taskGid) return NextResponse.json({ error: "Missing taskGid" }, { status: 400 });

    const data = await getEofyClientActivities(taskGid);
    return NextResponse.json(data);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    console.error("eofy-client-activities failed:", message);
    return NextResponse.json({ activities: [], error: message }, { status: 500 });
  }
}
