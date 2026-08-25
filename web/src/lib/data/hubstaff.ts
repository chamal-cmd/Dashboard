import "server-only";
import { getPodByEmail, getAllPods } from "./pods";
import { createAdminClient } from "@/lib/supabase/admin";
import { mean, median, stdDev, round1 } from "@/lib/stats";
import { batchMap } from "@/lib/concurrency";
import { auTodayISODate, auDateISODate } from "@/lib/business-tz";
import { isoWeekMonday } from "@/lib/iso-week";

export interface HubstaffProjectStat {
  projectId: number;
  name: string;
  hours: number;
  activityPct: number | null;
}

export interface HubstaffPodStat {
  pod: string;
  podId: string | null; // matches Asana's pods.id — lets the UI link through to /dashboard/hubstaff/pod/[id]
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
  workBreakHours: number;
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
  teams: { id: number; name: string }[];
  projects: HubstaffProjectStat[];
  pods: HubstaffPodStat[];
  allPods: { id: string; name: string }[]; // every pod regardless of activity — for a fixed pod switcher, unlike pods which only lists pods with tracked hours in range
  members: HubstaffMemberStat[];
  trend: HubstaffTrendPoint[]; // per-weekday tracked hours + activity across the window, oldest first — for the comparison bar chart
  rangeLabel: string;
  error?: string;
}

export interface HubstaffTrendPoint {
  date: string; // YYYY-MM-DD (weekday only — weekends are already filtered out)
  hours: number;
  activityPct: number | null;
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
    teams: [],
    projects: [],
    pods: [],
    allPods: [],
    members: [],
    trend: [],
    rangeLabel,
  };
}

type UserInfo = { name: string; email: string };

// Hubstaff's own /members endpoint doesn't include name/email at all — only
// the dedicated per-user lookup does. Resolved with limited concurrency,
// same pattern as Aircall's contact-name resolution. One retry with a short
// backoff (same shape as Hiver's fetchWithRetry) before giving up — without
// it, a single transient failure on one user's lookup silently drops that
// person from the By Pod table with no error surfaced anywhere.
async function resolveUserInfo(token: string, userIds: number[]): Promise<Map<number, UserInfo>> {
  const pairs = await batchMap(userIds, async (id) => {
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const res = await fetch(`https://api.hubstaff.com/v2/users/${id}`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (res.ok) {
          const data = await res.json();
          return [id, { name: data.user?.name ?? `User ${id}`, email: data.user?.email ?? "" }] as const;
        }
      } catch {
        // fall through to retry/backoff below
      }
      if (attempt === 0) await new Promise((r) => setTimeout(r, 300));
    }
    return [id, null] as const;
  });
  const result = new Map<number, UserInfo>();
  for (const [id, info] of pairs) if (info) result.set(id, info);
  return result;
}

const hoursOf = (seconds: number) => Math.round((seconds / 3600) * 10) / 10;

type UserTotals = { tracked: number; overall: number; billable: number; idle: number; manual: number; work_break: number };
const emptyTotals = (): UserTotals => ({ tracked: 0, overall: 0, billable: 0, idle: 0, manual: 0, work_break: 0 });

type DailyActivityEntry = {
  date: string; // "YYYY-MM-DD", bucketed to the org's local (AU) day
  user_id: number; project_id: number; tracked: number; overall: number;
  keyboard: number; mouse: number; manual: number; idle: number; billable: number; work_break: number;
};

// The team works weekdays, so Saturday/Sunday tracked time (overtime, stray
// sessions) is excluded from every Hubstaff metric — otherwise it would
// distort hours totals and activity averages. Hubstaff's `date` is already
// the org's local calendar day, so parsing it as UTC midnight and reading
// the UTC weekday gives the correct day-of-week with no timezone drift.
function isWeekday(dateStr: string): boolean {
  const dow = new Date(`${dateStr}T00:00:00Z`).getUTCDay();
  return dow !== 0 && dow !== 6;
}

