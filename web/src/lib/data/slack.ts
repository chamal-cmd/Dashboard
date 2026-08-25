import "server-only";
import type { createAdminClient } from "@/lib/supabase/admin";

const SLACK_API = "https://slack.com/api";

function requireToken(): string {
  const token = process.env.SLACK_BOT_TOKEN;
  if (!token) throw new Error("Slack isn't configured yet (SLACK_BOT_TOKEN missing)");
  return token;
}

// users.lookupByEmail is a GET-style Slack method (query param, not a JSON
// body) — unlike chat.postMessage below, which does take JSON.
async function lookupSlackUserByEmail(email: string): Promise<string> {
  const token = requireToken();
  const res = await fetch(`${SLACK_API}/users.lookupByEmail?email=${encodeURIComponent(email)}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const json = await res.json() as { ok: boolean; error?: string; user?: { id: string } };
  if (!json.ok || !json.user) throw new Error(`Slack has no user for ${email}: ${json.error ?? "not found"}`);
  return json.user.id;
}

// chat.postMessage with a USER id as `channel` opens/reuses a DM with them —
// no separate "open a DM" call needed. Requires the chat:write bot scope.
async function postSlackDM(slackUserId: string, text: string): Promise<void> {
  const token = requireToken();
  const res = await fetch(`${SLACK_API}/chat.postMessage`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json; charset=utf-8" },
    body: JSON.stringify({ channel: slackUserId, text }),
  });
  const json = await res.json() as { ok: boolean; error?: string };
  if (!json.ok) throw new Error(`Slack message failed: ${json.error ?? "unknown error"}`);
}

export interface NudgeResult {
  ok: boolean;
  error?: string;
  leaderName?: string;
}

// Resolves a bookkeeper -> their pod -> that pod's leader -> the leader's
// Slack account (matched by email, same email column already used to join
// Hubstaff throughout lib/data/bookkeepers.ts), then DMs them. Every failure
// mode returns a specific, actionable error rather than throwing — a nudge
// button that just says "failed" for "no leader assigned yet" vs "Slack not
// configured" vs "no email on file" would send whoever clicked it down the
// wrong troubleshooting path.
export async function nudgePodLeader(
  admin: ReturnType<typeof createAdminClient>, bookkeeperMemberId: string, dueCount: number,
  senderName: string, origin: string
): Promise<NudgeResult> {
  const { data: bookkeeper } = await admin
    .from("asana_members").select("name, pod_id").eq("id", bookkeeperMemberId).maybeSingle();
  if (!bookkeeper) return { ok: false, error: "Bookkeeper not found." };
  if (!bookkeeper.pod_id) return { ok: false, error: `${bookkeeper.name} isn't assigned to a pod.` };

  const { data: pod } = await admin
    .from("pods").select("name, leader_member_id").eq("id", bookkeeper.pod_id).maybeSingle();
  if (!pod?.leader_member_id) {
    return { ok: false, error: `${pod?.name ?? "This pod"} doesn't have a leader assigned yet — set one in Admin → Pods.` };
  }

  const { data: leader } = await admin
    .from("asana_members").select("name, email").eq("id", pod.leader_member_id).maybeSingle();
  if (!leader) return { ok: false, error: "The pod leader's Asana member record is missing." };
  if (!leader.email) return { ok: false, error: `${leader.name} doesn't have an email on file.` };

  // Deep-links into the exact bookkeeper's task list (request 2026-08-21) —
  // ?panel opens the right FathomReportSection card, ?bookkeeper opens that
  // person's modal within it. See FathomReportSection.tsx and
  // BookkeeperProjectsPreview.tsx for the corresponding read side.
  const link = `${origin}/dashboard/asana?panel=bookkeeper-projects&bookkeeper=${encodeURIComponent(bookkeeperMemberId)}`;
  const text = `👋 *${bookkeeper.name}* has *${dueCount}* overdue task${dueCount === 1 ? "" : "s"} in Asana (${pod.name}).\nNudged by ${senderName} — <${link}|View in Ops Hub>`;
  try {
    const slackUserId = await lookupSlackUserByEmail(leader.email);
    await postSlackDM(slackUserId, text);
    return { ok: true, leaderName: leader.name };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}
