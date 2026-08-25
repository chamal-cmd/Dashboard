import { NextRequest, NextResponse } from "next/server";
import { getUser } from "@/lib/supabase/get-user";
import { createAdminClient } from "@/lib/supabase/admin";
import { nudgePodLeader } from "@/lib/data/slack";

export const dynamic = "force-dynamic";

// Backs the Bookkeeper Projects "Nudge" button — DMs the bookkeeper's pod
// leader on Slack when they have overdue work. See lib/data/slack.ts for the
// bookkeeper -> pod -> leader -> Slack-account resolution.
export async function POST(req: NextRequest) {
  const user = await getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const body = (await req.json().catch(() => null)) as { bookkeeperId?: string; dueCount?: number } | null;
  const bookkeeperId = body?.bookkeeperId?.trim();
  if (!bookkeeperId) return NextResponse.json({ error: "bookkeeperId is required" }, { status: 400 });
  const dueCount = typeof body?.dueCount === "number" && body.dueCount >= 0 ? body.dueCount : 0;

  const admin = createAdminClient();
  // Same profiles lookup used to label the sidebar/settings pages (see
  // dashboard/layout.tsx) — the Auth user's own user_metadata isn't kept in
  // sync with edits made via ProfileSettings, profiles.full_name is.
  const { data: senderProfile } = await admin.from("profiles").select("full_name").eq("id", user.id).single();
  const senderName = senderProfile?.full_name || user.email || "Someone";
  const origin = new URL(req.url).origin;
  const result = await nudgePodLeader(admin, bookkeeperId, dueCount, senderName, origin);
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 400 });
  return NextResponse.json({ ok: true, leaderName: result.leaderName });
}