function addDaysToISO(dateStr: string, days: number): string {
  const d = new Date(`${dateStr}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

// Hubstaff caps /activities/daily at ~100 entries per page by default and
// silently stops there unless you both raise page_limit and follow
// pagination.next_page_start_id yourself — without this, any window with
// enough users/projects/days to produce more than one page's worth of rows
// undercounts hours (confirmed live: 316h shown vs 651h actual for a 7-day
// window) and specifically drops the most recent days, since Hubstaff
// returns pages oldest-first.
//
// Separately, Hubstaff hard-rejects any SINGLE request spanning more than 31
// days (confirmed live 2026-08-13: error_code 11000, "Date range can not be
// more than 31 days") — callers routinely ask for wider windows than that
// (a full quarter in the period comparison chart, 8-16 weeks of bookkeeper
// trend data), so the requested range is split into <=31-day chunks here,
// transparently to every caller, instead of pushing that limit onto each
// call site (which is what caused the 400s: getHubstaffWeeklyTrend's default
// 8-week window is 56 days, already past the cap).
async function fetchAllDailyActivities(
  token: string,
  startDate: string,
  endDate: string
): Promise<{ ok: boolean; status: number; entries: DailyActivityEntry[] }> {
  const entries: DailyActivityEntry[] = [];
  let chunkStart = startDate;
  while (chunkStart <= endDate) {
    const maxChunkEnd = addDaysToISO(chunkStart, 30);
    const chunkEnd = maxChunkEnd < endDate ? maxChunkEnd : endDate;

    let pageStartId: string | number | undefined;
    for (;;) {
      const url = new URL(`https://api.hubstaff.com/v2/organizations/${ORG_ID}/activities/daily`);
      url.searchParams.set("date[start]", chunkStart);
      url.searchParams.set("date[stop]", chunkEnd);
      url.searchParams.set("page_limit", "500");
      if (pageStartId !== undefined) url.searchParams.set("page_start_id", String(pageStartId));

      const res = await fetch(url.toString(), { headers: { Authorization: `Bearer ${token}` } });
      if (!res.ok) return { ok: false, status: res.status, entries };

      const data = await res.json();
      entries.push(...((data.daily_activities ?? []) as DailyActivityEntry[]));

      const nextPageStartId = data.pagination?.next_page_start_id;
      if (!nextPageStartId) break;
      pageStartId = nextPageStartId;
    }

    chunkStart = addDaysToISO(chunkEnd, 1);
  }
  return { ok: true, status: 200, entries };
}

// `days` = 1 for "today" (compact card), larger for the dedicated page's
// wider window. `projectsLimit` caps how many project rows come back.
// `specificDate` (YYYY-MM-DD) overrides both — used to look at one exact
// calendar day instead of a trailing window ending today.
export async function getHubstaffOverview(days = 1, projectsLimit = 10, specificDate?: string): Promise<HubstaffOverview> {
  let startDate: string;
  let endDate: string;
  let rangeLabel: string;
  if (specificDate) {
    startDate = specificDate;
    endDate = specificDate;
    rangeLabel = new Date(`${specificDate}T00:00:00`).toLocaleDateString("en-AU", { weekday: "short", day: "numeric", month: "short", year: "numeric" });
  } else {
    startDate = auDateISODate(-(days - 1));
    endDate = auTodayISODate();
    rangeLabel = days === 1 ? "today" : `last ${days} days`;
  }

  if (!process.env.HUBSTAFF_REFRESH_TOKEN) return { ...emptyResult(rangeLabel), error: "not configured" };

  try {
    const token = await getToken();
    const auth = { headers: { Authorization: `Bearer ${token}` } };

    const [activitiesResult, projectsRes, orgRes, teamsRes] = await Promise.all([
      fetchAllDailyActivities(token, startDate, endDate),
      fetch(`https://api.hubstaff.com/v2/organizations/${ORG_ID}/projects`, auth),
      fetch(`https://api.hubstaff.com/v2/organizations/${ORG_ID}`, auth),
      fetch(`https://api.hubstaff.com/v2/organizations/${ORG_ID}/teams`, auth),
    ]);
    if (!activitiesResult.ok) return { ...emptyResult(rangeLabel), error: `Hubstaff returned ${activitiesResult.status}` };

    // Weekdays only — drop any Sat/Sun daily-activity rows before aggregating,
    // so hours, activity %, per-member and per-pod stats all count weekdays only.
    const entries: DailyActivityEntry[] = activitiesResult.entries.filter((e) => isWeekday(e.date));

    const projectNames = new Map<number, string>();
    if (projectsRes.ok) {
      const projectsData = await projectsRes.json();
      for (const p of projectsData.projects ?? []) projectNames.set(p.id, p.name);
    }

    const orgName = orgRes.ok ? (await orgRes.json()).organization?.name ?? null : null;
    const teams = teamsRes.ok ? ((await teamsRes.json()).teams ?? []).map((t: { id: number; name: string }) => ({ id: t.id, name: t.name })) : [];

    const activeUsers = new Set(entries.map((e) => e.user_id));
    const sum = (key: keyof (typeof entries)[number]) => entries.reduce((s, e) => s + (e[key] as number), 0);
    const totalTracked = sum("tracked");
    const totalOverall = sum("overall");

    // Per-weekday time series (tracked hours + activity) across the window —
    // powers the comparison bar chart. Oldest-first so the chart reads L→R.
    const byDate = new Map<string, { tracked: number; overall: number }>();
    for (const e of entries) {
      const cur = byDate.get(e.date) ?? { tracked: 0, overall: 0 };
      cur.tracked += e.tracked;
      cur.overall += e.overall;
      byDate.set(e.date, cur);
    }
    const trend: HubstaffTrendPoint[] = Array.from(byDate.entries())
      .map(([date, v]) => ({
        date,
        hours: hoursOf(v.tracked),
        activityPct: v.tracked > 0 ? Math.round((v.overall / v.tracked) * 100) : null,
      }))
      .sort((a, b) => a.date.localeCompare(b.date));

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
      cur.work_break += e.work_break;
      byUser.set(e.user_id, cur);
    }
    const [userInfo, podByEmail, allPods] = await Promise.all([
      resolveUserInfo(token, Array.from(byUser.keys())),
      getPodByEmail(),
      getAllPods(),
    ]);
    const podIdByName = new Map(allPods.map((p) => [p.name, p.id]));

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
        workBreakHours: hoursOf(v.work_break),
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
        podId: podIdByName.get(pod) ?? null,
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
      teams,
      projects,
      pods,
      allPods,
      members,
      trend,
      rangeLabel,
    };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ...emptyResult(rangeLabel), error: `Hubstaff unreachable: ${msg}` };
  }
}

