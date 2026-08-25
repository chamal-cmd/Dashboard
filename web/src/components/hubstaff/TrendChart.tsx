"use client";

import { useState } from "react";
import type { HubstaffTrendPoint } from "@/lib/data/hubstaff";

type Grouping = "day" | "week";

interface Bar {
  key: string;
  label: string;      // short axis label
  fullLabel: string;  // tooltip label
  hours: number;
  activityPct: number | null;
}

const ACCENT = "#4f8ef7"; // Hubstaff blue — single series, so one hue is correct

function fmtDayLabel(iso: string): { label: string; full: string } {
  const d = new Date(`${iso}T00:00:00Z`);
  const wd = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][d.getUTCDay()];
  const mo = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][d.getUTCMonth()];
  return { label: `${wd} ${d.getUTCDate()}`, full: `${wd}, ${d.getUTCDate()} ${mo}` };
}

// ISO-week key (year + week number) so weeks group correctly across month/year
// boundaries; label shows the Monday of that week.
function isoWeek(iso: string): { key: string; mondayISO: string } {
  const d = new Date(`${iso}T00:00:00Z`);
  const day = d.getUTCDay() === 0 ? 7 : d.getUTCDay(); // Mon=1..Sun=7
  const monday = new Date(d);
  monday.setUTCDate(d.getUTCDate() - (day - 1));
  const thursday = new Date(monday);
  thursday.setUTCDate(monday.getUTCDate() + 3);
  const yearStart = new Date(Date.UTC(thursday.getUTCFullYear(), 0, 1));
  const week = Math.ceil((((thursday.getTime() - yearStart.getTime()) / 86400000) + 1) / 7);
  return { key: `${thursday.getUTCFullYear()}-W${week}`, mondayISO: monday.toISOString().slice(0, 10) };
}

function buildBars(trend: HubstaffTrendPoint[], grouping: Grouping): Bar[] {
  if (grouping === "day") {
    return trend.map((p) => {
      const { label, full } = fmtDayLabel(p.date);
      return { key: p.date, label, fullLabel: full, hours: p.hours, activityPct: p.activityPct };
    });
  }
  // Weekly: sum hours, hours-weight the activity average across the week.
  const byWeek = new Map<string, { mondayISO: string; hours: number; actNum: number; actDen: number }>();
  for (const p of trend) {
    const { key, mondayISO } = isoWeek(p.date);
    const cur = byWeek.get(key) ?? { mondayISO, hours: 0, actNum: 0, actDen: 0 };
    cur.hours += p.hours;
    if (p.activityPct != null) { cur.actNum += p.activityPct * p.hours; cur.actDen += p.hours; }
    byWeek.set(key, cur);
  }
  return [...byWeek.entries()]
    .sort((a, b) => a[1].mondayISO.localeCompare(b[1].mondayISO))
    .map(([key, v]) => {
      const { label } = fmtDayLabel(v.mondayISO);
      return {
        key,
        label: `wk ${label.split(" ")[1]}`,
        fullLabel: `Week of ${label}`,
        hours: Math.round(v.hours * 10) / 10,
        activityPct: v.actDen > 0 ? Math.round(v.actNum / v.actDen) : null,
      };
    });
}

// A bar chart comparing tracked hours across periods — one bar per weekday, or
// per ISO-week when grouped. Single series (tracked hours), so one hue and no
// legend; the value sits directly on each bar and a hover tooltip adds the
// activity %. Weekends are already excluded upstream (weekday-only Hubstaff).
export function HubstaffTrendChart({ trend }: { trend: HubstaffTrendPoint[] }) {
  const [grouping, setGrouping] = useState<Grouping>("day");
  const [hover, setHover] = useState<number | null>(null);

  if (trend.length === 0) {
    return <div className="dpEmpty">No tracked time in this period.</div>;
  }

  const bars = buildBars(trend, grouping);
  const maxHours = Math.max(...bars.map((b) => b.hours), 1);
  // Fewer bars → wider; keep labels legible by only showing every Nth label
  // when the day view gets crowded.
  const labelEvery = bars.length > 16 ? Math.ceil(bars.length / 12) : 1;

  return (
    <div>
      <div className="acTabBar" style={{ marginBottom: 18 }}>
        <button className={`acTab ${grouping === "day" ? "acTabActive" : ""}`} onClick={() => setGrouping("day")}>By day</button>
        <button className={`acTab ${grouping === "week" ? "acTabActive" : ""}`} onClick={() => setGrouping("week")}>By week</button>
      </div>

      <div style={{ display: "flex", alignItems: "flex-end", gap: 6, height: 200, borderBottom: "1px solid var(--border)", paddingBottom: 0 }}>
        {bars.map((b, i) => {
          const pct = (b.hours / maxHours) * 100;
          const active = hover === i;
          return (
            <div
              key={b.key}
              style={{ flex: 1, display: "flex", flexDirection: "column", justifyContent: "flex-end", alignItems: "center", height: "100%", position: "relative", minWidth: 0 }}
              onMouseEnter={() => setHover(i)}
              onMouseLeave={() => setHover(null)}
            >
              {active && (
                <div style={{ position: "absolute", bottom: "100%", marginBottom: 6, background: "var(--tooltip-bg)", color: "#fff", fontSize: 11, lineHeight: 1.4, padding: "6px 9px", borderRadius: 6, whiteSpace: "nowrap", zIndex: 2, textAlign: "left" }}>
                  <div style={{ fontWeight: 700 }}>{b.fullLabel}</div>
                  <div>{b.hours}h tracked</div>
                  <div>{b.activityPct != null ? `${b.activityPct}% activity` : "activity —"}</div>
                </div>
              )}
              <div style={{ fontSize: 10, fontWeight: 700, color: "var(--text-2)", marginBottom: 3 }}>{b.hours}</div>
              <div
                style={{
                  width: "100%",
                  maxWidth: 46,
                  height: `${Math.max(pct, 1)}%`,
                  background: ACCENT,
                  opacity: active ? 1 : 0.85,
                  borderRadius: "4px 4px 0 0",
                  transition: "opacity .12s",
                }}
              />
            </div>
          );
        })}
      </div>
      <div style={{ display: "flex", gap: 6, marginTop: 6 }}>
        {bars.map((b, i) => (
          <div key={b.key} style={{ flex: 1, textAlign: "center", fontSize: 9, color: "var(--text-3)", minWidth: 0, overflow: "hidden", whiteSpace: "nowrap" }}>
            {i % labelEvery === 0 ? b.label : ""}
          </div>
        ))}
      </div>
      <div style={{ fontSize: 11, color: "var(--text-3)", marginTop: 10 }}>
        Tracked hours per {grouping === "day" ? "weekday" : "week"} · hover a bar for activity %. Weekends excluded.
      </div>
    </div>
  );
}
