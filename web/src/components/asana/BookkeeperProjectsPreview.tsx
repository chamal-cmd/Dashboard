"use client";

import { useState, useEffect } from "react";
import { useSearchParams } from "next/navigation";
import { fmtDate } from "./TaskRow";
import { auTodayISODateClient } from "@/lib/business-tz-client";
import { AGE_BUCKETS } from "@/lib/overdue-buckets";
import { LastRefreshed } from "@/components/LastRefreshed";

export interface BookkeeperProjectsRow {
  id: string;
  name: string;
  pod: string | null;
  projects: { project: string; due: number; upcoming: number; due0to2: number; due3to7: number; due8to14: number; due15plus: number }[];
}
interface BookkeeperTask {
  id: string;
  name: string;
  project: string;
  dueOn: string | null;
}

const INCOMPLETE_HEX = "#f87171";

function formatDue(dueOn: string | null): string {
  return dueOn ? fmtDate(dueOn) : "No due date";
}

// Sorted by due date, soonest first — no-due-date tasks last, since they
// carry no particular urgency (filtering "must be as of the due date", per
// request 2026-08-11).
function sortByDueDate(tasks: BookkeeperTask[]): BookkeeperTask[] {
  return [...tasks].sort((a, b) => {
    if (a.dueOn === b.dueOn) return 0;
    if (a.dueOn === null) return 1;
    if (b.dueOn === null) return -1;
    return a.dueOn < b.dueOn ? -1 : 1;
  });
}

