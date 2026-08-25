import { NextRequest, NextResponse } from "next/server";
import { getAircallOverview } from "@/lib/data/aircall";
import { getUser } from "@/lib/supabase/get-user";

export async function GET(req: NextRequest) {
  const user = await getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const raw = Number(req.nextUrl.searchParams.get("days") ?? "7");
  const days = isNaN(raw) || raw < 1 ? 7 : Math.min(raw, 90);
  // ?callerNumber= drills the Aircall page's Repeat Callers trend chart into
  // one specific caller's day-by-day volume (request 2026-08-19) — computed
  // from calls this same request already fetches, not a second live lookup.
  const callerTrendNumber = req.nextUrl.searchParams.get("callerNumber")?.trim() || undefined;
  // ?direction=inbound|outbound — same "independent of the main filters"
  // idea, currently only used by the Repeat Callers trend chart.
  const directionRaw = req.nextUrl.searchParams.get("direction");
  const direction = directionRaw === "inbound" || directionRaw === "outbound" ? directionRaw : undefined;
  // ?period=week|month or ?from=YYYY-MM-DD&to=YYYY-MM-DD — calendar-aligned
  // window for the Repeat Callers trend chart (request 2026-08-20), resolved
  // against Colombo's calendar inside getAircallOverview. Plain digits/
  // hyphens only, unlike callerNumber — no "+" to fall victim to the
  // double-decode issue that broke the caller drill-down.
  const periodRaw = req.nextUrl.searchParams.get("period");
  const period = periodRaw === "week" || periodRaw === "month" ? periodRaw : undefined;
  const fromDate = req.nextUrl.searchParams.get("from")?.trim() || undefined;
  const toDate = req.nextUrl.searchParams.get("to")?.trim() || undefined;
  // 200 matches the page's initial server render so switching ranges
  // doesn't silently shrink the recent-calls list. Contact names enabled to
  // match the initial load — see page.tsx; getAircallOverview caps contact
  // lookups regardless of range, so this stays safe on wider presets too.
  const data = await getAircallOverview(200, days, { callerTrendNumber, direction, period, fromDate, toDate });
  return NextResponse.json(data);
}
