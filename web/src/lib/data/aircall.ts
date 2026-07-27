import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";
import { getPodByEmail, getAllPods } from "./pods";
import { median, round1 } from "@/lib/stats";
import { batchMap } from "@/lib/concurrency";

export interface AircallCall {
  id: number;
  direction: string;
  status: string;
  duration: number;
  number: string;
  contactName: string | null;
  contactCompany: string | null;
  agent: string | null;
  agentEmail: string | null;
  startedAt: string;
}

export interface AircallAgentStat {
  email: string;
  name: string;
  pod: string | null;
  total: number;
  inbound: number;
  outboundAnswered: number;
  outboundUnanswered: number;
  missedOrVoicemail: number;
}

export interface RepeatCaller {
  number: string;
  contactName: string | null;
  contactCompany: string | null;
  count: number;
  totalDuration: number;
  lastCallAt: string;
}

export interface AircallMessage {
  id: string;
  body: string;
  from: string | null;
  to: string | null;
  direction: "inbound" | "outbound";
  status: string;
  channel: string | null;
  agent: string | null;
  line: string | null;
  contactName: string | null;
  createdAt: string;
}

export interface MessagingStats {
  total: number;
  inbound: number;
  outbound: number;
  delivered: number;
  failed: number;
  deliveryRatePct: number | null;
  recentMessages: AircallMessage[];
}

export interface AircallOverview {
  total: number | null;
  inbound: number | null;
  outboundAnswered: number | null;
  outboundUnanswered: number | null;
  missedOrVoicemail: number | null;
  totalTalkTimeSeconds: number | null;
  avgDurationSeconds: number | null;
  medianDurationSeconds: number | null;
  // Blended answer rate conflates two different questions — how well we
  // service incoming calls vs. how often our own outbound dials connect —
  // so it's split into the two rates that actually drive different actions.
  inboundAnswerRatePct: number | null;
  outboundConnectRatePct: number | null;
  missedRatePct: number | null;
  callsPerDay: number | null; // normalizes volume across the Today/7d/30d presets
  lines: string[];
  recentCalls: AircallCall[];
  repeatCallers: RepeatCaller[];
  messaging: MessagingStats | null;
  byAgent: AircallAgentStat[];
  allPods: { id: string; name: string }[];
  // True when the calls-fetch loop hit its page cap while Aircall still had
  // more pages to give (next_page_link was non-null) — meaning the oldest
  // calls in the requested window were dropped rather than pagination
  // genuinely running out. Not surfaced in the UI yet; the signal exists so
  // a future change can warn the user their stats are incomplete.
  truncated: boolean;
  error?: string;
}

type RawCall = {
  id: number;
  direction: string;
  status: string;
  missed_call_reason: string | null;
  voicemail: unknown;
  answered_at: number | null;
  duration: number;
  raw_digits: string;
  started_at: number;
  user: { name: string; email: string | null } | null;
  number: { name: string } | null;
};

type ContactInfo = { name: string | null; company: string | null };

const EMPTY: AircallOverview = {
  total: null,
  inbound: null,
  outboundAnswered: null,
  outboundUnanswered: null,
  missedOrVoicemail: null,
  totalTalkTimeSeconds: null,
  avgDurationSeconds: null,
  medianDurationSeconds: null,
  inboundAnswerRatePct: null,
  outboundConnectRatePct: null,
  missedRatePct: null,
  callsPerDay: null,
  lines: [],
  recentCalls: [],
  repeatCallers: [],
  messaging: null,
  byAgent: [],
  allPods: [],
  truncated: false,
};

function isMissedOrVoicemail(c: RawCall) {
  return c.status === "missed" || c.status === "voicemail" || !!c.missed_call_reason || !!c.voicemail;
}

