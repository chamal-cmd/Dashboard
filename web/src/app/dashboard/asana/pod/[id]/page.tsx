import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getUser } from "@/lib/supabase/get-user";
import { getAsanaPodDetail } from "@/lib/data/asana-pod";
import type { AsanaTask } from "@/lib/data/asana";
import "@/components/detail-page-theme.css";

const TODAY = new Date().toISOString().slice(0, 10);

function fmtDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = iso.slice(0, 10);
  const [y, m, mo] = d.split("-");
  const months = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
  const label = `${months[parseInt(m) - 1]} ${parseInt(mo)}`;
  return parseInt(y) !== new Date().getFullYear() ? `${label}, ${y}` : label;
}

function TaskRow({ task, showCompleted }: { task: AsanaTask; showCompleted?: boolean }) {
  const overdue = !showCompleted && !!task.dueOn && task.dueOn < TODAY;
  return (
    <tr>
      <td className="dpPrimary" style={{ maxWidth: 320, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
        {task.name || "—"}
      </td>
      <td className="dpMuted" style={{ whiteSpace: "nowrap" }}>{task.assigneeName ?? "—"}</td>
      <td className="dpMuted" style={{ whiteSpace: "nowrap", color: overdue ? "#ef4444" : undefined }}>
        {showCompleted ? fmtDate(task.completedAt) : fmtDate(task.dueOn)}
        {overdue && <span style={{ fontSize: 9, background: "#ef444420", color: "#ef4444", borderRadius: 3, padding: "0 4px", marginLeft: 6 }}>overdue</span>}
      </td>
      <td className="dpMuted" style={{ maxWidth: 220, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontSize: 11 }}>
        {task.projectName ?? "—"}
      </td>
    </tr>
  );
}

export default async function AsanaPodPage({ params }: { params: Promise<{ id: string }> }) {
  // Check auth before touching data: the layout also gates, but layout and
  // page render concurrently — without this, an unauthenticated hit aborts
  // the page's queries and surfaces as a 404 instead of the login redirect.
  const user = await getUser();
  if (!user) redirect("/login");

  const { id } = await params;
  const pod = await getAsanaPodDetail(id);
  if (!pod) notFound();

  return (
    <div className="shellPage dpPage">
      <div className="dpHeader">
        <div className="dpHeaderLeft">
          <div style={{ marginBottom: 6 }}>
            <Link href="/dashboard/asana" style={{ fontSize: 12, color: "#4f8ef7", textDecoration: "none" }}>← Asana overview</Link>
          </div>
          <div className="dpTitle">{pod.name}</div>
          <div className="dpSub">{pod.byMember.length} member{pod.byMember.length !== 1 ? "s" : ""} with open tasks · Asana workload</div>
        </div>
        <span className="dpBadge dpBadgeLive">Live</span>
      </div>

      {/* ── Workload KPIs ─────────────────────────────────── */}
      <div className="dpSectionLbl">Workload</div>
      <div className="dpKpiGrid" style={{ gridTemplateColumns: "repeat(4, 1fr)" }}>
        <div className="dpKpi" style={{ "--kpi-accent": "#4f8ef7" } as React.CSSProperties}>
          <div className="dpKpiVal">{pod.open}</div>
          <div className="dpKpiLbl">Open tasks</div>
        </div>
        <div className="dpKpi" style={{ "--kpi-accent": "#ef4444" } as React.CSSProperties}>
          <div className="dpKpiVal">
            {pod.overdue}
            {pod.open > 0 && <span style={{ fontSize: 12, color: "#6b7280", fontWeight: 400 }}> ({Math.round((pod.overdue / pod.open) * 100)}%)</span>}
          </div>
          <div className="dpKpiLbl">Overdue</div>
        </div>
        <div className="dpKpi" style={{ "--kpi-accent": "#fbbf24" } as React.CSSProperties}>
          <div className="dpKpiVal">{pod.dueSoon}</div>
          <div className="dpKpiLbl">Due in next 7 days</div>
        </div>
        <div className="dpKpi" style={{ "--kpi-accent": "#a78bfa" } as React.CSSProperties}>
          <div className="dpKpiVal">{pod.avgOpenTaskAgeDays != null ? `${pod.avgOpenTaskAgeDays}d` : "—"}</div>
          <div className="dpKpiLbl">Avg open task age{pod.medianOpenTaskAgeDays != null ? ` (median ${pod.medianOpenTaskAgeDays}d)` : ""}</div>
        </div>
      </div>

      <div className="dpSectionLbl" style={{ marginTop: 8 }}>Throughput</div>
      <div className="dpKpiGrid dpKpiGridLast" style={{ gridTemplateColumns: "repeat(2, 1fr)" }}>
        <div className="dpKpi" style={{ "--kpi-accent": "#22c55e" } as React.CSSProperties}>
          <div className="dpKpiVal">{pod.completedThisWeek}</div>
          <div className="dpKpiLbl">Completed this week</div>
        </div>
        <div className="dpKpi" style={{ "--kpi-accent": "#22c55e" } as React.CSSProperties}>
          <div className="dpKpiVal">{pod.completedThisMonth}</div>
          <div className="dpKpiLbl">Completed this month</div>
        </div>
      </div>

      {/* ── By Bookkeeper ─────────────────────────────────── */}
      <div className="dpTableWrap" style={{ marginBottom: 28 }}>
        <div className="dpTableHead">
          <div>
            <div className="dpTableTitle">By Bookkeeper</div>
            <div className="dpTableSub">{pod.byMember.length} member{pod.byMember.length !== 1 ? "s" : ""} with open tasks in this pod</div>
          </div>
        </div>
        {pod.byMember.length === 0 ? (
          <div className="dpEmpty">No open tasks in this pod.</div>
        ) : (
          <table className="dpTable">
            <thead><tr><th>Bookkeeper</th><th>Open</th><th>Overdue</th></tr></thead>
            <tbody>
              {pod.byMember.map((m) => (
                <tr key={m.assigneeId ?? m.name}>
                  <td className="dpPrimary">
                    {m.assigneeId ? (
                      <Link href={`/dashboard/asana/person/${m.assigneeId}`} style={{ color: "#4f8ef7", textDecoration: "none" }}>
                        {m.name} →
                      </Link>
                    ) : m.name}
                  </td>
                  <td className="dpMuted">{m.open}</td>
                  <td style={{ color: m.overdue > 0 ? "#ef4444" : "#6b7280", fontSize: 13 }}>{m.overdue}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* ── Open by Client ────────────────────────────────── */}
      <div className="dpTableWrap" style={{ marginBottom: 28 }}>
        <div className="dpTableHead">
          <div>
            <div className="dpTableTitle">Open by Client / Project</div>
            <div className="dpTableSub">{pod.openByProject.length} projects with open tasks</div>
          </div>
        </div>
        {pod.openByProject.length === 0 ? (
          <div className="dpEmpty">No open tasks.</div>
        ) : (
          <table className="dpTable">
            <thead><tr><th>Client / Project</th><th>Open</th><th>Overdue</th></tr></thead>
            <tbody>
              {pod.openByProject.map((p) => (
                <tr key={p.project}>
                  <td className="dpPrimary">{p.project}</td>
                  <td className="dpMuted">{p.open}</td>
                  <td style={{ color: p.overdue > 0 ? "#ef4444" : "#6b7280", fontSize: 13 }}>{p.overdue}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* ── Overdue ───────────────────────────────────────── */}
      {pod.overdueTasks.length > 0 && (
        <div className="dpTableWrap" style={{ marginBottom: 28 }}>
          <div className="dpTableHead">
            <div>
              <div className="dpTableTitle" style={{ color: "#ef4444" }}>Overdue Tasks</div>
              <div className="dpTableSub">Oldest first — showing up to {pod.overdueTasks.length}</div>
            </div>
          </div>
          <table className="dpTable">
            <thead><tr><th>Task</th><th>Assignee</th><th>Due</th><th>Project</th></tr></thead>
            <tbody>{pod.overdueTasks.map((t) => <TaskRow key={t.id} task={t} />)}</tbody>
          </table>
        </div>
      )}

      {/* ── Due soon ──────────────────────────────────────── */}
      {pod.dueSoonTasks.length > 0 && (
        <div className="dpTableWrap" style={{ marginBottom: 28 }}>
          <div className="dpTableHead">
            <div>
              <div className="dpTableTitle" style={{ color: "#fbbf24" }}>Due in Next 7 Days</div>
              <div className="dpTableSub">Earliest first — showing {pod.dueSoonTasks.length}</div>
            </div>
          </div>
          <table className="dpTable">
            <thead><tr><th>Task</th><th>Assignee</th><th>Due</th><th>Project</th></tr></thead>
            <tbody>{pod.dueSoonTasks.map((t) => <TaskRow key={t.id} task={t} />)}</tbody>
          </table>
        </div>
      )}

      {/* ── Recently completed ────────────────────────────── */}
      {pod.recentCompletions.length > 0 && (
        <div className="dpTableWrap" style={{ marginBottom: 24 }}>
          <div className="dpTableHead">
            <div>
              <div className="dpTableTitle" style={{ color: "#22c55e" }}>Recently Completed</div>
              <div className="dpTableSub">Last 30 days — showing {pod.recentCompletions.length}</div>
            </div>
          </div>
          <table className="dpTable">
            <thead><tr><th>Task</th><th>Assignee</th><th>Completed</th><th>Project</th></tr></thead>
            <tbody>{pod.recentCompletions.map((t) => <TaskRow key={t.id} task={t} showCompleted />)}</tbody>
          </table>
        </div>
      )}
    </div>
  );
}
