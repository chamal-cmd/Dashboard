import { NextRequest, NextResponse } from "next/server";
import { getUser } from "@/lib/supabase/get-user";
import { getBookkeeperTrend } from "@/lib/data/bookkeepers";

// Fetched client-side by the Bookkeeper Stats page, separate from the fast
// initial getBookkeeperStats() page load — a multi-week Asana + Hubstaff
// scan is heavier than the single-window stats that page already renders.
export async function GET(req: NextRequest) {
  const user = await getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const raw = Number(req.nextUrl.searchParams.get("weeks") ?? "8");
  const weeks = isNaN(raw) || raw < 2 ? 8 : Math.min(raw, 26);
  const data = await getBookkeeperTrend(weeks);
  return NextResponse.json(data);
}
