import { NextResponse } from "next/server";
import { getUser } from "@/lib/supabase/get-user";
import { getPodByEmail, getAllPods } from "@/lib/data/pods";

// Lets client components (Hiver's dashboard has no server-rendered data path —
// see HiverDashboard.tsx) resolve a Hiver agent's email to their Asana/Hubstaff
// pod, without duplicating the asana_members join server-only code can do directly.
// allPods rides along here too so Hiver's "Jump to Pod" nav and per-pod pages
// have a fixed roster to switch between, same as byEmail does for grouping.
export async function GET() {
  const user = await getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const [byEmail, allPods] = await Promise.all([getPodByEmail(), getAllPods()]);
  return NextResponse.json({ byEmail: Object.fromEntries(byEmail), allPods });
}
