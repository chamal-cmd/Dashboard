"use client";

import { useState, useRef } from "react";
import { InfoTip } from "@/components/InfoTip";
import { LastRefreshed } from "@/components/LastRefreshed";
import "./aircall-page.css";
import "@/components/info-tip.css";

// Inline types so this client component doesn't import the server-only data module
interface AircallCall {
  id: number; direction: string; status: string; duration: number;
  number: string; contactName: string | null; contactCompany: string | null; contactChecked: boolean;
  agent: string | null; agentEmail: string | null; startedAt: string;
  answered: boolean;
}
interface RepeatCaller {
  number: string; contactName: string | null; contactCompany: string | null; contactChecked: boolean;
  count: number; totalDuration: number; lastCallAt: string;
}
interface AircallOverview {
  total: number | null; inbound: number | null;
  inboundAnswered: number | null; inboundMissed: number | null;
  outboundAnswered: number | null;
  outboundUnanswered: number | null; missedOrVoicemail: number | null;
  totalTalkTimeSeconds: number | null; avgDurationSeconds: number | null; medianDurationSeconds: number | null;
  inboundAnswerRatePct: number | null; outboundConnectRatePct: number | null;
  missedRatePct: number | null; callsPerDay: number | null; lines: string[];
  recentCalls: AircallCall[]; repeatCallers: RepeatCaller[];
  allPods: { id: string; name: string }[];
  // Mirrors AircallOverview.truncated in lib/data/aircall.ts — true when the
  // calls list came back incomplete, so every figure here is an undercount.
  // AircallDashboard renders the warning; declared here because this
  // component's prop type is what AircallDashboard derives its own type from.
  truncated: boolean;
}

function formatDuration(s: number) {
  return `${Math.floor(s / 60)}:${(s % 60).toString().padStart(2, "0")}`;
}
function formatHoursMinutes(s: number) {
  const h = Math.floor(s / 3600), m = Math.round((s % 3600) / 60);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}
function formatTime(iso: string) {
  return new Date(iso).toLocaleString("en-AU", {
    weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit",
  });
}
function callStatusClass(s: string) {
  if (s === "missed") return "acStatusBadge acStatusMissed";
  if (s === "voicemail") return "acStatusBadge acStatusVoicemail";
  return "acStatusBadge acStatusDone";
}

// Name if resolved; otherwise the number, plus a small caption underneath —
// "number not saved" once Aircall/the cache has actually confirmed there's no
// contact for it, or nothing while that check is still pending (contactChecked
// tells the two apart; both would otherwise look identical: contactName null).
function CallerCell({ name, number, company, checked }: { name: string | null; number: string; company: string | null; checked: boolean }) {
  return (
    <>
      {name ?? number}
      {name ? (
        <div className="dpMuted" style={{ fontSize: 11, fontWeight: 400 }}>{number}{company ? ` · ${company}` : ""}</div>
      ) : checked ? (
        <div className="dpMuted" style={{ fontSize: 11, fontWeight: 400, opacity: 0.6 }}>number not saved</div>
      ) : null}
    </>
  );
}

const TREND_PRESETS = [
  { label: "Today", days: 1 },
  { label: "7 days", days: 7 },
  { label: "14 days", days: 14 },
  { label: "30 days", days: 30 },
  { label: "90 days", days: 90 },
] as const;
const TREND_MAX_DAYS = 90;

interface CallerTrendDay { date: string; count: number }

function formatShortDate(iso: string): string {
  const [, m, d] = iso.split("-");
  return `${d}/${m}`;
}

