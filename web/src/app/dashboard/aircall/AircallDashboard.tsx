"use client";

import { useState, useCallback } from "react";
import AircallTabs from "./AircallTabs";
import { LoadingScreen } from "@/components/LoadingScreen";
import { LastRefreshed } from "@/components/LastRefreshed";
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
  const [lastRefreshed, setLastRefreshed] = useState<Date | null>(null);

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
      setLastRefreshed(new Date());
    } catch { /* keep existing data and range */ } finally {
      setLoading(false);
    }
  }, [days, loading]);

  const submitCustom = () => {
    const n = Math.floor(Number(custom));
    if (!isNaN(n) && n >= 1) pickPreset(Math.min(n, MAX_DAYS));
  };

  if (loading) {
    return <LoadingScreen icon="☎" title="AIRCALL" status="Loading Aircall data…" color="#34d399" />;
  }

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
        <LastRefreshed at={lastRefreshed} />
      </div>

      {/* Aircall's calls list is paginated 50 at a time and fetched in
          parallel; if the window exceeds the page cap or a page fails even
          after retries, every figure below is an UNDERCOUNT. Silently showing
          low numbers as if they were complete is worse than saying so. */}
      {data.truncated && (
        <div
          className="dpNote"
          style={{ marginTop: -14, marginBottom: 20, color: "#fb923c" }}
          title="Aircall returns calls 50 per page. Either this range has more pages than the fetch cap allows, or one page failed after retries."
        >
          ⚠ Incomplete data for this range — some calls couldn&apos;t be fetched, so the counts and rates
          below are lower than reality. Try a shorter range or refresh.
        </div>
      )}

      <AircallTabs aircall={data} days={days} />
    </>
  );
}
