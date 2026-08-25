import { NextResponse } from "next/server";
import { getUser } from "@/lib/supabase/get-user";
import { getTrackerCadence, getFathomMonthSplit } from "@/lib/data/asana-cadence";
import { auTodayISODate } from "@/lib/business-tz";

// Client-fetched so the live Asana calls don't slow the dashboard's first
// paint (see asana-cadence.ts for why it reads Asana directly). The Fathom
// month split rides along on this same route so the Fathom block needs one
// request, not two.
export async function GET() {
  const user = await getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const [trackers, fathomMonths] = await Promise.all([
    getTrackerCadence(auTodayISODate()),
    getFathomMonthSplit(),
  ]);
  return NextResponse.json({ trackers, fathomMonths });
}
