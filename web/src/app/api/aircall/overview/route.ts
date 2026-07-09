import { NextRequest, NextResponse } from "next/server";
import { getAircallOverview } from "@/lib/data/aircall";
import { getUser } from "@/lib/supabase/get-user";

export async function GET(req: NextRequest) {
  const user = await getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const raw = Number(req.nextUrl.searchParams.get("days") ?? "7");
  const days = isNaN(raw) || raw < 1 ? 7 : Math.min(raw, 90);
  // 200 matches the page's initial server render so switching ranges
  // doesn't silently shrink the recent-calls list.
  const data = await getAircallOverview(200, days);
  return NextResponse.json(data);
}
