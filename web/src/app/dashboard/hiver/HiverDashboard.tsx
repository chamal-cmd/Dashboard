"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import "./hiver-dashboard.css";

interface Inbox {
  id: number;
  display_name: string;
  email: string;
  _userIds?: number[];
}
interface User {
  id: number;
  first_name: string;
  last_name: string;
  email: string;
}
interface Tag {
  id: number;
  name: string;
  color_code: string;
}
interface Conversation {
  id: number;
  status: string;
  assignee?: { assignee_id?: number };
  tag_ids?: number[];
  _inbox_id: number;
  created_at?: number;
}

const COLORS = [
  "#f97316","#4f8ef7","#22c55e","#a78bfa","#f06292",
  "#fbbf24","#60a5fa","#34d399","#e879f9","#94a3b8",
];

function initials(name: string) {
  return (name || "").split(" ").map((n) => n[0]).slice(0, 2).join("").toUpperCase() || "?";
}

function workloadColor(pct: number) {
  if (pct < 30) return "#22c55e";
  if (pct < 60) return "#f97316";
  return "#ef4444";
}

async function hiverFetch(path: string) {
  const r = await fetch(`/api/hiver${path}`);
  if (!r.ok) throw new Error(`Hiver ${r.status}: ${path}`);
  return r.json();
}

async function hiverAll(
  path: string,
  dateRange: { start: Date; stop: Date } | null
): Promise<unknown[]> {
  let results: unknown[] = [];
  let next: string | null = null;
  let basePath = path;
  if (dateRange?.start) {
    const ts = Math.floor(dateRange.start.getTime() / 1000);
    basePath = path + `&created_after=${ts}`;
  }
  do {
    const url = next ? `${basePath}&next_page=${encodeURIComponent(next)}` : basePath;
    const d = await hiverFetch(url);
    results = results.concat((d as { data?: { results?: unknown[] } }).data?.results || []);
    next = (d as { data?: { pagination?: { next_page?: string } } }).data?.pagination?.next_page || null;
  } while (next && results.length < 1000);
  return results;
}

type DatePreset = "today" | "week" | "month" | "30d" | "90d" | "all";

function computeDateRange(preset: DatePreset): { start: Date; stop: Date } | null {
  const now = new Date();
  if (preset === "today") {
    return {
      start: new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0),
      stop: new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999),
    };
  }
  if (preset === "week") {
    const day = now.getDay();
    return {
      start: new Date(now.getFullYear(), now.getMonth(), now.getDate() - day, 0, 0, 0),
      stop: new Date(now.getFullYear(), now.getMonth(), now.getDate() + (6 - day), 23, 59, 59, 999),
    };
  }
  if (preset === "month") {
    return {
      start: new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0),
      stop: new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999),
    };
  }
  if (preset === "30d") {
    return { start: new Date(Date.now() - 30 * 86400000), stop: now };
  }
  if (preset === "90d") {
    return { start: new Date(Date.now() - 90 * 86400000), stop: now };
  }
  return null;
}

