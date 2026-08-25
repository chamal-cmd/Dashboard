"use client";

import { useState, useEffect } from "react";

interface ReportCounts {
  completed: number; due: number; upcoming: number;
  outstanding: number; notApplicable: number; total: number; pct: number | null;
}
interface FathomPodBreakdown { podId: string; pod: string; reports: ReportCounts }

const DONE_HEX = "#34d399";
const OPEN_HEX = "#fbbf24";
const DUE_HEX = "#f87171";

// Sums every pod's own report counts (each pod's `reports` already excludes
// projected quarters — see asana-cadence.ts) into one org-wide total. `pct`
// is re-derived from the summed numerator/denominator, never averaged.
function sumReports(pods: FathomPodBreakdown[]): ReportCounts {
  const t = pods.reduce(
    (a, p) => ({
      completed: a.completed + p.reports.completed,
      due: a.due + p.reports.due,
      upcoming: a.upcoming + p.reports.upcoming,
      outstanding: a.outstanding + p.reports.outstanding,
      notApplicable: a.notApplicable + p.reports.notApplicable,
      total: a.total + p.reports.total,
    }),
    { completed: 0, due: 0, upcoming: 0, outstanding: 0, notApplicable: 0, total: 0 }
  );
  return { ...t, pct: t.total > 0 ? Math.round((t.completed / t.total) * 100) : null };
}

// Read-only donut — no pod switcher, no per-quarter breakdown, no click-to-
// expand (simplified on request 2026-08-19: "only have the overall pie
// chart, no need of pod by breakdown"). Visually matches FathomPodPreview's
// own CompletionDonut, just without the interactive/expandable parts, which
// don't make sense for an org-wide aggregate anyway.
function OverallDonut({ reports }: { reports: ReportCounts }) {
  const { completed, due, upcoming, notApplicable, total, pct } = reports;
  const size = 120;
  const strokeWidth = 15;
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const segments = [
    { value: completed, hex: DONE_HEX },
    { value: due, hex: DUE_HEX },
    { value: upcoming, hex: OPEN_HEX },
  ].filter((s) => s.value > 0);
  const gap = segments.length > 1 ? 4 : 0;
  let offset = 0;
  const arcs = segments.map((s) => {
    const len = total > 0 ? (s.value / total) * circumference : 0;
    const arc = { ...s, len, offset };
    offset += len;
    return arc;
  });

  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 14 }}>
      <div style={{ position: "relative", width: size, height: size, flexShrink: 0 }}>
        <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} style={{ transform: "rotate(-90deg)" }}>
          <circle cx={size / 2} cy={size / 2} r={radius} fill="none" stroke="var(--surface-2)" strokeWidth={strokeWidth} />
          {arcs.map((a) => (
            <circle
              key={a.hex} cx={size / 2} cy={size / 2} r={radius} fill="none"
              stroke={a.hex} strokeWidth={strokeWidth} strokeLinecap="round"
              strokeDasharray={`${Math.max(a.len - gap, 0)} ${circumference}`} strokeDashoffset={-a.offset}
            />
          ))}
        </svg>
        <div style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center" }}>
          <div style={{ fontSize: 24, fontWeight: 700, color: "var(--text-1)", lineHeight: 1 }}>{pct != null ? `${pct}%` : "—"}</div>
          <div style={{ fontSize: 10, color: "var(--text-3)", marginTop: 2 }}>of reports</div>
        </div>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 6, alignItems: "center", textAlign: "center" }}>
        <span style={{ fontSize: 12, color: "var(--text-3)" }}>
          <strong style={{ color: "var(--text-1)" }}>{completed}</strong> of <strong style={{ color: "var(--text-1)" }}>{total}</strong> reports sent
        </span>
        <span style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13, color: "var(--text-2)" }}>
          <span style={{ width: 10, height: 10, borderRadius: 3, background: DONE_HEX, flexShrink: 0 }} />
          <strong style={{ color: "var(--text-1)" }}>{completed}</strong> sent
        </span>
        <span style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13, color: "var(--text-2)" }}>
          <span style={{ width: 10, height: 10, borderRadius: 3, background: DUE_HEX, flexShrink: 0 }} />
          <strong style={{ color: "var(--text-1)" }}>{due}</strong> due
        </span>
        <span style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13, color: "var(--text-2)" }}>
          <span style={{ width: 10, height: 10, borderRadius: 3, background: OPEN_HEX, flexShrink: 0 }} />
          <strong style={{ color: "var(--text-1)" }}>{upcoming}</strong> upcoming
        </span>
        {notApplicable > 0 && (
          <span style={{ fontSize: 11, color: "var(--text-3)" }}>({notApplicable} not applicable, excluded)</span>
        )}
      </div>
    </div>
  );
}

// Org-wide completion for the Fathom or BAS tracker — every pod's reports
// summed into one donut. Same data source as FathomPodPreview, just
// aggregated instead of switchable per pod.
export function OverallCompletionChart({ tracker }: { tracker: "fathom" | "bas" }) {
  const [pods, setPods] = useState<FathomPodBreakdown[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/asana/fathom-pod-preview?tracker=${tracker}`)
      .then((res) => res.json().catch(() => null) as Promise<{ pods?: FathomPodBreakdown[]; error?: string } | null>)
      .then((json) => {
        if (cancelled) return;
        if (!json) { setError("The server sent a response that wasn't valid JSON."); return; }
        if (json.error) { setError(json.error); return; }
        setPods(json.pods ?? []);
      })
      .catch((e) => { if (!cancelled) setError(e instanceof Error ? e.message : String(e)); });
    return () => { cancelled = true; };
  }, [tracker]);

  if (error) return <div className="dpEmpty">Couldn&apos;t load {tracker === "bas" ? "BAS" : "Fathom"} completion: {error}</div>;
  if (!pods) return <div className="dpEmpty">Loading…</div>;
  if (pods.length === 0) return <div className="dpEmpty">No pods found.</div>;

  return <OverallDonut reports={sumReports(pods)} />;
}
