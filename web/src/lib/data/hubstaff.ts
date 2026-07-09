import "server-only";
import { getPodByEmail } from "./pods";
import { createAdminClient } from "@/lib/supabase/admin";
import { mean, median, stdDev, round1 } from "@/lib/stats";

export interface HubstaffProjectStat {
  projectId: number;
  name: string;
  hours: number;
  activityPct: number | null;
}

export interface HubstaffPodStat {
  pod: string;
  hours: number;
  activityPct: number | null;
  billableHours: number;
  idleHours: number;
  manualHours: number;
  memberCount: number;
}

export interface HubstaffMemberStat {
  userId: number;
  name: string;
  email: string;
  pod: string | null;
  hours: number;
  activityPct: number | null;
  billableHours: number;
  idleHours: number;
  manualHours: number;
}

export interface HubstaffOverview {
  orgName: string | null;
  activeCount: number | null;
  productivityPct: number | null;
  avgMemberActivityPct: number | null;
  medianMemberActivityPct: number | null;
  activityStdDevPct: number | null;
  billableRatioPct: number | null;
  idleRatioPct: number | null;
  hoursTracked: number | null;
  idleHours: number | null;
  manualHours: number | null;
  billableHours: number | null;
  workBreakHours: number | null;
  keyboardActions: number | null;
  mouseActions: number | null;
  taskCount: number | null;
  teams: { id: number; name: string }[];
  projects: HubstaffProjectStat[];
  pods: HubstaffPodStat[];
  members: HubstaffMemberStat[];
  rangeLabel: string;
  error?: string;
}

// GP Bookkeeper Pty Ltd
const ORG_ID = "564198";

// Two-tier token cache. The module-level tier only survives within one
// process/isolate; on Cloudflare Workers each request can be a fresh
// isolate, so tokens are also persisted in Supabase (integration_tokens).
// Without the shared tier, every cold isolate refreshes the token and
// Hubstaff rate-limits the refresh token ("Too many requests to refresh
// this token"), taking the whole integration down.
let cachedToken: string | null = null;
let tokenExpiry = 0;

const TOKEN_SAFETY_MS = 120_000;

async function getToken(): Promise<string> {
  if (cachedToken && Date.now() < tokenExpiry) return cachedToken;

  const admin = createAdminClient();

  const { data: stored } = await admin
    .from("integration_tokens")
    .select("access_token, expires_at")
    .eq("provider", "hubstaff")
    .maybeSingle();
  if (stored && new Date(stored.expires_at).getTime() - TOKEN_SAFETY_MS > Date.now()) {
    cachedToken = stored.access_token;
    tokenExpiry = new Date(stored.expires_at).getTime() - TOKEN_SAFETY_MS;
    return stored.access_token;
  }

  const res = await fetch("https://account.hubstaff.com/access_tokens", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: `grant_type=refresh_token&refresh_token=${encodeURIComponent(process.env.HUBSTAFF_REFRESH_TOKEN ?? "")}`,
  });
  const data = await res.json();
  if (!data.access_token) {
    // Refresh failed (usually Hubstaff's refresh rate limit). If a stored
    // token exists that hasn't strictly expired yet, limp along on it
    // rather than showing the whole page as unavailable.
    if (stored && new Date(stored.expires_at).getTime() > Date.now()) return stored.access_token;
    throw new Error(`Hubstaff token refresh failed: ${data.error_description ?? data.error ?? "unknown"}`);
  }
  const token: string = data.access_token;
  const expiresAt = new Date(Date.now() + data.expires_in * 1000);
  cachedToken = token;
  tokenExpiry = expiresAt.getTime() - TOKEN_SAFETY_MS;

  await admin.from("integration_tokens").upsert({
    provider: "hubstaff",
    access_token: token,
    expires_at: expiresAt.toISOString(),
    updated_at: new Date().toISOString(),
  });

  return token;
}

function emptyResult(rangeLabel: string): HubstaffOverview {
  return {
    orgName: null,
    activeCount: null,
    productivityPct: null,
    avgMemberActivityPct: null,
    medianMemberActivityPct: null,
    activityStdDevPct: null,
    billableRatioPct: null,
    idleRatioPct: null,
    hoursTracked: null,
    idleHours: null,
    manualHours: null,
    billableHours: null,
    workBreakHours: null,
    keyboardActions: null,
    mouseActions: null,
    taskCount: null,
    teams: [],
    projects: [],
    pods: [],
    members: [],
    rangeLabel,
  };
}

type UserInfo = { name: string; email: string };

