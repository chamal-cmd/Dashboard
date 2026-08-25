import { NextResponse } from "next/server";
import { getUser } from "@/lib/supabase/get-user";
import { getClientProjectTasksForBookkeeper } from "@/lib/data/asana";

// Backs the Bookkeeper Projects popup — lazy per-bookkeeper task list, fetched
// only when their row is clicked (same reasoning as eofy-client-activities:
// fetching this for every bookkeeper up front would be needless work most of
// which never gets looked at).
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const user = await getUser();
    if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

    const assigneeId = new URL(request.url).searchParams.get("assigneeId");
    if (!assigneeId) return NextResponse.json({ error: "Missing assigneeId" }, { status: 400 });

    const data = await getClientProjectTasksForBookkeeper(assigneeId, { personalOnly: true });
    return NextResponse.json(data);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    console.error("bookkeeper-tasks failed:", message);
    return NextResponse.json({ tasks: [], error: message }, { status: 500 });
  }
}