export interface HubstaffPeriodSummary {
  start: string;
  end: string;
  hours: number;
  activityPct: number | null;
  error?: string;
}

// Lightweight single-number summary for an arbitrary date range — powers the
// multi-period comparison chart. Deliberately does NOT do the user/pod/project
// resolution getHubstaffOverview does (those are per-user API calls); it only
// sums the weekday daily-activity totals, so several periods can be fetched
// cheaply in parallel from the client.
export async function getHubstaffPeriodSummary(start: string, end: string): Promise<HubstaffPeriodSummary> {
  if (!process.env.HUBSTAFF_REFRESH_TOKEN) return { start, end, hours: 0, activityPct: null, error: "not configured" };
  try {
    const token = await getToken();
    const res = await fetchAllDailyActivities(token, start, end);
    if (!res.ok) return { start, end, hours: 0, activityPct: null, error: `Hubstaff returned ${res.status}` };
    const entries = res.entries.filter((e) => isWeekday(e.date)); // weekdays only, same as everywhere else
    const tracked = entries.reduce((s, e) => s + e.tracked, 0);
    const overall = entries.reduce((s, e) => s + e.overall, 0);
    return { start, end, hours: hoursOf(tracked), activityPct: tracked > 0 ? Math.round((overall / tracked) * 100) : null };
  } catch (e) {
    return { start, end, hours: 0, activityPct: null, error: e instanceof Error ? e.message : String(e) };
  }
}

export interface HubstaffWeeklyPoint {
  email: string; // lowercased, matches the pod/bookkeeper email-join used elsewhere
  weekStartISO: string; // Monday of that ISO week
  hours: number;
}

// Weekly tracked-hours per member across a trailing N-week window — powers
// the Bookkeeper performance-over-time chart. Keyed by email (not Hubstaff
// user id) so it joins cleanly against the Asana member roster, same as
// getHubstaffOverview's own byEmail lookups.
export async function getHubstaffWeeklyTrend(weeksCount = 8): Promise<{ points: HubstaffWeeklyPoint[]; error?: string }> {
  if (!process.env.HUBSTAFF_REFRESH_TOKEN) return { points: [], error: "not configured" };
  try {
    const token = await getToken();
    const endDate = auTodayISODate();
    const startDate = auDateISODate(-(weeksCount * 7 - 1));
    const res = await fetchAllDailyActivities(token, startDate, endDate);
    if (!res.ok) return { points: [], error: `Hubstaff returned ${res.status}` };

    const entries = res.entries.filter((e) => isWeekday(e.date));
    const userIds = Array.from(new Set(entries.map((e) => e.user_id)));
    const userInfo = await resolveUserInfo(token, userIds);

    const byKey = new Map<string, number>(); // `${userId}:${weekMonday}` -> tracked seconds
    for (const e of entries) {
      const key = `${e.user_id}:${isoWeekMonday(e.date)}`;
      byKey.set(key, (byKey.get(key) ?? 0) + e.tracked);
    }

    const points: HubstaffWeeklyPoint[] = [];
    for (const [key, trackedSec] of byKey.entries()) {
      const sep = key.indexOf(":");
      const info = userInfo.get(Number(key.slice(0, sep)));
      if (!info?.email) continue;
      points.push({ email: info.email.toLowerCase(), weekStartISO: key.slice(sep + 1), hours: hoursOf(trackedSec) });
    }
    return { points };
  } catch (e) {
    return { points: [], error: e instanceof Error ? e.message : String(e) };
  }
}

