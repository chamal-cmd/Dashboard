"use client";

import { useState, useCallback } from "react";
import AircallTabs from "./AircallTabs";
import "./aircall-page.css";

type AircallData = React.ComponentProps<typeof AircallTabs>["aircall"];

const PRESETS = [
  { label: "Today", days: 1 },
  { label: "7 days", days: 7 },
  { label: "14 days", days: 14 },
  { label: "30 days", days: 30 },
  { label: "90 days", days: 90 },
] as const;

const MAX_DAYS = 90;

// Date-range state around AircallTabs — same pattern as HubstaffDashboard:
// preset buttons + custom day count, refetching /api/aircall/overview.
export default function AircallDashboard({ initial }: { initial: AircallData }) {
  const [days, setDays] = useState(7);
  const [custom, setCustom] = useState("");
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<AircallData>(initial);

  const pickPreset = useCallback(async (d: number) => {
    if (d === days || loading) return;
    setLoading(true);
    try {
      const res = await fetch(`/api/aircall/overview?days=${d}`);
      // A non-OK response (401, 500) still parses as JSON — setting it as
      // data would wipe the dashboard, so treat it as a failure instead.
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setData(await res.json() as AircallData);
      setDays(d);
    } catch { /* keep existing data and range */ } finally {
      setLoading(false);
    }
  }, [days, loading]);

  const submitCustom = () => {
    const n = Math.floor(Number(custom));
    if (!isNaN(n) && n >= 1) pickPreset(Math.min(n, MAX_DAYS));
  };

  return (
    <>
      {/* ── Date range picker ──────────────────────────────── */}
      <div className="acTabBar" style={{ marginBottom: 28 }}>
        {PRESETS.map((p) => (
          <button
            key={p.days}
            className={`acTab ${days === p.days ? "acTabActive" : ""}`}
            onClick={() => pickPreset(p.days)}
          >
            {p.label}
          </button>
        ))}
        <span className="dpRangeCustom">
          <input
            className="dpRangeInput"
            type="number"
            min={1}
            max={MAX_DAYS}
            placeholder="Custom"
            value={custom}
            onChange={(e) => setCustom(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && submitCustom()}
          />
          <button className={`acTab ${!PRESETS.some((p) => p.days === days) ? "acTabActive" : ""}`} onClick={submitCustom}>
            days
          </button>
        </span>
        {loading && <span style={{ fontSize: 11, color: "#6b7280", alignSelf: "center", marginLeft: 8 }}>Loading…</span>}
      </div>

      <AircallTabs aircall={data} />
    </>
  );
}