// Flat list of one bookkeeper's overdue tasks across every client project —
// no per-project grouping and no upcoming tasks (simplified on request
// 2026-08-14: the client-by-client card grid was more structure than anyone
// needed; what actually gets chased is what's already past its deadline).
// No project column (removed on request 2026-08-17) — since Bookkeeper
// Projects is now scoped to each bookkeeper's own Finance board, it's rarely
// worth repeating on every row.
function DueTaskList({ tasks }: { tasks: BookkeeperTask[] }) {
  const sorted = sortByDueDate(tasks);
  if (sorted.length === 0) {
    return <div className="dpEmpty" style={{ padding: 14 }}>No overdue tasks — nothing past its deadline.</div>;
  }
  return (
    <div style={{ maxHeight: 480, overflowY: "auto", border: "1px solid var(--border-soft)", borderRadius: 8 }}>
      <table className="dpTable">
        <thead><tr><th>Task</th><th>Due date</th></tr></thead>
        <tbody>
          {sorted.map((t) => (
            <tr key={t.id}>
              <td className="dpPrimary" style={{ maxWidth: 320, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{t.name}</td>
              <td style={{ fontSize: 12, whiteSpace: "nowrap", color: INCOMPLETE_HEX, fontWeight: 600 }}>{formatDue(t.dueOn)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// Popup opened by clicking a bookkeeper: just their overdue tasks, oldest
// deadline first. Completed tasks are dropped entirely (changed on request
// 2026-08-11: only pending work matters here) — getClientProjectTasksForBookkeeper
// doesn't even fetch them anymore. Purely presentational — the fetch it
// displays is triggered from the click handler that opens it (see
// openBookkeeper below), not from an effect here, same reasoning as
// EofyPodPreview's per-client activity fetch.
function BookkeeperModal({ row, tasks, error, onClose }: {
  row: BookkeeperProjectsRow; tasks: BookkeeperTask[] | null; error: string | null; onClose: () => void;
}) {
  const today = auTodayISODateClient();
  const due = (tasks ?? []).filter((t) => t.dueOn !== null && t.dueOn < today);

  return (
    <div
      onClick={onClose}
      style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="dpTableWrap"
        style={{ width: "100%", maxWidth: 640, maxHeight: "85vh", overflowY: "auto", padding: 24 }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 4 }}>
          <span style={{ fontSize: 16, fontWeight: 700, color: "var(--text-1)", flex: 1 }}>{row.name}</span>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            style={{ background: "none", border: "none", cursor: "pointer", fontSize: 20, color: "var(--text-3)", lineHeight: 1, padding: 4 }}
          >
            ×
          </button>
        </div>
        <div style={{ fontSize: 11, color: "var(--text-3)", marginBottom: 18 }}>
          Overdue tasks as of {fmtDate(today)}
        </div>

        {error ? (
          <div className="dpEmpty" style={{ padding: 14 }}>{error}</div>
        ) : !tasks ? (
          <div className="dpEmpty" style={{ padding: 14 }}>Loading tasks…</div>
        ) : (
          <DueTaskList tasks={due} />
        )}
      </div>
    </div>
  );
}

// Per-bookkeeper totals summed across all of their client projects — reuses
// data already in `rows`, no extra fetch needed for either bar chart below.
interface BookkeeperAgeStats {
  name: string; due: number; upcoming: number;
  due0to2: number; due3to7: number; due8to14: number; due15plus: number;
}

export function aggregateBookkeeper(row: BookkeeperProjectsRow): BookkeeperAgeStats {
  const sum = (key: "due" | "upcoming" | "due0to2" | "due3to7" | "due8to14" | "due15plus") =>
    row.projects.reduce((total, p) => total + p[key], 0);
  return {
    name: row.name,
    due: sum("due"), upcoming: sum("upcoming"),
    due0to2: sum("due0to2"), due3to7: sum("due3to7"), due8to14: sum("due8to14"), due15plus: sum("due15plus"),
  };
}

// Shades of red by how overdue, oldest on top (restored on request 2026-08-19
// — was a due/upcoming 2-color split; upcoming isn't shown here at all now,
// matching this section already having dropped it from the task list itself).
// AGE_BUCKETS itself lives in lib/overdue-buckets.ts, shared with Bookkeeper
// Stats' own due bar chart so both read identically.

// One big VERTICAL stacked-bar chart comparing several bookkeepers at once
// (changed to vertical on request 2026-08-11) — used both per-pod (compare
// that pod's own members) and org-wide (compare everyone). Bar HEIGHT is each
// person's total OVERDUE volume; the stack within it is the age-bucket split
// above. Sorted busiest-first, left to right.
export function PeopleBarChart({ title, people }: { title: string; people: BookkeeperAgeStats[] }) {
  const sorted = [...people].sort((a, b) => b.due - a.due);
  const maxTotal = Math.max(...sorted.map((p) => p.due), 1);
  const barMaxHeight = 160;

  return (
    <div className="dpTableWrap" style={{ padding: 18, marginBottom: 14 }}>
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", flexWrap: "wrap", gap: 10, marginBottom: 16 }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: "var(--text-1)" }}>{title}</div>
        <div style={{ display: "flex", gap: 14, flexWrap: "wrap" }}>
          {AGE_BUCKETS.map((b) => (
            <span key={b.key} style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 11, color: "var(--text-3)" }}>
              <span style={{ width: 9, height: 9, borderRadius: 2, background: b.hex, display: "inline-block" }} />
              {b.label}
            </span>
          ))}
        </div>
      </div>
      <div style={{ display: "flex", alignItems: "flex-end", gap: 16, overflowX: "auto", paddingBottom: 4 }}>
        {sorted.map((p) => {
          const barHeight = Math.max((p.due / maxTotal) * barMaxHeight, p.due > 0 ? 4 : 0);
          const tooltip = `${p.name}: ${AGE_BUCKETS.map((b) => `${p[b.key]} (${b.label})`).join(", ")}`;
          return (
            <div
              key={p.name}
              style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 6, width: 68, flexShrink: 0 }}
              title={tooltip}
            >
              <div style={{ fontSize: 10, color: "var(--text-3)" }}>{p.due} due</div>
              <div style={{ height: barMaxHeight, display: "flex", alignItems: "flex-end" }}>
                <div style={{ width: 30, height: barHeight, display: "flex", flexDirection: "column", borderRadius: 4, overflow: "hidden" }}>
                  {AGE_BUCKETS.map((b) => p[b.key] > 0 && <div key={b.key} style={{ flex: p[b.key], background: b.hex }} />)}
                </div>
              </div>
              <div style={{ fontSize: 11, fontWeight: 600, color: "var(--text-1)", textAlign: "center", lineHeight: 1.25 }}>
                {p.name}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

type NudgeState = { status: "idle" | "sending" | "sent" | "error"; message?: string };

// Slack DM to this bookkeeper's pod leader (request 2026-08-19) — visible
// only when they actually have overdue work. A sibling button rather than
// nested inside the row's own onOpen button (buttons can't nest); its own
// success/error detail shows as a tooltip so the label itself stays compact.
function NudgeButton({ bookkeeperId, dueCount }: { bookkeeperId: string; dueCount: number }) {
  const [state, setState] = useState<NudgeState>({ status: "idle" });

  const nudge = async () => {
    setState({ status: "sending" });
    try {
      const res = await fetch("/api/asana/nudge", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ bookkeeperId, dueCount }),
      });
      const json = await res.json().catch(() => null) as { ok?: boolean; leaderName?: string; error?: string } | null;
      if (!json) { setState({ status: "error", message: "The server sent a response that wasn't valid JSON." }); return; }
      if (!json.ok) { setState({ status: "error", message: json.error ?? "Failed to send" }); return; }
      setState({ status: "sent", message: `Sent to ${json.leaderName ?? "the pod leader"}` });
    } catch (e) {
      setState({ status: "error", message: e instanceof Error ? e.message : String(e) });
    }
  };

  const label = state.status === "sending" ? "Sending…" : state.status === "sent" ? "✓ Sent" : state.status === "error" ? "Retry" : "🔔 Nudge";
  const tip = state.status === "sent" || state.status === "error" ? state.message : "Notify this bookkeeper's pod leader on Slack";

  return (
    <button
      type="button"
      onClick={(e) => { e.stopPropagation(); void nudge(); }}
      disabled={state.status === "sending"}
      className="acTab"
      title={tip}
      style={{ flexShrink: 0, fontSize: 11, padding: "5px 11px" }}
    >
      {label}
    </button>
  );
}

function BookkeeperRow({ row, onOpen }: { row: BookkeeperProjectsRow; onOpen: () => void }) {
  const { due } = aggregateBookkeeper(row);
  return (
    <div className="dpTableWrap" style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
      <button
        type="button"
        onClick={onOpen}
        style={{ background: "none", border: "none", cursor: "pointer", flex: 1, textAlign: "left", padding: "14px 18px", display: "flex", alignItems: "center", gap: 12 }}
      >
        <span style={{ fontSize: 14, fontWeight: 700, color: "var(--text-1)", flex: 1 }}>{row.name}</span>
        <span style={{ fontSize: 12, fontWeight: due > 0 ? 700 : 400, color: due > 0 ? INCOMPLETE_HEX : "var(--text-3)" }}>
          {due} due
        </span>
        <span style={{ fontSize: 11, color: "#4f8ef7" }}>▸ View</span>
      </button>
      {due > 0 && <NudgeButton bookkeeperId={row.id} dueCount={due} />}
      <span style={{ width: 4 }} />
    </div>
  );
}

// Every bookkeeper's client-project PENDING task load, one bar chart per
// project. Backed by a Supabase-synced table (not a live Asana call), so —
// unlike the Fathom/BAS/EOFY panels — this loads fast.
export function BookkeeperProjectsPreview() {
  // ?bookkeeper= opens straight to that person's task modal on load (request
  // 2026-08-21) — the other half of the Nudge Slack message's deep link,
  // read here since FathomReportSection only knows which CARD to open, not
  // which bookkeeper within it.
  const searchParams = useSearchParams();
  const initialBookkeeperId = searchParams.get("bookkeeper");
  const [rows, setRows] = useState<BookkeeperProjectsRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [lastRefreshed, setLastRefreshed] = useState<Date | null>(null);
  const [reloadNonce, setReloadNonce] = useState(0);
  const [selectedId, setSelectedId] = useState<string | null>(initialBookkeeperId);
  const [taskState, setTaskState] = useState<{ tasks: BookkeeperTask[] | null; error: string | null }>({ tasks: null, error: null });

  const openBookkeeper = (id: string) => {
    setSelectedId(id);
    setTaskState({ tasks: null, error: null });
    fetch(`/api/asana/bookkeeper-tasks?assigneeId=${encodeURIComponent(id)}`)
      .then((res) => res.json().catch(() => null) as Promise<{ tasks?: BookkeeperTask[]; error?: string } | null>)
      .then((json) => {
        if (!json) { setTaskState({ tasks: null, error: "The server sent a response that wasn't valid JSON." }); return; }
        if (json.error) { setTaskState({ tasks: null, error: json.error }); return; }
        setTaskState({ tasks: json.tasks ?? [], error: null });
      })
      .catch((e) => setTaskState({ tasks: null, error: e instanceof Error ? e.message : String(e) }));
  };

  useEffect(() => {
    let cancelled = false;
    const load = async (attempt: number): Promise<void> => {
      try {
        const res = await fetch("/api/asana/bookkeeper-projects");
        const json = await res.json().catch(() => null) as { rows?: BookkeeperProjectsRow[]; error?: string } | null;
        if (cancelled) return;
        if (!res.ok) throw new Error(json?.error ?? `HTTP ${res.status}`);
        if (!json) throw new Error("The server sent a response that wasn't valid JSON.");
        if (json.error) throw new Error(json.error);
        setRows(json.rows ?? []);
        setLastRefreshed(new Date());
      } catch (e) {
        if (cancelled) return;
        if (attempt === 0) {
          await new Promise((r) => setTimeout(r, 1200));
          if (!cancelled) return load(1);
          return;
        }
        setError(e instanceof Error ? e.message : String(e));
      }
    };
    void load(0);
    return () => { cancelled = true; };
  }, [reloadNonce]);

  useEffect(() => {
    // selectedId is already seeded to initialBookkeeperId above, and
    // taskState already starts at {tasks: null, error: null} — the same
    // values openBookkeeper's own synchronous setState calls would produce —
    // so only the fetch itself does anything new here.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (initialBookkeeperId) openBookkeeper(initialBookkeeperId);
    // Deliberately runs once for the initial deep-link, not on every
    // id/param change — that's what the missing-dependency warning would
    // push toward, and it's not what this effect is for.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (error) {
    return (
      <div className="dpEmpty" style={{ display: "flex", flexDirection: "column", gap: 10, alignItems: "center" }}>
        <div>Couldn&apos;t load the bookkeeper breakdown.</div>
        <div style={{ fontSize: 12, color: "var(--text-3)", maxWidth: 520 }}>{error}</div>
        <button type="button" className="acTab" onClick={() => { setError(null); setRows(null); setReloadNonce((n) => n + 1); }}>
          ↻ Retry
        </button>
      </div>
    );
  }
  if (!rows) return <div className="dpEmpty">Loading bookkeeper breakdown…</div>;

  // No-pod bookkeepers dropped entirely (changed on request 2026-08-11) —
  // not just sorted last. These are typically not real, active bookkeepers
  // (e.g. shared/admin accounts with no pod assignment).
  const podRows = rows.filter((r) => r.pod != null);
  if (podRows.length === 0) return <div className="dpEmpty">No bookkeepers found.</div>;

  const byPod = new Map<string, BookkeeperProjectsRow[]>();
  for (const r of podRows) {
    const key = r.pod as string;
    const list = byPod.get(key) ?? [];
    list.push(r);
    byPod.set(key, list);
  }
  const podNames = Array.from(byPod.keys()).sort((a, b) => a.localeCompare(b));
  const selectedRow = rows.find((r) => r.id === selectedId) ?? null;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      <div style={{ display: "flex", justifyContent: "flex-end" }}>
        <LastRefreshed at={lastRefreshed} />
      </div>
      <PeopleBarChart title="Org-wide — every bookkeeper" people={podRows.map(aggregateBookkeeper)} />

      {podNames.map((pod) => {
        const members = byPod.get(pod)!;
        // Most-overdue-first — the due badge is the actionable signal now,
        // so whoever needs attention first should be the first row, not
        // whatever order the API happened to return.
        const sortedMembers = [...members].sort((a, b) => aggregateBookkeeper(b).due - aggregateBookkeeper(a).due);
        return (
          <div key={pod}>
            <div style={{ fontSize: 13, fontWeight: 700, color: "var(--text-1)", marginBottom: 10 }}>{pod}</div>
            <PeopleBarChart title={`${pod} — all members`} people={members.map(aggregateBookkeeper)} />
            {sortedMembers.map((row) => (
              <BookkeeperRow key={row.id} row={row} onOpen={() => openBookkeeper(row.id)} />
            ))}
          </div>
        );
      })}

      {selectedRow && (
        <BookkeeperModal
          key={selectedRow.id}
          row={selectedRow}
          tasks={taskState.tasks}
          error={taskState.error}
          onClose={() => setSelectedId(null)}
        />
      )}
    </div>
  );
}
