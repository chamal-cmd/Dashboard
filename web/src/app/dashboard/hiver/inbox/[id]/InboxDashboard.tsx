"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import Link from "next/link";
import "../../hiver-dashboard.css";
import {
  type Inbox,
  type HiverUser as User,
  type HiverTag as Tag,
  type HiverConversation as Conversation,
  HIVER_COLORS as COLORS,
  HIVER_DATE_FILTER_NOTE,
  initials,
  hiverFetch,
} from "../../hiver-shared";

export default function InboxDashboard({ inboxId }: { inboxId: string }) {
  const [inbox, setInbox] = useState<Inbox | null>(null);
  const [users, setUsers] = useState<Record<number, User>>({});
  const [tags, setTags] = useState<Record<number, Tag>>({});
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notFound, setNotFound] = useState(false);
  const loadRef = useRef(0);

  const load = useCallback(async () => {
    const token = ++loadRef.current;
    setLoading(true);
    setError(null);
    setNotFound(false);
    try {
      const [inboxListRaw, dataRaw] = await Promise.all([
        hiverFetch("/v1/inboxes?limit=100"),
        fetch(`/api/inbox-data/${inboxId}`).then((r) => {
          if (!r.ok) throw new Error(`HTTP ${r.status}`);
          return r.json();
        }),
      ]);
      if (token !== loadRef.current) return;

      const inboxList = (inboxListRaw as { data?: { results?: Inbox[] } }).data?.results ?? [];
      const match = inboxList.find((i) => String(i.id) === String(inboxId)) ?? null;
      if (!match) {
        setNotFound(true);
        return;
      }

      const d = dataRaw as { users: Record<number, User>; tags: Record<number, Tag>; conversations: Conversation[] };
      setInbox(match);
      setUsers(d.users);
      setTags(d.tags);
      setConversations(d.conversations);
    } catch (e) {
      if (token !== loadRef.current) return;
      setError((e as Error).message);
    } finally {
      if (token === loadRef.current) setLoading(false);
    }
  }, [inboxId]);

  // Initial load on mount. The synchronous setStates inside load are no-ops
  // here (they match the initial state values), so the cascading render the
  // rule guards against can't happen.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { load(); }, [load]);

  const open       = conversations.filter((c) => c.status === "open").length;
  const pending    = conversations.filter((c) => c.status === "pending").length;
  const closed     = conversations.filter((c) => c.status === "closed").length;
  const unassigned = conversations.filter((c) => !c.assignee?.assignee_id).length;
  const total      = conversations.length;

  const agentMap: Record<number, { open: number; pending: number; closed: number }> = {};
  conversations.forEach((c) => {
    const aid = c.assignee?.assignee_id;
    if (!aid) return;
    if (!agentMap[aid]) agentMap[aid] = { open: 0, pending: 0, closed: 0 };
    if (c.status === "closed")       agentMap[aid].closed++;
    else if (c.status === "pending") agentMap[aid].pending++;
    else                             agentMap[aid].open++;
  });
  const agentEntries = Object.entries(agentMap)
    .sort((a, b) => (b[1].open + b[1].pending) - (a[1].open + a[1].pending));

  const tagUsage: Record<number, number> = {};
  conversations.forEach((c) => (c.tag_ids || []).forEach((tid) => { tagUsage[tid] = (tagUsage[tid] || 0) + 1; }));
  const topTags = Object.entries(tagUsage).sort((a, b) => b[1] - a[1]).slice(0, 10);

  const convList = (() => {
    let cs = conversations;
    if (statusFilter !== "all") cs = cs.filter((c) => c.status === statusFilter);
    return cs.slice(0, 100);
  })();

  if (loading) {
    return (
      <div className="hv-loading">
        <div className="hv-loading-icon">@</div>
        <div className="hv-loading-title">HIVER</div>
        <div className="hv-loading-status">Loading inbox…</div>
      </div>
    );
  }

  if (notFound) {
    return (
      <div className="hv-error">
        <div className="hv-error-title">⚠ Inbox not found</div>
        <div className="hv-error-msg">No inbox with id {inboxId}.</div>
        <Link href="/dashboard/hiver" className="hv-retry-btn" style={{ textDecoration: "none", display: "inline-block" }}>← Hiver overview</Link>
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
          <div className="hv-title">{inbox?.display_name}</div>
          <div className="hv-sub">{inbox?.email}</div>
        </div>
        <div className="hv-header-right">
          <button className="hv-refresh-btn" onClick={() => load()}>↺ Refresh</button>
        </div>
      </div>

      <div className="hv-note">{HIVER_DATE_FILTER_NOTE}</div>

      {/* Total + status breakdown */}
      <div className="hv-agg-strip" style={{ gridTemplateColumns: "1fr" }}>
        <div className="hv-agg-card">
          <div className="hv-agg-lbl">Total Conversations</div>
          <div className="hv-agg-val hv-c-or">{total}</div>
          <div className="hv-agg-sub">{agentEntries.length} agent{agentEntries.length !== 1 ? "s" : ""}</div>
        </div>
      </div>
      <div className="hv-pod-kpis" style={{ marginBottom: 22 }}>
        <div className="hv-pod-kpi">
          <div className="hv-pod-kpi-val" style={{ color: "#fb923c" }}>{open}</div>
          <div className="hv-pod-kpi-lbl">Open</div>
        </div>
        <div className="hv-pod-kpi">
          <div className="hv-pod-kpi-val" style={{ color: "#4f8ef7" }}>{pending}</div>
          <div className="hv-pod-kpi-lbl">Pending</div>
        </div>
        <div className="hv-pod-kpi">
          <div className="hv-pod-kpi-val" style={{ color: "#34d399" }}>{closed}</div>
          <div className="hv-pod-kpi-lbl">Closed</div>
        </div>
        <div className="hv-pod-kpi">
          <div className="hv-pod-kpi-val" style={{ color: unassigned > 0 ? "#f87171" : "#34d399" }}>{unassigned}</div>
          <div className="hv-pod-kpi-lbl">Unassigned</div>
        </div>
      </div>

      {/* Agents */}
      <div className="hv-conv-panel" style={{ marginBottom: 22 }}>
        <div className="hv-conv-header">
          <div className="hv-conv-title">Agents ({agentEntries.length})</div>
        </div>
        {agentEntries.length === 0 ? (
          <div className="hv-pod-no-agents">No agent assignments yet</div>
        ) : (
          agentEntries.map(([aid, s], i) => {
            const u = users[Number(aid)] || { first_name: "User", last_name: "", email: "" };
            const name = `${u.first_name} ${u.last_name}`.trim();
            return (
              <div key={aid} className="hv-pod-agent-row">
                <div
                  className="hv-agent-av"
                  style={{
                    background: `linear-gradient(135deg,${COLORS[i % COLORS.length]},${COLORS[(i + 3) % COLORS.length]})`,
                  }}
                >
                  {initials(name)}
                </div>
                <div className="hv-agent-info">
                  <div className="hv-agent-name">{name}</div>
                  <div className="hv-agent-email">{u.email || ""}</div>
                </div>
                <div className="hv-agent-counts">
                  <span style={{ color: "#fb923c", fontWeight: 700 }}>{s.open} open</span>
                  {s.pending > 0 && <span style={{ color: "#4f8ef7", fontWeight: 700 }}>{s.pending} pend</span>}
                  <span style={{ color: "#34d399", fontWeight: 700 }}>{s.closed} closed</span>
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* Tags */}
      {topTags.length > 0 && (
        <div className="hv-conv-panel" style={{ marginBottom: 22 }}>
          <div className="hv-conv-header">
            <div className="hv-conv-title">Top Tags</div>
          </div>
          <div className="hv-pod-tags">
            {topTags.map(([tid, cnt]) => {
              const t = tags[Number(tid)];
              if (!t) return null;
              return (
                <span
                  key={tid}
                  className="hv-tag-pill"
                  style={{
                    background: t.color_code + "18",
                    border: `1px solid ${t.color_code}45`,
                    color: t.color_code,
                  }}
                  title={`${cnt} conversations`}
                >
                  {t.name} <span style={{ opacity: 0.6 }}>{cnt}</span>
                </span>
              );
            })}
          </div>
        </div>
      )}

      {/* Conversations panel */}
      <div className="hv-conv-panel">
        <div className="hv-conv-header">
          <div className="hv-conv-title">Conversations</div>
          <div className="hv-conv-controls">
            <select
              className="hv-inbox-sel"
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
            >
              <option value="all">All Status</option>
              <option value="open">Open</option>
              <option value="pending">Pending</option>
              <option value="closed">Closed</option>
            </select>
            <span className="hv-conv-badge">{convList.length}</span>
          </div>
        </div>
        <div className="hv-conv-list">
          {convList.length === 0 ? (
            <div className="hv-conv-empty">No conversations found</div>
          ) : (
            convList.map((c) => {
              const assigneeUser = c.assignee?.assignee_id ? users[c.assignee.assignee_id] : null;
              const convTags = (c.tag_ids || []).map((tid) => tags[tid]).filter(Boolean).slice(0, 3);
              return (
                <div key={c.id} className="hv-conv-item">
                  <div className="hv-conv-top">
                    <span className="hv-conv-id">#{c.id}</span>
                    <span className={`hv-status-badge hv-status-${c.status || "open"}`}>{c.status || "open"}</span>
                    <span className="hv-conv-assignee">
                      {assigneeUser
                        ? `${assigneeUser.first_name} ${assigneeUser.last_name}`
                        : "— unassigned"}
                    </span>
                  </div>
                  {convTags.length > 0 && (
                    <div className="hv-conv-tags">
                      {convTags.map((t) => t && (
                        <span
                          key={t.id}
                          className="hv-tag-pill-sm"
                          style={{ background: t.color_code }}
                        >
                          {t.name}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}
