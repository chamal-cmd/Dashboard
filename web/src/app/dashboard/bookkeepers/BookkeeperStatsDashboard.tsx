"use client";

import Link from "next/link";
import { PerformanceTrendChart } from "@/components/bookkeepers/PerformanceTrendChart";
import { displayName } from "@/lib/asana-client-map";

interface BookkeeperRow {
  id: string; name: string; email: string; pod: string | null;
  asanaOpen: number | null; asanaOverdue: number | null;
  hubstaffHours: number | null; hubstaffActivityPct: number | null;
}
interface Stats {
  bookkeepers: BookkeeperRow[];
  pods: { id: string; name: string }[];
  errors: { asana?: string; hubstaff?: string };
}

// Asana/Hubstaff come pre-computed from the server (fast, see
// getBookkeeperStats). Hiver was previously loaded here client-side but has
// been removed from this page for now — its per-inbox sweep took 60-90s and
// often part-failed; /dashboard/hiver still has the full live breakdown.
export default function BookkeeperStatsDashboard({ initial }: { initial: Stats }) {
  const byPod = new Map<string, BookkeeperRow[]>();
  for (const b of initial.bookkeepers) {
    const key = b.pod ?? "No pod";
    const arr = byPod.get(key) ?? [];
    arr.push(b);
    byPod.set(key, arr);
  }
  const podOrder = [...initial.pods.map((p) => p.name), "No pod"].filter((name) => byPod.has(name));

  const anyError = initial.errors.asana || initial.errors.hubstaff;

  return (
    <>
      <div className="dpNote" style={{ marginTop: -4, marginBottom: 20 }}>
        Asana / Hubstaff: last 7 days.
      </div>

      {anyError && (
        <div className="hubUnavailable" style={{ marginBottom: 20 }}>
          {initial.errors.asana && <div>Asana: {initial.errors.asana}</div>}
          {initial.errors.hubstaff && <div>Hubstaff: {initial.errors.hubstaff}</div>}
        </div>
      )}

      <div className="dpSectionLbl">Performance over time</div>
      <div className="dpTableWrap" style={{ marginBottom: 28 }}>
        <div className="dpTableHead">
          <div>
            <div className="dpTableTitle">Bookkeeper trends</div>
            <div className="dpTableSub">Pick up to 6 bookkeepers and compare their week-by-week trend, in tasks completed or hours tracked</div>
          </div>
        </div>
        <PerformanceTrendChart />
      </div>

      {podOrder.map((podName) => {
        const rows = byPod.get(podName)!;
        return (
          <div className="dpTableWrap" key={podName} style={{ marginBottom: 24 }}>
            <div className="dpTableHead">
              <div>
                <div className="dpTableTitle">{podName}</div>
                <div className="dpTableSub">{rows.length} bookkeeper{rows.length !== 1 ? "s" : ""}</div>
              </div>
            </div>
            <table className="dpTable">
              <thead>
                <tr>
                  <th>Bookkeeper</th>
                  <th>Asana Open</th>
                  <th>Asana Overdue</th>
                  <th>Hubstaff Hrs</th>
                  <th>Hubstaff Activity</th>
                  <th>Email</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((b) => (
                  <tr key={b.id}>
                    <td className="dpPrimary">
                      <Link href={`/dashboard/asana/person/${b.id}`} className="dpDrillBtn">{displayName(b.name)}</Link>
                    </td>
                    <td className="dpMuted">
                      <Link href={`/dashboard/asana/person/${b.id}`} className="dpDrillBtn">{b.asanaOpen ?? "—"}</Link>
                    </td>
                    <td style={{ color: (b.asanaOverdue ?? 0) > 0 ? "#f87171" : "var(--text-3)" }}>
                      <Link href={`/dashboard/asana/person/${b.id}`} className="dpDrillBtn">{b.asanaOverdue ?? "—"}</Link>
                    </td>
                    <td className="dpMuted">{b.hubstaffHours != null ? `${b.hubstaffHours}h` : "—"}</td>
                    <td className="dpMuted">{b.hubstaffActivityPct != null ? `${b.hubstaffActivityPct}%` : "—"}</td>
                    <td className="dpMuted" style={{ fontSize: 11 }}>{b.email || "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        );
      })}
    </>
  );
}
