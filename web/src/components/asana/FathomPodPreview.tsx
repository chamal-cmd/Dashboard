"use client";

import { useState, useEffect } from "react";
import { LastRefreshed } from "@/components/LastRefreshed";
import "./fathom-pod-preview.css";

type MonthDueStatus = "done" | "upcoming" | "due" | "not-applicable";

interface MonthTag {
  name: string;
  // False when the month is owed because the row sits in that quarter, but
  // nobody ticked it in Asana's Months field. Counted either way — see
  // monthsOwedBy in asana-cadence.ts. Always true for quarterly trackers
  // (BAS), where one row is one lodgement and there is nothing to infer.
  ticked: boolean;
  // Due-date status computed server-side — 10th working day of the following
  // month for Fathom, the ATO's 28th-after-quarter-end for BAS.
  status: MonthDueStatus;
  dueOn: string;
}
interface PodLeaderClient {
  name: string;
  progress: string;
  months: MonthTag[];
  // Quarterly trackers (BAS) only — which of the quarter's calendar months
  // are individually ticked, i.e. the monthly prep work behind the one
  // quarterly lodgement. See the same field in lib/data/asana-cadence.ts.
  monthTicks?: { name: string; ticked: boolean }[];
  bookkeeper: string;
}
// Completion in REPORTS (one client × one month), not client rows — mirrors
// ReportCounts in lib/data/asana-cadence.ts, declared locally so this client
// component doesn't import the server-only module. 4 clients × 3 months = 12
// reports, so 6 delivered is 50%.
interface ReportCounts {
  completed: number;
  due: number;
  upcoming: number;
  outstanding: number;
  notApplicable: number;
  total: number;
  pct: number | null;
  inferredMonths: number;
}
interface FathomPodBreakdown {
  podId: string;
  pod: string;
  quarters: PodLeaderQuarter[];
  reports: ReportCounts;
}
interface PodLeaderQuarter {
  period: string;
  sortKey: string;
  fyQuarter: number | null;
  fyLabel: string | null;
  summary: Record<string, number>;
  reports: ReportCounts;
  // Quarter synthesised from the previous one because the Asana board has no
  // section for it yet — see projectNextQuarter in asana-cadence.ts.
  projected: boolean;
  clients: PodLeaderClient[];
}

function progressChipClass(progress: string): string {
  if (progress === "Completed") return "dpBadgeChip dpChipGreen";
  if (progress === "Not Applicable") return "dpBadgeChip dpChipAmber";
  if (progress === "Not Completed") return "dpBadgeChip dpChipRed";
  return "dpBadgeChip dpChipBlue";
}

const DONE_HEX = "#34d399";
const OPEN_HEX = "#fbbf24";
const DUE_HEX = "#f87171";
const NA_HEX = "#8b90b5";

// Financial-year order (Jul→Jun) — the Months field's own option order, so a
// quarter's months read chronologically rather than alphabetically.
const FY_MONTHS = ["July", "Aug", "Sep", "Oct", "Nov", "Dec", "Jan", "Feb", "Mar", "Apr", "May", "Jun"];
const fyIndex = (name: string) => {
  const i = FY_MONTHS.findIndex((m) => m.slice(0, 3).toLowerCase() === name.slice(0, 3).toLowerCase());
  return i === -1 ? 99 : i;
};

// Splits one client row's owed months into the three status groups shown
// as separate table columns. "not-applicable" months are omitted from all
// three — a client that doesn't owe a report for a month has nothing to show
// for it in any of Completed/Upcoming/Due. A trailing ° marks a month that is
// owed because of the quarter but was never ticked in Asana's Months field.
function monthNamesByStatus(months: MonthTag[], status: MonthDueStatus): string {
  const names = months
    .filter((m) => m.status === status)
    .sort((a, b) => fyIndex(a.name) - fyIndex(b.name))
    .map((m) => (m.ticked ? m.name : `${m.name}°`));
  return names.length ? names.join(", ") : "—";
}

