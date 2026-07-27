"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { auTodayISODateClient } from "@/lib/business-tz-client";

// Validated categorical palette (dataviz skill reference theme, first 6 slots,
// in their CVD-safe order — verified with scripts/validate_palette.js). Each
// period keeps its color across the bar↔pie toggle so identity is stable.
const PALETTE = ["#2a78d6", "#008300", "#e87ba4", "#eda100", "#1baf7a", "#eb6834"];
const MAX_PERIODS = 6;

type ChartType = "bar" | "pie";

interface Period {
  id: string;
  label: string;
  start: string;
  end: string;
  hours: number | null;
  activityPct: number | null;
  loading: boolean;
  error?: string;
}

// ── Date math (UTC-parsed to avoid machine-tz drift; anchored to AU today) ──
function iso(d: Date): string { return d.toISOString().slice(0, 10); }
function parse(s: string): Date { return new Date(`${s}T00:00:00Z`); }
function addDays(s: string, n: number): string { const d = parse(s); d.setUTCDate(d.getUTCDate() + n); return iso(d); }
function monthStart(s: string): string { return `${s.slice(0, 7)}-01`; }

interface PresetDef { key: string; label: string; range: (today: string) => { start: string; end: string } }

const PRESETS: PresetDef[] = [
  { key: "last_7",  label: "Last 7 days",      range: (t) => ({ start: addDays(t, -6), end: t }) },
  { key: "prev_7",  label: "Previous 7 days",  range: (t) => ({ start: addDays(t, -13), end: addDays(t, -7) }) },
  { key: "last_14", label: "Last 14 days",     range: (t) => ({ start: addDays(t, -13), end: t }) },
  { key: "last_30", label: "Last 30 days",     range: (t) => ({ start: addDays(t, -29), end: t }) },
  { key: "prev_30", label: "Previous 30 days", range: (t) => ({ start: addDays(t, -59), end: addDays(t, -30) }) },
  { key: "this_week", label: "This week", range: (t) => { const dow = parse(t).getUTCDay() || 7; return { start: addDays(t, -(dow - 1)), end: t }; } },
  { key: "last_week", label: "Last week", range: (t) => { const dow = parse(t).getUTCDay() || 7; const mon = addDays(t, -(dow - 1)); return { start: addDays(mon, -7), end: addDays(mon, -1) }; } },
  { key: "this_month", label: "This month", range: (t) => ({ start: monthStart(t), end: t }) },
  { key: "last_month", label: "Last month", range: (t) => { const prevEnd = addDays(monthStart(t), -1); return { start: monthStart(prevEnd), end: prevEnd }; } },
  { key: "this_quarter", label: "This quarter", range: (t) => { const d = parse(t); const qm = Math.floor(d.getUTCMonth() / 3) * 3; return { start: `${d.getUTCFullYear()}-${String(qm + 1).padStart(2, "0")}-01`, end: t }; } },
  { key: "last_quarter", label: "Last quarter", range: (t) => { const d = parse(t); const qm = Math.floor(d.getUTCMonth() / 3) * 3; const thisQStart = `${d.getUTCFullYear()}-${String(qm + 1).padStart(2, "0")}-01`; const prevEnd = addDays(thisQStart, -1); const pd = parse(prevEnd); const pqm = Math.floor(pd.getUTCMonth() / 3) * 3; return { start: `${pd.getUTCFullYear()}-${String(pqm + 1).padStart(2, "0")}-01`, end: prevEnd }; } },
];

function fmtShort(s: string): string {
  const d = parse(s);
  const mo = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][d.getUTCMonth()];
  return `${d.getUTCDate()} ${mo}`;
}

function arcPath(cx: number, cy: number, r: number, a0: number, a1: number): string {
  const rad = (a: number) => ((a - 90) * Math.PI) / 180;
  const x1 = cx + r * Math.cos(rad(a0)), y1 = cy + r * Math.sin(rad(a0));
  const x2 = cx + r * Math.cos(rad(a1)), y2 = cy + r * Math.sin(rad(a1));
  const large = a1 - a0 > 180 ? 1 : 0;
  return `M ${cx} ${cy} L ${x1} ${y1} A ${r} ${r} 0 ${large} 1 ${x2} ${y2} Z`;
}

// Cumulative pie slice angles — module-scoped (not in render) so the running
// accumulator can be reassigned without tripping React's immutability rule.
function computeSlices(shown: { p: Period; i: number }[], totalHours: number) {
  let angle = 0;
  return shown.map(({ p, i }) => {
    const frac = (p.hours ?? 0) / (totalHours || 1);
    const a0 = angle, a1 = angle + frac * 360;
    angle = a1;
    return { p, i, a0, a1, frac };
  });
}

let seq = 0;

