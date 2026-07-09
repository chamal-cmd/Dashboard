import { NextRequest, NextResponse } from "next/server";
import { getHubstaffOverview } from "@/lib/data/hubstaff";
import { getUser } from "@/lib/supabase/get-user";

export async function GET(req: NextRequest) {
  const user = await getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const raw = Number(req.nextUrl.searchParams.get("days") ?? "7");
  const days = isNaN(raw) || raw < 1 ? 7 : Math.min(raw, 90);
  const data = await getHubstaffOverview(days, 10);
  return NextResponse.json(data);
}
