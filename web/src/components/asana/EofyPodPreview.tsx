"use client";

import { useState, useEffect, Fragment } from "react";
import { fmtDate } from "./TaskRow";
import { LastRefreshed } from "@/components/LastRefreshed";

interface EofyClient {
  gid: string;
  name: string;
  status: string;
  complete: boolean;
  bookkeeper: string;
}
interface EofyPodBreakdown {
  podId: string;
  pod: string;
  clients: EofyClient[];
  complete: number;
  incomplete: number;
}
interface EofyActivity {
  name: string;
  complete: boolean;
  dueOn: string | null;
}
// Only one client's activities are ever fetched/shown at a time (clicking a
// different client replaces this rather than adding another entry) — keeps
// it to one Asana subtasks call in flight, and one thing open at once matches
// the pod-level donut's own single-`expanded` pattern below.
interface ActivityState {
  gid: string;
  loading: boolean;
  error?: string;
  activities: EofyActivity[];
  detailOpen: boolean;
}

const DONE_HEX = "#34d399";
const INCOMPLETE_HEX = "#f87171";

function formatDue(dueOn: string | null): string {
  return dueOn ? fmtDate(dueOn) : "No due date";
}

// Two-colour version of the donut in FathomPodPreview.tsx — EOFY has no
// due-date concept at the pod/client level (it's an annual close, not a
// monthly/quarterly cadence), so there's nothing between "signed off" and
// "not yet", unlike Fathom/BAS's three-way done/due/upcoming split. Reused
// as-is for the per-client activity checklist below (subLabel/detailNoun
// swap the wording) since the shape — complete vs incomplete out of a total —
// is identical.
function CompletionDonut({ complete, incomplete, expanded, onToggle, subLabel = "signed off", detailNoun = "client" }: {
  complete: number; incomplete: number; expanded: boolean; onToggle: () => void; subLabel?: string; detailNoun?: string;
}) {
  const total = complete + incomplete;
  const pct = total > 0 ? Math.round((complete / total) * 100) : null;
  const size = 108;
  const strokeWidth = 14;
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const gap = complete > 0 && incomplete > 0 ? 4 : 0;
  const completeLen = total > 0 ? (complete / total) * circumference : 0;
  const incompleteLen = total > 0 ? (incomplete / total) * circumference : 0;

  return (
    <button
      type="button"
      onClick={onToggle}
      aria-expanded={expanded}
      title={expanded ? `Hide the ${detailNoun} lists` : `Show the complete/incomplete ${detailNoun} lists`}
      // Stacked, not side by side (changed on request 2026-08-10), to match
      // the Fathom/BAS donut layout: numbers read at a glance below the
      // chart instead of squeezed beside it.
      style={{ background: "none", border: "none", cursor: "pointer", padding: 0, display: "flex", flexDirection: "column", alignItems: "center", gap: 14, width: "100%", textAlign: "center" }}
    >
      <div style={{ position: "relative", width: size, height: size, flexShrink: 0 }}>
        <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} style={{ transform: "rotate(-90deg)" }}>
          <circle cx={size / 2} cy={size / 2} r={radius} fill="none" stroke="var(--surface-2)" strokeWidth={strokeWidth} />
          {complete > 0 && (
            <circle
              cx={size / 2} cy={size / 2} r={radius} fill="none"
              stroke={DONE_HEX} strokeWidth={strokeWidth} strokeLinecap="round"
              strokeDasharray={`${Math.max(completeLen - gap, 0)} ${circumference}`}
            />
          )}
          {incomplete > 0 && (
            <circle
              cx={size / 2} cy={size / 2} r={radius} fill="none"
              stroke={INCOMPLETE_HEX} strokeWidth={strokeWidth} strokeLinecap="round"
              strokeDasharray={`${Math.max(incompleteLen - gap, 0)} ${circumference}`}
              strokeDashoffset={-completeLen}
            />
          )}
        </svg>
        <div style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center" }}>
          <div style={{ fontSize: 22, fontWeight: 700, color: "var(--text-1)", lineHeight: 1 }}>{pct != null ? `${pct}%` : "—"}</div>
          <div style={{ fontSize: 10, color: "var(--text-3)", marginTop: 2 }}>{subLabel}</div>
        </div>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 6, alignItems: "center", textAlign: "center" }}>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 13, color: "var(--text-2)" }}>
          <span style={{ width: 10, height: 10, borderRadius: 3, background: DONE_HEX, flexShrink: 0 }} />
          <strong style={{ color: "var(--text-1)" }}>{complete}</strong> complete
        </span>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 13, color: "var(--text-2)" }}>
          <span style={{ width: 10, height: 10, borderRadius: 3, background: INCOMPLETE_HEX, flexShrink: 0 }} />
          <strong style={{ color: "var(--text-1)" }}>{incomplete}</strong> incomplete
        </span>
        <span style={{ fontSize: 11, color: "#4f8ef7", fontWeight: 600, marginTop: 2 }}>
          {expanded ? "▾ Hide details" : "▸ Show details"}
        </span>
      </div>
    </button>
  );
}

