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
  // Distinguishes "checked Aircall/cache and there's genuinely no contact
  // saved for this number" from "never looked up this request" — without
  // this, both look identical (contactName: null) and the UI can't tell a
  // confirmed-absent contact from one it just hasn't gotten to yet.
  contactChecked: boolean;
  agent: string | null;
  agentEmail: string | null;
  startedAt: string;
  // Whether Aircall recorded an answered_at for this call. Exposed so the UI
  // can split outbound answered/unanswered with the SAME predicate the
  // headline tiles use — `status` alone can't express it, so a client-side
  // filter derived from status would silently disagree with the tile counts.
  answered: boolean;
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
  contactChecked: boolean;
  count: number;
  totalDuration: number;
  lastCallAt: string;
}

export interface AircallOverview {
  total: number | null;
  inbound: number | null;
  inboundAnswered: number | null;
  inboundMissed: number | null;
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
  byAgent: AircallAgentStat[];
  allPods: { id: string; name: string }[];
  // Present only when opts.callerTrendNumber was passed — one entry per
  // calendar day in the window (even zero-call days, so gaps are visible),
  // count of that ONE caller's calls that day. Powers the Aircall page's
  // "drill into one caller" trend view.
  callerTrend?: { date: string; count: number }[];
  // True when this window's stats are built on an INCOMPLETE set of calls,
  // for either reason: the window has more pages than PAGE_CAP allows (so the
  // oldest calls were never fetched, since order=desc), or one of the parallel
  // page fetches failed even after retries. Every count, rate and average on
  // this object understates reality when it's true.
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
  inboundAnswered: null,
  inboundMissed: null,
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
// Which Colombo calendar day a call's UNIX timestamp falls on — same offset
// trick as colomboMidnightEpochSeconds above, just reading the date back out
// instead of computing a boundary.
function colomboDateISO(epochSeconds: number): string {
  return new Date(epochSeconds * 1000 + COLOMBO_OFFSET_MS).toISOString().slice(0, 10);
}

function digitsOnly(s: string): string {
  return s.replace(/\D/g, "");
}

// Calendar-aligned window overrides for the Repeat Callers trend chart's
// Week/Month/custom-date options (request 2026-08-20) — "this week" and
// "this month" mean the actual calendar period, not a rolling N-day window,
// same convention BAS/Fathom deadlines already use for "month" elsewhere in
// this app. Same offset-shift trick as colomboMidnightEpochSeconds throughout.
function colomboStartOfWeekEpochSeconds(): number {
  const shifted = new Date(Date.now() + COLOMBO_OFFSET_MS);
  shifted.setUTCHours(0, 0, 0, 0);
  const day = shifted.getUTCDay(); // 0=Sun..6=Sat, Colombo-local
  shifted.setUTCDate(shifted.getUTCDate() - (day === 0 ? 6 : day - 1)); // back to Monday
  return Math.floor((shifted.getTime() - COLOMBO_OFFSET_MS) / 1000);
}
function colomboStartOfMonthEpochSeconds(): number {
  const shifted = new Date(Date.now() + COLOMBO_OFFSET_MS);
  shifted.setUTCHours(0, 0, 0, 0);
  shifted.setUTCDate(1);
  return Math.floor((shifted.getTime() - COLOMBO_OFFSET_MS) / 1000);
}
// A specific Colombo-local calendar date's midnight, from a "YYYY-MM-DD"
// string — for the chart's explicit custom-range option.
function colomboDateToEpochSeconds(iso: string): number {
  return Math.floor((new Date(`${iso}T00:00:00Z`).getTime() - COLOMBO_OFFSET_MS) / 1000);
}

// One entry per calendar day from `fromEpochSeconds` to `toEpochSeconds`
// inclusive, even days with zero matching calls — a trend chart with gaps
// silently skipped reads as "no data" rather than "nothing happened that
// day", which is the whole point of asking what a specific caller's pattern
// looks like over time.
function dailyCountsInRange(calls: RawCall[], fromEpochSeconds: number, toEpochSeconds: number): { date: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const c of calls) {
    const d = colomboDateISO(c.started_at);
    counts.set(d, (counts.get(d) ?? 0) + 1);
  }
  const days: { date: string; count: number }[] = [];
  const cursor = new Date(`${colomboDateISO(fromEpochSeconds)}T00:00:00Z`);
  const end = new Date(`${colomboDateISO(toEpochSeconds)}T00:00:00Z`);
  while (cursor.getTime() <= end.getTime()) {
    const iso = cursor.toISOString().slice(0, 10);
    days.push({ date: iso, count: counts.get(iso) ?? 0 });
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return days;
}

// Retries transient failures (network blips, 429s) with backoff — without
// this, a single rate-limit response took the whole Aircall page down with
// "Couldn't reach Aircall right now" (hit live 2026-08-04, from a burst of
// requests during testing). Kept short since this runs inline in a page
// load, not a background job: 2 attempts each, capped backoff.
async function aircallGet(url: string, auth: string, attempt = 0): Promise<Response> {
  let res: Response;
  try {
    res = await fetch(url, { headers: { Authorization: `Basic ${auth}` } });
  } catch (e) {
    if (attempt < 2) {
      await new Promise((r) => setTimeout(r, (attempt + 1) * 1500));
      return aircallGet(url, auth, attempt + 1);
    }
    const cause = e instanceof Error && e.cause instanceof Error ? ` (${e.cause.message})` : "";
    throw new Error(`Aircall fetch failed${cause}: ${url.slice(0, 120)}`);
  }
  if (res.status === 429 && attempt < 2) {
    const wait = Number(res.headers.get("Retry-After") ?? "5");
    await new Promise((r) => setTimeout(r, Math.min(wait, 15) * 1000));
    return aircallGet(url, auth, attempt + 1);
  }
  return res;
}

// Contact-name resolution is one Aircall subrequest PER UNIQUE NUMBER —
// resolving every number across a whole date range live can mean hundreds of
// lookups for a busy line, which alone can exceed this Worker's per-invocation
// subrequest cap (the same Cloudflare Free-plan ceiling found and fixed
// elsewhere 2026-08-13). CONTACT_LOOKUP_CAP bounds how many genuinely NEW
// numbers get a live Aircall lookup in a single request; resolveContactNames
// below caches every resolved name in Supabase so a number seen once is free
// to display on every later request (one Supabase read, no Aircall call at
// all), and coverage grows across requests instead of resetting every time.
const CONTACT_LOOKUP_CAP = 40;
// Re-check a cached name occasionally in case the contact was added, renamed,
// or edited in Aircall since it was last resolved — 30 days balances that
// against not re-spending the live-lookup budget on numbers we already know.
const CACHE_STALE_MS = 30 * 24 * 60 * 60 * 1000;
type CachedContactRow = { phone_number: string; name: string | null; company: string | null; resolved_at: string };

// The call object's own `contact` field is unpopulated for this account, but
// Aircall's contacts CRM can still be searched by phone number directly.
// `numbers` is every unique caller in the window (cache reads are cheap
// regardless of how many); `priorityNumbers` — the calls actually displayed
// plus the top repeat callers — decides which CACHE MISSES get a live lookup
// first when there are more misses than CONTACT_LOOKUP_CAP allows.
async function resolveContactNames(auth: string, numbers: string[], priorityNumbers: Set<string>): Promise<Map<string, ContactInfo>> {
  const result = new Map<string, ContactInfo>();
  if (numbers.length === 0) return result;

  const admin = createAdminClient();
  // Defensive cap on the IN-list itself — realistic volumes for this account
  // are nowhere near this, it just bounds the pathological case (a very wide
  // date range on a very busy line) from building an unreasonable query.
  const lookupSet = numbers.slice(0, 1000);
  const { data: cachedRows } = await admin
    .from("aircall_contact_cache")
    .select("phone_number, name, company, resolved_at")
    .in("phone_number", lookupSet);

  const now = Date.now();
  const freshNumbers = new Set<string>();
  for (const row of (cachedRows ?? []) as CachedContactRow[]) {
    if (now - new Date(row.resolved_at).getTime() < CACHE_STALE_MS) {
      result.set(row.phone_number, { name: row.name, company: row.company });
      freshNumbers.add(row.phone_number);
    }
  }

  const misses = lookupSet.filter((n) => !freshNumbers.has(n));
  const prioritized = [
    ...misses.filter((n) => priorityNumbers.has(n)),
    ...misses.filter((n) => !priorityNumbers.has(n)),
  ].slice(0, CONTACT_LOOKUP_CAP);

  if (prioritized.length > 0) {
    const pairs = await batchMap(prioritized, async (num) => {
      try {
        const res = await aircallGet(`https://api.aircall.io/v1/contacts/search?phone_number=${encodeURIComponent(num)}`, auth);
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

    const nowIso = new Date(now).toISOString();
    await admin.from("aircall_contact_cache").upsert(
      pairs.map(([num, info]) => ({ phone_number: num, name: info.name, company: info.company, resolved_at: nowIso })),
      { onConflict: "phone_number" },
    );
    for (const [num, info] of pairs) result.set(num, info);
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
    contactChecked: contacts.has(c.raw_digits),
    agent: c.user?.name ?? null,
    agentEmail: c.user?.email?.toLowerCase() ?? null,
    startedAt: new Date(c.started_at * 1000).toISOString(),
    answered: !!c.answered_at,
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
export async function getAircallOverview(
  callsLimit = 10, days = 7,
  opts?: {
    skipContacts?: boolean;
    callerTrendNumber?: string;
    direction?: "inbound" | "outbound";
    // Calendar-aligned window override for the Repeat Callers trend chart's
    // Week/Month/custom-date options (request 2026-08-20) — takes precedence
    // over `days` when present, since "this week"/"this month"/a picked date
    // range don't fit a rolling day count. period wins over fromDate/toDate
    // if somehow both are sent (the client only ever sends one).
    period?: "week" | "month";
    fromDate?: string; // "YYYY-MM-DD", Colombo-local calendar date, inclusive
    toDate?: string;   // "YYYY-MM-DD", Colombo-local calendar date, inclusive
  }
): Promise<AircallOverview> {
  const id = process.env.AIRCALL_API_ID;
  const token = process.env.AIRCALL_API_TOKEN;
  if (!id || !token) return { ...EMPTY, error: "not configured" };

  const auth = Buffer.from(`${id}:${token}`).toString("base64");
  const usingOverride = !!(opts?.period || opts?.fromDate || opts?.toDate);
  // toDate uses end-of-that-day so a custom historical range is fully
  // inclusive; week/month (no toDate) instead run through "now" so a
  // still-in-progress week/month shows what's happened so far, not padded
  // out to its final day.
  const now = opts?.toDate ? colomboDateToEpochSeconds(opts.toDate) + 86400 - 1 : Math.floor(Date.now() / 1000);
  // days=1 ("Today") -> daysAgo=0 -> midnight today. days=7 -> midnight 6
  // days ago, giving a 7-calendar-day window (today plus the 6 before it)
  // ending now, same shape as before but anchored to a real day boundary.
  const from = opts?.period === "week" ? colomboStartOfWeekEpochSeconds()
    : opts?.period === "month" ? colomboStartOfMonthEpochSeconds()
    : opts?.fromDate ? colomboDateToEpochSeconds(opts.fromDate)
    : colomboMidnightEpochSeconds(days - 1);
  // callsPerDay normalizes by the actual span of an overridden window rather
  // than the (now-irrelevant) `days` param, so "this month" on the 5th still
  // reports a sane per-day rate instead of dividing by a full 30/31.
  const effectiveDays = usingOverride ? Math.max(1, Math.round((now - from) / 86400)) : days;

  try {
    // Kicked off now (2 cheap Supabase queries) rather than after the calls
    // fetch — resolveContactNames below can issue one subrequest per unique
    // phone number in the window (dozens+), and awaiting pod data only after
    // that was silently starving it: Supabase's client doesn't throw on a
    // failed fetch, it resolves with {data: null}, so getPodByEmail/getAllPods
    // came back empty with no error surfaced anywhere. Firing this first
    // means it's already in flight (or done) well before that burst.
    const podDataPromise = Promise.all([getPodByEmail(), getAllPods()]);

    // Paginate through the full window rather than trusting a single-page
    // sample — Aircall's `status`/`direction` query filters are silently
    // ignored, so accurate breakdowns need every call, not a guess.
    //
    // Pages 2..N are fetched IN PARALLEL, not by following next_page_link one
    // at a time. Aircall hard-caps per_page at 50 (asking for 100 or 200 still
    // returns 50 — verified live), so a wide window needs a lot of pages and
    // walking them sequentially was the entire load time of this page:
    // measured 2026-08-09, the 30-day preset took 11 requests and 12.8s, and
    // 7 days took 4.8s. The same 11 pages fetched concurrently take 1.8s.
    //
    // This is safe because page 1's `meta.total` tells us up front exactly how
    // many pages exist, and `?page=N` is honoured directly — checked live:
    // zero overlap between pages, and the union of ids matched meta.total
    // exactly (524/524). Concurrency is capped by batchMap so we don't trip
    // Aircall's rate limiter; aircallGet still retries a 429 on top of that.
    const PAGE_CAP = 80; // 80 x 50 = 4,000 calls, comfortably above the 90-day preset
    const baseUrl = `https://api.aircall.io/v1/calls?from=${from}&to=${now}&per_page=50&order=desc`;

    const firstRes = await aircallGet(baseUrl, auth);
    if (!firstRes.ok) return { ...EMPTY, error: `Aircall returned ${firstRes.status}` };
    const firstData: { calls?: RawCall[]; meta?: { total?: number; per_page?: number } } = await firstRes.json();

    let allCalls: RawCall[] = [...(firstData.calls ?? [])];
    const perPage = firstData.meta?.per_page || 50;
    const totalCalls = firstData.meta?.total ?? allCalls.length;
    const totalPages = Math.max(1, Math.ceil(totalCalls / perPage));
    const pagesToFetch = Math.min(totalPages, PAGE_CAP);
    // True when the window genuinely has more pages than the cap allows, so
    // the OLDEST calls in it were never fetched (order=desc).
    let truncated = totalPages > PAGE_CAP;

    if (pagesToFetch > 1) {
      const pageNumbers = Array.from({ length: pagesToFetch - 1 }, (_, i) => i + 2);
      const results = await batchMap(pageNumbers, async (page) => {
        const res = await aircallGet(`${baseUrl}&page=${page}`, auth);
        if (!res.ok) return null;
        const data: { calls?: RawCall[] } = await res.json();
        return data.calls ?? [];
      });
      for (const calls of results) {
        // A page that failed even after aircallGet's retries would silently
        // undercount every stat on this page, so it flips `truncated` rather
        // than being ignored.
        if (calls === null) truncated = true;
        else allCalls.push(...calls);
      }
    }

    // Applied AFTER pagination, not as an Aircall query param — see the note
    // above about Aircall silently ignoring status/direction filters at the
    // API level. Reassigning `allCalls` itself (rather than introducing a
    // second filtered variable) means every stat below — repeatCallers,
    // callerTrend, byAgent, the headline counts — automatically respects it
    // with no further changes. Independent of the main page's own filters
    // (request 2026-08-19); only the Aircall page's own Repeat Callers trend
    // chart passes this today.
    if (opts?.direction) allCalls = allCalls.filter((c) => c.direction === opts.direction);

    const outboundCalls = allCalls.filter((c) => c.direction === "outbound");
    const totalTalkTimeSeconds = allCalls.reduce((sum, c) => sum + c.duration, 0);

    // Repeat callers: group by number, keep anyone called 2+ times this week.
    const byNumber = new Map<string, { count: number; totalDuration: number; lastCallAt: number }>();
    for (const c of allCalls) {
      const cur = byNumber.get(c.raw_digits) ?? { count: 0, totalDuration: 0, lastCallAt: 0 };
      cur.count += 1;
      cur.totalDuration += c.duration;
      cur.lastCallAt = Math.max(cur.lastCallAt, c.started_at);
      byNumber.set(c.raw_digits, cur);
    }
    const topRepeatNumbers = Array.from(byNumber.entries())
      .filter(([, v]) => v.count >= 2)
      .sort((a, b) => b[1].count - a[1].count)
      .slice(0, 15)
      .map(([number]) => number);

    // Every unique number in the window is offered to resolveContactNames —
    // cache hits are a single cheap Supabase read regardless of set size, so
    // there's no reason to pre-trim this the way the live-lookup budget must
    // be. displayedNumbers/topRepeatNumbers instead decide which CACHE MISSES
    // win the limited live-lookup budget when there are more misses than it
    // allows (see CONTACT_LOOKUP_CAP above resolveContactNames).
    const displayedNumbers = allCalls.slice(0, callsLimit).map((c) => c.raw_digits);
    const priorityNumbers = new Set([...displayedNumbers, ...topRepeatNumbers]);
    const allUniqueNumbers = Array.from(byNumber.keys());
    const contacts = opts?.skipContacts ? new Map<string, ContactInfo>() : await resolveContactNames(auth, allUniqueNumbers, priorityNumbers);

    const repeatCallers = Array.from(byNumber.entries())
      .filter(([, v]) => v.count >= 2)
      .map(([number, v]) => ({
        number,
        contactName: contacts.get(number)?.name ?? null,
        contactCompany: contacts.get(number)?.company ?? null,
        contactChecked: contacts.has(number),
        count: v.count,
        totalDuration: v.totalDuration,
        lastCallAt: new Date(v.lastCallAt * 1000).toISOString(),
      }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 15);

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

    // Compared by digits only, not exact string equality: this value travels
    // through a URL query param, and Cloudflare's runtime decodes the URL
    // once before Next.js sees it, then NextRequest.nextUrl.searchParams
    // decodes it AGAIN — a leading "+" (e.g. "+61 452 641 143") survives the
    // first pass, then the second pass treats that literal "+" as an encoded
    // space, and the route's own .trim() quietly eats the resulting leading
    // space along with it. Confirmed live 2026-08-20: the server received
    // "61 452 641 143" (no leading +) while every stored raw_digits value
    // still has it, so an exact match could never succeed. Digits-only
    // comparison is immune to this regardless of which characters an
    // encoding round-trip mangles.
    const callerTrend = opts?.callerTrendNumber
      ? dailyCountsInRange(allCalls.filter((c) => digitsOnly(c.raw_digits) === digitsOnly(opts.callerTrendNumber!)), from, now)
      : undefined;

    return {
      total: allCalls.length,
      inbound: inboundCalls.length,
      inboundAnswered: inboundCalls.length - inboundMissed,
      inboundMissed,
      outboundAnswered,
      outboundUnanswered,
      missedOrVoicemail,
      totalTalkTimeSeconds,
      avgDurationSeconds: allCalls.length > 0 ? Math.round(totalTalkTimeSeconds / allCalls.length) : null,
      medianDurationSeconds: durations.length > 0 ? Math.round(median(durations)!) : null,
      inboundAnswerRatePct: inboundCalls.length > 0 ? Math.round(((inboundCalls.length - inboundMissed) / inboundCalls.length) * 100) : null,
      outboundConnectRatePct: outboundCalls.length > 0 ? Math.round((outboundAnswered / outboundCalls.length) * 100) : null,
      missedRatePct: allCalls.length > 0 ? Math.round((missedOrVoicemail / allCalls.length) * 100) : null,
      callsPerDay: effectiveDays > 0 ? round1(allCalls.length / effectiveDays) : null,
      lines: Array.from(new Set(allCalls.map((c) => c.number?.name).filter((n): n is string => !!n))),
      recentCalls: allCalls.slice(0, callsLimit).map((c) => mapCall(c, contacts)),
      repeatCallers,
      byAgent,
      allPods,
      callerTrend,
      truncated,
    };
  } catch (e) {
    return { ...EMPTY, error: e instanceof Error ? e.message : "Aircall unreachable" };
  }
}