export function PeriodComparison() {
  const today = auTodayISODateClient();
  const [periods, setPeriods] = useState<Period[]>([]);
  const [chartType, setChartType] = useState<ChartType>("bar");
  const [customStart, setCustomStart] = useState("");
  const [customEnd, setCustomEnd] = useState("");
  const seeded = useRef(false);

  const addPeriod = useCallback(async (label: string, start: string, end: string) => {
    const id = `p${++seq}`;
    setPeriods((prev) => (prev.length >= MAX_PERIODS ? prev : [...prev, { id, label, start, end, hours: null, activityPct: null, loading: true }]));
    try {
      const res = await fetch(`/api/hubstaff/period?start=${start}&end=${end}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const d = await res.json() as { hours: number; activityPct: number | null; error?: string };
      setPeriods((prev) => prev.map((p) => p.id === id ? { ...p, hours: d.hours, activityPct: d.activityPct, loading: false, error: d.error } : p));
    } catch (e) {
      setPeriods((prev) => prev.map((p) => p.id === id ? { ...p, loading: false, error: (e as Error).message } : p));
    }
  }, []);

  // Seed with an obvious default comparison (this vs previous 7 days) so the
  // section isn't empty on first load.
  useEffect(() => {
    if (seeded.current) return;
    seeded.current = true;
    const l7 = PRESETS.find((p) => p.key === "last_7")!.range(today);
    const p7 = PRESETS.find((p) => p.key === "prev_7")!.range(today);
    addPeriod("Last 7 days", l7.start, l7.end);
    addPeriod("Previous 7 days", p7.start, p7.end);
  }, [today, addPeriod]);

  const onPickPreset = (key: string) => {
    if (key === "custom") return;
    const preset = PRESETS.find((p) => p.key === key);
    if (!preset) return;
    const { start, end } = preset.range(today);
    addPeriod(preset.label, start, end);
  };

  const addCustom = () => {
    if (!customStart || !customEnd || customStart > customEnd) return;
    addPeriod(`${fmtShort(customStart)} – ${fmtShort(customEnd)}`, customStart, customEnd);
    setCustomStart(""); setCustomEnd("");
  };

  const remove = (id: string) => setPeriods((prev) => prev.filter((p) => p.id !== id));

  const ready = periods.filter((p) => !p.loading && !p.error && p.hours != null);
  const maxHours = Math.max(...ready.map((p) => p.hours ?? 0), 1);
  const totalHours = ready.reduce((s, p) => s + (p.hours ?? 0), 0);
  const colorOf = (i: number) => PALETTE[i % PALETTE.length];
  const atCap = periods.length >= MAX_PERIODS;

  return (
    <div>
      {/* ── Controls ─────────────────────────────────────── */}
      <div style={{ display: "flex", flexWrap: "wrap", gap: 10, alignItems: "center", marginBottom: 16 }}>
        <select
          className="dpRangeInput"
          value=""
          disabled={atCap}
          onChange={(e) => { onPickPreset(e.target.value); e.target.value = ""; }}
          style={{ minWidth: 170 }}
        >
          <option value="">{atCap ? `Max ${MAX_PERIODS} periods` : "+ Add a period to compare…"}</option>
          {PRESETS.map((p) => <option key={p.key} value={p.key}>{p.label}</option>)}
        </select>

        <span className="dpRangeCustom" style={{ display: "flex", gap: 6, alignItems: "center" }}>
          <input className="dpRangeInput" type="date" max={today} value={customStart} onChange={(e) => setCustomStart(e.target.value)} disabled={atCap} title="Custom range start" />
          <span style={{ color: "var(--text-3)", fontSize: 12 }}>→</span>
          <input className="dpRangeInput" type="date" max={today} value={customEnd} onChange={(e) => setCustomEnd(e.target.value)} disabled={atCap} title="Custom range end" />
          <button className="acTab" onClick={addCustom} disabled={atCap || !customStart || !customEnd}>Add range</button>
        </span>

        <span style={{ flex: 1 }} />

        <div className="acTabBar" style={{ marginBottom: 0 }}>
          <button className={`acTab ${chartType === "bar" ? "acTabActive" : ""}`} onClick={() => setChartType("bar")}>Bar</button>
          <button className={`acTab ${chartType === "pie" ? "acTabActive" : ""}`} onClick={() => setChartType("pie")}>Pie</button>
        </div>
      </div>

      {/* ── Selected period chips ────────────────────────── */}
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 20 }}>
        {periods.map((p, i) => (
          <span key={p.id} style={{ display: "inline-flex", alignItems: "center", gap: 7, background: "var(--surface-2)", border: "1px solid var(--border)", borderRadius: 16, padding: "4px 6px 4px 11px", fontSize: 12 }}>
            <span style={{ width: 9, height: 9, borderRadius: "50%", background: colorOf(i) }} />
            <span style={{ fontWeight: 600, color: "var(--text-2)" }}>{p.label}</span>
            <span style={{ color: "var(--text-3)", fontSize: 11 }}>{p.loading ? "…" : p.error ? "error" : `${p.hours}h`}</span>
            <button onClick={() => remove(p.id)} aria-label={`Remove ${p.label}`} style={{ border: "none", background: "none", cursor: "pointer", color: "var(--text-3)", fontSize: 15, lineHeight: 1, padding: "0 2px" }}>×</button>
          </span>
        ))}
        {periods.length === 0 && <span style={{ fontSize: 12, color: "var(--text-3)" }}>Add periods above to compare them.</span>}
      </div>

      {/* ── Chart ────────────────────────────────────────── */}
      {ready.length === 0 ? (
        <div className="dpEmpty">{periods.some((p) => p.loading) ? "Loading periods…" : "No comparable data yet."}</div>
      ) : chartType === "bar" ? (
        <BarView periods={periods} maxHours={maxHours} colorOf={colorOf} />
      ) : (
        <PieView periods={periods} totalHours={totalHours} colorOf={colorOf} />
      )}

      {/* ── Table (always present — also the accessibility relief for the
             low-contrast palette slots) ──────────────────── */}
      {ready.length > 0 && (
        <table className="dpTable" style={{ marginTop: 22 }}>
          <thead><tr><th>Period</th><th>Dates</th><th>Tracked hrs</th><th>Activity</th>{chartType === "pie" && <th>Share</th>}</tr></thead>
          <tbody>
            {periods.filter((p) => !p.loading).map((p, i) => (
              <tr key={p.id}>
                <td className="dpPrimary"><span style={{ display: "inline-block", width: 9, height: 9, borderRadius: "50%", background: colorOf(i), marginRight: 8 }} />{p.label}</td>
                <td className="dpMuted" style={{ fontSize: 12 }}>{fmtShort(p.start)} – {fmtShort(p.end)}</td>
                <td className="dpMuted">{p.error ? "—" : `${p.hours}h`}</td>
                <td className="dpMuted">{p.activityPct != null ? `${p.activityPct}%` : "—"}</td>
                {chartType === "pie" && <td className="dpMuted">{p.hours != null && totalHours > 0 ? `${Math.round((p.hours / totalHours) * 100)}%` : "—"}</td>}
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <div style={{ fontSize: 11, color: "var(--text-3)", marginTop: 10 }}>Tracked hours, weekdays only. Pie shows each period&apos;s share of the combined total.</div>
    </div>
  );
}

function BarView({ periods, maxHours, colorOf }: { periods: Period[]; maxHours: number; colorOf: (i: number) => string }) {
  const shown = periods.filter((p) => !p.loading && !p.error);
  return (
    <div style={{ display: "flex", alignItems: "flex-end", gap: 14, height: 220, borderBottom: "1px solid var(--border)" }}>
      {shown.map((p) => {
        const h = p.hours ?? 0;
        const pct = (h / maxHours) * 100;
        return (
          <div key={p.id} style={{ flex: 1, display: "flex", flexDirection: "column", justifyContent: "flex-end", alignItems: "center", height: "100%", minWidth: 0 }} title={`${p.label}: ${h}h${p.activityPct != null ? `, ${p.activityPct}% activity` : ""}`}>
            <div style={{ fontSize: 12, fontWeight: 700, color: "var(--text-2)", marginBottom: 4 }}>{h}h</div>
            <div style={{ width: "100%", maxWidth: 90, height: `${Math.max(pct, 1)}%`, background: colorOf(periods.indexOf(p)), borderRadius: "4px 4px 0 0" }} />
            <div style={{ fontSize: 11, color: "var(--text-3)", marginTop: 6, textAlign: "center", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", maxWidth: 110 }}>{p.label}</div>
          </div>
        );
      })}
    </div>
  );
}

function PieView({ periods, totalHours, colorOf }: { periods: Period[]; totalHours: number; colorOf: (i: number) => string }) {
  const shown = periods.map((p, i) => ({ p, i })).filter(({ p }) => !p.loading && !p.error && (p.hours ?? 0) > 0);
  const size = 220, r = 100, cx = size / 2, cy = size / 2;
  const slices = computeSlices(shown, totalHours);
  const single = slices.length === 1;

  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: 32, alignItems: "center" }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} role="img" aria-label="Tracked hours share by period">
        {single ? (
          <circle cx={cx} cy={cy} r={r} fill={colorOf(slices[0].i)} />
        ) : (
          slices.map((s) => (
            <path key={s.p.id} d={arcPath(cx, cy, r, s.a0, s.a1)} fill={colorOf(s.i)} stroke="#1e2038" strokeWidth={2}>
              <title>{`${s.p.label}: ${s.p.hours}h (${Math.round(s.frac * 100)}%)`}</title>
            </path>
          ))
        )}
      </svg>
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {slices.map((s) => (
          <div key={s.p.id} style={{ display: "flex", alignItems: "center", gap: 9, fontSize: 13 }}>
            <span style={{ width: 12, height: 12, borderRadius: 3, background: colorOf(s.i), flexShrink: 0 }} />
            <span style={{ fontWeight: 600, color: "var(--text-2)" }}>{s.p.label}</span>
            <span style={{ color: "var(--text-3)" }}>{s.p.hours}h · {Math.round(s.frac * 100)}%</span>
          </div>
        ))}
      </div>
    </div>
  );
}
