"use client";

import { useState } from "react";
import type { TrackerStat, AsanaTask } from "@/lib/data/asana";
import { fmtDate, isOverdue } from "./TaskRow";
import { displayName } from "@/lib/asana-client-map";

function groupByBookkeeper(tasks: AsanaTask[]) {
  const map = new Map<string, { id: string | null; name: string; tasks: AsanaTask[] }>();
  for (const t of tasks) {
    const name = t.assigneeName ?? "Unassigned";
    const key = t.assigneeId ?? `name:${name}`;
    const cur = map.get(key) ?? { id: t.assigneeId, name, tasks: [] };
    cur.tasks.push(t);
    map.set(key, cur);
  }
  // Most-loaded bookkeeper first; Unassigned always sinks to the bottom.
  return [...map.values()].sort((a, b) => {
    if (a.name === "Unassigned") return 1;
    if (b.name === "Unassigned") return -1;
    return b.tasks.length - a.tasks.length;
  });
}

function TrackerItem({ t, days }: { t: TrackerStat; days: number }) {
  const [open, setOpen] = useState(false);
  const pct = t.total && t.total > 0 ? Math.round(((t.total - (t.open ?? 0)) / t.total) * 100) : null;
  const asanaUrl = t.projectId ? `https://app.asana.com/0/${t.projectId}/list` : null;
  const groups = groupByBookkeeper(t.openTasks);
  const hasProject = t.open !== null;

  return (
    <div style={{ borderBottom: "1px solid var(--surface-2)" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "12px 4px" }}>
        <button
          type="button"
          onClick={() => hasProject && setOpen((v) => !v)}
          className="hv-expand-btn"
          aria-expanded={open}
          disabled={!hasProject}
          style={{ minWidth: 34, justifyContent: "center", opacity: hasProject ? 1 : 0.4 }}
        >
          {open ? "▴" : "▾"}
        </button>
        <div style={{ flex: 1, minWidth: 0, fontSize: 13, fontWeight: 600, color: "var(--text-1)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
          {asanaUrl ? <a href={asanaUrl} target="_blank" rel="noopener noreferrer" className="dpDrillBtn" title="Open this project in Asana">{t.label}</a> : t.label}
        </div>
        <div style={{ width: 60, textAlign: "right", fontSize: 13, color: (t.open ?? 0) > 0 ? "#fb923c" : "#34d399", fontWeight: 700 }}>{t.open ?? "—"}<div style={{ fontSize: 9, color: "var(--text-3)", fontWeight: 400 }}>open</div></div>
        <div style={{ width: 60, textAlign: "right", fontSize: 13, color: "var(--text-3)" }}>{t.total ?? "—"}<div style={{ fontSize: 9, color: "var(--text-3)" }}>total</div></div>
        <div style={{ width: 80, textAlign: "right", fontSize: 13, color: "#34d399" }}>{t.completedInRange ?? "—"}<div style={{ fontSize: 9, color: "var(--text-3)" }}>done · {days}d</div></div>
        {/* Labelled "of rows" deliberately. This is (total - open) / total over
            BOARD ROWS, which is a different measure from the report-based
            completion on the Fathom Report (one client-month = one report).
            Left unlabelled, the two percentages look like the same number
            disagreeing with itself. A report-based figure can't be computed
            here: asana_tasks carries `progress` but not the Months field or the
            quarter section, so there is no way to know how many client-months a
            row covers without the live Asana call the Fathom Report makes. */}
        <div
          style={{ width: 90, textAlign: "right", fontSize: 12, color: "var(--text-3)" }}
          title="Share of this tracker's board ROWS that are complete. Not the same as the report-based completion on the Fathom Report, which counts one client-month as one report — a row spanning three months counts once here and three times there."
        >
          {pct != null ? `${pct}%` : "—"}
          <div style={{ fontSize: 9, color: "var(--text-3)" }}>of rows</div>
        </div>
      </div>

      {open && (
        <div style={{ padding: "2px 4px 16px 34px" }}>
          {t.openTasks.length === 0 ? (
            <div className="dpEmpty" style={{ padding: "8px 0" }}>No open tasks in this tracker.</div>
          ) : (
            <>
              <div style={{ fontSize: 11, color: "var(--text-3)", marginBottom: 10 }}>{t.open} open task{t.open !== 1 ? "s" : ""} across {groups.length} bookkeeper{groups.length !== 1 ? "s" : ""} · every task links to Asana</div>
              {groups.map((g) => (
                <div key={g.id ?? g.name} style={{ marginBottom: 14 }}>
                  <div style={{ fontSize: 12, fontWeight: 700, color: g.name === "Unassigned" ? "#f87171" : "var(--text-2)", marginBottom: 5 }}>
                    {g.id ? <a href={`/dashboard/asana/person/${g.id}`} className="dpDrillBtn">{displayName(g.name)}</a> : displayName(g.name)}
                    <span style={{ color: "var(--text-3)", fontWeight: 400, marginLeft: 8 }}>{g.tasks.length} open</span>
                  </div>
                  <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
                    {g.tasks.map((task) => {
                      const overdue = isOverdue(task.dueOn);
                      return (
                        <li key={task.id} style={{ display: "flex", alignItems: "baseline", gap: 10, padding: "3px 0", fontSize: 13, borderBottom: "1px solid var(--surface-2)" }}>
                          <a href={`https://app.asana.com/0/0/${task.id}`} target="_blank" rel="noopener noreferrer" style={{ color: "var(--text-1)", textDecoration: "none", flex: 1, minWidth: 0, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }} title="Open in Asana">
                            {task.name || "—"}
                          </a>
                          <span style={{ fontSize: 12, color: overdue ? "#f87171" : "var(--text-3)", whiteSpace: "nowrap" }}>
                            {fmtDate(task.dueOn)}{overdue && <span style={{ fontSize: 9, background: "#f8717120", color: "#f87171", borderRadius: 3, padding: "0 4px", marginLeft: 5 }}>overdue</span>}
                          </span>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              ))}
            </>
          )}
        </div>
      )}
    </div>
  );
}

// Collapsible compliance-tracker list: each tracker is closed by default and
// expands (button) to a per-bookkeeper breakdown of its open tasks, each task
// linking to the real Asana task. Replaces the old flat count-only table.
export function TrackerList({ trackers, days }: { trackers: TrackerStat[]; days: number }) {
  return (
    <div>
      {trackers.map((t) => <TrackerItem key={t.key} t={t} days={days} />)}
    </div>
  );
}