function ActivityList({ title, hex, activities }: { title: string; hex: string; activities: EofyActivity[] }) {
  return (
    <div style={{ flex: 1, minWidth: 220 }}>
      <div style={{ fontSize: 12, fontWeight: 700, color: hex, marginBottom: 8 }}>
        {title} <span style={{ color: "var(--text-3)", fontWeight: 400 }}>({activities.length})</span>
      </div>
      {activities.length === 0 ? (
        <div className="dpEmpty" style={{ padding: 14 }}>None</div>
      ) : (
        <table className="dpTable">
          <thead><tr><th>Activity</th><th>Due date</th></tr></thead>
          <tbody>
            {activities.map((a) => (
              <tr key={a.name}>
                <td className="dpPrimary">{a.name}</td>
                <td className="dpMuted">{formatDue(a.dueOn)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

// Client rows expand in place (a second <tr> below the clicked one) rather
// than navigating away, so the pod-level donut and bookkeeper filter above
// stay put. activityState/onSelectClient/onToggleDetail are threaded down
// from EofyPodPreview rather than owned here because Incomplete and Complete
// render two separate ClientList instances that must share ONE expanded
// client — otherwise clicking a client in one list wouldn't collapse one
// already open in the other.
function ClientList({ title, hex, clients, activityState, onSelectClient, onToggleDetail }: {
  title: string;
  hex: string;
  clients: EofyClient[];
  activityState: ActivityState | null;
  onSelectClient: (gid: string) => void;
  onToggleDetail: () => void;
}) {
  return (
    <div style={{ flex: 1, minWidth: 260 }}>
      <div style={{ fontSize: 12, fontWeight: 700, color: hex, marginBottom: 8 }}>
        {title} <span style={{ color: "var(--text-3)", fontWeight: 400 }}>({clients.length})</span>
      </div>
      {clients.length === 0 ? (
        <div className="dpEmpty" style={{ padding: 14 }}>None</div>
      ) : (
        <table className="dpTable">
          <thead><tr><th>Client</th><th>Bookkeeper</th><th>Status</th></tr></thead>
          <tbody>
            {clients.map((c) => {
              const isOpen = activityState?.gid === c.gid;
              return (
                <Fragment key={c.gid}>
                  <tr
                    onClick={() => onSelectClient(c.gid)}
                    style={{ cursor: "pointer" }}
                    title="Click to see this client's EOFY activity checklist"
                  >
                    <td className="dpPrimary">{isOpen ? "▾ " : "▸ "}{c.name}</td>
                    <td className="dpMuted">{c.bookkeeper}</td>
                    <td className="dpMuted">{c.status}</td>
                  </tr>
                  {isOpen && (
                    <tr>
                      <td colSpan={3} style={{ padding: "16px 6px" }}>
                        {activityState.loading ? (
                          <div className="dpEmpty" style={{ padding: 14 }}>Loading activities…</div>
                        ) : activityState.error ? (
                          <div className="dpEmpty" style={{ padding: 14 }}>{activityState.error}</div>
                        ) : (
                          <>
                            <CompletionDonut
                              complete={activityState.activities.filter((a) => a.complete).length}
                              incomplete={activityState.activities.filter((a) => !a.complete).length}
                              expanded={activityState.detailOpen}
                              onToggle={onToggleDetail}
                              subLabel="of activities"
                              detailNoun="activity"
                            />
                            {activityState.detailOpen && (
                              <div style={{ marginTop: 18, paddingTop: 18, borderTop: "1px solid var(--border-soft)", display: "flex", gap: 24, flexWrap: "wrap" }}>
                                <ActivityList title="Incomplete" hex={INCOMPLETE_HEX} activities={activityState.activities.filter((a) => !a.complete)} />
                                <ActivityList title="Complete" hex={DONE_HEX} activities={activityState.activities.filter((a) => a.complete)} />
                              </div>
                            )}
                          </>
                        )}
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      )}
    </div>
  );
}

export function EofyPodPreview() {
  const [pods, setPods] = useState<EofyPodBreakdown[] | null>(null);
  const [selectedPodId, setSelectedPodId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [lastRefreshed, setLastRefreshed] = useState<Date | null>(null);
  const [reloadNonce, setReloadNonce] = useState(0);
  const [expanded, setExpanded] = useState(false);
  const [bookkeeperFilter, setBookkeeperFilter] = useState<string | null>(null);
  const [activityState, setActivityState] = useState<ActivityState | null>(null);

  useEffect(() => {
    let cancelled = false;
    const load = async (attempt: number): Promise<void> => {
      try {
        const res = await fetch("/api/asana/eofy-pod-preview");
        const json = await res.json().catch(() => null) as { pods?: EofyPodBreakdown[]; error?: string } | null;
        if (cancelled) return;
        if (!res.ok) throw new Error(json?.error ?? `HTTP ${res.status}`);
        if (!json) throw new Error("The server sent a response that wasn't valid JSON.");
        if (json.error) throw new Error(json.error);
        setPods(json.pods ?? []);
        setSelectedPodId((json.pods ?? []).find((p) => p.clients.length > 0)?.podId ?? (json.pods ?? [])[0]?.podId ?? null);
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

  const selectClient = (gid: string) => {
    if (activityState?.gid === gid) {
      setActivityState(null);
      return;
    }
    setActivityState({ gid, loading: true, activities: [], detailOpen: false });
    fetch(`/api/asana/eofy-client-activities?taskGid=${encodeURIComponent(gid)}`)
      .then((res) => res.json().catch(() => null) as Promise<{ activities?: EofyActivity[]; error?: string } | null>)
      .then((json) => {
        setActivityState((cur) => {
          if (!cur || cur.gid !== gid) return cur; // user picked a different client before this resolved
          if (!json) return { ...cur, loading: false, error: "The server sent a response that wasn't valid JSON." };
          if (json.error) return { ...cur, loading: false, error: json.error };
          return { ...cur, loading: false, activities: json.activities ?? [] };
        });
      })
      .catch((e) => {
        setActivityState((cur) => (cur && cur.gid === gid ? { ...cur, loading: false, error: e instanceof Error ? e.message : String(e) } : cur));
      });
  };
  const toggleActivityDetail = () => setActivityState((cur) => (cur ? { ...cur, detailOpen: !cur.detailOpen } : cur));

  if (error) {
    return (
      <div className="dpEmpty" style={{ display: "flex", flexDirection: "column", gap: 10, alignItems: "center" }}>
        <div>Couldn&apos;t load the EOFY breakdown.</div>
        <div style={{ fontSize: 12, color: "var(--text-3)", maxWidth: 520 }}>{error}</div>
        <button type="button" className="acTab" onClick={() => { setError(null); setPods(null); setReloadNonce((n) => n + 1); }}>
          ↻ Retry
        </button>
      </div>
    );
  }
  if (!pods) return <div className="dpEmpty">Loading EOFY breakdown…</div>;

  const selected = pods.find((p) => p.podId === selectedPodId) ?? pods[0] ?? null;

  // Sorted, de-duplicated bookkeeper names for the current pod, so the
  // filter row only ever offers names that actually own a client here.
  const bookkeepers = selected
    ? Array.from(new Set(selected.clients.map((c) => c.bookkeeper))).sort((a, b) => a.localeCompare(b))
    : [];
  const filteredClients = selected
    ? bookkeeperFilter ? selected.clients.filter((c) => c.bookkeeper === bookkeeperFilter) : selected.clients
    : [];

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      <div className="acTabBar" style={{ marginBottom: 0, alignItems: "center" }}>
        {pods.map((p) => (
          <button
            key={p.podId}
            type="button"
            className={`acTab ${p.podId === selected?.podId ? "acTabActive" : ""}`}
            onClick={() => { setSelectedPodId(p.podId); setExpanded(false); setBookkeeperFilter(null); setActivityState(null); }}
          >
            {p.pod}
          </button>
        ))}
        <LastRefreshed at={lastRefreshed} />
      </div>

      {selected && bookkeepers.length > 1 && (
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          <span style={{ fontSize: 11, color: "var(--text-3)", fontWeight: 700 }}>Bookkeeper:</span>
          <button
            type="button"
            className={`acTab ${bookkeeperFilter === null ? "acTabActive" : ""}`}
            onClick={() => setBookkeeperFilter(null)}
          >
            All
          </button>
          {bookkeepers.map((name) => (
            <button
              key={name}
              type="button"
              className={`acTab ${bookkeeperFilter === name ? "acTabActive" : ""}`}
              onClick={() => setBookkeeperFilter(name)}
            >
              {name}
            </button>
          ))}
        </div>
      )}

      {selected && selected.clients.length === 0 ? (
        <div className="dpEmpty">No EOFY client tracker set up yet for {selected.pod}.</div>
      ) : selected && (
        <div className="dpTableWrap" style={{ padding: 18 }}>
          {/* Donut stays pod-wide regardless of the bookkeeper filter below
              (confirmed 2026-08-10) — only the two client lists narrow down;
              the headline % is meant to read as the whole pod's status. */}
          <CompletionDonut
            complete={selected.complete}
            incomplete={selected.incomplete}
            expanded={expanded}
            onToggle={() => setExpanded((v) => !v)}
          />
          {expanded && (
            <div style={{ marginTop: 18, paddingTop: 18, borderTop: "1px solid var(--border-soft)", display: "flex", gap: 24, flexWrap: "wrap" }}>
              <ClientList
                title="Incomplete" hex={INCOMPLETE_HEX}
                clients={filteredClients.filter((c) => !c.complete)}
                activityState={activityState}
                onSelectClient={selectClient}
                onToggleDetail={toggleActivityDetail}
              />
              <ClientList
                title="Complete" hex={DONE_HEX}
                clients={filteredClients.filter((c) => c.complete)}
                activityState={activityState}
                onSelectClient={selectClient}
                onToggleDetail={toggleActivityDetail}
              />
            </div>
          )}
        </div>
      )}
    </div>
  );
}
