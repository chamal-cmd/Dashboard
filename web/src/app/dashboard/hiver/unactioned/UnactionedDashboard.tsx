"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import Link from "next/link";
import "../hiver-dashboard.css";
import {
  type Inbox,
  type HiverUser as User,
  type HiverConversation as Conversation,
  HIVER_DATE_FILTER_NOTE,
} from "../hiver-shared";
import { LastRefreshed } from "@/components/LastRefreshed";

export default function UnactionedDashboard() {
  const [inboxes, setInboxes] = useState<Inbox[]>([]);
  const [users, setUsers] = useState<Record<number, User>>({});
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusMsg, setStatusMsg] = useState("Fetching inboxes...");
  const [pct, setPct] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [failedInboxes, setFailedInboxes] = useState<string[]>([]);
  const [lastRefreshed, setLastRefreshed] = useState<Date | null>(null);
  const loadRef = useRef(0);

  // "Unactioned" = still open or pending (not closed) — status is data we
  // already have per conversation. This used to also offer a 5d/10d "created
  // in the last N days" window via created_after on each inbox's fetch, but
  // that param is silently ignored by Hiver's API (confirmed live,
  // 2026-07-22 — see HIVER_DATE_FILTER_NOTE in hiver-shared.ts) and
  // conversations carry no timestamp to window client-side either, so the
  // toggle was picking between two identical result sets. It's gone; this
  // now honestly shows every open/pending conversation Hiver returns, with
  // no time window at all.
  const load = useCallback(async () => {
    const token = ++loadRef.current;
    setLoading(true);
    setError(null);
    setPct(0);
    setStatusMsg("Fetching inboxes...");
    setConversations([]);
    setFailedInboxes([]);

    try {
      const inboxRes = await fetch("/api/hiver/v1/inboxes?limit=100");
      if (!inboxRes.ok) throw new Error(`Inboxes failed: ${inboxRes.status}`);
      const inboxData = await inboxRes.json() as { data?: { results?: Inbox[] } };
      const rawInboxes: Inbox[] = inboxData.data?.results ?? [];
      if (token !== loadRef.current) return;
      setInboxes(rawInboxes);
      setPct(5);

      const allUsers: Record<number, User> = {};
      const allConvs: Conversation[] = [];
      const failed: string[] = [];

      for (let i = 0; i < rawInboxes.length; i++) {
        if (token !== loadRef.current) return;
        const inbox = rawInboxes[i];
        setStatusMsg(`Loading inbox ${i + 1}/${rawInboxes.length}: ${inbox.display_name}`);
        try {
          const r = await fetch(`/api/inbox-data/${inbox.id}`);
          if (!r.ok) throw new Error(`HTTP ${r.status}`);
          const d = await r.json() as { users: Record<number, User>; conversations: Conversation[] };
          Object.assign(allUsers, d.users);
          allConvs.push(...d.conversations.filter((c) => c.status === "open" || c.status === "pending"));
        } catch (err) {
          console.error(`Inbox ${inbox.id} failed:`, err);
          failed.push(inbox.display_name);
        }
        setPct(Math.round(((i + 1) / rawInboxes.length) * 95) + 5);
      }

      if (token !== loadRef.current) return;
      setUsers(allUsers);
      setConversations(allConvs);
      setFailedInboxes(failed);
      setStatusMsg("Done");
      setPct(100);
      setLastRefreshed(new Date());
    } catch (e) {
      if (token !== loadRef.current) return;
      setError((e as Error).message);
    } finally {
      if (token === loadRef.current) setLoading(false);
    }
  }, []);

  // Initial load on mount. The synchronous setStates inside load are no-ops
  // here (they match the initial state values), so the cascading render the
  // rule guards against can't happen.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { load(); }, [load]);

  const byInbox = inboxes
    .map((inbox) => ({
      inbox,
      count: conversations.filter((c) => String(c._inbox_id) === String(inbox.id)).length,
    }))
    .filter((r) => r.count > 0)
    .sort((a, b) => b.count - a.count);

  const sorted = [...conversations].sort((a, b) => b.id - a.id).slice(0, 200);

  if (loading) {
    return (
      <div className="hv-loading">
        <div className="hv-loading-icon">@</div>
        <div className="hv-loading-title">HIVER</div>
        <div className="hv-loading-status">{statusMsg}</div>
        <div className="hv-loading-pct">{pct}%</div>
        <div className="hv-loading-bar-track">
          <div className="hv-loading-bar-fill" style={{ width: `${pct}%` }} />
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="hv-error">
        <div className="hv-error-title">⚠ Failed to load</div>
        <div className="hv-error-msg">{error}</div>
        <button className="hv-retry-btn" onClick={() => load()}>↺ Retry</button>
      </div>
    );
  }

  return (
    <div className="hv-root">
      {/* Header */}
      <div className="hv-header">
        <div className="hv-header-left">
          <div style={{ marginBottom: 6 }}>
            <Link href="/dashboard/hiver" style={{ fontSize: 12, color: "#fb923c", textDecoration: "none" }}>← Hiver overview</Link>
          </div>
          <div className="hv-title">Unactioned Emails</div>
          <div className="hv-sub">Every open or pending conversation, across all inboxes</div>
        </div>
        <div className="hv-header-right">
          <button className="hv-refresh-btn" onClick={() => load()}>↺ Refresh</button>
          <LastRefreshed at={lastRefreshed} />
        </div>
      </div>

      <div className="hv-note">{HIVER_DATE_FILTER_NOTE} This report previously offered a 5/10-day created-in-the-last-N-days toggle — removed for the same reason, since that window was never actually being applied.</div>

      {failedInboxes.length > 0 && (
        <div className="hv-error" style={{ marginBottom: 22 }}>
          <div className="hv-error-title">⚠ {failedInboxes.length} inbox{failedInboxes.length !== 1 ? "es" : ""} didn&apos;t load</div>
          <div className="hv-error-msg">
            {failedInboxes.join(", ")} — likely rate-limited by Hiver. Numbers below exclude these. Try Refresh.
          </div>
        </div>
      )}

      {/* Total */}
      <div className="hv-agg-strip" style={{ gridTemplateColumns: "1fr", marginBottom: 22 }}>
        <div className="hv-agg-card">
          <div className="hv-agg-lbl">Unactioned Emails</div>
          <div className="hv-agg-val hv-c-or">{conversations.length}</div>
          <div className="hv-agg-sub">Open or pending, across {byInbox.length} inbox{byInbox.length !== 1 ? "es" : ""}</div>
        </div>
      </div>

      {/* By Inbox */}
      <div className="hv-table-wrap" style={{ marginBottom: 22 }}>
        <div className="hv-table-head">
          <div className="hv-table-title">By Inbox</div>
          <div className="hv-table-sub">{byInbox.length} with unactioned mail</div>
        </div>
        {byInbox.length === 0 ? (
          <div className="hv-conv-empty">Nothing unactioned right now.</div>
        ) : (
          <table className="hv-table">
            <thead><tr><th>Inbox</th><th>Unactioned</th></tr></thead>
            <tbody>
              {byInbox.map(({ inbox, count }) => (
                <tr key={inbox.id}>
                  <td className="hv-table-primary">
                    <Link href={`/dashboard/hiver/inbox/${inbox.id}`} className="hv-drill-btn">
                      {inbox.display_name}
                    </Link>
                  </td>
                  <td style={{ color: "#fb923c", fontWeight: 700 }}>{count}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* List */}
      <div className="hv-conv-panel">
        <div className="hv-conv-header">
          <div className="hv-conv-title">Conversations</div>
          <span className="hv-conv-badge">{sorted.length}{conversations.length > 200 ? ` of ${conversations.length}` : ""}</span>
        </div>
        <div className="hv-conv-list">
          {sorted.length === 0 ? (
            <div className="hv-conv-empty">No unactioned conversations found</div>
          ) : (
            sorted.map((c) => {
              const inboxName = inboxes.find((i) => String(i.id) === String(c._inbox_id))?.display_name || "";
              const assigneeUser = c.assignee?.assignee_id ? users[c.assignee.assignee_id] : null;
              const row = (
                <div className="hv-conv-top">
                  <span className="hv-conv-id">#{c.id}</span>
                  <span className={`hv-status-badge hv-status-${c.status || "open"}`}>{c.status || "open"}</span>
                  <span className="hv-conv-assignee">
                    {assigneeUser ? `${assigneeUser.first_name} ${assigneeUser.last_name}` : "— unassigned"}
                  </span>
                  <span className="hv-conv-pod">{inboxName}</span>
                </div>
              );
              return c.private_permalink ? (
                <a
                  key={c.id}
                  href={c.private_permalink}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="hv-conv-item"
                  style={{ display: "block", textDecoration: "none", color: "inherit" }}
                >
                  {row}
                </a>
              ) : (
                <div key={c.id} className="hv-conv-item">{row}</div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}
