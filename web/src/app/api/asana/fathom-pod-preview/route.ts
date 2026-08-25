import { NextRequest, NextResponse } from "next/server";
import { getUser } from "@/lib/supabase/get-user";
import { getTrackerPodBreakdown, TRACKER_CONFIGS, type TrackerKey } from "@/lib/data/asana-cadence";

// Pod-by-pod compliance-tracker breakdown, client-fetched so this live Asana
// call doesn't slow the dashboard's first paint (see asana-cadence.ts).
// Returns all three pods in one response so switching pods in the UI is a
// client-side re-render, not a second live Asana call.
//
// `?tracker=fathom|bas` picks the board. Defaults to fathom, which is what
// this route returned before BAS existed — so any older caller keeps working.
// The path still says "fathom-pod-preview" for the same reason; it now serves
// both trackers.
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  // Everything is inside try/catch on purpose. Anything that escapes this
  // handler on Cloudflare tears down the request without an HTTP response,
  // which the browser reports only as "Failed to fetch" — no status, no
  // message, nothing to act on. Returning JSON means the UI can show the real
  // reason and we get something to debug.
  try {
    const user = await getUser();
    if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

    const raw = req.nextUrl.searchParams.get("tracker") ?? "fathom";
    if (!Object.prototype.hasOwnProperty.call(TRACKER_CONFIGS, raw)) {
      return NextResponse.json(
        { error: `Unknown tracker "${raw}". Expected one of: ${Object.keys(TRACKER_CONFIGS).join(", ")}.` },
        { status: 400 }
      );
    }

    const data = await getTrackerPodBreakdown(raw as TrackerKey);
    return NextResponse.json(data);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    console.error("fathom-pod-preview failed:", message);
    return NextResponse.json({ pods: [], error: message }, { status: 500 });
  }
}