// Per-month prep-work chips for a quarterly (BAS) row — "✓ Jul  ✓ Aug  ✗ Sep"
// — the individual months ticked in Asana toward the one quarterly lodgement.
// Kept visually distinct from the Progress chip: a row can show 2 of 3 months
// ticked while Progress is still Not Completed, which is exactly the case
// this exists to make legible instead of collapsing into a single "not done".
function MonthTickChips({ monthTicks }: { monthTicks: { name: string; ticked: boolean }[] }) {
  if (monthTicks.length === 0) return <span className="dpMuted">—</span>;
  return (
    <span style={{ display: "inline-flex", flexWrap: "wrap", gap: 4 }}>
      {[...monthTicks].sort((a, b) => fyIndex(a.name) - fyIndex(b.name)).map((m) => (
        <span
          key={m.name}
          className="dpBadgeChip"
          title={`${m.name}: ${m.ticked ? "ticked in Asana's Months field" : "not yet ticked"}`}
          style={{
            color: m.ticked ? DONE_HEX : "var(--text-3)",
            background: m.ticked ? `${DONE_HEX}22` : "var(--surface-2)",
          }}
        >
          {m.ticked ? "✓" : "✗"} {m.name}
        </span>
      ))}
    </span>
  );
}

// The one date worth showing per client row: the earliest deadline that hasn't
// been met, falling back to the latest deadline once everything is done.
// Listing all three of a Fathom row's deadlines in a table cell is noise —
// what gets chased is the next one.
function deadlineOf(months: MonthTag[]): string {
  if (months.length === 0) return "—";
  const outstanding = months.filter((m) => m.status === "due" || m.status === "upcoming");
  const pool = outstanding.length > 0 ? outstanding : months;
  const iso = pool.map((m) => m.dueOn).sort()[outstanding.length > 0 ? 0 : pool.length - 1];
  if (!iso) return "—";
  const [y, mo, d] = iso.split("-");
  return `${d} ${MONTH_SHORT[Number(mo) - 1]} ${y}`;
}
const MONTH_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

interface MonthStat { name: string; done: number; upcoming: number; due: number; na: number }

// Rolls a quarter's client rows up per tagged month, by that month's own
// due-date status (not the row's overall Progress) — the same month tag can
// be "done" for one client and "due" for another.
function monthRollup(clients: PodLeaderClient[]): MonthStat[] {
  const map = new Map<string, MonthStat>();
  for (const c of clients) {
    for (const m of c.months) {
      const cur = map.get(m.name) ?? { name: m.name, done: 0, upcoming: 0, due: 0, na: 0 };
      if (m.status === "done") cur.done += 1;
      else if (m.status === "upcoming") cur.upcoming += 1;
      else if (m.status === "due") cur.due += 1;
      else cur.na += 1;
      map.set(m.name, cur);
    }
  }
  return [...map.values()].sort((a, b) => fyIndex(a.name) - fyIndex(b.name));
}

// Module scope, not nested inside MonthSplitBar: a component defined during
// another component's render gets a new identity every render, which React's
// static-components rule (correctly) rejects.
function MonthGroup({ label, hex, months, render }: {
  label: string; hex: string; months: MonthStat[]; render: (m: MonthStat) => string;
}) {
  return (
    <span style={{ display: "inline-flex", alignItems: "center", flexWrap: "wrap", gap: 4, marginRight: 16 }}>
      <span style={{ fontSize: 11, color: "var(--text-3)", fontWeight: 700 }}>{label}</span>
      {months.length === 0
        ? <span style={{ fontSize: 11, color: "var(--text-3)" }}>none</span>
        : months.map((m) => (
            <span key={m.name} className="dpBadgeChip" style={{ color: hex, background: `${hex}22` }}>
              {render(m)}
            </span>
          ))}
    </span>
  );
}

function LegendRow({ hex, count, label }: { hex: string; count: number; label: string }) {
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 13, color: "var(--text-2)" }}>
      <span style={{ width: 10, height: 10, borderRadius: 3, background: hex, flexShrink: 0 }} />
      <strong style={{ color: "var(--text-1)" }}>{count}</strong> {label}
    </span>
  );
}

