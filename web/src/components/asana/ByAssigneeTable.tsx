import Link from "next/link";
import type { AsanaTask } from "@/lib/data/asana";
import { displayName, isExcludedBookkeeper } from "@/lib/asana-client-map";

export interface AssigneeCount {
  id: string | null;
  name: string;
  count: number;
}

// Keyed by assigneeId (falling back to name only for genuinely unassigned
// tasks) so every row links reliably — a name-only lookup against a
// top-N-by-open-count list would silently drop anyone outside that list,
// e.g. someone who just cleared their whole board.
export function groupByAssignee(tasks: AsanaTask[]): AssigneeCount[] {
  const rows = new Map<string, AssigneeCount>();
  for (const t of tasks) {
    // Departed/non-bookkeeper accounts are hidden from these breakdowns
    // (see EXCLUDED_BOOKKEEPERS) — display-level only, data is untouched.
    if (isExcludedBookkeeper(t.assigneeName, t.assigneeId)) continue;
    const name = t.assigneeName ?? "Unassigned";
    const key = t.assigneeId ?? `name:${name}`;
    const cur = rows.get(key) ?? { id: t.assigneeId, name, count: 0 };
    cur.count += 1;
    rows.set(key, cur);
  }
  return Array.from(rows.values()).sort((a, b) => b.count - a.count);
}

// Shared by the org-wide overview and pod drilldown pages — collapses what
// used to be a flat up-to-30-row task list into one row per bookkeeper,
// with their name as a real drill-down button through to their person page.
export function ByAssigneeTable({
  rows,
  countLabel,
}: {
  rows: AssigneeCount[];
  countLabel: string;
}) {
  return (
    <table className="dpTable">
      <thead>
        <tr><th>Bookkeeper</th><th>{countLabel}</th></tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.id ?? r.name}>
            <td className="dpPrimary">
              {r.id ? (
                <Link href={`/dashboard/asana/person/${r.id}`} className="dpDrillBtn">
                  {displayName(r.name)}
                </Link>
              ) : displayName(r.name)}
            </td>
            <td className="dpMuted">{r.count}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
