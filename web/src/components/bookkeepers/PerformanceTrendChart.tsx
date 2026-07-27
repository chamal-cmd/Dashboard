"use client";

import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import Link from "next/link";
import { displayName } from "@/lib/asana-client-map";

// Validated categorical palette (dataviz skill reference theme, first 6
// slots, CVD-safe order — checked with scripts/validate_palette.js). Same
// palette used by the Hubstaff period-comparison pie chart, so a bookkeeper's
// color stays consistent with the rest of the app's charts... well, at least
// internally consistent within this one chart, since color always follows
// the SELECTED entity here, never a fixed per-person hue across pages.
const PALETTE = ["#2a78d6", "#008300", "#e87ba4", "#eda100", "#1baf7a", "#eb6834"];
const MAX_SERIES = 6;
const WEEK_OPTIONS = [4, 8, 12, 16] as const;

type Metric = "asana" | "hubstaff";

interface TrendPoint { weekStartISO: string; asanaCompleted: number | null; hubstaffHours: number | null }
interface TrendSeries { id: string; name: string; email: string; points: TrendPoint[] }
interface TrendResult { weeks: string[]; series: TrendSeries[]; errors: { asana?: string; hubstaff?: string } }

function fmtWeek(iso: string): string {
  const d = new Date(`${iso}T00:00:00Z`);
  const mo = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][d.getUTCMonth()];
  return `${d.getUTCDate()} ${mo}`;
}

function metricValue(p: TrendPoint, metric: Metric): number | null {
  return metric === "asana" ? p.asanaCompleted : p.hubstaffHours;
}