// Hubstaff's own /members endpoint doesn't include name/email at all — only
// the dedicated per-user lookup does. Resolved with limited concurrency,
// same pattern as Aircall's contact-name resolution.
async function resolveUserInfo(token: string, userIds: number[]): Promise<Map<number, UserInfo>> {
  const result = new Map<number, UserInfo>();
  const CONCURRENCY = 5;
  for (let i = 0; i < userIds.length; i += CONCURRENCY) {
    const batch = userIds.slice(i, i + CONCURRENCY);
    const looked = await Promise.all(
      batch.map(async (id) => {
        try {
          const res = await fetch(`https://api.hubstaff.com/v2/users/${id}`, {
            headers: { Authorization: `Bearer ${token}` },
          });
          if (!res.ok) return [id, null] as const;
          const data = await res.json();
          return [id, { name: data.user?.name ?? `User ${id}`, email: data.user?.email ?? "" }] as const;
        } catch {
          return [id, null] as const;
        }
      })
    );
    for (const [id, info] of looked) if (info) result.set(id, info);
  }
  return result;
}

const hoursOf = (seconds: number) => Math.round((seconds / 3600) * 10) / 10;

type UserTotals = { tracked: number; overall: number; billable: number; idle: number; manual: number };
const emptyTotals = (): UserTotals => ({ tracked: 0, overall: 0, billable: 0, idle: 0, manual: 0 });

