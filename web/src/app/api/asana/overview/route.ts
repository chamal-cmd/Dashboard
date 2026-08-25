import { NextRequest, NextResponse } from "next/server";
import { getAsanaOverview } from "@/lib/data/asana";
import { getUser } from "@/lib/supabase/get-user";

export async function GET(req: NextRequest) {
  const user = await getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const raw = Number(req.nextUrl.searchParams.get("days") ?? "7");
  const days = isNaN(raw) || raw < 1 ? 7 : Math.min(raw, 90);
  const data = await getAsanaOverview(days);
  return NextResponse.json(data);
}
