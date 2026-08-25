"use client";

import { useState, useEffect } from "react";

// Mirrors FathomMonthSplit / FathomMonth in lib/data/asana-cadence.ts. Declared
// locally so this client component doesn't import the server-only module.
interface MonthOutstanding { client: string; bookkeeper: string; reason: "Not Completed" | "Not marked" }
interface FathomMonth {
  key: string; label: string;
  completed: number; outstanding: number; notApplicable: number;
  clients: MonthOutstanding[];
  status: "complete" | "incomplete" | "nothing-required";
}
interface Split {
  complete: FathomMonth[];
  incomplete: FathomMonth[];
  rowsWithoutMonths: number;
  rowsWithoutSection: number;
  totalRows: number;
  reports: { completed: number; outstanding: number; notApplicable: number; total: number; pct: number | null };
  error?: string;
}

const GREEN = "#34d399";
const AMBER = "#fbbf24";

// One month chip. Incomplete months expand to name the client rows still
// holding them open, since "3 outstanding" on its own isn't actionable.
function MonthCard({ m }: { m: FathomMonth }) {
  const [open, setOpen] = useState(false);
  const done = m.status !== "incomplete";
  const accent = done ? GREEN : AMBER;
  const expandable = m.clients.length > 0;

  return (
    <div
      style={{
        border: `1px solid ${done ? "rgba(52,211,153,0.35)" : "rgba(251,191,36,0.35)"}`,
        background: done ? "rgba(52,211,153,0.08)" : "rgba(251,191,36,0.08)",
        borderRadius: 8, padding: "9px 11px",
      }}
    >
      <button
        type="button"
        onClick={() => expandable && setOpen((v) => !v)}
        aria-expanded={expandable ? open : undefined}
        style={{
          display: "flex", alignItems: "baseline", gap: 8, width: "100%",
          background: "none", border: "none", padding: 0, font: "inherit",
          cursor: expandable ? "pointer" : "default", textAlign: "left",
        }}
      >
        <span style={{ fontSize: 13, fontWeight: 700, color: "var(--text-1)" }}>{m.label}</span>
        <span style={{ fontSize: 11, color: accent, fontWeight: 700 }}>
          {done ? "✓" : `${m.outstanding} outstanding`}
        </span>
        <span style={{ flex: 1 }} />
        <span style={{ fontSize: 10, color: "var(--text-3)" }}>
          {m.completed} done
          {m.notApplicable > 0 && ` · ${m.notApplicable} n/a`}
          {expandable && (open ? " ▴" : " ▾")}
        </span>
      </button>

      {m.status === "nothing-required" && (
        <div style={{ fontSize: 10, color: "var(--text-3)", marginTop: 4 }}>
          No work required this month — every client row is marked Not Applicable.
        </div>
      )}

      {open && expandable && (
        <ul style={{ listStyle: "none", margin: "8px 0 0", padding: 0, borderTop: "1px solid var(--border-soft)" }}>
          {m.clients.map((c) => (
            <li
              key={`${c.client}-${c.reason}`}
              style={{ display: "flex", alignItems: "baseline", gap: 8, padding: "4px 0", fontSize: 12, borderBottom: "1px solid var(--border-soft)" }}
            >
              <span style={{ flex: 1, minWidth: 0, color: "var(--text-1)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                {c.client}
              </span>
              <span style={{ fontSize: 10, color: "var(--text-3)", whiteSpace: "nowrap" }}>{c.bookkeeper}</span>
              <span
                style={{
                  fontSize: 9, fontWeight: 700, whiteSpace: "nowrap", padding: "1px 6px", borderRadius: 3,
                  color: c.reason === "Not Completed" ? "#f87171" : "var(--text-3)",
                  background: c.reason === "Not Completed" ? "rgba(248,113,113,0.12)" : "var(--surface-2)",
                }}
              >
                {c.reason}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function MonthGroup({ title, months, color, emptyText }: { title: string; months: FathomMonth[]; color: string; emptyText: string }) {
  return (
    <div>
      <div className="dpTableSub" style={{ marginBottom: 8 }}>
        <span style={{ color, fontWeight: 700 }}>{title}</span>{" "}
        <span style={{ color: "var(--text-3)" }}>({months.length})</span>
      </div>
      {months.length === 0 ? (
        <div className="dpEmpty" style={{ padding: "14px 0", fontSize: 12 }}>{emptyText}</div>
      ) : (
        <div style={{ display: "grid", gap: 6 }}>
          {months.map((m) => <MonthCard key={m.key} m={m} />)}
        </div>
      )}
    </div>
  );
}

// Splits the Fathom tracker's months into fully-complete vs still-outstanding.
// Completion comes from the board's "Progress" custom field, not the task
// checkbox — see getFathomMonthSplit() for why that distinction matters.
export function FathomMonthSplit() {
  const [data, setData] = useState<Split | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/asana/tracker-cadence");
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const json = await res.json() as { fathomMonths?: Split };
        if (!cancelled) {
          if (!json.fathomMonths) throw new Error("no month data in response");
          setData(json.fathomMonths);
        }
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      }
    })();
    return () => { cancelled = true; };
  }, []);

  if (error) return <div className="dpEmpty" style={{ padding: "12px 0" }}>Couldn&apos;t load the month split ({error}).</div>;
  if (!data) return <div className="dpEmpty" style={{ padding: "12px 0" }}>Loading month split…</div>;
  if (data.error) return <div className="dpEmpty" style={{ padding: "12px 0" }}>Month split unavailable ({data.error}).</div>;

  // Only rows outside a quarter section are genuinely uncounted now — a row
  // with nothing ticked in Months still owes its quarter's months, so it is
  // counted in full (see getFathomMonthSplit).
  const attributed = data.totalRows - data.rowsWithoutSection;
  const unattributed = data.rowsWithoutSection;

  if (data.complete.length === 0 && data.incomplete.length === 0) {
    return <div className="dpEmpty" style={{ padding: "12px 0" }}>No client rows on this tracker have a month set, so there&apos;s nothing to split by month yet.</div>;
  }

  return (
    <div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", gap: 22 }}>
        <MonthGroup
          title="Complete months"
          months={data.complete}
          color={GREEN}
          emptyText="No month is fully complete yet."
        />
        <MonthGroup
          title="Incomplete months"
          months={data.incomplete}
          color={AMBER}
          emptyText="Every month with work assigned is complete."
        />
      </div>
      <div style={{ fontSize: 11, color: "var(--text-3)", marginTop: 14, lineHeight: 1.6 }}>
        {data.reports.pct != null && (
          <>
            <strong style={{ color: "var(--text-2)" }}>
              {data.reports.completed} of {data.reports.total} reports sent ({data.reports.pct}%)
            </strong>{" "}
            — one report is one client for one month.{" "}
          </>
        )}
        Every client owes all three months of the quarter they sit in, so a month counts as complete when
        every client covering it has that month ticked <em>and</em> is marked{" "}
        <strong style={{ color: "var(--text-2)" }}>Completed</strong> in the tracker&apos;s Progress field
        (rows marked <em>Not Applicable</em> don&apos;t hold a month open). Click any incomplete month to
        see which clients are still outstanding.
        {data.rowsWithoutMonths > 0 && (
          <>
            {" "}
            {data.rowsWithoutMonths} of {data.totalRows} rows have nothing ticked in the Months field; they
            are still counted against their quarter&apos;s months.
          </>
        )}
        {unattributed > 0 && (
          <>
            {" "}
            <strong style={{ color: "var(--text-2)" }}>
              {unattributed} of {data.totalRows} rows aren&apos;t counted here
            </strong>{" "}
            ({attributed} are) — they sit outside any quarter section, so no months can be derived for them.
          </>
        )}
      </div>
    </div>
  );
}
