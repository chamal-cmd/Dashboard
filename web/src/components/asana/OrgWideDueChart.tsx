"use client";

import { useState, useEffect } from "react";
import { aggregateBookkeeper, PeopleBarChart, type BookkeeperProjectsRow } from "./BookkeeperProjectsPreview";

// The org-wide bar chart from Bookkeeper Projects, standalone — for the
// Overview page (request 2026-08-19: "just copy... the org wide bar chart
// from Bookkeeper Project"). Same data source, same component, just without
// the per-pod breakdown, rows, or click-through modal that come with the
// full BookkeeperProjectsPreview.
export function OrgWideDueChart() {
  const [rows, setRows] = useState<BookkeeperProjectsRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/asana/bookkeeper-projects")
      .then((res) => res.json().catch(() => null) as Promise<{ rows?: BookkeeperProjectsRow[]; error?: string } | null>)
      .then((json) => {
        if (cancelled) return;
        if (!json) { setError("The server sent a response that wasn't valid JSON."); return; }
        if (json.error) { setError(json.error); return; }
        setRows(json.rows ?? []);
      })
      .catch((e) => { if (!cancelled) setError(e instanceof Error ? e.message : String(e)); });
    return () => { cancelled = true; };
  }, []);

  if (error) return <div className="dpEmpty">Couldn&apos;t load the bookkeeper breakdown: {error}</div>;
  if (!rows) return <div className="dpEmpty">Loading bookkeeper breakdown…</div>;

  // No-pod bookkeepers dropped entirely — mirrors BookkeeperProjectsPreview
  // (these are typically shared/admin accounts, not real active bookkeepers).
  const podRows = rows.filter((r) => r.pod != null);
  if (podRows.length === 0) return <div className="dpEmpty">No bookkeepers found.</div>;

  return <PeopleBarChart title="Org-wide — every bookkeeper" people={podRows.map(aggregateBookkeeper)} />;
}
