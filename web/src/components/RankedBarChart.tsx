"use client";

import { useState, Fragment } from "react";
import Link from "next/link";

export interface RankedRow {
  id?: string;
  label: string;
  href?: string;             // optional drill-down link on the bookkeeper name
  // Rows that aren't a person (e.g. "Unmapped") have no page to link to, but
  // still need to be actionable — set this and the label renders as a button
  // that the caller handles (typically by revealing the rows behind it).
  onSelect?: () => void;
  selected?: boolean;
  values: Record<string, number>;
}

export interface RankedMetric {
  key: string;
  label: string;
  unit?: string;             // e.g. "h" or "%" appended to the value
  color: string;
}

// A ranked horizontal bar chart broken down by bookkeeper (or any label) —
// one bar per row, sorted highest-first for the selected metric, with the
// value printed at the end of each bar. Single hue per metric (identity is
// the row label, so no categorical palette needed); rows with a zero value
// for the active metric are hidden to keep the ranking clean. When more than
// one metric is supplied, a toggle switches which one the bars show.
export function RankedBarChart({ rows, metrics, ordered = false }: { rows: RankedRow[]; metrics: RankedMetric[]; ordered?: boolean }) {
  const [metricKey, setMetricKey] = useState(metrics[0].key);
  const metric = metrics.find((m) => m.key === metricKey) ?? metrics[0];

  // ordered = keep the caller's row order and show zero rows too — for
  // sequential categories like age buckets, where sorting by value and
  // hiding empty bands would scramble the story the order itself tells.
  const sorted = ordered
    ? rows
    : rows
        .filter((r) => (r.values[metric.key] ?? 0) > 0)
        .sort((a, b) => (b.values[metric.key] ?? 0) - (a.values[metric.key] ?? 0));
  const max = Math.max(...sorted.map((r) => r.values[metric.key] ?? 0), 1);

  return (
    <div>
      {metrics.length > 1 && (
        <div className="acTabBar" style={{ marginBottom: 16 }}>
          {metrics.map((m) => (
            <button key={m.key} className={`acTab ${m.key === metricKey ? "acTabActive" : ""}`} onClick={() => setMetricKey(m.key)}>
              {m.label}
            </button>
          ))}
        </div>
      )}

      {sorted.length === 0 ? (
        <div className="dpEmpty">Nothing to show for {metric.label.toLowerCase()}.</div>
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "auto 1fr auto", alignItems: "center", columnGap: 12, rowGap: 8 }}>
          {sorted.map((r) => {
            const v = r.values[metric.key] ?? 0;
            const pct = (v / max) * 100;
            const tip = `${r.label}: ${v}${metric.unit ?? ""}`;
            return (
              <Fragment key={r.id ?? r.label}>
                <div title={tip} style={{ fontSize: 13, whiteSpace: "nowrap" }}>
                  {r.href ? (
                    <Link href={r.href} className="dpDrillBtn">{r.label}</Link>
                  ) : r.onSelect ? (
                    <button
                      type="button"
                      onClick={r.onSelect}
                      className="dpDrillBtn"
                      aria-expanded={!!r.selected}
                      style={{ cursor: "pointer", font: "inherit" }}
                    >
                      {r.label}
                    </button>
                  ) : (
                    <span style={{ color: "var(--text-1)", fontWeight: 500 }}>{r.label}</span>
                  )}
                </div>
                <div title={tip} style={{ background: "var(--surface-2)", borderRadius: 4, height: 22, position: "relative", minWidth: 0 }}>
                  <div style={{ position: "absolute", left: 0, top: 0, height: "100%", width: `${Math.max(pct, 1.5)}%`, background: metric.color, borderRadius: 4 }} />
                </div>
                <div title={tip} style={{ textAlign: "right", fontSize: 13, fontWeight: 700, color: "var(--text-2)" }}>
                  {v}{metric.unit ?? ""}
                </div>
              </Fragment>
            );
          })}
        </div>
      )}
    </div>
  );
}
