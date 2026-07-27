"use client";

import Link from "next/link";
import "../../hiver-dashboard.css";
import { HIVER_DATE_FILTER_NOTE } from "../../hiver-shared";
import { useHiverData } from "../../useHiverData";

export default function HiverPodDashboard({ podName }: { podName: string }) {
  const {
    users, conversations,
    podByEmail, allPods,
    loading, pct, statusMsg, error, failedInboxes,
    reload,
  } = useHiverData();

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

  // This pod's conversations = assignee's email resolves (via podByEmail) to
  // this pod's name — same email-matching Hubstaff's pod pages already use,
  // since Hiver has no native pod concept of its own.
  const podConversations = conversations.filter((c) => {
    const aid = c.assignee?.assignee_id;
    if (!aid) return false;
    const email = users[aid]?.email?.toLowerCase();
    return email ? podByEmail[email] === podName : false;
  });

  const open = podConversations.filter((c) => c.status === "open").length;
  const pending = podConversations.filter((c) => c.status === "pending").length;
  const closed = podConversations.filter((c) => c.status === "closed").length;
  const total = podConversations.length;

  const byBookkeeper = (() => {
    const map = new Map<number, { name: string; email: string; total: number; open: number; closed: number }>();
    for (const c of podConversations) {
      const aid = c.assignee!.assignee_id!;
      const u = users[aid];
      const cur = map.get(aid) ?? {
        name: u ? `${u.first_name} ${u.last_name}`.trim() : `User #${aid}`,
        email: u?.email ?? "—",
        total: 0, open: 0, closed: 0,
      };
      cur.total++;
      if (c.status === "closed") cur.closed++;
      else if (c.status !== "pending") cur.open++;
      map.set(aid, cur);
    }
    return Array.from(map.values()).sort((a, b) => b.total - a.total);
  })();

  return (
    <div className="hv-root">
      {/* Header */}
      <div className="hv-header">
        <div className="hv-header-left">
          <div style={{ marginBottom: 6 }}>
            <Link href="/dashboard/hiver" style={{ fontSize: 12, color: "#fb923c", textDecoration: "none" }}>← Hiver overview</Link>
          </div>
          <div className="hv-title">{podName}</div>
          <div className="hv-sub">{total} conversations assigned to this pod</div>
        </div>
        <div className="hv-header-right">
          <button className="hv-refresh-btn" onClick={reload}>↺ Refresh</button>
        </div>
      </div>

      <div className="hv-note">{HIVER_DATE_FILTER_NOTE}</div>

      {failedInboxes.length > 0 && (
        <div className="hv-error" style={{ marginBottom: 22 }}>
          <div className="hv-error-title">⚠ {failedInboxes.length} inbox{failedInboxes.length !== 1 ? "es" : ""} didn&apos;t load</div>
          <div className="hv-error-msg">
            {failedInboxes.join(", ")} — likely rate-limited by Hiver. Numbers below exclude these. Try Refresh.
          </div>
        </div>
      )}

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

      {/* Aggregate strip */}
      <div className="hv-agg-strip">
        <div className="hv-agg-card">
          <div className="hv-agg-lbl">Total Conversations</div>
          <div className="hv-agg-val hv-c-or">{total}</div>
        </div>
        <div className="hv-agg-card">
          <div className="hv-agg-lbl">Open</div>
          <div className="hv-agg-val hv-c-or">{open}</div>
          <div className="hv-agg-sub">{total ? Math.round(open / total * 100) : 0}% of total</div>
        </div>
        <div className="hv-agg-card">
          <div className="hv-agg-lbl">Pending</div>
          <div className="hv-agg-val" style={{ color: "#4f8ef7" }}>{pending}</div>
        </div>
        <div className="hv-agg-card">
          <div className="hv-agg-lbl">Closed</div>
          <div className="hv-agg-val hv-c-gr">{closed}</div>
          <div className="hv-agg-sub">{total ? Math.round(closed / total * 100) : 0}% resolution rate</div>
        </div>
      </div>

      {/* By Bookkeeper */}
      <div className="hv-table-wrap">
        <div className="hv-table-head">
          <div className="hv-table-title">By Bookkeeper</div>
          <div className="hv-table-sub">{byBookkeeper.length} bookkeeper{byBookkeeper.length !== 1 ? "s" : ""} in {podName} with assigned conversations</div>
        </div>
        <table className="hv-table">
          <thead>
            <tr><th>Bookkeeper</th><th>Total</th><th>Open</th><th>Closed</th></tr>
          </thead>
          <tbody>
            {byBookkeeper.length === 0 ? (
              <tr><td colSpan={4} className="hv-table-muted" style={{ textAlign: "center", padding: 20 }}>No conversations assigned to anyone in this pod in this range.</td></tr>
            ) : byBookkeeper.map((b) => (
              <tr key={b.email}>
                <td className="hv-table-primary">{b.name}</td>
                <td className="hv-table-muted">{b.total}</td>
                <td style={{ color: "#fb923c", fontWeight: 700 }}>{b.open}</td>
                <td style={{ color: "#34d399", fontWeight: 700 }}>{b.closed}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
