import { NextRequest, NextResponse } from "next/server";
import { getUser } from "@/lib/supabase/get-user";
import { getHubstaffPeriodSummary } from "@/lib/data/hubstaff";

const DATE = /^\d{4}-\d{2}-\d{2}$/;

// One period's tracked-hours summary for an arbitrary date range — the client
// hits this once per period in a multi-period comparison.
export async function GET(req: NextRequest) {
  const user = await getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const start = req.nextUrl.searchParams.get("start") ?? "";
  const end = req.nextUrl.searchParams.get("end") ?? "";
  if (!DATE.test(start) || !DATE.test(end) || start > end) {
    return NextResponse.json({ error: "invalid range" }, { status: 400 });
  }

  const data = await getHubstaffPeriodSummary(start, end);
  return NextResponse.json(data);
}
