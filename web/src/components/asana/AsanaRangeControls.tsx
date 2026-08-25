"use client";

import Link from "next/link";
import { ASANA_PRESETS, ASANA_MAX_DAYS } from "./useAsanaRange";

interface Props {
  days: number;
  custom: string;
  setCustom: (v: string) => void;
  loading: boolean;
  pickPreset: (d: number) => void;
  submitCustom: () => void;
  allPods: { id: string; name: string }[];
}

// Shared control-panel body (date range + jump-to-pod) for every split-up
// Asana page — same controls, same behavior, wherever you land.
export function AsanaRangeControls({ days, custom, setCustom, loading, pickPreset, submitCustom, allPods }: Props) {
  return (
    <>
      <div className="dpSectionLbl" style={{ marginTop: 0 }}>Date range</div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 10 }}>
        {ASANA_PRESETS.map((p) => (
          <button key={p.days} className={`acTab ${days === p.days ? "acTabActive" : ""}`} onClick={() => pickPreset(p.days)}>{p.label}</button>
        ))}
      </div>
      <div style={{ display: "flex", gap: 6 }}>
        <input
          className="dpRangeInput"
          type="number"
          min={1}
          max={ASANA_MAX_DAYS}
          placeholder="Custom days"
          value={custom}
          onChange={(e) => setCustom(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && submitCustom()}
          style={{ flex: 1, minWidth: 0 }}
        />
        <button className={`acTab ${!ASANA_PRESETS.some((p) => p.days === days) ? "acTabActive" : ""}`} onClick={submitCustom}>Go</button>
      </div>
      {loading && <div style={{ fontSize: 11, color: "var(--text-3)", marginTop: 8 }}>Loading…</div>}

      {allPods.length > 0 && (
        <>
          <div className="dpSectionLbl" style={{ marginTop: 16 }}>Jump to pod</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {allPods.map((p) => (
              <Link key={p.id} href={`/dashboard/asana/pod/${p.id}`} className="acTab" style={{ textDecoration: "none", textAlign: "center" }}>{p.name} →</Link>
            ))}
          </div>
        </>
      )}
    </>
  );
}