// SVG multi-line chart — one line per selected bookkeeper across weeks, for
// whichever metric (Asana completions or Hubstaff hours) is toggled. A
// vertical crosshair + tooltip follows the pointer (line charts get hover by
// default); a legend and a full data table are always present alongside it.
function LineChart({ weeks, series, metric, colorOf }: { weeks: string[]; series: TrendSeries[]; metric: Metric; colorOf: (i: number) => string }) {
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);
  const W = 640, H = 240, padL = 36, padR = 12, padT = 12, padB = 28;
  const plotW = W - padL - padR, plotH = H - padT - padB;

  const allValues = series.flatMap((s) => s.points.map((p) => metricValue(p, metric) ?? 0));
  const maxVal = Math.max(...allValues, 1);
  const niceMax = maxVal <= 5 ? Math.ceil(maxVal) || 1 : Math.ceil(maxVal * 1.1);

  const xAt = (i: number) => padL + (weeks.length <= 1 ? plotW / 2 : (i / (weeks.length - 1)) * plotW);
  const yAt = (v: number) => padT + plotH - (v / niceMax) * plotH;

  const yTicks = [0, 0.25, 0.5, 0.75, 1].map((f) => Math.round(niceMax * f));

  const onMove = (e: React.MouseEvent<SVGSVGElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const relX = ((e.clientX - rect.left) / rect.width) * W;
    const frac = (relX - padL) / plotW;
    const idx = Math.round(frac * (weeks.length - 1));
    setHoverIdx(Math.max(0, Math.min(weeks.length - 1, idx)));
  };

  return (
    <div style={{ position: "relative" }}>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        style={{ width: "100%", height: "auto", display: "block" }}
        onMouseMove={onMove}
        onMouseLeave={() => setHoverIdx(null)}
      >
        {/* recessive gridlines + y-axis labels */}
        {yTicks.map((t) => (
          <g key={t}>
            <line x1={padL} x2={W - padR} y1={yAt(t)} y2={yAt(t)} stroke="var(--border-soft)" strokeWidth={1} />
            <text x={padL - 6} y={yAt(t) + 3} textAnchor="end" fontSize={9} fill="var(--text-3)">{t}</text>
          </g>
        ))}
        {/* x-axis week labels (thinned if crowded) */}
        {weeks.map((w, i) => {
          const every = weeks.length > 10 ? Math.ceil(weeks.length / 8) : 1;
          if (i % every !== 0) return null;
          return <text key={w} x={xAt(i)} y={H - 8} textAnchor="middle" fontSize={9} fill="var(--text-3)">{fmtWeek(w)}</text>;
        })}

        {/* hover crosshair */}
        {hoverIdx != null && (
          <line x1={xAt(hoverIdx)} x2={xAt(hoverIdx)} y1={padT} y2={padT + plotH} stroke="var(--border)" strokeWidth={1} strokeDasharray="3,3" />
        )}

        {/* one line + markers per bookkeeper */}
        {series.map((s, i) => {
          const color = colorOf(i);
          const path = s.points.map((p, wi) => `${wi === 0 ? "M" : "L"} ${xAt(wi)} ${yAt(metricValue(p, metric) ?? 0)}`).join(" ");
          return (
            <g key={s.id}>
              <path d={path} fill="none" stroke={color} strokeWidth={2} />
              {s.points.map((p, wi) => (
                <circle key={wi} cx={xAt(wi)} cy={yAt(metricValue(p, metric) ?? 0)} r={hoverIdx === wi ? 4.5 : 3.5} fill={color} stroke="#1e2038" strokeWidth={1.2} />
              ))}
            </g>
          );
        })}
      </svg>

      {hoverIdx != null && (
        <div style={{ position: "absolute", top: 4, right: 8, background: "var(--tooltip-bg)", color: "#fff", fontSize: 11, lineHeight: 1.5, padding: "8px 11px", borderRadius: 6, pointerEvents: "none", minWidth: 140 }}>
          <div style={{ fontWeight: 700, marginBottom: 3 }}>Week of {fmtWeek(weeks[hoverIdx])}</div>
          {series.map((s, i) => (
            <div key={s.id} style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
              <span><span style={{ display: "inline-block", width: 8, height: 8, borderRadius: "50%", background: colorOf(i), marginRight: 6 }} />{displayName(s.name)}</span>
              <span>{metricValue(s.points[hoverIdx], metric) ?? "—"}{metric === "hubstaff" ? "h" : ""}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export function PerformanceTrendChart() {
  const [weeksCount, setWeeksCount] = useState<number>(8);
  const [metric, setMetric] = useState<Metric>("asana");
  const [data, setData] = useState<TrendResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const seededRef = useRef(false);

  const load = useCallback(async (weeks: number) => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/bookkeepers/trend?weeks=${weeks}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json() as TrendResult;
      setData(json);
      // Default to the 4 busiest bookkeepers (by total activity) the first
      // time data loads, so the chart isn't empty before anyone picks anyone.
      if (!seededRef.current) {
        seededRef.current = true;
        const ranked = [...json.series].sort((a, b) => {
          const totalOf = (s: TrendSeries) => s.points.reduce((sum, p) => sum + (p.asanaCompleted ?? 0) + (p.hubstaffHours ?? 0), 0);
          return totalOf(b) - totalOf(a);
        });
        setSelectedIds(ranked.slice(0, 4).map((s) => s.id));
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  // Fetch on mount and whenever the weeks-count selector changes.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { load(weeksCount); }, [weeksCount, load]);

  const colorOf = (i: number) => PALETTE[i % PALETTE.length];

  const selectedSeries = useMemo(() => {
    if (!data) return [];
    const byId = new Map(data.series.map((s) => [s.id, s]));
    return selectedIds.map((id) => byId.get(id)).filter((s): s is TrendSeries => !!s);
  }, [data, selectedIds]);

  const atCap = selectedIds.length >= MAX_SERIES;
  const availableToAdd = data?.series.filter((s) => !selectedIds.includes(s.id)) ?? [];

  const addBookkeeper = (id: string) => {
    if (!id || atCap || selectedIds.includes(id)) return;
    setSelectedIds((prev) => [...prev, id]);
  };
  const removeBookkeeper = (id: string) => setSelectedIds((prev) => prev.filter((x) => x !== id));

  return (
    <div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 10, alignItems: "center", marginBottom: 14 }}>
        <div className="acTabBar" style={{ marginBottom: 0 }}>
          <button className={`acTab ${metric === "asana" ? "acTabActive" : ""}`} onClick={() => setMetric("asana")}>Tasks completed (Asana)</button>
          <button className={`acTab ${metric === "hubstaff" ? "acTabActive" : ""}`} onClick={() => setMetric("hubstaff")}>Hours tracked (Hubstaff)</button>
        </div>
        <span style={{ flex: 1 }} />
        <div className="acTabBar" style={{ marginBottom: 0 }}>
          {WEEK_OPTIONS.map((w) => (
            <button key={w} className={`acTab ${weeksCount === w ? "acTabActive" : ""}`} onClick={() => setWeeksCount(w)}>{w}w</button>
          ))}
        </div>
      </div>

      <div style={{ display: "flex", flexWrap: "wrap", gap: 10, alignItems: "center", marginBottom: 14 }}>
        <select className="dpRangeInput" value="" disabled={atCap || !data} onChange={(e) => { addBookkeeper(e.target.value); e.target.value = ""; }} style={{ minWidth: 190 }}>
          <option value="">{atCap ? `Max ${MAX_SERIES} bookkeepers` : "+ Add a bookkeeper to compare…"}</option>
          {availableToAdd.map((s) => <option key={s.id} value={s.id}>{displayName(s.name)}</option>)}
        </select>
      </div>

      <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 18 }}>
        {selectedSeries.map((s, i) => (
          <span key={s.id} style={{ display: "inline-flex", alignItems: "center", gap: 7, background: "var(--surface-2)", border: "1px solid var(--border)", borderRadius: 16, padding: "4px 6px 4px 11px", fontSize: 12 }}>
            <span style={{ width: 9, height: 9, borderRadius: "50%", background: colorOf(i) }} />
            <Link href={`/dashboard/asana/person/${s.id}`} className="dpDrillBtn" style={{ fontSize: 12 }}>{displayName(s.name)}</Link>
            <button onClick={() => removeBookkeeper(s.id)} aria-label={`Remove ${s.name}`} style={{ border: "none", background: "none", cursor: "pointer", color: "var(--text-3)", fontSize: 15, lineHeight: 1, padding: "0 2px" }}>×</button>
          </span>
        ))}
        {selectedSeries.length === 0 && !loading && <span style={{ fontSize: 12, color: "var(--text-3)" }}>Add bookkeepers above to compare their trends.</span>}
      </div>

      {loading ? (
        <div className="dpEmpty">Loading trend data…</div>
      ) : error ? (
        <div className="dpEmpty">Couldn&apos;t load trend data ({error}).</div>
      ) : !data || selectedSeries.length === 0 ? (
        <div className="dpEmpty">No bookkeepers selected.</div>
      ) : (
        <>
          <LineChart weeks={data.weeks} series={selectedSeries} metric={metric} colorOf={colorOf} />
          <table className="dpTable" style={{ marginTop: 18 }}>
            <thead>
              <tr>
                <th>Bookkeeper</th>
                {data.weeks.map((w) => <th key={w} style={{ textAlign: "right", fontSize: 11 }}>{fmtWeek(w)}</th>)}
              </tr>
            </thead>
            <tbody>
              {selectedSeries.map((s, i) => (
                <tr key={s.id}>
                  <td className="dpPrimary"><span style={{ display: "inline-block", width: 9, height: 9, borderRadius: "50%", background: colorOf(i), marginRight: 8 }} />{displayName(s.name)}</td>
                  {s.points.map((p, wi) => (
                    <td key={wi} className="dpMuted" style={{ textAlign: "right" }}>{metricValue(p, metric) ?? "—"}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
      <div style={{ fontSize: 11, color: "var(--text-3)", marginTop: 10 }}>
        Weekly totals, Monday-start · Asana counts tasks completed that week · Hubstaff hours are weekdays only.
        {data?.errors.asana && <span style={{ color: "#f87171" }}> Asana: {data.errors.asana}.</span>}
        {data?.errors.hubstaff && <span style={{ color: "#f87171" }}> Hubstaff: {data.errors.hubstaff}.</span>}
      </div>
    </div>
  );
}