// Headline completion figure, counted in REPORTS rather than client rows: a
// quarter with 4 clients each owing 3 monthly reports is 12 reports, so 6
// delivered reads 50% — not "2 of 4 rows ticked". Counting rows treated a
// client who had delivered one month of three as either wholly done or wholly
// undone, which is what made this number disagree with the board.
//
// Three segments rather than two, so the shortfall is attributed: sent
// (green), due (red, deadline passed and not sent) and upcoming (amber, not
// yet due) are very different things to be looking at in August.
function CompletionDonut({ reports, expanded, onToggle }: {
  reports: ReportCounts; expanded: boolean; onToggle: () => void;
}) {
  const { completed, due, upcoming, notApplicable, total, pct } = reports;
  const size = 108;
  const strokeWidth = 14;
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;

  const segments = [
    { value: completed, hex: DONE_HEX },
    { value: due, hex: DUE_HEX },
    { value: upcoming, hex: OPEN_HEX },
  ].filter((s) => s.value > 0);
  // 2px of surface either side of each seam, only where segments actually
  // meet — a single full-circle segment must not be shortened.
  const gap = segments.length > 1 ? 4 : 0;

  let offset = 0;
  const arcs = segments.map((s) => {
    const len = total > 0 ? (s.value / total) * circumference : 0;
    const arc = { ...s, len, offset };
    offset += len;
    return arc;
  });

  return (
    <button
      type="button"
      onClick={onToggle}
      aria-expanded={expanded}
      title={expanded ? "Hide the detailed breakdown" : "Show the detailed breakdown"}
      // Stacked, not side by side (changed on request 2026-08-10): all of a
      // quarter's cards now sit in one horizontal row (see the grid below),
      // so each card is narrower — the donut on top with its numbers below,
      // centered, reads at a glance instead of being squeezed sideways.
      style={{ background: "none", border: "none", cursor: "pointer", padding: 0, display: "flex", flexDirection: "column", alignItems: "center", gap: 14, width: "100%", textAlign: "center" }}
    >
      <div style={{ position: "relative", width: size, height: size, flexShrink: 0 }}>
        <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} style={{ transform: "rotate(-90deg)" }}>
          <circle cx={size / 2} cy={size / 2} r={radius} fill="none" stroke="var(--surface-2)" strokeWidth={strokeWidth} />
          {arcs.map((a) => (
            <circle
              key={a.hex}
              cx={size / 2} cy={size / 2} r={radius} fill="none"
              stroke={a.hex} strokeWidth={strokeWidth} strokeLinecap="round"
              strokeDasharray={`${Math.max(a.len - gap, 0)} ${circumference}`}
              strokeDashoffset={-a.offset}
            />
          ))}
        </svg>
        <div style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center" }}>
          <div style={{ fontSize: 22, fontWeight: 700, color: "var(--text-1)", lineHeight: 1 }}>{pct != null ? `${pct}%` : "—"}</div>
          <div style={{ fontSize: 10, color: "var(--text-3)", marginTop: 2 }}>of reports</div>
        </div>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 6, alignItems: "center", textAlign: "center" }}>
        <span style={{ fontSize: 12, color: "var(--text-3)" }}>
          <strong style={{ color: "var(--text-1)" }}>{completed}</strong> of{" "}
          <strong style={{ color: "var(--text-1)" }}>{total}</strong> reports sent
        </span>
        <LegendRow hex={DONE_HEX} count={completed} label="sent" />
        <LegendRow hex={DUE_HEX} count={due} label="due" />
        <LegendRow hex={OPEN_HEX} count={upcoming} label="upcoming" />
        {notApplicable > 0 && (
          <span style={{ fontSize: 11, color: "var(--text-3)" }}>({notApplicable} not applicable, excluded)</span>
        )}
        {reports.inferredMonths > 0 && (
          <span
            style={{ fontSize: 11, color: "var(--text-3)" }}
            title="These months are owed because the client sits in this quarter, but nobody ticked them in Asana's Months field. They are counted in full."
          >
            {reports.inferredMonths} of these month{reports.inferredMonths !== 1 ? "s" : ""} not ticked in Asana
          </span>
        )}
        <span style={{ fontSize: 11, color: "#4f8ef7", fontWeight: 600, marginTop: 2 }}>
          {expanded ? "▾ Hide details" : "▸ Show details"}
        </span>
      </div>
    </button>
  );
}

