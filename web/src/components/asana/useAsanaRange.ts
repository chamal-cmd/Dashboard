"use client";

import { useState, useCallback } from "react";
import type { AsanaOverview } from "@/lib/data/asana";

export const ASANA_PRESETS = [
  { label: "Today",  days: 1  },
  { label: "7 days", days: 7  },
  { label: "14 days",days: 14 },
  { label: "30 days",days: 30 },
  { label: "90 days",days: 90 },
] as const;
export const ASANA_MAX_DAYS = 90;

// Date-range state shared by every split-up Asana page — each page fetches
// independently (no cross-page range memory; picking 30 days on Overview
// then visiting Insights starts that page back at 7), same as Aircall and
// Hubstaff's own independent range pickers.
export function useAsanaRange(initial: AsanaOverview) {
  const [days, setDays] = useState(initial.rangeDays);
  const [custom, setCustom] = useState("");
  const [loading, setLoading] = useState(false);
  const [asana, setAsana] = useState<AsanaOverview>(initial);
  // Null until the first client-side fetch actually resolves (request
  // 2026-08-21) — never seeded from Date.now() at mount, which would render
  // a different value during SSR than during hydration.
  const [lastRefreshed, setLastRefreshed] = useState<Date | null>(null);

  const pickPreset = useCallback(async (d: number) => {
    if (d === days || loading) return;
    setLoading(true);
    try {
      const res = await fetch(`/api/asana/overview?days=${d}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setAsana(await res.json() as AsanaOverview);
      setDays(d);
      setLastRefreshed(new Date());
    } catch { /* keep existing data and range */ } finally {
      setLoading(false);
    }
  }, [days, loading]);

  const submitCustom = () => {
    const n = Math.floor(Number(custom));
    if (!isNaN(n) && n >= 1) pickPreset(Math.min(n, ASANA_MAX_DAYS));
  };

  // Re-fetch the current range on demand — unlike pickPreset, this doesn't
  // bail out when the day count is unchanged.
  const refreshData = useCallback(async () => {
    if (loading) return;
    setLoading(true);
    try {
      const res = await fetch(`/api/asana/overview?days=${days}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setAsana(await res.json() as AsanaOverview);
      setLastRefreshed(new Date());
    } catch { /* keep existing data */ } finally {
      setLoading(false);
    }
  }, [days, loading]);

  return { asana, days, custom, setCustom, loading, pickPreset, submitCustom, refreshData, lastRefreshed };
}
