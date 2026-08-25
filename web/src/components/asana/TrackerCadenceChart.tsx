"use client";

import { useState, useEffect } from "react";

interface CadencePeriod {
  period: string;
  sortKey: string;
  dueDate: string | null;
  total: number;
  completed: number;
  open: number;
  lateOpen: number;
}
interface TrackerCadence {
  key: string;
  label: string;
  rule: string;
  periods: CadencePeriod[];
  unsectioned: number;
  error?: string;
}

const DUE_COLOR = "#fbbf24";
const DONE_COLOR = "#34d399";

function fmtDue(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(`${iso}T00:00:00Z`);
  const mo = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][d.getUTCMonth()];
  return `${d.getUTCDate()} ${mo} ${d.getUTCFullYear()}`;
}

// Per-quarter "due vs completed" for one tracker. Grouped bars (all client
// rows in that quarter vs how many are done) with the quarter's real
// deadline underneath and a late count when the deadline has passed.
function CadenceBars({ t }: { t: TrackerCadence }) {
  const [hover, setHover] = useState<number | null>(null);
  const max = Math.max(...t.periods.map((p) => p.total), 1);
  const H = 260; // full-width row now, so the bars get real vertical space

  return (
    <div>
      <div style={{ display: "flex", gap: 14, marginBottom: 10 }}>
        {[{ c: DUE_COLOR, l: "Due" }, { c: DONE_COLOR, l: "Completed" }].map((s) => (
          <span key={s.l} style={{ display: "inline-flex", alignItems: "center", gap: 7, fontSize: 12, color: "var(--text-2)" }}>
            <span style={{ width: 10, height: 10, borderRadius: 3, background: s.c }} />{s.l}
          </span>
        ))}
      </div>

      <div style={{ display: "flex", alignItems: "flex-end", gap: 18, height: H, borderBottom: "1px solid var(--border)", padding: "0 8px" }}>
        {t.periods.map((p, i) => {
          const active = hover === i;
          return (
            <div
              key={p.sortKey}
              style={{ flex: 1, display: "flex", alignItems: "flex-end", justifyContent: "center", gap: 8, height: "100%", position: "relative", minWidth: 0, background: active ? "var(--hover)" : undefined, borderRadius: 6 }}
              onMouseEnter={() => setHover(i)}
              onMouseLeave={() => setHover(null)}
            >
              {active && (
                <div style={{ position: "absolute", bottom: "100%", marginBottom: 4, background: "var(--tooltip-bg)", color: "#fff", fontSize: 12, lineHeight: 1.55, padding: "9px 12px", borderRadius: 5, whiteSpace: "nowrap", zIndex: 3 }}>
                  <div style={{ fontWeight: 700 }}>{p.period}</div>
                  <div>Due by {fmtDue(p.dueDate)}</div>
                  <div>{p.completed} of {p.total} complete</div>
                  {p.lateOpen > 0 && <div style={{ color: "#fca5a5" }}>{p.lateOpen} still open past deadline</div>}
                </div>
              )}
              {([{ v: p.total, c: DUE_COLOR }, { v: p.completed, c: DONE_COLOR }]).map((b, bi) => (
                <div key={bi} style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "flex-end", height: "100%", width: "38%", maxWidth: 64 }}>
                  <div style={{ fontSize: 15, fontWeight: 750, color: "var(--text-1)", marginBottom: 4, fontVariantNumeric: "tabular-nums" }}>{b.v}</div>
                  <div style={{ width: "100%", height: `${Math.max((b.v / max) * 100, b.v > 0 ? 2 : 0)}%`, background: b.c, borderRadius: "5px 5px 0 0" }} />
                </div>
              ))}
            </div>
          );
        })}
      </div>

      <div style={{ display: "flex", gap: 18, marginTop: 8, padding: "0 8px" }}>
        {t.periods.map((p) => (
          <div key={p.sortKey} style={{ flex: 1, textAlign: "center", minWidth: 0 }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: "var(--text-1)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{p.period}</div>
            <div style={{ fontSize: 11, color: "var(--text-3)", whiteSpace: "nowrap", marginTop: 2 }}>due {fmtDue(p.dueDate)}</div>
            {p.lateOpen > 0 && <div style={{ fontSize: 11, color: "#f87171", fontWeight: 700, marginTop: 2 }}>{p.lateOpen} late</div>}
          </div>
        ))}
      </div>
    </div>
  );
}

export function TrackerCadenceChart({ trackerKey }: { trackerKey: string }) {
  const [data, setData] = useState<TrackerCadence[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/asana/tracker-cadence");
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const json = await res.json() as { trackers: TrackerCadence[] };
        if (!cancelled) setData(json.trackers);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const t = data?.find((x) => x.key === trackerKey);

  if (error) return <div className="dpEmpty" style={{ padding: "12px 0" }}>Couldn&apos;t load period analysis ({error}).</div>;
  if (!data) return <div className="dpEmpty" style={{ padding: "12px 0" }}>Loading period analysis…</div>;
  if (!t) return null;
  if (t.error) return <div className="dpEmpty" style={{ padding: "12px 0" }}>Period analysis unavailable ({t.error}).</div>;
  if (t.periods.length === 0) return <div className="dpEmpty" style={{ padding: "12px 0" }}>No quarter sections found in this tracker.</div>;

  const totalDone = t.periods.reduce((s, p) => s + p.completed, 0);
  const totalAll = t.periods.reduce((s, p) => s + p.total, 0);
  const totalLate = t.periods.reduce((s, p) => s + p.lateOpen, 0);

  return (
    <div>
      <CadenceBars t={t} />
      <div style={{ fontSize: 12, color: "var(--text-3)", marginTop: 14, lineHeight: 1.6 }}>
        {t.rule}.
        <br />
        <strong style={{ color: totalLate > 0 ? "#f87171" : "var(--text-2)" }}>
          {totalDone} of {totalAll} complete across all quarters{totalLate > 0 ? ` · ${totalLate} still open past their deadline` : ""}
        </strong>
        {t.unsectioned > 0 && <> · {t.unsectioned} task{t.unsectioned !== 1 ? "s" : ""} sit outside a quarter section and aren&apos;t counted.</>}
      </div>
    </div>
  );
}