export default function HiverDashboard() {
  const [inboxes, setInboxes] = useState<Inbox[]>([]);
  const [users, setUsers] = useState<Record<number, User>>({});
  const [tags, setTags] = useState<Record<number, Tag>>({});
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [currentInbox, setCurrentInbox] = useState<string>("all");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [preset, setPreset] = useState<DatePreset>("all");
  const [dateRange, setDateRange] = useState<{ start: Date; stop: Date } | null>(null);
  const [loading, setLoading] = useState(true);
  const [pct, setPct] = useState(0);
  const [statusMsg, setStatusMsg] = useState("Fetching inboxes...");
  const [error, setError] = useState<string | null>(null);
  const loadRef = useRef(0);

  const loadAll = useCallback(async (dr: { start: Date; stop: Date } | null) => {
    const token = ++loadRef.current;
    setLoading(true);
    setError(null);
    setPct(0);
    setStatusMsg("Fetching inboxes...");

    try {
      const rawInboxes = (await hiverAll("/v1/inboxes?limit=100", null)) as Inbox[];
      if (token !== loadRef.current) return;
      setInboxes(rawInboxes);
      setPct(5);

      const perPhase = rawInboxes.length;
      const total = 1 + perPhase * 2;
      let done = 1;

      const newUsers: Record<number, User> = {};
      const newTags: Record<number, Tag> = {};

      setStatusMsg("Fetching users & tags...");
      await Promise.all(
        rawInboxes.map(async (inbox) => {
          try {
            const [us, ts] = await Promise.all([
              hiverAll(`/v1/inboxes/${inbox.id}/users?limit=100`, null),
              hiverAll(`/v1/inboxes/${inbox.id}/tags?limit=100`, null),
            ]);
            inbox._userIds = (us as User[]).map((u) => u.id);
            (us as User[]).forEach((u) => { newUsers[u.id] = u; });
            (ts as Tag[]).forEach((t) => { newTags[t.id] = t; });
          } catch { /* skip */ }
          done++;
          setPct(Math.round((done / total) * 100));
        })
      );

      if (token !== loadRef.current) return;
      setUsers(newUsers);
      setTags(newTags);

      setStatusMsg("Fetching conversations...");
      const allConvs: Conversation[] = [];
      await Promise.all(
        rawInboxes.map(async (inbox) => {
          try {
            const cs = (await hiverAll(
              `/v1/inboxes/${inbox.id}/conversations?limit=100`,
              dr
            )) as Conversation[];
            cs.forEach((c) => {
              c._inbox_id = inbox.id;
              if (c.status === "close") c.status = "closed";
            });
            allConvs.push(...cs);
          } catch { /* skip */ }
          done++;
          setPct(Math.round((done / total) * 100));
        })
      );

      if (token !== loadRef.current) return;
      setConversations(allConvs);
      setStatusMsg("Done");
      setPct(100);
    } catch (e) {
      if (token !== loadRef.current) return;
      setError((e as Error).message);
    } finally {
      if (token === loadRef.current) setLoading(false);
    }
  }, []);

  useEffect(() => { loadAll(null); }, [loadAll]);

  function applyPreset(p: DatePreset) {
    const dr = computeDateRange(p);
    setPreset(p);
    setDateRange(dr);
    loadAll(dr);
  }

  const filtered = currentInbox === "all"
    ? conversations
    : conversations.filter((c) => String(c._inbox_id) === currentInbox);

  const open       = filtered.filter((c) => c.status === "open").length;
  const closed     = filtered.filter((c) => c.status === "closed").length;
  const unassigned = filtered.filter((c) => !c.assignee?.assignee_id).length;
  const total      = filtered.length;

  const inboxesToShow = currentInbox === "all"
    ? inboxes
    : inboxes.filter((i) => String(i.id) === currentInbox);

  const convList = (() => {
    let cs = filtered;
    if (statusFilter !== "all") cs = cs.filter((c) => c.status === statusFilter);
    return cs.slice(0, 50);
  })();

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
        <button className="hv-retry-btn" onClick={() => loadAll(dateRange)}>↺ Retry</button>
      </div>
    );
  }

  return (
    <div className="hv-root">
      {/* Header */}
      <div className="hv-header">
        <div className="hv-header-left">
          <div className="hv-title">Overview</div>
          <div className="hv-sub">GP Bookkeeper · {inboxes.length} pods · {conversations.length} total conversations</div>
        </div>
        <div className="hv-header-right">
          <div className="hv-presets">
            {(["today","week","month","30d","90d","all"] as DatePreset[]).map((p) => (
              <button
                key={p}
                className={`hv-preset-btn${preset === p ? " active" : ""}`}
                onClick={() => applyPreset(p)}
              >
                {p === "all" ? "All" : p === "today" ? "Today" : p === "week" ? "Week" : p === "month" ? "Month" : p}
              </button>
            ))}
          </div>
          <select
            className="hv-inbox-sel"
            value={currentInbox}
            onChange={(e) => setCurrentInbox(e.target.value)}
          >
            <option value="all">All Inboxes</option>
            {inboxes.map((i) => (
              <option key={i.id} value={String(i.id)}>{i.display_name}</option>
            ))}
          </select>
          <button className="hv-refresh-btn" onClick={() => loadAll(dateRange)}>↺ Refresh</button>
        </div>
      </div>

      {/* Aggregate strip */}
      <div className="hv-agg-strip">
        <div className="hv-agg-card">
          <div className="hv-agg-lbl">Total Conversations</div>
          <div className="hv-agg-val hv-c-or">{total}</div>
          <div className="hv-agg-sub">{inboxes.length} pods · {Object.keys(users).length} agents</div>
        </div>
        <div className="hv-agg-card">
          <div className="hv-agg-lbl">Open</div>
          <div className="hv-agg-val hv-c-or">{open}</div>
          <div className="hv-agg-sub">{total ? Math.round(open / total * 100) : 0}% of total</div>
        </div>
        <div className="hv-agg-card">
          <div className="hv-agg-lbl">Closed</div>
          <div className="hv-agg-val hv-c-gr">{closed}</div>
          <div className="hv-agg-sub">{total ? Math.round(closed / total * 100) : 0}% resolution rate</div>
        </div>
        <div className="hv-agg-card">
          <div className="hv-agg-lbl">Unassigned</div>
          <div className={`hv-agg-val ${unassigned > 0 ? "hv-c-rd" : "hv-c-gr"}`}>{unassigned}</div>
          <div className="hv-agg-sub">{total ? Math.round(unassigned / total * 100) : 0}% need owner</div>
        </div>
      </div>

      {/* Pod grid */}
      <div className="hv-pod-grid">
        {inboxesToShow.map((inbox, podIdx) => {
          const ic = conversations.filter((c) => String(c._inbox_id) === String(inbox.id));
          const io  = ic.filter((c) => c.status === "open").length;
          const ip  = ic.filter((c) => c.status === "pending").length;
          const icl = ic.filter((c) => c.status === "closed").length;
          const iu  = ic.filter((c) => !c.assignee?.assignee_id).length;
          const tot = ic.length;
          const openPct = tot > 0 ? (io / tot * 100) : 0;
          const resPct  = tot > 0 ? Math.round(icl / tot * 100) : 0;

          const health = openPct < 30
            ? { label: "Healthy",  color: "#22c55e" }
            : openPct < 60
            ? { label: "Moderate", color: "#f97316" }
            : { label: "Critical", color: "#ef4444" };

          // Per-agent breakdown
          const agentMap: Record<number, { open: number; pending: number; closed: number }> = {};
          ic.forEach((c) => {
            const aid = c.assignee?.assignee_id;
            if (!aid) return;
            if (!agentMap[aid]) agentMap[aid] = { open: 0, pending: 0, closed: 0 };
            if (c.status === "closed")       agentMap[aid].closed++;
            else if (c.status === "pending") agentMap[aid].pending++;
            else                             agentMap[aid].open++;
          });
          const agentEntries = Object.entries(agentMap)
            .sort((a, b) => (b[1].open + b[1].pending) - (a[1].open + a[1].pending));

          // Tag usage
          const tagUsage: Record<number, number> = {};
          ic.forEach((c) => (c.tag_ids || []).forEach((tid) => { tagUsage[tid] = (tagUsage[tid] || 0) + 1; }));
          const topTags = Object.entries(tagUsage).sort((a, b) => b[1] - a[1]).slice(0, 6);

          return (
            <div key={inbox.id} className="hv-pod-card">
              {/* Header */}
              <div className="hv-pod-header">
                <div className="hv-pod-title-group">
                  <div className="hv-pod-name">{inbox.display_name}</div>
                  <div className="hv-pod-email">{inbox.email || "—"}</div>
                </div>
                <div
                  className="hv-pod-health"
                  style={{ color: health.color, borderColor: health.color + "40", background: health.color + "12" }}
                >
                  <span className="hv-health-dot" style={{ background: health.color }} />
                  {health.label}
                </div>
              </div>

              {/* KPIs */}
              <div className="hv-pod-kpis">
                <div className="hv-pod-kpi">
                  <div className="hv-pod-kpi-val" style={{ color: "#f97316" }}>{io}</div>
                  <div className="hv-pod-kpi-lbl">Open</div>
                </div>
                <div className="hv-pod-kpi">
                  <div className="hv-pod-kpi-val" style={{ color: "#4f8ef7" }}>{ip}</div>
                  <div className="hv-pod-kpi-lbl">Pending</div>
                </div>
                <div className="hv-pod-kpi">
                  <div className="hv-pod-kpi-val" style={{ color: "#22c55e" }}>{icl}</div>
                  <div className="hv-pod-kpi-lbl">Closed</div>
                </div>
                <div className="hv-pod-kpi">
                  <div className="hv-pod-kpi-val" style={{ color: iu > 0 ? "#ef4444" : "#22c55e" }}>{iu}</div>
                  <div className="hv-pod-kpi-lbl">Unassigned</div>
                </div>
              </div>

              {/* Agents */}
              <div className="hv-pod-section">
                <div className="hv-pod-section-title">Agents ({agentEntries.length})</div>
                {agentEntries.length === 0 ? (
                  <div className="hv-pod-no-agents">No agent assignments yet</div>
                ) : (
                  <>
                    {agentEntries.slice(0, 5).map(([aid, s], i) => {
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
                            <span style={{ color: "#f97316", fontWeight: 700 }}>{s.open} open</span>
                            {s.pending > 0 && <span style={{ color: "#4f8ef7", fontWeight: 700 }}>{s.pending} pend</span>}
                            <span style={{ color: "#22c55e", fontWeight: 700 }}>{s.closed} closed</span>
                          </div>
                        </div>
                      );
                    })}
                    {agentEntries.length > 5 && (
                      <div className="hv-pod-more">+{agentEntries.length - 5} more agents</div>
                    )}
                  </>
                )}
              </div>

              {/* Tags */}
              {topTags.length > 0 && (
                <div className="hv-pod-section">
                  <div className="hv-pod-section-title">Top Tags</div>
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

              {/* Footer */}
              <div className="hv-pod-footer">
                <span>{tot} total conversations</span>
                <span style={{ color: resPct >= 70 ? "#22c55e" : resPct >= 40 ? "#f97316" : "#ef4444", fontWeight: 600 }}>
                  {resPct}% resolved
                </span>
              </div>
            </div>
          );
        })}
      </div>

      {/* Conversations panel */}
      <div className="hv-conv-panel">
        <div className="hv-conv-header">
          <div className="hv-conv-title">
            {currentInbox === "all"
              ? "Recent Conversations"
              : `${inboxes.find((i) => String(i.id) === currentInbox)?.display_name || ""} — Recent Conversations`}
          </div>
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
              const podName = inboxes.find((i) => String(i.id) === String(c._inbox_id))?.display_name || "";
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
                    {currentInbox === "all" && podName && (
                      <span className="hv-conv-pod">{podName}</span>
                    )}
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
