"use client";

import { useState } from "react";

export interface MonthSeries {
  key: string;
  label: string;
  color: string;
}

// Compact vertical month-by-month bar chart (the "months analysis" style from
// Asana's own reporting) supporting one or two series side by side. Direct
// value labels on each bar; a legend renders whenever there are 2 series so
// identity is never color-alone; hover highlights a month and shows a tooltip.
export function MonthlyBars<T extends { month: string }>({
  data,
  series,
  height = 150,
}: {
  data: T[];
  series: MonthSeries[];
  height?: number;
}) {
  const [hover, setHover] = useState<number | null>(null);
  const valueOf = (d: T, key: string) => Number((d as Record<string, unknown>)[key]) || 0;
  const max = Math.max(...data.flatMap((d) => series.map((s) => valueOf(d, s.key))), 1);

  const fmtMonth = (m: string) => {
    const names = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    return names[Number(m.slice(5, 7)) - 1];
  };

  return (
    <div>
      {series.length > 1 && (
        <div style={{ display: "flex", gap: 14, marginBottom: 8 }}>
          {series.map((s) => (
            <span key={s.key} style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 11, color: "var(--text-2)" }}>
              <span style={{ width: 10, height: 10, borderRadius: 3, background: s.color }} />{s.label}
            </span>
          ))}
        </div>
      )}
      <div style={{ display: "flex", alignItems: "flex-end", gap: 6, height, borderBottom: "1px solid var(--border)" }}>
        {data.map((d, i) => {
          const active = hover === i;
          return (
            <div
              key={d.month}
              style={{ flex: 1, display: "flex", alignItems: "flex-end", justifyContent: "center", gap: 2, height: "100%", position: "relative", minWidth: 0, background: active ? "var(--surface-2)" : undefined, borderRadius: 4 }}
              onMouseEnter={() => setHover(i)}
              onMouseLeave={() => setHover(null)}
            >
              {active && (
                <div style={{ position: "absolute", bottom: "100%", marginBottom: 4, background: "var(--tooltip-bg)", color: "#fff", fontSize: 10, lineHeight: 1.5, padding: "5px 8px", borderRadius: 5, whiteSpace: "nowrap", zIndex: 2 }}>
                  <div style={{ fontWeight: 700 }}>{fmtMonth(d.month)} {d.month.slice(0, 4)}</div>
                  {series.map((s) => <div key={s.key}>{s.label}: {valueOf(d, s.key)}</div>)}
                </div>
              )}
              {series.map((s) => {
                const v = valueOf(d, s.key);
                const pct = (v / max) * 100;
                return (
                  <div key={s.key} style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "flex-end", height: "100%", width: series.length > 1 ? "38%" : "55%", maxWidth: 26 }}>
                    {v > 0 && <div style={{ fontSize: 8.5, fontWeight: 700, color: "var(--text-2)", marginBottom: 2 }}>{v}</div>}
                    <div style={{ width: "100%", height: `${Math.max(pct, v > 0 ? 2 : 0)}%`, background: s.color, borderRadius: "3px 3px 0 0" }} />
                  </div>
                );
              })}
            </div>
          );
        })}
      </div>
      <div style={{ display: "flex", gap: 6, marginTop: 4 }}>
        {data.map((d) => (
          <div key={d.month} style={{ flex: 1, textAlign: "center", fontSize: 9, color: "var(--text-3)", minWidth: 0, overflow: "hidden" }}>{fmtMonth(d.month)}</div>
        ))}
      </div>
    </div>
  );
}
