"use client";

import { useState, useEffect, useMemo } from "react";
import { auTodayISODateClient } from "@/lib/business-tz-client";

interface LeaveEntry {
  id: number; userId: number; name: string; email: string; pod: string | null;
  policyName: string; status: string; startDate: string; endDate: string;
  allDay: boolean; message: string | null; days: string[];
}

const MONTH_NAMES = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const DOW = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const ACCENT = "#4f8ef7"; // sequential single hue — day-cell intensity encodes headcount, no categorical color needed

function fmtRange(e: LeaveEntry): string {
  const fmt = (d: string) => { const dt = new Date(`${d}T00:00:00Z`); return `${dt.getUTCDate()} ${MONTH_NAMES[dt.getUTCMonth()].slice(0, 3)}`; };
  return e.startDate === e.endDate ? fmt(e.startDate) : `${fmt(e.startDate)} – ${fmt(e.endDate)}`;
}

// Month-grid calendar — each day cell's fill intensity encodes how many
// people are on leave that day (sequential single hue); clicking a day opens
// the roster below the grid instead of a hover tooltip, so it works on touch.
function MonthCalendar({ entries }: { entries: LeaveEntry[] }) {
  const today = auTodayISODateClient();
  const todayDate = new Date(`${today}T00:00:00Z`);
  const [year, setYear] = useState(todayDate.getUTCFullYear());
  const [month, setMonth] = useState(todayDate.getUTCMonth()); // 0-indexed
  const [selectedDay, setSelectedDay] = useState<string | null>(today);

  const byDay = useMemo(() => {
    const map = new Map<string, LeaveEntry[]>();
    for (const e of entries) {
      for (const d of e.days) {
        const arr = map.get(d) ?? [];
        arr.push(e);
        map.set(d, arr);
      }
    }
    return map;
  }, [entries]);

  const firstOfMonth = new Date(Date.UTC(year, month, 1));
  const daysInMonth = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  const leadingBlanks = firstOfMonth.getUTCDay();
  const maxCount = Math.max(...Array.from(byDay.values()).map((v) => v.length), 1);

  const cells: (string | null)[] = [...Array(leadingBlanks).fill(null)];
  for (let d = 1; d <= daysInMonth; d++) {
    cells.push(`${year}-${String(month + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`);
  }
  while (cells.length % 7 !== 0) cells.push(null);

  const goMonth = (delta: number) => {
    let m = month + delta, y = year;
    if (m < 0) { m = 11; y -= 1; } else if (m > 11) { m = 0; y += 1; }
    setMonth(m); setYear(y);
  };

  const selectedEntries = selectedDay ? (byDay.get(selectedDay) ?? []) : [];

  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
        <button className="acTab" onClick={() => goMonth(-1)}>← Prev</button>
        <div style={{ fontWeight: 700, fontSize: 14 }}>{MONTH_NAMES[month]} {year}</div>
        <button className="acTab" onClick={() => goMonth(1)}>Next →</button>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 4, marginBottom: 4 }}>
        {DOW.map((d) => <div key={d} style={{ textAlign: "center", fontSize: 10, color: "var(--text-3)", fontWeight: 700 }}>{d}</div>)}
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 4 }}>
        {cells.map((date, i) => {
          if (!date) return <div key={i} />;
          const list = byDay.get(date) ?? [];
          const count = list.length;
          const isToday = date === today;
          const isSelected = date === selectedDay;
          const opacity = count === 0 ? 0 : Math.max(0.18, count / maxCount);
          const dayNum = Number(date.slice(8, 10));
          return (
            <button
              key={date}
              onClick={() => setSelectedDay(date)}
              style={{
                aspectRatio: "1", border: isSelected ? `2px solid ${ACCENT}` : isToday ? "2px solid var(--text-3)" : "1px solid var(--surface-2)",
                borderRadius: 6, background: count > 0 ? `${ACCENT}${Math.round(opacity * 255).toString(16).padStart(2, "0")}` : "var(--card)",
                cursor: "pointer", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: 2, minHeight: 0,
              }}
              title={count > 0 ? `${count} on leave` : undefined}
            >
              <span style={{ fontSize: 11, color: count > 0 ? "var(--text-1)" : "var(--text-3)", fontWeight: isToday ? 700 : 400 }}>{dayNum}</span>
              {count > 0 && <span style={{ fontSize: 9, color: "#93c5fd", fontWeight: 700 }}>{count}</span>}
            </button>
          );
        })}
      </div>

      <div style={{ marginTop: 14, paddingTop: 12, borderTop: "1px solid var(--surface-2)" }}>
        <div style={{ fontSize: 12, fontWeight: 700, color: "var(--text-2)", marginBottom: 6 }}>
          {selectedDay ? new Date(`${selectedDay}T00:00:00Z`).toLocaleDateString("en-AU", { weekday: "long", day: "numeric", month: "long" }) : "Pick a day"}
        </div>
        {selectedEntries.length === 0 ? (
          <div style={{ fontSize: 12, color: "var(--text-3)" }}>Nobody on leave.</div>
        ) : (
          <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
            {selectedEntries.map((e) => (
              <li key={e.id} style={{ fontSize: 13, padding: "3px 0", display: "flex", gap: 8 }}>
                <span style={{ fontWeight: 600 }}>{e.name}</span>
                <span style={{ color: "var(--text-3)" }}>{e.pod ?? "No pod"} · {e.policyName}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

export function LeaveCalendar() {
  const [entries, setEntries] = useState<LeaveEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/api/hubstaff/leave");
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json() as { entries: LeaveEntry[]; error?: string };
        setEntries(data.entries);
        if (data.error) setError(data.error);
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const today = auTodayISODateClient();
  const current = entries.filter((e) => e.days.includes(today));
  const upcoming = entries.filter((e) => e.startDate > today).sort((a, b) => a.startDate.localeCompare(b.startDate));
  const past = entries.filter((e) => e.endDate < today).sort((a, b) => b.endDate.localeCompare(a.endDate));

  if (loading) return <div className="dpEmpty">Loading leave data…</div>;
  if (error) return <div className="dpEmpty">Couldn&apos;t load leave data ({error}).</div>;

  return (
    <div>
      {/* Currently on leave */}
      <div style={{ marginBottom: 20 }}>
        <div className="dpTableSub" style={{ marginBottom: 8 }}>Currently on leave{current.length > 0 ? ` (${current.length})` : ""}</div>
        {current.length === 0 ? (
          <div className="dpEmpty">Nobody is on leave today.</div>
        ) : (
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
            {current.map((e) => (
              <span key={e.id} style={{ display: "inline-flex", flexDirection: "column", background: "rgba(79,142,247,0.13)", border: "1px solid #bfdbfe", borderRadius: 8, padding: "6px 12px" }}>
                <span style={{ fontWeight: 700, fontSize: 13 }}>{e.name}</span>
                <span style={{ fontSize: 11, color: "var(--text-3)" }}>{e.pod ?? "No pod"} · {e.policyName} · {fmtRange(e)}</span>
              </span>
            ))}
          </div>
        )}
      </div>

      {/* Calendar */}
      <div style={{ marginBottom: 20, maxWidth: 420 }}>
        <div className="dpTableSub" style={{ marginBottom: 8 }}>Calendar</div>
        <MonthCalendar entries={entries} />
      </div>

      {/* Upcoming / Past side by side */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20 }}>
        <div>
          <div className="dpTableSub" style={{ marginBottom: 8 }}>Upcoming leave ({upcoming.length})</div>
          {upcoming.length === 0 ? <div className="dpEmpty">Nothing scheduled.</div> : (
            <table className="dpTable">
              <thead><tr><th>Name</th><th>Dates</th><th>Type</th></tr></thead>
              <tbody>
                {upcoming.slice(0, 15).map((e) => (
                  <tr key={e.id}>
                    <td className="dpPrimary">{e.name}</td>
                    <td className="dpMuted">{fmtRange(e)}</td>
                    <td className="dpMuted">{e.policyName}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {upcoming.length > 15 && <div className="dpNote">+{upcoming.length - 15} more</div>}
        </div>
        <div>
          <div className="dpTableSub" style={{ marginBottom: 8 }}>Past leave ({past.length})</div>
          {past.length === 0 ? <div className="dpEmpty">No leave history.</div> : (
            <table className="dpTable">
              <thead><tr><th>Name</th><th>Dates</th><th>Type</th></tr></thead>
              <tbody>
                {past.slice(0, 15).map((e) => (
                  <tr key={e.id}>
                    <td className="dpPrimary">{e.name}</td>
                    <td className="dpMuted">{fmtRange(e)}</td>
                    <td className="dpMuted">{e.policyName}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {past.length > 15 && <div className="dpNote">+{past.length - 15} more</div>}
        </div>
      </div>
      <div style={{ fontSize: 11, color: "var(--text-3)", marginTop: 12 }}>From Hubstaff&apos;s Time Off module · approved leave only.</div>
    </div>
  );
}
