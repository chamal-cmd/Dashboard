import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";
import { median, round1 } from "@/lib/stats";

export interface AircallCall {
  id: number;
  direction: string;
  status: string;
  duration: number;
  number: string;
  contactName: string | null;
  contactCompany: string | null;
  agent: string | null;
  startedAt: string;
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
  id: number;
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
  user: { name: string } | null;
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
};

function isMissedOrVoicemail(c: RawCall) {
  return c.status === "missed" || c.status === "voicemail" || !!c.missed_call_reason || !!c.voicemail;
}

// The call object's own `contact` field is unpopulated for this account, but
// Aircall's contacts CRM can still be searched by phone number directly.
async function resolveContactNames(auth: string, numbers: string[]): Promise<Map<string, ContactInfo>> {
  const result = new Map<string, ContactInfo>();
  const CONCURRENCY = 5;
  for (let i = 0; i < numbers.length; i += CONCURRENCY) {
    const batch = numbers.slice(i, i + CONCURRENCY);
    const looked = await Promise.all(
      batch.map(async (num) => {
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
      })
    );
    for (const [num, info] of looked) result.set(num, info);
  }
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
    startedAt: new Date(c.started_at * 1000).toISOString(),
  };
}

// `callsLimit` controls how many mapped calls come back in `recentCalls` —
// the compact dashboard card only needs 10, the dedicated Aircall page wants
// the full week. Every other stat is always computed from every call in the
// window regardless of this limit.
export async function getAircallOverview(callsLimit = 10, days = 7): Promise<AircallOverview> {
  const id = process.env.AIRCALL_API_ID;
  const token = process.env.AIRCALL_API_TOKEN;
  if (!id || !token) return { ...EMPTY, error: "not configured" };

  const auth = Buffer.from(`${id}:${token}`).toString("base64");
  const now = Math.floor(Date.now() / 1000);
  const weekAgo = now - days * 86400;

  try {
    // Paginate through the full week rather than trusting a single-page
    // sample — Aircall's `status`/`direction` query filters are silently
    // ignored, so accurate breakdowns need every call, not a guess.
    const allCalls: RawCall[] = [];
    let url: string | null = `https://api.aircall.io/v1/calls?from=${weekAgo}&to=${now}&per_page=50&order=desc`;
    let pages = 0;
    while (url && pages < 10) {
      const res: Response = await fetch(url, { headers: { Authorization: `Basic ${auth}` } });
      if (!res.ok) return { ...EMPTY, error: `Aircall returned ${res.status}` };
      const data: { calls?: RawCall[]; meta?: { next_page_link?: string } } = await res.json();
      allCalls.push(...(data.calls ?? []));
      url = data.meta?.next_page_link ?? null;
      pages++;
    }

    const outboundCalls = allCalls.filter((c) => c.direction === "outbound");
    const totalTalkTimeSeconds = allCalls.reduce((sum, c) => sum + c.duration, 0);

    const uniqueNumbers = Array.from(new Set(allCalls.map((c) => c.raw_digits)));
    const contacts = await resolveContactNames(auth, uniqueNumbers);

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
        .gte("message_at", new Date(weekAgo * 1000).toISOString())
        .order("message_at", { ascending: false })
        .limit(200);

      if (msgs && msgs.length > 0) {
        type DbMsg = { id: number; direction: string; channel: string | null; content: string | null; status: string | null; number_name: string | null; message_at: string | null };
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
    };
  } catch {
    return { ...EMPTY, error: "Aircall unreachable" };
  }
}
