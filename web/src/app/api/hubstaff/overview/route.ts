import { NextRequest, NextResponse } from "next/server";
import { getHubstaffOverview } from "@/lib/data/hubstaff";
import { getUser } from "@/lib/supabase/get-user";

export async function GET(req: NextRequest) {
  const user = await getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const specificDate = req.nextUrl.searchParams.get("date");
  if (specificDate && /^\d{4}-\d{2}-\d{2}$/.test(specificDate)) {
    const data = await getHubstaffOverview(1, 10, specificDate);
    return NextResponse.json(data);
  }

  // Hubstaff's own API hard-rejects date ranges over 31 days, so capping
  // here (not just in the UI) keeps a direct/stale-client hit from
  // triggering the same silent error-flagged-but-200-OK empty response.
  const raw = Number(req.nextUrl.searchParams.get("days") ?? "7");
  const days = isNaN(raw) || raw < 1 ? 7 : Math.min(raw, 31);
  const data = await getHubstaffOverview(days, 10);
  return NextResponse.json(data);
}
