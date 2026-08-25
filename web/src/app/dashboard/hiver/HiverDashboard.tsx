"use client";

import { Fragment, useState } from "react";
import Link from "next/link";
import "./hiver-dashboard.css";
import {
  HIVER_COLORS as COLORS,
  HIVER_DATE_FILTER_NOTE,
  initials,
} from "./hiver-shared";
import { useHiverData } from "./useHiverData";
import { LastRefreshed } from "@/components/LastRefreshed";

function workloadColor(pct: number) {
  if (pct < 30) return "#34d399";
  if (pct < 60) return "#fb923c";
  return "#f87171";
}

export default function HiverDashboard() {
  const {
    inboxes, users, tags, conversations,
    podByEmail, allPods,
    loading, pct, statusMsg, error, failedInboxes,
    reload, lastRefreshed,
  } = useHiverData();
  const [currentInbox, setCurrentInbox] = useState<string>("all");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [showUnmapped, setShowUnmapped] = useState(false);

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

  // Always computed across all 8 inboxes regardless of the current filter —
  // this is the "compare all of them, then jump into one" view, so narrowing
  // it to match currentInbox would just leave a 1-row table.
  const inboxSummaries = inboxes.map((inbox) => {
    const ic = conversations.filter((c) => String(c._inbox_id) === String(inbox.id));
    return {
      inbox,
      total: ic.length,
      open: ic.filter((c) => c.status === "open").length,
      closed: ic.filter((c) => c.status === "closed").length,
      unassigned: ic.filter((c) => !c.assignee?.assignee_id).length,
    };
  }).sort((a, b) => b.total - a.total);

  // Real Asana/Hubstaff pods (as opposed to Hiver's own "inbox" grouping,
  // which is what inboxSummaries/hv-pod-grid actually track despite the
  // "pod" naming left over from before that distinction was cleaned up).
  // Resolved per-conversation via its assignee's email, since Hiver has no
  // native pod concept. "Unmapped" = assigned to someone not in the pod
  // roster; "Unassigned" = no assignee at all — kept separate so the four
  // pod rows plus these two always sum to the same total shown up top.
  const POD_ORDER = ["MAS Legato", "Jemajo", "Philippines"];
  const { podSummaries, unmappedByAssignee } = (() => {
    const byPod = new Map<string, { total: number; open: number; closed: number }>();
    const byAssignee = new Map<number, { name: string; email: string; count: number }>();
    const bump = (key: string, status: string) => {
      const cur = byPod.get(key) ?? { total: 0, open: 0, closed: 0 };
      cur.total++;
      if (status === "closed") cur.closed++;
      else if (status !== "pending") cur.open++;
      byPod.set(key, cur);
    };
    for (const c of conversations) {
      const aid = c.assignee?.assignee_id;
      if (!aid) { bump("Unassigned", c.status); continue; }
      const email = users[aid]?.email?.toLowerCase();
      const podName = email ? podByEmail[email] : undefined;
      bump(podName ?? "Unmapped", c.status);
      if (!podName) {
        const u = users[aid];
        const cur = byAssignee.get(aid) ?? {
          name: u ? `${u.first_name} ${u.last_name}`.trim() : `User #${aid}`,
          email: u?.email ?? "—",
          count: 0,
        };
        cur.count++;
        byAssignee.set(aid, cur);
      }
    }
    const order = [...POD_ORDER, "Unmapped", "Unassigned"];
    const summaries = order
      .map((name) => ({ name, ...(byPod.get(name) ?? { total: 0, open: 0, closed: 0 }) }))
      .filter((p) => POD_ORDER.includes(p.name) || p.total > 0);
    return {
      podSummaries: summaries,
      unmappedByAssignee: Array.from(byAssignee.values()).sort((a, b) => b.count - a.count),
    };
  })();

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
        <button className="hv-retry-btn" onClick={reload}>↺ Retry</button>
      </div>
    );
  }

  return (
    <div className="hv-root">
      {/* Header */}
      <div className="hv-header">
        <div className="hv-header-left">
          <div className="hv-title">Overview</div>
          <div className="hv-sub">GP Bookkeeper · {inboxes.length} inboxes · {conversations.length} total conversations</div>
          <div style={{ marginTop: 8 }}>
            <Link href="/dashboard/hiver/unactioned" className="hv-drill-btn">Unactioned Emails Report</Link>
          </div>
        </div>
        <div className="hv-header-right">
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
          <button className="hv-refresh-btn" onClick={reload}>↺ Refresh</button>
          <LastRefreshed at={lastRefreshed} />
        </div>
      </div>

      <div className="hv-note">{HIVER_DATE_FILTER_NOTE}</div>

      {/* Jump to Pod */}
      {allPods.length > 0 && (
        <div className="hv-table-wrap" style={{ marginBottom: 24 }}>
          <div className="hv-table-head">
            <div className="hv-table-title">Jump to Pod</div>
          </div>
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            {allPods.map((p) => (
              <Link key={p.id} href={`/dashboard/hiver/pod/${p.id}`} className="hv-drill-btn" style={{ textDecoration: "none" }}>
                {p.name}
              </Link>
            ))}
          </div>
        </div>
      )}

      {failedInboxes.length > 0 && (
        <div className="hv-error" style={{ marginBottom: 22 }}>
          <div className="hv-error-title">⚠ {failedInboxes.length} inbox{failedInboxes.length !== 1 ? "es" : ""} didn&apos;t load</div>
          <div className="hv-error-msg">
            {failedInboxes.join(", ")} — likely rate-limited by Hiver. Numbers below exclude these. Try Refresh.
          </div>
        </div>
      )}

      {/* Aggregate strip */}
      <div className="hv-agg-strip">
        <div className="hv-agg-card">
          <div className="hv-agg-lbl">Total Conversations</div>
          <div className="hv-agg-val hv-c-or">{total}</div>
          <div className="hv-agg-sub">{inboxes.length} inboxes · {Object.keys(users).length} agents</div>
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

      {/* By Inbox summary */}
      <div className="hv-table-wrap">
        <div className="hv-table-head">
          <div className="hv-table-title">By Inbox</div>
          <div className="hv-table-sub">{inboxSummaries.length} inbox{inboxSummaries.length !== 1 ? "es" : ""} · click one to drill in</div>
        </div>
        <table className="hv-table">
          <thead>
            <tr><th>Inbox</th><th>Total</th><th>Open</th><th>Closed</th><th>Unassigned</th></tr>
          </thead>
          <tbody>
            {inboxSummaries.map(({ inbox, total: t, open: o, closed: cl, unassigned: u }) => (
              <tr key={inbox.id}>
                <td className="hv-table-primary">
                  <Link href={`/dashboard/hiver/inbox/${inbox.id}`} className="hv-drill-btn">
                    {inbox.display_name}
                  </Link>
                </td>
                <td className="hv-table-muted">{t}</td>
                <td style={{ color: "#fb923c", fontWeight: 700 }}>{o}</td>
                <td style={{ color: "#34d399", fontWeight: 700 }}>{cl}</td>
                <td style={{ color: u > 0 ? "#f87171" : "var(--text-3)", fontWeight: u > 0 ? 700 : 400 }}>{u}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* By Pod summary */}
      <div className="hv-table-wrap">
        <div className="hv-table-head">
          <div className="hv-table-title">By Pod</div>
          <div className="hv-table-sub">Same conversations as above, grouped by assignee rather than inbox</div>
        </div>
        <table className="hv-table">
          <thead>
            <tr><th>Pod</th><th>Total</th><th>Open</th><th>Closed</th></tr>
          </thead>
          <tbody>
            {podSummaries.map((p) => {
              if (p.name !== "Unmapped") {
                return (
                  <tr key={p.name}>
                    <td className={POD_ORDER.includes(p.name) ? "hv-table-primary" : "hv-table-muted"}>{p.name}</td>
                    <td className="hv-table-muted">{p.total}</td>
                    <td style={{ color: "#fb923c", fontWeight: 700 }}>{p.open}</td>
                    <td style={{ color: "#34d399", fontWeight: 700 }}>{p.closed}</td>
                  </tr>
                );
              }
              return (
                <Fragment key={p.name}>
                  <tr>
                    <td className="hv-table-primary">
                      <button type="button" className="hv-expand-btn" onClick={() => setShowUnmapped((v) => !v)}>
                        {p.name} {showUnmapped ? "▴" : "▾"}
                      </button>
                    </td>
                    <td className="hv-table-muted">{p.total}</td>
                    <td style={{ color: "#fb923c", fontWeight: 700 }}>{p.open}</td>
                    <td style={{ color: "#34d399", fontWeight: 700 }}>{p.closed}</td>
                  </tr>
                  {showUnmapped && (
                    <tr>
                      <td colSpan={4} style={{ padding: 0 }}>
                        <div className="hv-unmapped-detail">
                          <div className="hv-unmapped-hint">
                            Assigned to someone not yet in a pod roster — add them under Admin → Pods.
                          </div>
                          <table className="hv-table">
                            <thead>
                              <tr><th>Assignee</th><th>Email</th><th>Conversations</th></tr>
                            </thead>
                            <tbody>
                              {unmappedByAssignee.map((a) => (
                                <tr key={a.email}>
                                  <td className="hv-table-primary">{a.name}</td>
                                  <td className="hv-table-muted">{a.email}</td>
                                  <td className="hv-table-muted">{a.count}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Inbox grid */}
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
            ? { label: "Healthy",  color: "#34d399" }
            : openPct < 60
            ? { label: "Moderate", color: "#fb923c" }
            : { label: "Critical", color: "#f87171" };

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
                  <Link href={`/dashboard/hiver/inbox/${inbox.id}`} className="hv-pod-name" style={{ textDecoration: "none" }}>
                    {inbox.display_name} →
                  </Link>
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
                  <div className="hv-pod-kpi-val" style={{ color: "#fb923c" }}>{io}</div>
                  <div className="hv-pod-kpi-lbl">Open</div>
                </div>
                <div className="hv-pod-kpi">
                  <div className="hv-pod-kpi-val" style={{ color: "#4f8ef7" }}>{ip}</div>
                  <div className="hv-pod-kpi-lbl">Pending</div>
                </div>
                <div className="hv-pod-kpi">
                  <div className="hv-pod-kpi-val" style={{ color: "#34d399" }}>{icl}</div>
                  <div className="hv-pod-kpi-lbl">Closed</div>
                </div>
                <div className="hv-pod-kpi">
                  <div className="hv-pod-kpi-val" style={{ color: iu > 0 ? "#f87171" : "#34d399" }}>{iu}</div>
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
                            <span style={{ color: "#fb923c", fontWeight: 700 }}>{s.open} open</span>
                            {s.pending > 0 && <span style={{ color: "#4f8ef7", fontWeight: 700 }}>{s.pending} pend</span>}
                            <span style={{ color: "#34d399", fontWeight: 700 }}>{s.closed} closed</span>
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
                <span style={{ color: resPct >= 70 ? "#34d399" : resPct >= 40 ? "#fb923c" : "#f87171", fontWeight: 600 }}>
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