// Sri Lanka never observes DST, so a fixed +5:30 offset is safe year-round —
// no Intl/timezone-database dependency needed. This matches the account's
// own configured reporting timezone (see AIRCALL_MESSAGING_ANALYTICS_URL's
// timezone=Asia/Colombo), which is what made "Today" disagree with Aircall's
// own dashboard: this file was computing "the last 24 hours" (a rolling
// window ending at whatever second the request happened to land on)
// instead of "since midnight, Colombo time" (a calendar day) — two windows
// that only ever coincide by accident.
const COLOMBO_OFFSET_MS = 5.5 * 60 * 60 * 1000;
function colomboMidnightEpochSeconds(daysAgo: number): number {
  const shifted = new Date(Date.now() + COLOMBO_OFFSET_MS);
  shifted.setUTCHours(0, 0, 0, 0);
  shifted.setUTCDate(shifted.getUTCDate() - daysAgo);
  return Math.floor((shifted.getTime() - COLOMBO_OFFSET_MS) / 1000);
}

// The call object's own `contact` field is unpopulated for this account, but
// Aircall's contacts CRM can still be searched by phone number directly.
async function resolveContactNames(auth: string, numbers: string[]): Promise<Map<string, ContactInfo>> {
  const pairs = await batchMap(numbers, async (num) => {
    try {
      const res = await fetch(`https://api.aircall.io/v1/contacts/search?phone_number=${encodeURIComponent(num)}`, {
        headers: { Authorization: `Basic ${auth}` },
      });
      if (!res.ok) return [num, { name: null, company: null }] as const;
      const data = await res.json();
      const contact = data.contacts?.[0];
      if (!contact) return [num, { name: null, company: null }] as const;
      const name = [contact.first_name, contact.last_name].filter(Boolean).join(" ").trim() || null;
      return [num, { name, company: contact.company_name ?? null }] as const;
    } catch {
      return [num, { name: null, company: null }] as const;
    }
  });
  const result = new Map<string, ContactInfo>();
  for (const [num, info] of pairs) result.set(num, info);
  return result;
}

function mapCall(c: RawCall, contacts: Map<string, ContactInfo>): AircallCall {
  const contact = contacts.get(c.raw_digits);
  return {
    id: c.id,
    direction: c.direction,
    status: isMissedOrVoicemail(c) ? (c.status === "voicemail" || c.voicemail ? "voicemail" : "missed") : c.status,
    duration: c.duration,
    number: c.raw_digits,
    contactName: contact?.name ?? null,
    contactCompany: contact?.company ?? null,
    agent: c.user?.name ?? null,
    agentEmail: c.user?.email?.toLowerCase() ?? null,
    startedAt: new Date(c.started_at * 1000).toISOString(),
  };
}

