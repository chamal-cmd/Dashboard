"use client";

import { useState } from "react";
import Link from "next/link";
import { displayName, isExcludedBookkeeper } from "@/lib/asana-client-map";
import { InfoTip } from "@/components/InfoTip";
import { AGE_BUCKETS, type AgeBucketKey } from "@/lib/overdue-buckets";
import "@/components/info-tip.css";

interface ClientProjectStat {
  project: string; due: number; upcoming: number;
  due0to2: number; due3to7: number; due8to14: number; due15plus: number;
}
interface BookkeeperRow {
  id: string; name: string; email: string; pod: string | null;
  clientProjects: ClientProjectStat[];
  hubstaffHoursToday: number | null; hubstaffActivityPctToday: number | null;
}
interface Stats {
  bookkeepers: BookkeeperRow[];
  pods: { id: string; name: string }[];
  asOfISO: string;
  errors: { asana?: string; hubstaff?: string };
}

const DUE_HEX = "#f87171";

function fmtAsOf(iso: string): string {
  const d = new Date(`${iso}T00:00:00`);
  return d.toLocaleDateString("en-AU", { weekday: "short", day: "numeric", month: "short" });
}

interface AgeStats { due: number; due0to2: number; due3to7: number; due8to14: number; due15plus: number }

// Upcoming dropped entirely (request 2026-08-19: "no need of upcoming, just
// due is enough") — this now sums only the overdue-age buckets.
function aggregate(row: BookkeeperRow): AgeStats {
  const sum = (key: AgeBucketKey) => row.clientProjects.reduce((total, p) => total + p[key], 0);
  const due0to2 = sum("due0to2"), due3to7 = sum("due3to7"), due8to14 = sum("due8to14"), due15plus = sum("due15plus");
  return { due: due0to2 + due3to7 + due8to14 + due15plus, due0to2, due3to7, due8to14, due15plus };
}