export interface HubstaffLeaveEntry {
  id: number;
  userId: number;
  name: string;
  email: string;
  pod: string | null;
  policyName: string;
  status: string; // "approved" (only status this app surfaces as real leave)
  startDate: string; // YYYY-MM-DD, from the request's own per-day breakdown
  endDate: string;
  allDay: boolean;
  message: string | null;
  days: string[]; // every calendar day (YYYY-MM-DD) this request covers — powers the calendar view
}

export interface HubstaffLeaveResult {
  entries: HubstaffLeaveEntry[]; // approved only, sorted by startDate
  error?: string;
}

type RawTimeOffRequest = {
  id: number;
  user_id: number;
  time_off_policy_id: number;
  status: string;
  all_day: boolean;
  starts_at: string;
  stops_at: string;
  message: string | null;
  time_off_request_days?: { date: string }[];
};

// Hubstaff's Time Off module — confirmed live for this account (v2
// /time_off_requests + /time_off_policies, both real endpoints distinct from
// activity tracking). Paginates the same way as /activities/daily
// (page_limit + next_page_start_id). Only "approved" requests are surfaced —
// denied ones aren't real leave, and this account's data has no "pending"
// status observed, but the filter guards against it either way.
export async function getHubstaffLeave(): Promise<HubstaffLeaveResult> {
  if (!process.env.HUBSTAFF_REFRESH_TOKEN) return { entries: [], error: "not configured" };
  try {
    const token = await getToken();
    const auth = { headers: { Authorization: `Bearer ${token}` } };

    const requests: RawTimeOffRequest[] = [];
    let pageStartId: number | undefined;
    for (;;) {
      const url = new URL(`https://api.hubstaff.com/v2/organizations/${ORG_ID}/time_off_requests`);
      url.searchParams.set("page_limit", "500");
      if (pageStartId !== undefined) url.searchParams.set("page_start_id", String(pageStartId));
      const res = await fetch(url.toString(), auth);
      if (!res.ok) return { entries: [], error: `Hubstaff returned ${res.status}` };
      const data = await res.json();
      requests.push(...((data.time_off_requests ?? []) as RawTimeOffRequest[]));
      const next = data.pagination?.next_page_start_id;
      if (!next) break;
      pageStartId = next;
    }

    const policyNames = new Map<number, string>();
    const policiesRes = await fetch(`https://api.hubstaff.com/v2/organizations/${ORG_ID}/time_off_policies`, auth);
    if (policiesRes.ok) {
      const pd = await policiesRes.json();
      for (const p of pd.time_off_policies ?? []) policyNames.set(p.id, p.name);
    }

    const approved = requests.filter((r) => r.status === "approved");
    const userIds = Array.from(new Set(approved.map((r) => r.user_id)));
    const [userInfo, podByEmail] = await Promise.all([resolveUserInfo(token, userIds), getPodByEmail()]);

    const entries: HubstaffLeaveEntry[] = approved.map((r) => {
      const info = userInfo.get(r.user_id);
      const email = info?.email ?? "";
      const days = (r.time_off_request_days ?? []).map((d) => d.date).sort();
      return {
        id: r.id,
        userId: r.user_id,
        name: info?.name ?? `User ${r.user_id}`,
        email,
        pod: email ? podByEmail.get(email.toLowerCase()) ?? null : null,
        policyName: policyNames.get(r.time_off_policy_id) ?? "Leave",
        status: r.status,
        startDate: days[0] ?? r.starts_at.slice(0, 10),
        endDate: days[days.length - 1] ?? r.stops_at.slice(0, 10),
        allDay: r.all_day,
        message: r.message,
        days,
      };
    }).sort((a, b) => a.startDate.localeCompare(b.startDate));

    return { entries };
  } catch (e) {
    return { entries: [], error: e instanceof Error ? e.message : String(e) };
  }
}