// `days` = 1 for "today" (compact card), larger for the dedicated page's
// wider window. `projectsLimit` caps how many project rows come back.
export async function getHubstaffOverview(days = 1, projectsLimit = 10): Promise<HubstaffOverview> {
  const startDate = new Date(Date.now() - (days - 1) * 86400000).toISOString().slice(0, 10);
  const endDate = new Date().toISOString().slice(0, 10);
  const rangeLabel = days === 1 ? "today" : `last ${days} days`;

  if (!process.env.HUBSTAFF_REFRESH_TOKEN) return { ...emptyResult(rangeLabel), error: "not configured" };

  try {
    const token = await getToken();
    const auth = { headers: { Authorization: `Bearer ${token}` } };

    const [activitiesRes, projectsRes, orgRes, teamsRes, tasksRes] = await Promise.all([
      fetch(`https://api.hubstaff.com/v2/organizations/${ORG_ID}/activities/daily?date[start]=${startDate}&date[stop]=${endDate}`, auth),
      fetch(`https://api.hubstaff.com/v2/organizations/${ORG_ID}/projects`, auth),
      fetch(`https://api.hubstaff.com/v2/organizations/${ORG_ID}`, auth),
      fetch(`https://api.hubstaff.com/v2/organizations/${ORG_ID}/teams`, auth),
      fetch(`https://api.hubstaff.com/v2/organizations/${ORG_ID}/tasks?page_limit=500`, auth),
    ]);
    if (!activitiesRes.ok) return { ...emptyResult(rangeLabel), error: `Hubstaff returned ${activitiesRes.status}` };

    const activities = await activitiesRes.json();
    const entries: {
      user_id: number; project_id: number; tracked: number; overall: number;
      keyboard: number; mouse: number; manual: number; idle: number; billable: number; work_break: number;
    }[] = activities.daily_activities ?? [];

    const projectNames = new Map<number, string>();
    if (projectsRes.ok) {
      const projectsData = await projectsRes.json();
      for (const p of projectsData.projects ?? []) projectNames.set(p.id, p.name);
    }

    const orgName = orgRes.ok ? (await orgRes.json()).organization?.name ?? null : null;
    const teams = teamsRes.ok ? ((await teamsRes.json()).teams ?? []).map((t: { id: number; name: string }) => ({ id: t.id, name: t.name })) : [];
    const taskCount = tasksRes.ok ? ((await tasksRes.json()).tasks ?? []).length : null;

    const activeUsers = new Set(entries.map((e) => e.user_id));
    const sum = (key: keyof (typeof entries)[number]) => entries.reduce((s, e) => s + (e[key] as number), 0);
    const totalTracked = sum("tracked");
    const totalOverall = sum("overall");

    // Per-project breakdown (existing behaviour)
    const byProject = new Map<number, { tracked: number; overall: number }>();
    for (const e of entries) {
      const cur = byProject.get(e.project_id) ?? { tracked: 0, overall: 0 };
      cur.tracked += e.tracked;
      cur.overall += e.overall;
      byProject.set(e.project_id, cur);
    }
    const projects = Array.from(byProject.entries())
      .map(([projectId, v]) => ({
        projectId,
        name: projectNames.get(projectId) ?? `Project ${projectId}`,
        hours: hoursOf(v.tracked),
        activityPct: v.tracked > 0 ? Math.round((v.overall / v.tracked) * 100) : null,
      }))
      .sort((a, b) => b.hours - a.hours)
      .slice(0, projectsLimit);

    // Per-user totals (every field, not just tracked/overall), then resolve
    // names/emails and match against the real pod roster (from Supabase —
    // Hubstaff's own team_id filter is fake).
    const byUser = new Map<number, UserTotals>();
    for (const e of entries) {
      const cur = byUser.get(e.user_id) ?? emptyTotals();
      cur.tracked += e.tracked;
      cur.overall += e.overall;
      cur.billable += e.billable;
      cur.idle += e.idle;
      cur.manual += e.manual;
      byUser.set(e.user_id, cur);
    }
    const [userInfo, podByEmail] = await Promise.all([
      resolveUserInfo(token, Array.from(byUser.keys())),
      getPodByEmail(),
    ]);

    const members: HubstaffMemberStat[] = Array.from(byUser.entries()).map(([userId, v]) => {
      const info = userInfo.get(userId);
      const email = info?.email ?? "";
      return {
        userId,
        name: info?.name ?? `User ${userId}`,
        email,
        pod: email ? podByEmail.get(email.toLowerCase()) ?? null : null,
        hours: hoursOf(v.tracked),
        activityPct: v.tracked > 0 ? Math.round((v.overall / v.tracked) * 100) : null,
        billableHours: hoursOf(v.billable),
        idleHours: hoursOf(v.idle),
        manualHours: hoursOf(v.manual),
      };
    }).sort((a, b) => b.hours - a.hours);

    // Mean alone hides shape: a team evenly at 70% and a team split 95%/45%
    // both average ~70%. Median (typical member) + std dev (spread) together
    // tell you which one you actually have.
    const membersWithActivity = members.filter((m) => m.activityPct !== null);
    const activityValues = membersWithActivity.map((m) => m.activityPct ?? 0);
    const avgMemberActivityPct = activityValues.length > 0 ? Math.round(mean(activityValues)!) : null;
    const medianMemberActivityPct = activityValues.length > 0 ? Math.round(median(activityValues)!) : null;
    const activityStdDevPct = activityValues.length > 1 ? round1(stdDev(activityValues)!) : null;

    // Utilization rates — billable/idle hours only mean something relative
    // to total tracked time, not as raw counts.
    const billableRatioPct = totalTracked > 0 ? round1((sum("billable") / totalTracked) * 100) : null;
    const idleRatioPct = totalTracked > 0 ? round1((sum("idle") / totalTracked) * 100) : null;

    const byPod = new Map<string, UserTotals & { members: Set<number> }>();
    for (const [userId, v] of byUser.entries()) {
      const email = userInfo.get(userId)?.email?.toLowerCase();
      const pod = email ? podByEmail.get(email) : null;
      if (!pod) continue;
      const cur = byPod.get(pod) ?? { ...emptyTotals(), members: new Set<number>() };
      cur.tracked += v.tracked;
      cur.overall += v.overall;
      cur.billable += v.billable;
      cur.idle += v.idle;
      cur.manual += v.manual;
      cur.members.add(userId);
      byPod.set(pod, cur);
    }
    const pods: HubstaffPodStat[] = Array.from(byPod.entries())
      .map(([pod, v]) => ({
        pod,
        hours: hoursOf(v.tracked),
        activityPct: v.tracked > 0 ? Math.round((v.overall / v.tracked) * 100) : null,
        billableHours: hoursOf(v.billable),
        idleHours: hoursOf(v.idle),
        manualHours: hoursOf(v.manual),
        memberCount: v.members.size,
      }))
      .sort((a, b) => b.hours - a.hours);

    return {
      orgName,
      activeCount: activeUsers.size,
      productivityPct: totalTracked > 0 ? Math.round((totalOverall / totalTracked) * 100) : null,
      avgMemberActivityPct,
      medianMemberActivityPct,
      activityStdDevPct,
      billableRatioPct,
      idleRatioPct,
      hoursTracked: hoursOf(totalTracked),
      idleHours: hoursOf(sum("idle")),
      manualHours: hoursOf(sum("manual")),
      billableHours: hoursOf(sum("billable")),
      workBreakHours: hoursOf(sum("work_break")),
      keyboardActions: sum("keyboard"),
      mouseActions: sum("mouse"),
      taskCount,
      teams,
      projects,
      pods,
      members,
      rangeLabel,
    };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ...emptyResult(rangeLabel), error: `Hubstaff unreachable: ${msg}` };
  }
}