// Repeat-caller call volume, under the Repeat Callers table (request
// 2026-08-19, replacing an earlier attempt that just reused the page's own
// date range: "the trend chart must have filters independent of the total
// filters"). Seeded from the page's own already-fetched 7-day data (no
// redundant fetch on mount) but from then on re-fetches its OWN
// /api/aircall/overview window on preset/custom changes only — you can view,
// say, the last 90 days of caller volume here while the rest of the page
// stays on 7.
//
// Two modes, toggled by clicking a bar (request 2026-08-19, "a way to filter
// to see the trends of a client calling"): the default aggregate view (X
// axis = each repeat caller, Y axis = their call count in range), or —
// after clicking one — a drill-down (X axis = date, Y axis = that ONE
// caller's calls per day), via the same endpoint's callerTrend field so no
// second live Aircall fetch shape is needed.
type Direction = "all" | "inbound" | "outbound";
const DIRECTION_OPTIONS: { key: Direction; label: string }[] = [
  { key: "all", label: "All" },
  { key: "inbound", label: "Inbound" },
  { key: "outbound", label: "Outbound" },
];

// "This week"/"This month" are the actual calendar period (Mon-Sun, 1st-to-
// today), not a rolling N-day window (request 2026-08-20) — resolved
// server-side against Colombo's calendar so this component doesn't need its
// own timezone math. "dates" is a fully custom from/to range for anything
// else. Kept as one discriminated union (rather than separate flags) so
// there's exactly one "current period" at a time and every handler passes
// it straight through to load() without reconstructing it.
type PeriodSpec =
  | { mode: "days"; days: number }
  | { mode: "week" }
  | { mode: "month" }
  | { mode: "dates"; from: string; to: string };

function periodQuery(period: PeriodSpec): Record<string, string> {
  switch (period.mode) {
    case "days": return { days: String(period.days) };
    case "week": return { period: "week" };
    case "month": return { period: "month" };
    case "dates": return { from: period.from, to: period.to };
  }
}

// A caller's day-by-day volume is a genuine trend over time — a connected
// line reads that trajectory at a glance, unlike the discrete bars this used
// to render (request 2026-08-21, "make the chart a trend chart instead of a
// bar chart"). The aggregate per-caller comparison below stays as bars: it's
// comparing unrelated people, not a sequence, so a connecting line between
// them wouldn't represent anything real.
function CallerTrendLine({ trend, maxCount, height }: { trend: CallerTrendDay[]; maxCount: number; height: number }) {
  const stepX = 34;
  const topPad = 16;
  const width = Math.max(trend.length * stepX, stepX);
  const x = (i: number) => i * stepX + stepX / 2;
  const y = (count: number) => height - (count / maxCount) * (height - topPad);

  const linePoints = trend.map((d, i) => `${x(i)},${y(d.count)}`).join(" ");
  const areaPoints = `${x(0)},${height} ${linePoints} ${x(trend.length - 1)},${height}`;

  return (
    <div style={{ overflowX: "auto", paddingBottom: 4 }}>
      <svg width={width} height={height} style={{ display: "block" }}>
        {trend.length > 1 && <polygon points={areaPoints} style={{ fill: "#4f8ef71f" }} />}
        {trend.length > 1 && (
          <polyline points={linePoints} fill="none" stroke="#4f8ef7" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
        )}
        {trend.map((d, i) => (
          <circle key={d.date} cx={x(i)} cy={y(d.count)} r={d.count > 0 ? 4 : 2.5} style={{ fill: d.count > 0 ? "#4f8ef7" : "var(--surface-2)" }}>
            <title>{`${d.date}: ${d.count} call${d.count !== 1 ? "s" : ""}`}</title>
          </circle>
        ))}
      </svg>
      <div style={{ display: "flex", width, marginTop: 4 }}>
        {trend.map((d) => (
          <div key={d.date} style={{ width: stepX, flexShrink: 0, textAlign: "center", fontSize: 9, color: "var(--text-3)" }}>
            {formatShortDate(d.date)}
          </div>
        ))}
      </div>
    </div>
  );
}