// Snapshot comparison — one stacked bar per bookkeeper, shades of red by how
// overdue (same 4 buckets and colors as Bookkeeper Projects' bar chart, per
// request 2026-08-19, so the two pages read identically). Sorted busiest
// (most due) first, since that's the actionable ordering for a page about
// who needs attention now.
function DueBarChart({ people }: { people: (AgeStats & { id: string; name: string })[] }) {
  const sorted = [...people].sort((a, b) => b.due - a.due);
  const maxTotal = Math.max(...sorted.map((p) => p.due), 1);
  const barMaxHeight = 170;

  return (
    <div className="dpTableWrap" style={{ padding: 18, marginBottom: 24 }}>
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", flexWrap: "wrap", gap: 10, marginBottom: 16 }}>
        <div>
          <div className="dpTableTitle">Due tasks</div>
          <div className="dpTableSub">Every bookkeeper&apos;s overdue client work, right now — busiest first</div>
        </div>
        <div style={{ display: "flex", gap: 14, flexWrap: "wrap" }}>
          {AGE_BUCKETS.map((b) => (
            <span key={b.key} style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 11, color: "var(--text-3)" }}>
              <span style={{ width: 9, height: 9, borderRadius: 2, background: b.hex, display: "inline-block" }} />
              {b.label}
            </span>
          ))}
        </div>
      </div>
      {sorted.length === 0 ? (
        <div className="dpEmpty">No client work found.</div>
      ) : (
        <div style={{ display: "flex", alignItems: "flex-end", gap: 16, overflowX: "auto", paddingBottom: 4 }}>
          {sorted.map((p) => {
            const barHeight = Math.max((p.due / maxTotal) * barMaxHeight, p.due > 0 ? 4 : 0);
            const tooltip = `${displayName(p.name)}: ${AGE_BUCKETS.map((b) => `${p[b.key]} (${b.label})`).join(", ")}`;
            return (
              <Link
                href={`/dashboard/asana/person/${p.id}`}
                key={p.id}
                style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 6, width: 72, flexShrink: 0, textDecoration: "none" }}
                title={tooltip}
              >
                <div style={{ fontSize: 11, fontWeight: 700, color: p.due > 0 ? DUE_HEX : "var(--text-3)" }}>{p.due}</div>
                <div style={{ height: barMaxHeight, display: "flex", alignItems: "flex-end" }}>
                  <div style={{ width: 32, height: barHeight, display: "flex", flexDirection: "column", borderRadius: 4, overflow: "hidden" }}>
                    {AGE_BUCKETS.map((b) => p[b.key] > 0 && <div key={b.key} style={{ flex: p[b.key], background: b.hex }} />)}
                  </div>
                </div>
                <div style={{ fontSize: 11, fontWeight: 600, color: "var(--text-1)", textAlign: "center", lineHeight: 1.25, maxWidth: 72, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {displayName(p.name)}
                </div>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}

// Per-client tiles removed on request 2026-08-19 ("we don't need client
// wise") — this is now just due + Hubstaff, same aggregate numbers
// DueBarChart already uses, one row per bookkeeper instead of one card each.
function BookkeeperListRow({ row }: { row: BookkeeperRow }) {
  const { due } = aggregate(row);
  return (
    <tr>
      <td className="dpPrimary">
        <Link href={`/dashboard/asana/person/${row.id}`} style={{ color: "inherit", textDecoration: "none" }}>
          {displayName(row.name)}
        </Link>
      </td>
      <td style={{ color: due > 0 ? DUE_HEX : "var(--text-3)", fontWeight: due > 0 ? 700 : 400 }}>{due}</td>
      <td className="dpMuted">
        {row.hubstaffHoursToday != null ? `${row.hubstaffHoursToday}h` : "—"}
        {row.hubstaffActivityPctToday != null && ` · ${row.hubstaffActivityPctToday}%`}
      </td>
    </tr>
  );
}

export default function BookkeeperStatsDashboard({ initial }: { initial: Stats }) {
  const [podFilter, setPodFilter] = useState<string | null>(null);

  const eligible = initial.bookkeepers.filter((b) => !isExcludedBookkeeper(b.name, b.id));
  const byPod = new Map<string, BookkeeperRow[]>();
  for (const b of eligible) {
    const key = b.pod ?? "No pod";
    const arr = byPod.get(key) ?? [];
    arr.push(b);
    byPod.set(key, arr);
  }
  const podOrder = [...initial.pods.map((p) => p.name), "No pod"].filter((name) => byPod.has(name));
  const visiblePods = podFilter ? podOrder.filter((p) => p === podFilter) : podOrder;
  const visibleBookkeepers = podFilter ? (byPod.get(podFilter) ?? []) : eligible;

  const anyError = initial.errors.asana || initial.errors.hubstaff;

  return (
    <>
      <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap", marginTop: -4, marginBottom: 20 }}>
        <div className="dpNote" style={{ margin: 0 }}>
          Client due tasks as of {fmtAsOf(initial.asOfISO)} · Hubstaff activity is today&apos;s totals, refreshed on demand.
          <InfoTip text="Due tasks come from the same client-project data Bookkeeper Projects uses, so the two always agree. Hubstaff shows today only — reload the page to refresh it." />
        </div>
        <span style={{ flex: 1 }} />
        <select
          className="dpRangeInput"
          value={podFilter ?? ""}
          onChange={(e) => setPodFilter(e.target.value || null)}
          style={{ minWidth: 160 }}
        >
          <option value="">All pods</option>
          {podOrder.map((p) => <option key={p} value={p}>{p}</option>)}
        </select>
      </div>

      {anyError && (
        <div className="hubUnavailable" style={{ marginBottom: 20 }}>
          {initial.errors.asana && <div>Asana: {initial.errors.asana}</div>}
          {initial.errors.hubstaff && <div>Hubstaff: {initial.errors.hubstaff}</div>}
        </div>
      )}

      <DueBarChart people={visibleBookkeepers.map((b) => ({ id: b.id, name: b.name, ...aggregate(b) }))} />

      {visiblePods.map((podName) => {
        const rows = [...byPod.get(podName)!].sort((a, b) => aggregate(b).due - aggregate(a).due);
        return (
          <div key={podName} className="dpTableWrap" style={{ marginBottom: 20 }}>
            <div className="dpTableHead">
              <div>
                <div className="dpTableTitle">{podName}</div>
                <div className="dpTableSub">{rows.length} bookkeeper{rows.length !== 1 ? "s" : ""}</div>
              </div>
            </div>
            <table className="dpTable">
              <thead><tr><th>Bookkeeper</th><th>Due</th><th>Hubstaff today</th></tr></thead>
              <tbody>{rows.map((row) => <BookkeeperListRow key={row.id} row={row} />)}</tbody>
            </table>
          </div>
        );
      })}
    </>
  );
}