// `callsLimit` controls how many mapped calls come back in `recentCalls` —
// the compact dashboard card only needs 10, the dedicated Aircall page wants
// the full week. Every other stat is always computed from every call in the
// window regardless of this limit.
//
// `skipContacts` bypasses resolveContactNames — an individual Aircall API
// call per unique phone number in the window, which was the entire cost of
// a ~17s load for callers (Bookkeeper Stats, the pod page) that only need
// byAgent/pods and never render a contact name.
export async function getAircallOverview(callsLimit = 10, days = 7, opts?: { skipContacts?: boolean }): Promise<AircallOverview> {
  const id = process.env.AIRCALL_API_ID;
  const token = process.env.AIRCALL_API_TOKEN;
  if (!id || !token) return { ...EMPTY, error: "not configured" };

  const auth = Buffer.from(`${id}:${token}`).toString("base64");
  const now = Math.floor(Date.now() / 1000);
  // days=1 ("Today") -> daysAgo=0 -> midnight today. days=7 -> midnight 6
  // days ago, giving a 7-calendar-day window (today plus the 6 before it)
  // ending now, same shape as before but anchored to a real day boundary.
  const from = colomboMidnightEpochSeconds(days - 1);

  try {
    // Kicked off now (2 cheap Supabase queries) rather than after the calls
    // fetch — resolveContactNames below can issue one subrequest per unique
    // phone number in the window (dozens+), and awaiting pod data only after
    // that was silently starving it: Supabase's client doesn't throw on a
    // failed fetch, it resolves with {data: null}, so getPodByEmail/getAllPods
    // came back empty with no error surfaced anywhere. Firing this first
    // means it's already in flight (or done) well before that burst.
    const podDataPromise = Promise.all([getPodByEmail(), getAllPods()]);

    // Paginate through the full week rather than trusting a single-page
    // sample — Aircall's `status`/`direction` query filters are silently
    // ignored, so accurate breakdowns need every call, not a guess.
    const allCalls: RawCall[] = [];
    // Cap raised from 10 to 80 pages (50/page = up to 4,000 calls) — at 10
    // pages/500 calls, the 30-day preset (500+ calls) and 90-day preset
    // (1,300+ calls) were both silently truncated, and since order=desc
    // drops the OLDEST calls in the window rather than the newest. 80 pages
    // comfortably covers realistic volume even at the 90-day MAX_DAYS preset
    // with headroom for growth.
    const PAGE_CAP = 80;
    let url: string | null = `https://api.aircall.io/v1/calls?from=${from}&to=${now}&per_page=50&order=desc`;
    let pages = 0;
    let truncated = false;
    while (url && pages < PAGE_CAP) {
      const res: Response = await fetch(url, { headers: { Authorization: `Basic ${auth}` } });
      if (!res.ok) return { ...EMPTY, error: `Aircall returned ${res.status}` };
      const data: { calls?: RawCall[]; meta?: { next_page_link?: string } } = await res.json();
      allCalls.push(...(data.calls ?? []));
      url = data.meta?.next_page_link ?? null;
      pages++;
    }
    if (url) truncated = true; // loop exited on the page cap, not on pagination ending

    const outboundCalls = allCalls.filter((c) => c.direction === "outbound");
    const totalTalkTimeSeconds = allCalls.reduce((sum, c) => sum + c.duration, 0);

    const uniqueNumbers = Array.from(new Set(allCalls.map((c) => c.raw_digits)));
    const contacts = opts?.skipContacts ? new Map<string, ContactInfo>() : await resolveContactNames(auth, uniqueNumbers);

    // Repeat callers: group by number, keep anyone called 2+ times this week.
    const byNumber = new Map<string, { count: number; totalDuration: number; lastCallAt: number }>();
    for (const c of allCalls) {
      const cur = byNumber.get(c.raw_digits) ?? { count: 0, totalDuration: 0, lastCallAt: 0 };
      cur.count += 1;
      cur.totalDuration += c.duration;
      cur.lastCallAt = Math.max(cur.lastCallAt, c.started_at);
      byNumber.set(c.raw_digits, cur);
    }
    const repeatCallers = Array.from(byNumber.entries())
      .filter(([, v]) => v.count >= 2)
      .map(([number, v]) => ({
        number,
        contactName: contacts.get(number)?.name ?? null,
        contactCompany: contacts.get(number)?.company ?? null,
        count: v.count,
        totalDuration: v.totalDuration,
        lastCallAt: new Date(v.lastCallAt * 1000).toISOString(),
      }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 15);

    // Messaging stats come from Supabase (populated by the /api/aircall/webhook endpoint).
    // Aircall's REST API has no GET endpoint for message history — webhooks are the only source.
    let messaging: MessagingStats | null = null;
    try {
      const supabase = createAdminClient();
      const { data: msgs } = await supabase
        .from("aircall_messages")
        .select("id, direction, channel, content, status, number_name, message_at")
        .gte("message_at", new Date(from * 1000).toISOString())
        .order("message_at", { ascending: false })
        .limit(200);

      if (msgs && msgs.length > 0) {
        type DbMsg = { id: string; direction: string; channel: string | null; content: string | null; status: string | null; number_name: string | null; message_at: string | null };
        const rows = msgs as DbMsg[];
        const delivered = rows.filter((m) => ["delivered", "sent", "received"].includes(m.status ?? "")).length;
        const failed = rows.filter((m) => ["failed", "undelivered"].includes(m.status ?? "")).length;
        messaging = {
          total: rows.length,
          inbound: rows.filter((m) => m.direction === "inbound").length,
          outbound: rows.filter((m) => m.direction === "outbound").length,
          delivered,
          failed,
          deliveryRatePct: rows.length > 0 ? Math.round((delivered / rows.length) * 100) : null,
          recentMessages: rows.map((m) => ({
            id: m.id,
            body: m.content ?? "",
            from: null,
            to: null,
            direction: m.direction as "inbound" | "outbound",
            status: m.status ?? "unknown",
            channel: m.channel ?? null,
            agent: null,
            line: m.number_name ?? null,
            contactName: null,
            createdAt: m.message_at ?? new Date().toISOString(),
          })),
        };
      }
    } catch {
      // messaging unavailable — calls data still returned
    }

    const inboundCalls = allCalls.filter((c) => c.direction === "inbound");
    const inboundMissed = inboundCalls.filter(isMissedOrVoicemail).length;
    const outboundAnswered = outboundCalls.filter((c) => c.answered_at).length;
    const outboundUnanswered = outboundCalls.filter((c) => !c.answered_at).length;
    const missedOrVoicemail = allCalls.filter(isMissedOrVoicemail).length;
    const durations = allCalls.map((c) => c.duration);

    // Per-agent breakdown, keyed by email (reliable since Aircall's raw
    // call.user object includes a real email, unlike its display-name-only
    // `agent` field) — feeds the Bookkeeper Stats page's Aircall column and
    // the per-pod page (which filters byAgent down to one pod's agents).
    const [podByEmail, allPods] = await podDataPromise;
    const agentBuckets = new Map<string, AircallAgentStat>();
    for (const c of allCalls) {
      const email = c.user?.email?.toLowerCase();
      if (!email) continue;
      const cur = agentBuckets.get(email) ?? {
        email,
        name: c.user?.name ?? email,
        pod: podByEmail.get(email) ?? null,
        total: 0, inbound: 0, outboundAnswered: 0, outboundUnanswered: 0, missedOrVoicemail: 0,
      };
      cur.total++;
      if (c.direction === "inbound") cur.inbound++;
      else if (c.answered_at) cur.outboundAnswered++;
      else cur.outboundUnanswered++;
      if (isMissedOrVoicemail(c)) cur.missedOrVoicemail++;
      agentBuckets.set(email, cur);
    }
    const byAgent = Array.from(agentBuckets.values()).sort((a, b) => b.total - a.total);

    return {
      total: allCalls.length,
      inbound: inboundCalls.length,
      outboundAnswered,
      outboundUnanswered,
      missedOrVoicemail,
      totalTalkTimeSeconds,
      avgDurationSeconds: allCalls.length > 0 ? Math.round(totalTalkTimeSeconds / allCalls.length) : null,
      medianDurationSeconds: durations.length > 0 ? Math.round(median(durations)!) : null,
      inboundAnswerRatePct: inboundCalls.length > 0 ? Math.round(((inboundCalls.length - inboundMissed) / inboundCalls.length) * 100) : null,
      outboundConnectRatePct: outboundCalls.length > 0 ? Math.round((outboundAnswered / outboundCalls.length) * 100) : null,
      missedRatePct: allCalls.length > 0 ? Math.round((missedOrVoicemail / allCalls.length) * 100) : null,
      callsPerDay: days > 0 ? round1(allCalls.length / days) : null,
      lines: Array.from(new Set(allCalls.map((c) => c.number?.name).filter((n): n is string => !!n))),
      recentCalls: allCalls.slice(0, callsLimit).map((c) => mapCall(c, contacts)),
      repeatCallers,
      messaging,
      byAgent,
      allPods,
      truncated,
    };
  } catch {
    return { ...EMPTY, error: "Aircall unreachable" };
  }
}