function RepeatCallersTrendChart({ initial, initialDays }: { initial: RepeatCaller[]; initialDays: number }) {
  // Seeded from the page's own current range (fixed 2026-08-19 — this used
  // to default to 7 unconditionally, so if the main page was actually on,
  // say, 30 days, this chart displayed 30-day data while its own presets
  // still showed "7 days" as active, and clicking it did nothing because as
  // far as this component knew that preset was already selected).
  const [period, setPeriod] = useState<PeriodSpec>({ mode: "days", days: initialDays });
  const [custom, setCustom] = useState("");
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState("");
  const [direction, setDirection] = useState<Direction>("all");
  const [loading, setLoading] = useState(false);
  const [repeatCallers, setRepeatCallers] = useState<RepeatCaller[]>(initial);
  const [selectedCaller, setSelectedCaller] = useState<RepeatCaller | null>(null);
  const [callerTrend, setCallerTrend] = useState<CallerTrendDay[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [lastRefreshed, setLastRefreshed] = useState<Date | null>(null);
  // Four independent triggers (presets, direction, the caller dropdown,
  // custom-days) can each fire load() while an earlier call is still in
  // flight — the caller dropdown in particular has no `loading` guard, so a
  // quick preset-then-caller click starts two overlapping fetches. Without
  // this, whichever response happened to resolve LAST won regardless of
  // which click was actually most recent, so an older, superseded response
  // (e.g. a different caller, or the aggregate view) could overwrite state
  // after a newer one already landed — surfaced live 2026-08-20 as the
  // dropdown showing one caller's count while the drill-down claimed zero
  // calls for them. Stamping each call and checking it's still current
  // before applying its result discards any response that's been superseded.
  const requestIdRef = useRef(0);

  const load = async (nextPeriod: PeriodSpec, dir: Direction, callerNumber?: string) => {
    const requestId = ++requestIdRef.current;
    setLoading(true);
    try {
      const params = new URLSearchParams(periodQuery(nextPeriod));
      if (dir !== "all") params.set("direction", dir);
      if (callerNumber) params.set("callerNumber", callerNumber);
      const res = await fetch(`/api/aircall/overview?${params}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json() as { repeatCallers?: RepeatCaller[]; callerTrend?: CallerTrendDay[]; error?: string };
      if (json.error) throw new Error(json.error);
      if (requestId !== requestIdRef.current) return;
      setRepeatCallers(json.repeatCallers ?? []);
      if (callerNumber) setCallerTrend(json.callerTrend ?? []);
      setPeriod(nextPeriod);
      setDirection(dir);
      setError(null);
      setLastRefreshed(new Date());
    } catch (e) {
      if (requestId !== requestIdRef.current) return;
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      if (requestId === requestIdRef.current) setLoading(false);
    }
  };

  const pickPreset = (d: number) => {
    if (!loading && !(period.mode === "days" && period.days === d)) void load({ mode: "days", days: d }, direction, selectedCaller?.number);
  };
  const submitCustom = () => {
    const n = Math.floor(Number(custom));
    if (!isNaN(n) && n >= 1) void load({ mode: "days", days: Math.min(n, TREND_MAX_DAYS) }, direction, selectedCaller?.number);
  };
  const pickWeek = () => { if (!loading && period.mode !== "week") void load({ mode: "week" }, direction, selectedCaller?.number); };
  const pickMonth = () => { if (!loading && period.mode !== "month") void load({ mode: "month" }, direction, selectedCaller?.number); };
  const submitCustomDates = () => {
    if (!customFrom || !customTo || customFrom > customTo) return;
    const spanDays = Math.round((new Date(customTo).getTime() - new Date(customFrom).getTime()) / 86400000) + 1;
    if (spanDays > TREND_MAX_DAYS) { setError(`Pick a range of ${TREND_MAX_DAYS} days or less.`); return; }
    void load({ mode: "dates", from: customFrom, to: customTo }, direction, selectedCaller?.number);
  };
  const pickDirection = (dir: Direction) => { if (dir !== direction && !loading) void load(period, dir, selectedCaller?.number); };
  const selectCaller = (caller: RepeatCaller) => {
    setSelectedCaller(caller);
    setCallerTrend(null);
    void load(period, direction, caller.number);
  };
  // No new fetch needed: repeatCallers is already fresh for the current
  // period/`direction` regardless of whether a caller was selected (the
  // endpoint always returns it), so clearing the selection alone is enough
  // to go back.
  const backToAll = () => { setSelectedCaller(null); setCallerTrend(null); };

  const sorted = [...repeatCallers].sort((a, b) => b.count - a.count);
  const maxCount = Math.max(...sorted.map((r) => r.count), 1);
  const maxDailyCount = Math.max(...(callerTrend ?? []).map((d) => d.count), 1);
  const barMaxHeight = 150;

  return (
    <div className="dpTableWrap" style={{ padding: 18, marginBottom: 24 }}>
      <div className="dpTableTitle" style={{ marginBottom: 4, display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        <span>
          {selectedCaller ? `${selectedCaller.contactName ?? selectedCaller.number} — calls by date` : "Repeat Callers — call volume"}
          <InfoTip text={selectedCaller
            ? "This one caller's calls per day within the range picked here, including days with none."
            : "Its own date range, independent of the range above. X axis is each repeat caller, Y axis is how many times they called. Click a bar to see that caller's day-by-day pattern."} />
        </span>
        <LastRefreshed at={lastRefreshed} />
      </div>
      <div className="dpTableSub" style={{ marginBottom: 14 }}>
        {selectedCaller ? (
          <button type="button" className="dpFilterChip" style={{ marginLeft: 0 }} onClick={backToAll}>← All callers</button>
        ) : (
          "Own date range — separate from the rest of this page · click a bar, or pick a caller below, to see their trend"
        )}
      </div>

      {sorted.length > 0 && (
        <div style={{ marginBottom: 16 }}>
          <select
            className="dpRangeInput"
            style={{ minWidth: 220 }}
            value={selectedCaller?.number ?? ""}
            onChange={(e) => {
              if (!e.target.value) { backToAll(); return; }
              const caller = sorted.find((r) => r.number === e.target.value);
              if (caller) selectCaller(caller);
            }}
          >
            <option value="">— All callers —</option>
            {sorted.map((r) => (
              <option key={r.number} value={r.number}>{r.contactName ?? r.number} ({r.count})</option>
            ))}
          </select>
        </div>
      )}

      <div className={`acTabBar ${loading ? "hubDateLoading" : ""}`} style={{ marginBottom: 16, flexWrap: "wrap" }}>
        {TREND_PRESETS.map((p) => (
          <button key={p.days} className={`acTab ${period.mode === "days" && period.days === p.days ? "acTabActive" : ""}`} onClick={() => pickPreset(p.days)}>
            {p.label}
          </button>
        ))}
        <button className={`acTab ${period.mode === "week" ? "acTabActive" : ""}`} onClick={pickWeek}>This week</button>
        <button className={`acTab ${period.mode === "month" ? "acTabActive" : ""}`} onClick={pickMonth}>This month</button>
        <span className="dpRangeCustom">
          <input
            className="dpRangeInput" type="number" min={1} max={TREND_MAX_DAYS} placeholder="Custom"
            value={custom} onChange={(e) => setCustom(e.target.value)} onKeyDown={(e) => e.key === "Enter" && submitCustom()}
          />
          <button className={`acTab ${period.mode === "days" && !TREND_PRESETS.some((p) => p.days === period.days) ? "acTabActive" : ""}`} onClick={submitCustom}>
            days
          </button>
        </span>
        {loading && <span style={{ fontSize: 11, color: "var(--text-3)", alignSelf: "center", marginLeft: 8 }}>Loading…</span>}
      </div>

      <div className={`acTabBar ${loading ? "hubDateLoading" : ""}`} style={{ marginBottom: 16, flexWrap: "wrap" }}>
        <span className="dpRangeCustom">
          <span style={{ alignSelf: "center", color: "var(--text-3)", fontSize: 11 }}>Or pick dates:</span>
          <input className="dpRangeInput" type="date" value={customFrom} max={customTo || undefined} onChange={(e) => setCustomFrom(e.target.value)} />
          <span style={{ alignSelf: "center", color: "var(--text-3)", fontSize: 12 }}>to</span>
          <input className="dpRangeInput" type="date" value={customTo} min={customFrom || undefined} onChange={(e) => setCustomTo(e.target.value)} />
          <button
            className={`acTab ${period.mode === "dates" ? "acTabActive" : ""}`}
            onClick={submitCustomDates}
            disabled={!customFrom || !customTo || customFrom > customTo}
          >
            Apply
          </button>
        </span>
      </div>

      <div className={`acTabBar ${loading ? "hubDateLoading" : ""}`} style={{ marginBottom: 16 }}>
        {DIRECTION_OPTIONS.map((opt) => (
          <button key={opt.key} className={`acTab ${direction === opt.key ? "acTabActive" : ""}`} onClick={() => pickDirection(opt.key)}>
            {opt.label}
          </button>
        ))}
      </div>

      {error ? (
        <div className="dpEmpty">Couldn&apos;t load: {error}</div>
      ) : selectedCaller ? (
        !callerTrend ? (
          <div className="dpEmpty">Loading…</div>
        ) : callerTrend.every((d) => d.count === 0) ? (
          <div className="dpEmpty">No calls from {selectedCaller.contactName ?? selectedCaller.number} in this range.</div>
        ) : (
          <CallerTrendLine trend={callerTrend} maxCount={maxDailyCount} height={barMaxHeight} />
        )
      ) : sorted.length === 0 ? (
        <div className="dpEmpty">No repeat callers in this range.</div>
      ) : (
        <div style={{ display: "flex", alignItems: "flex-end", gap: 14, overflowX: "auto", paddingBottom: 4 }}>
          {sorted.map((r) => {
            const barHeight = Math.max((r.count / maxCount) * barMaxHeight, 4);
            return (
              <button
                key={r.number}
                type="button"
                onClick={() => selectCaller(r)}
                style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 6, width: 64, flexShrink: 0, background: "none", border: "none", cursor: "pointer", padding: 0 }}
                title={`${r.contactName ?? r.number}: ${r.count} calls — click for their day-by-day trend`}
              >
                <div style={{ fontSize: 11, fontWeight: 700, color: "var(--text-1)" }}>{r.count}</div>
                <div style={{ height: barMaxHeight, display: "flex", alignItems: "flex-end" }}>
                  <div style={{ width: 28, height: barHeight, borderRadius: 4, background: "#4f8ef7" }} />
                </div>
                <div style={{ fontSize: 10, fontWeight: 600, color: "var(--text-1)", textAlign: "center", lineHeight: 1.2, maxWidth: 64, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {r.contactName ?? r.number}
                </div>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

type Tab = "calls" | "messaging";

// Drill-down filters for the call list. Each predicate mirrors the matching
// headline tile's definition in lib/data/aircall.ts exactly (inbound by
// direction; outbound split on `answered`, not status; missed/voicemail via
// the normalized status mapCall() already applied) so the number on the tile
// and the number of rows it filters to can't drift apart.
type CallFilter = "all" | "inboundAnswered" | "inboundMissed" | "outboundAnswered" | "outboundUnanswered";

const CALL_FILTERS: Record<CallFilter, { label: string; match: (c: AircallCall) => boolean }> = {
  all:                 { label: "All calls",           match: () => true },
  inboundAnswered:     { label: "Inbound answered",    match: (c) => c.direction === "inbound" && c.status !== "missed" && c.status !== "voicemail" },
  inboundMissed:       { label: "Inbound missed",      match: (c) => c.direction === "inbound" && (c.status === "missed" || c.status === "voicemail") },
  outboundAnswered:    { label: "Outbound answered",   match: (c) => c.direction === "outbound" && c.answered },
  outboundUnanswered:  { label: "Outbound unanswered", match: (c) => c.direction === "outbound" && !c.answered },
};

// Aircall has no messaging list/GET endpoint (webhook-only, see aircall.ts) —
// their own analytics page is the authoritative source for message volume,
// so it's linked directly rather than waiting on our own webhook pipeline.
const AIRCALL_MESSAGING_ANALYTICS_URL =
  "https://dashboard.aircall.io/analytics/overview/messages?date=today&date_breakdown=daily&team_filter_option=users_belong_to_team&timezone=Asia%2FColombo";

export default function AircallTabs({ aircall, days }: { aircall: AircallOverview; days: number }) {
  const [tab, setTab] = useState<Tab>("calls");
  const [callFilter, setCallFilter] = useState<CallFilter>("all");
  // Independent of the tile filter: drilling into one repeat caller narrows to
  // that number. Kept separate so the two can compose (e.g. "missed calls from
  // this number") rather than clobbering each other.
  const [numberFilter, setNumberFilter] = useState<string | null>(null);

  // Clicking the already-active tile clears the filter, so the tiles toggle.
  const toggleFilter = (f: CallFilter) => setCallFilter((prev) => (prev === f ? "all" : f));

  const clearAll = () => { setCallFilter("all"); setNumberFilter(null); };

  const visibleCalls = aircall.recentCalls
    .filter(CALL_FILTERS[callFilter].match)
    .filter((c) => numberFilter == null || c.number === numberFilter);
  const anyFilter = callFilter !== "all" || numberFilter != null;
  // recentCalls is capped by the page's callsLimit while the tiles count every
  // call in the window — so on a wide range the list is a recent subset. Say
  // so explicitly rather than letting a filtered count look like a total.
  const listCapped = aircall.total != null && aircall.total > aircall.recentCalls.length;

  return (
    <>
      {/* ── Tab bar ───────────────────────────────────────── */}
      <div className="acTabBar">
        <button className={`acTab ${tab === "calls" ? "acTabActive" : ""}`} onClick={() => setTab("calls")}>
          📞 Calling
        </button>
        <button className={`acTab ${tab === "messaging" ? "acTabActive" : ""}`} onClick={() => setTab("messaging")}>
          💬 Messaging
        </button>
      </div>

      {/* ── Calling tab ───────────────────────────────────── */}
      {tab === "calls" && (
        <>
          <div className="dpSectionLbl">Volume</div>
          <div className="dpKpiGrid dpKpiGrid5">
            {[
              { val: aircall.total,              lbl: "Total Calls",          color: "#4f8ef7", filter: "all" as CallFilter,               tip: "All inbound and outbound calls in the selected date range. Click to show every call in the list below." },
              { val: aircall.inboundAnswered,    lbl: "Inbound Answered",     color: "#34d399", filter: "inboundAnswered" as CallFilter,   tip: "Calls that came in from a customer and were actually answered. Click to filter the call list below to just these." },
              { val: aircall.inboundMissed,      lbl: "Inbound Missed",       color: "#f87171", filter: "inboundMissed" as CallFilter,     tip: "Calls that came in from a customer and were never answered, or went to voicemail. Click to filter the call list below to just these." },
              { val: aircall.outboundAnswered,   lbl: "Outbound Answered",    color: "#a78bfa", filter: "outboundAnswered" as CallFilter,   tip: "Calls your team dialed out that the other side picked up. Click to filter the call list below to just these." },
              { val: aircall.outboundUnanswered, lbl: "Outbound Unanswered",  color: "#fbbf24", filter: "outboundUnanswered" as CallFilter, tip: "Calls your team dialed out that were not picked up. Click to filter the call list below to just these." },
            ].map(({ val, lbl, color, filter, tip }) => (
              <button
                key={lbl}
                type="button"
                className="dpKpi dpKpiBtn"
                style={{ "--kpi-accent": color } as React.CSSProperties}
                aria-pressed={callFilter === filter}
                onClick={() => toggleFilter(filter)}
              >
                <div className="dpKpiVal">{val}</div>
                <div className="dpKpiLbl">{lbl}<InfoTip text={tip} /></div>
              </button>
            ))}
          </div>
          <div className="dpNote" style={{ marginTop: -8 }}>
            Click any tile above to filter the call list at the bottom of this page.
          </div>

          <div className="dpSectionLbl">Quality</div>
          <div className="dpKpiGrid dpKpiGrid5 dpKpiGridLast">
            <div className="dpKpi" style={{ "--kpi-accent": "#34d399" } as React.CSSProperties}>
              <div className="dpKpiVal">{aircall.inboundAnswerRatePct != null ? `${aircall.inboundAnswerRatePct}%` : "—"}</div>
              <div className="dpKpiLbl">Inbound Answer Rate<InfoTip text="Of all inbound calls, the % that were actually answered (not missed or sent to voicemail) — how well the team services incoming calls." /></div>
            </div>
            <div className="dpKpi" style={{ "--kpi-accent": "#a78bfa" } as React.CSSProperties}>
              <div className="dpKpiVal">{aircall.outboundConnectRatePct != null ? `${aircall.outboundConnectRatePct}%` : "—"}</div>
              <div className="dpKpiLbl">Outbound Connect Rate<InfoTip text="Of all outbound calls the team dialed, the % that connected — a different question from Inbound Answer Rate, so it's tracked separately." /></div>
            </div>
            <div className="dpKpi" style={{ "--kpi-accent": "#4f8ef7" } as React.CSSProperties}>
              <div className="dpKpiVal">{aircall.avgDurationSeconds != null ? formatDuration(aircall.avgDurationSeconds) : "—"}</div>
              <div className="dpKpiLbl">Avg Duration {aircall.medianDurationSeconds != null && <span style={{ opacity: 0.6 }}>({formatDuration(aircall.medianDurationSeconds)} median)</span>}<InfoTip text="Mean call length across all calls. Median is shown too since a few very long calls can skew the average upward." /></div>
            </div>
            <div className="dpKpi" style={{ "--kpi-accent": "#fbbf24" } as React.CSSProperties}>
              <div className="dpKpiVal">{aircall.callsPerDay ?? "—"}</div>
              <div className="dpKpiLbl">Calls / Day<InfoTip text="Total calls divided by the number of days in the selected range — normalizes volume so Today/7d/30d are actually comparable." /></div>
            </div>
            <div className="dpKpi" style={{ "--kpi-accent": "#f87171" } as React.CSSProperties}>
              <div className="dpKpiVal">{aircall.missedRatePct != null ? `${aircall.missedRatePct}%` : "—"}</div>
              <div className="dpKpiLbl">Missed Rate<InfoTip text="Missed or voicemailed calls as a % of all calls (inbound and outbound combined)." /></div>
            </div>
          </div>

          <div className="dpNote" style={{ marginTop: -4 }}>
            Total talk time: {aircall.totalTalkTimeSeconds != null ? formatHoursMinutes(aircall.totalTalkTimeSeconds) : "—"}
            {aircall.lines.length > 0 && <> · Line{aircall.lines.length !== 1 ? "s" : ""}: {aircall.lines.join(", ")}</>}
          </div>

          {aircall.repeatCallers.length > 0 && (
            <div className="dpTableWrap" style={{ marginBottom: 24 }}>
              <div className="dpTableHead">
                <div>
                  <div className="dpTableTitle">Repeat Callers<InfoTip text="Phone numbers that called 2 or more times within the selected date range, ranked by call count. Click any row to see that caller's individual calls in the list below." /></div>
                  <div className="dpTableSub">Numbers that called 2+ times in this range · click a row to see their calls</div>
                </div>
              </div>
              <table className="dpTable">
                <thead><tr><th>Caller</th><th>Calls</th><th>Total Duration</th><th>Last Call</th></tr></thead>
                <tbody>
                  {aircall.repeatCallers.map((r) => (
                    <tr
                      key={r.number}
                      onClick={() => setNumberFilter((prev) => (prev === r.number ? null : r.number))}
                      style={{ cursor: "pointer", background: numberFilter === r.number ? "var(--surface-2)" : undefined }}
                      title={numberFilter === r.number ? "Click to clear this caller filter" : `Show ${r.contactName ?? r.number}'s calls below`}
                    >
                      <td className="dpPrimary">
                        <CallerCell name={r.contactName} number={r.number} company={r.contactCompany} checked={r.contactChecked} />
                      </td>
                      <td className="dpMuted">{r.count}</td>
                      <td className="dpMuted">{formatHoursMinutes(r.totalDuration)}</td>
                      <td className="dpMuted">{formatTime(r.lastCallAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <RepeatCallersTrendChart initial={aircall.repeatCallers} initialDays={days} />

          <div className="dpTableWrap" id="section-calls">
            <div className="dpTableHead">
              <div>
                <div className="dpTableTitle">
                  {callFilter === "all" ? "All Calls" : CALL_FILTERS[callFilter].label}
                  <InfoTip text="Every call in the selected date range, most recent first, with the resolved contact name/company where Aircall has one on file. Clicking a Volume tile above, or a row in Repeat Callers, filters this list." />
                  {anyFilter && (
                    <button type="button" className="dpFilterChip" onClick={clearAll}>
                      × clear filter
                    </button>
                  )}
                </div>
                <div className="dpTableSub">
                  {visibleCalls.length} call{visibleCalls.length !== 1 ? "s" : ""}
                  {callFilter !== "all" && ` matching “${CALL_FILTERS[callFilter].label}”`}
                  {numberFilter != null && ` from ${numberFilter}`}
                  {listCapped
                    ? ` · drawn from the ${aircall.recentCalls.length} most recent of ${aircall.total} calls in range`
                    : ", most recent first"}
                </div>
              </div>
            </div>
            {visibleCalls.length === 0 ? (
              <div className="dpEmpty">
                {aircall.recentCalls.length === 0
                  ? "No calls in this date range."
                  : `No matching calls${listCapped ? " among the most recent calls loaded" : ""} in this date range.`}
              </div>
            ) : (
              <table className="dpTable">
                <thead><tr><th>Caller</th><th>Direction</th><th>Status</th><th>Agent</th><th>Duration</th><th>Time</th></tr></thead>
                <tbody>
                  {visibleCalls.map((c) => (
                    <tr key={c.id}>
                      <td className="dpPrimary">
                        <CallerCell name={c.contactName} number={c.number} company={c.contactCompany} checked={c.contactChecked} />
                      </td>
                      <td><span className={`acDirBadge ${c.direction === "inbound" ? "acDirInbound" : "acDirOutbound"}`}>{c.direction}</span></td>
                      <td><span className={callStatusClass(c.status)}>{c.status}</span></td>
                      <td className="dpMuted">{c.agent ?? "—"}</td>
                      <td className="dpMuted">{formatDuration(c.duration)}</td>
                      <td className="dpMuted">{formatTime(c.startedAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </>
      )}

      {/* ── Messaging tab ─────────────────────────────────── */}
      {tab === "messaging" && (
        <div className="dpTableWrap">
          <div className="dpEmpty" style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 14 }}>
            <div style={{ maxWidth: 440 }}>
              Aircall&apos;s API doesn&apos;t allow pulling message history — there&apos;s no endpoint for SMS/WhatsApp messages, so this dashboard can&apos;t show them directly.
            </div>
            <a
              href={AIRCALL_MESSAGING_ANALYTICS_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="acMsgAnalyticsLink"
              style={{ marginBottom: 0 }}
            >
              📊 View messaging in Aircall ↗
            </a>
          </div>
        </div>
      )}
    </>
  );
}