// The complete / upcoming / due month split for one quarter, above its table.
// A month with any due client is shown as Due — that's the most urgent thing
// true about it, so it shouldn't hide behind a milder group.
function MonthSplitBar({ clients }: { clients: PodLeaderClient[] }) {
  const stats = monthRollup(clients);
  const complete = stats.filter((m) => m.due === 0 && m.upcoming === 0 && m.done > 0);
  const due = stats.filter((m) => m.due > 0);
  const upcoming = stats.filter((m) => m.due === 0 && m.upcoming > 0);
  const naOnly = stats.filter((m) => m.due === 0 && m.upcoming === 0 && m.done === 0);

  if (stats.length === 0) return null;

  return (
    <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", marginBottom: 8, rowGap: 6 }}>
      <MonthGroup label="Complete:" hex={DONE_HEX} months={complete} render={(m) => `✓ ${m.name}`} />
      <MonthGroup label="Due:" hex={DUE_HEX} months={due} render={(m) => `${m.name} · ${m.due} not sent`} />
      <MonthGroup label="Upcoming:" hex={OPEN_HEX} months={upcoming} render={(m) => `${m.name} · ${m.upcoming} pending`} />
      {naOnly.length > 0 && (
        <MonthGroup label="Not applicable:" hex={NA_HEX} months={naOnly} render={(m) => m.name} />
      )}
    </div>
  );
}

// Pod-by-pod real client list per quarter, read straight from the (old)
// Fathom tracker's Progress custom field and quarter sections — not the
// plain checkbox the rest of the dashboard uses, which is exactly why these
// numbers don't match what's visible in Asana at a glance.
const ALL_FY = "all";
const OVERALL_POD_ID = "__overall__";

// Sums a set of quarters' report counts. Mirrors sumReportCounts in
// lib/data/asana-cadence.ts — that module is server-only so it can't be
// imported here, the same reason the interfaces above are re-declared. The
// rule that matters and must not drift: `pct` is re-derived from the summed
// numerator and denominator, never averaged across quarters.
function sumReports(quarters: PodLeaderQuarter[]): ReportCounts {
  const t = quarters.reduce<ReportCounts>((a, q) => ({
    completed: a.completed + q.reports.completed,
    due: a.due + q.reports.due,
    upcoming: a.upcoming + q.reports.upcoming,
    outstanding: a.outstanding + q.reports.outstanding,
    notApplicable: a.notApplicable + q.reports.notApplicable,
    total: a.total + q.reports.total,
    pct: null,
    inferredMonths: a.inferredMonths + q.reports.inferredMonths,
  }), { completed: 0, due: 0, upcoming: 0, outstanding: 0, notApplicable: 0, total: 0, pct: null, inferredMonths: 0 });
  return { ...t, pct: t.total > 0 ? Math.round((t.completed / t.total) * 100) : null };
}

export type TrackerKey = "fathom" | "bas";

// `tracker` picks the compliance board. The two differ only in cadence:
// Fathom owes 3 monthly reports per client per quarter, BAS owes 1 quarterly
// lodgement — the server has already resolved that into each client's
// `months` array, so the only thing this component changes is wording
// ("Months" vs "Quarter") and hiding the per-month split, which is
// meaningless when a quarter contains exactly one period.
export function FathomPodPreview({ tracker = "fathom" }: { tracker?: TrackerKey }) {
  const quarterly = tracker === "bas";
  const periodWord = quarterly ? "Quarter" : "Months";
  const [pods, setPods] = useState<FathomPodBreakdown[] | null>(null);
  const [selectedPodId, setSelectedPodId] = useState<string | null>(null);
  const [fy, setFy] = useState<string>(ALL_FY);
  const [error, setError] = useState<string | null>(null);
  const [lastRefreshed, setLastRefreshed] = useState<Date | null>(null);
  // Bumped by the Retry button to re-run the load effect.
  const [reloadNonce, setReloadNonce] = useState(0);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const toggleExpanded = (sortKey: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(sortKey)) next.delete(sortKey); else next.add(sortKey);
      return next;
    });
  };

  // No state reset here: FathomReportSection remounts this component with a
  // `key` when the tracker changes, so it always starts from clean state.
  // Resetting synchronously in the effect body would only add a cascading
  // render (react-hooks/set-state-in-effect).
  useEffect(() => {
    let cancelled = false;

    // Retried once. "Failed to fetch" is a network-level failure — the request
    // never came back — and in practice those are usually transient (a stalled
    // upstream, a cold isolate, a dropped connection). Re-asking once turns a
    // dead panel into a slightly slower one; if it fails twice the message is
    // shown rather than swallowed, along with a manual Retry.
    const load = async (attempt: number): Promise<void> => {
      try {
        const res = await fetch(`/api/asana/fathom-pod-preview?tracker=${tracker}`);
        const json = await res.json().catch(() => null) as { pods?: FathomPodBreakdown[]; error?: string } | null;
        if (cancelled) return;
        if (!res.ok) throw new Error(json?.error ?? `HTTP ${res.status}`);
        if (!json) throw new Error("The server sent a response that wasn't valid JSON.");
        if (json.error) throw new Error(json.error);
        setPods(json.pods ?? []);
        // Default to whichever pod actually has data, so a stray empty pod
        // (e.g. no sections matched yet) doesn't land on a blank first view.
        setSelectedPodId((json.pods ?? []).find((p) => p.quarters.length > 0)?.podId ?? (json.pods ?? [])[0]?.podId ?? null);
        setLastRefreshed(new Date());
      } catch (e) {
        if (cancelled) return;
        if (attempt === 0) {
          await new Promise((r) => setTimeout(r, 1200));
          if (!cancelled) return load(1);
          return;
        }
        setError(e instanceof Error ? e.message : String(e));
      }
    };

    void load(0);
    return () => { cancelled = true; };
  }, [tracker, reloadNonce]);

  if (error) {
    return (
      <div className="dpEmpty" style={{ display: "flex", flexDirection: "column", gap: 10, alignItems: "center" }}>
        <div>Couldn&apos;t load the pod breakdown.</div>
        <div style={{ fontSize: 12, color: "var(--text-3)", maxWidth: 520 }}>{error}</div>
        <button
          type="button"
          className="acTab"
          onClick={() => { setError(null); setPods(null); setReloadNonce((n) => n + 1); }}
        >
          ↻ Retry
        </button>
      </div>
    );
  }
  if (!pods) return <div className="dpEmpty">Loading pod breakdown…</div>;

  const isOverall = selectedPodId === OVERALL_POD_ID;
  const selected = isOverall ? null : (pods.find((p) => p.podId === selectedPodId) ?? pods[0] ?? null);

  // Built from EVERY pod's quarters, not just the selected one, so the filter
  // buttons don't appear and disappear as you switch pods — and a filter that
  // is valid for one pod stays valid for the next.
  const financialYears = [...new Set(
    pods.flatMap((p) => p.quarters.map((q) => q.fyLabel).filter((l): l is string => !!l))
  )].sort();

  // Overall pools every pod's quarters together instead of picking one.
  const allQuarters = isOverall ? pods.flatMap((p) => p.quarters) : (selected?.quarters ?? []);
  const data = fy === ALL_FY ? allQuarters : allQuarters.filter((q) => q.fyLabel === fy);
  // Headline tracks the filter, and always excludes projected quarters — none
  // of their reports are late, so folding them in would drag the rate down for
  // work nobody is behind on.
  const headline = sumReports(data.filter((q) => !q.projected));
  const fyLabelText = fy === ALL_FY ? "all quarters on the board" : `${fy} — quarters on the board`;
  const headlineTitle = isOverall ? "All Pods" : selected?.pod ?? "";

  // Per-pod split shown behind the combined pie once expanded — the single
  // donut above hides which pod is actually carrying the shortfall.
  const perPodReports = isOverall
    ? pods.map((p) => ({
        pod: p.pod,
        reports: sumReports(
          (fy === ALL_FY ? p.quarters : p.quarters.filter((q) => q.fyLabel === fy)).filter((q) => !q.projected)
        ),
      }))
    : [];

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      <div className="podTabBar" style={{ alignItems: "center" }}>
        <button
          type="button"
          className={`podTab podTabOverall ${isOverall ? "podTabActive" : ""}`}
          onClick={() => setSelectedPodId(OVERALL_POD_ID)}
          title="Combined totals across all three pods"
        >
          <span className="podTabDot" />
          Overall
        </button>
        {pods.map((p) => (
          <button
            key={p.podId}
            type="button"
            className={`podTab ${!isOverall && p.podId === selected?.podId ? "podTabActive" : ""}`}
            onClick={() => setSelectedPodId(p.podId)}
          >
            <span className="podTabDot" />
            {p.pod}
          </button>
        ))}
        <LastRefreshed at={lastRefreshed} />
      </div>

      {financialYears.length > 1 && (
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          <span style={{ fontSize: 11, color: "var(--text-3)", fontWeight: 700 }}>Financial year:</span>
          <button
            type="button"
            className={`acTab ${fy === ALL_FY ? "acTabActive" : ""}`}
            onClick={() => setFy(ALL_FY)}
          >
            All
          </button>
          {financialYears.map((label) => (
            <button
              key={label}
              type="button"
              className={`acTab ${fy === label ? "acTabActive" : ""}`}
              onClick={() => setFy(label)}
            >
              {label}
            </button>
          ))}
        </div>
      )}

      {(selected || isOverall) && headline.total > 0 && (
        <div className="dpTableWrap" style={{ padding: "14px 18px", display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap" }}>
          <span
            style={{ fontSize: 18, fontWeight: 700, color: "var(--text-1)" }}
            title="One report = one client for one month, so 4 clients owing 3 monthly reports is 12 reports. Counted across the quarters that exist on the Asana board for the selected financial year. Months marked Not Applicable are excluded from the total. A projected quarter (one the board doesn't have yet) is shown below but left out of this figure — none of its reports are late."
          >
            {headlineTitle} — {fyLabelText}
          </span>
          <span style={{ fontSize: 30, fontWeight: 700, color: DONE_HEX }}>{headline.pct}%</span>
          <span style={{ fontSize: 15, color: "var(--text-3)" }}>
            {headline.completed} of {headline.total} reports sent
          </span>
          {headline.due > 0 && (
            <span className="dpBadgeChip" style={{ color: DUE_HEX, background: `${DUE_HEX}22` }}>
              {headline.due} due
            </span>
          )}
          {headline.upcoming > 0 && (
            <span className="dpBadgeChip" style={{ color: OPEN_HEX, background: `${OPEN_HEX}22` }}>
              {headline.upcoming} upcoming
            </span>
          )}
        </div>
      )}

      {/* A financial year whose only quarter is projected has no completion
          rate to show — the headline would otherwise just disappear when you
          select it, which reads as a bug rather than as the deliberate
          exclusion of not-yet-due work. */}
      {selected && headline.total === 0 && data.some((q) => q.projected) && (
        <div className="dpTableWrap" style={{ padding: "14px 18px", fontSize: 12, color: "var(--text-3)" }}>
          <strong style={{ color: "var(--text-1)" }}>{selected.pod} — {fy}</strong>{" "}
          has no completion rate yet: its only quarter is projected, so nothing in it is late. The
          breakdown below shows what&apos;s coming up.
        </div>
      )}

      {!isOverall && data.length === 0 && (
        <div className="dpEmpty">
          {allQuarters.length === 0
            ? `No sections matched for ${selected?.pod ?? "this pod"} in the Fathom tracker.`
            : `${selected?.pod ?? "This pod"} has no quarters in ${fy}.`}
        </div>
      )}

      {isOverall && headline.total === 0 && (
        <div className="dpEmpty">No reports found across any pod{fy === ALL_FY ? "" : ` in ${fy}`}.</div>
      )}
      {/* Overall: one combined pie rather than a 12-card grid (3 pods × up to
          4 quarters each) — that's what was asked for, not the full
          per-quarter breakdown squeezed sideways. Expanding it swaps in a
          per-pod split so the combined number doesn't hide who's behind. */}
      {isOverall && headline.total > 0 && (
        <div className="dpTableWrap" style={{ padding: 18, maxWidth: 420 }}>
          <div style={{ display: "flex", alignItems: "baseline", gap: 10, flexWrap: "wrap", marginBottom: 14 }}>
            <span style={{ fontSize: 14, fontWeight: 700, color: "var(--text-1)" }}>All pods combined</span>
            <span className="dpMuted" style={{ fontSize: 12 }}>· {fyLabelText}</span>
          </div>

          <CompletionDonut
            reports={headline}
            expanded={expanded.has("overall")}
            onToggle={() => toggleExpanded("overall")}
          />

          {expanded.has("overall") && (
            <div style={{ marginTop: 18, paddingTop: 18, borderTop: "1px solid var(--border-soft)" }}>
              <div style={{ overflowX: "auto" }}>
                <table className="dpTable">
                  <thead>
                    <tr>
                      <th>Pod</th>
                      <th>Completed {periodWord}</th>
                      <th>Upcoming {periodWord}</th>
                      <th>Due {periodWord}</th>
                      <th>Total reports</th>
                      <th>%</th>
                    </tr>
                  </thead>
                  <tbody>
                    {perPodReports.map((p) => (
                      <tr key={p.pod}>
                        <td className="dpPrimary">{p.pod}</td>
                        <td style={{ color: DONE_HEX }}>{p.reports.completed}</td>
                        <td style={{ color: OPEN_HEX }}>{p.reports.upcoming}</td>
                        <td style={{ color: DUE_HEX }}>{p.reports.due}</td>
                        <td className="dpMuted">{p.reports.total}</td>
                        <td className="dpMuted">{p.reports.pct != null ? `${p.reports.pct}%` : "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ALL quarters forced into one horizontal row (changed on request
          2026-08-10) so a client can see the whole financial year in one
          snapshot instead of it wrapping 2-3 across. Column count tracks
          data.length exactly; overflowX:auto on the wrapper is the safety
          net if that ever gets too narrow to read on a small screen.
          An EXPANDED quarter still spans the full row (gridColumn 1/-1): its
          client table has six columns and is unreadable squeezed into a
          sliver of the width, so opening one gives it the whole row while
          the rest stay in the single row. */}
      {!isOverall && (
      <div style={{ overflowX: "auto" }}>
      <div style={{ display: "grid", gridTemplateColumns: `repeat(${data.length}, minmax(260px, 1fr))`, gap: 16, alignItems: "start" }}>
      {data.map((q) => {
        const isExpanded = expanded.has(q.sortKey);
        return (
          <div
            key={q.sortKey}
            className="dpTableWrap"
            style={{ padding: 18, gridColumn: isExpanded ? "1 / -1" : undefined }}
          >
            <div style={{ display: "flex", alignItems: "baseline", gap: 10, flexWrap: "wrap", marginBottom: 14 }}>
              <span style={{ fontSize: 14, fontWeight: 700, color: "var(--text-1)" }}>
                {q.fyQuarter != null && q.fyLabel ? `Q${q.fyQuarter} ${q.fyLabel}` : q.period}
              </span>
              {q.fyQuarter != null && <span className="dpMuted" style={{ fontSize: 12 }}>({q.period})</span>}
              {q.projected && (
                <span
                  className="dpBadgeChip"
                  style={{ color: "#4f8ef7", background: "rgba(79,142,247,0.14)" }}
                  title="This quarter has no section on the Asana board yet. The client list is carried forward from the previous quarter so the months coming up are visible. Not counted in the pod percentage above."
                >
                  Projected
                </span>
              )}
              <span className="dpMuted" style={{ fontSize: 12 }}>
                · {q.clients.length} clients · {q.reports.total} report{q.reports.total !== 1 ? "s" : ""}
              </span>
            </div>

            <CompletionDonut
              reports={q.reports}
              expanded={isExpanded}
              onToggle={() => toggleExpanded(q.sortKey)}
            />

            {isExpanded && (
              <div style={{ marginTop: 18, paddingTop: 18, borderTop: "1px solid var(--border-soft)" }}>
                {/* Row-level, and labelled as such: these count client ROWS by
                    their Progress field, so they will not add up to the report
                    figures above (one row can span several months). Kept
                    because it's the state of the Asana board as a human sees it. */}
                <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 10, alignItems: "center" }}>
                  <span style={{ fontSize: 11, color: "var(--text-3)", fontWeight: 700 }}>Client rows:</span>
                  {Object.entries(q.summary).map(([progress, count]) => (
                    <span key={progress} className={progressChipClass(progress)}>{count} {progress}</span>
                  ))}
                </div>
                {/* One period per row on a quarterly tracker, so this split
                    would just restate the donut with a single entry. */}
                {!quarterly && <MonthSplitBar clients={q.clients} />}
                {/* The rules these columns encode used to be spelled out in a
                    long note above the table; removed on request (2026-08-07).
                    They live on as header tooltips so the definitions are still
                    reachable without a wall of text on every page load. */}
                {/* .dpTableWrap sets overflow:hidden, which CLIPS rather than
                    scrolls. Now that a quarter card can be a third of the row
                    wide, this six-column table needs its own scroll container
                    or the Due Months column is simply cut off on narrow
                    screens. */}
                <div style={{ overflowX: "auto" }}>
                <table className="dpTable">
                  <thead>
                    <tr>
                      <th>Client</th><th>Bookkeeper</th>
                      <th title="The row's Progress field in Asana. Row-level: one row can span several months, so this won't line up with the report counts above.">Progress</th>
                      {quarterly && (
                        <th title="The individual months of this quarter ticked in Asana's Months field — the monthly prep work behind the one quarterly lodgement. A row can have some months ticked while Progress is still Not Completed; that's normal, not a data error.">
                          Months prepped
                        </th>
                      )}
                      <th title={quarterly
                        ? "Lodged. A BAS quarter counts as lodged when the row's Progress is Completed."
                        : "Sent. A month counts as sent only when it is ticked in Asana's Months field AND the row is marked Completed. A ° marks a month owed because of the quarter that nobody ticked in Asana."}>
                        Completed {periodWord}
                      </th>
                      <th title={quarterly
                        ? "Deadline not yet reached. A BAS quarter is due the 28th of the month after it ends, except the Oct-Dec quarter which the ATO gives until 28 February."
                        : "Deadline not yet reached. Each report is due by the 10th working day of the following month — so in August, July is still upcoming. Working days are Mon-Fri; public holidays aren't accounted for, so a date right at the boundary may be off by one day."}>
                        Upcoming {periodWord}
                      </th>
                      <th title={quarterly
                        ? "Deadline passed and not lodged, at any age. Due the 28th of the month after quarter end (Oct-Dec quarter: 28 February). Lodging through a registered agent can extend this, so treat it as the baseline, not a guarantee."
                        : "Deadline passed and not sent, at any age — June and January sit in the same bucket. Due by the 10th working day of the following month, so in August the June report is due."}>
                        Due {periodWord}
                      </th>
                      <th title="The deadline this row's work is measured against.">Deadline</th>
                    </tr>
                  </thead>
                  <tbody>
                    {q.clients.map((c) => (
                      <tr key={c.name}>
                        <td className="dpPrimary">{c.name}</td>
                        <td className="dpMuted">{c.bookkeeper}</td>
                        <td><span className={progressChipClass(c.progress)}>{c.progress}</span></td>
                        {quarterly && (
                          <td><MonthTickChips monthTicks={c.monthTicks ?? []} /></td>
                        )}
                        <td style={{ color: DONE_HEX }}>{monthNamesByStatus(c.months, "done")}</td>
                        <td style={{ color: OPEN_HEX }}>{monthNamesByStatus(c.months, "upcoming")}</td>
                        <td style={{ color: DUE_HEX }}>{monthNamesByStatus(c.months, "due")}</td>
                        {/* The earliest deadline still outstanding, or the last
                            one if everything is done — a single date is what
                            people actually chase, not three. */}
                        <td className="dpMuted" style={{ whiteSpace: "nowrap" }}>{deadlineOf(c.months)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                </div>
              </div>
            )}
          </div>
        );
      })}
      </div>
      </div>
      )}
    </div>
  );
}
