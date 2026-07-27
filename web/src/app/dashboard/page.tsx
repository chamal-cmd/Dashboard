import AsanaCard from "./_components/AsanaCard";
import AircallCard from "./_components/AircallCard";
import HubstaffCard from "./_components/HubstaffCard";
import { getAsanaOverview } from "@/lib/data/asana";
import { getAircallOverview } from "@/lib/data/aircall";
import { getHubstaffOverview } from "@/lib/data/hubstaff";
import { getAdminSettings, statusFor, type HealthStatus } from "@/lib/data/settings";
import { InfoTip } from "@/components/InfoTip";
import { RefreshButton } from "@/components/RefreshButton";
import "./dashboard-theme.css";
import "@/components/info-tip.css";

export const dynamic = "force-dynamic";

const HEALTH_COLOR: Record<HealthStatus, string> = { ok: "#34d399", warn: "#fb923c", critical: "#f87171" };
const HEALTH_LABEL: Record<HealthStatus, string> = { ok: "Healthy", warn: "Warning", critical: "Critical" };

export default async function DashboardOverviewPage() {
  const [asana, aircall, hubstaff, settings] = await Promise.all([
    getAsanaOverview(),
    getAircallOverview(),
    getHubstaffOverview(7, 10),
    getAdminSettings().catch(() => ({} as Record<string, number>)),
  ]);

  // Hiver is deliberately not shown on this page for now (removed on request):
  // its only available count needs a ~1-2 min per-inbox sweep, since Hiver's
  // global count endpoint is permanently 503 for this account. The dedicated
  // /dashboard/hiver page still has the full live breakdown.
  const overviewStats = [
    { key: "tasks", label: "Open tasks (Asana)", value: asana.openTotal, tip: "Every incomplete Asana task across all clients and pods, right now." },
    { key: "calls", label: "Calls received, 7d (Aircall)", value: aircall.total, tip: "All inbound and outbound calls in the last 7 days." },
    { key: "productivity", label: "Avg productivity (Hubstaff)", value: hubstaff.productivityPct != null ? `${hubstaff.productivityPct}%` : null, tip: "Total active time divided by total tracked time across everyone, weighted by hours (not a simple per-person average)." },
  ];

  // The one place the admin-configured warn/critical thresholds actually do
  // something — each pairs a metric with the exact threshold defined for it
  // in /admin/thresholds, not just whatever happens to be the "headline" stat.
  const healthStats = [
    {
      key: "overdue", label: "Overdue tasks", value: asana.overdueCount,
      status: statusFor(asana.overdueCount, settings["asana.overdue_warn"], settings["asana.overdue_critical"], "highBad"),
      tip: "Colored against the overdue-task thresholds set in Admin → Thresholds. Red/orange means this pool of overdue work has crossed a level you configured as worth flagging.",
    },
    {
      key: "activity", label: "Avg activity", value: hubstaff.avgMemberActivityPct != null ? `${hubstaff.avgMemberActivityPct}%` : null,
      status: statusFor(hubstaff.avgMemberActivityPct, settings["hubstaff.activity_warn"], settings["hubstaff.activity_critical"], "lowBad"),
      tip: "Arithmetic mean of each member's own activity %, colored against the activity thresholds in Admin → Thresholds (this one warns when activity drops below the configured level, not above it).",
    },
    {
      key: "missed", label: "Missed calls, 7d", value: aircall.missedOrVoicemail,
      status: statusFor(aircall.missedOrVoicemail, settings["aircall.missed_warn"], settings["aircall.missed_critical"], "highBad"),
      tip: "Missed or voicemailed calls in the last 7 days, colored against the missed-call thresholds set in Admin → Thresholds.",
    },
  ];

  return (
    <div className="shellPage">
      <div className="shellPageTitle">GP Bookkeeper — Operations Dashboard</div>
      <div className="shellPageSub">Live data from Asana, Aircall, and Hubstaff.</div>

      <div className="hubOverview">
        <div className="hubOverviewHead">
          <div>
            <div className="hubOverviewTitle">Combined Overview</div>
            <div className="hubOverviewSub">One snapshot — surface stats only, for a quick glance</div>
          </div>
          <RefreshButton />
        </div>
        <div className="hubStatRow">
          {overviewStats.map((s) => (
            <div className="hubStat" key={s.key}>
              <div className="hubStatVal">{s.value ?? "—"}</div>
              <div className="hubStatLbl">{s.label}<InfoTip text={s.tip} /></div>
            </div>
          ))}
        </div>

        <div className="hubHealthRow">
          {healthStats.map((s) => (
            <div className="hubHealthPill" key={s.key} title={HEALTH_LABEL[s.status]}>
              <span className="hubHealthDot" style={{ background: HEALTH_COLOR[s.status] }} />
              <span className="hubHealthVal" style={{ color: s.status === "ok" ? undefined : HEALTH_COLOR[s.status] }}>{s.value ?? "—"}</span>
              <span className="hubHealthLbl">{s.label}<InfoTip text={s.tip} /></span>
            </div>
          ))}
        </div>
      </div>

      <div className="hubSectionGrid">
        <AsanaCard
          openTotal={asana.openTotal}
          overdueCount={asana.overdueCount}
          dueSoonCount={asana.dueSoonCount}
          velocity={asana.velocity}
          trackers={asana.trackers}
        />
        <AircallCard
          total={aircall.total}
          inbound={aircall.inbound}
          outboundAnswered={aircall.outboundAnswered}
          outboundUnanswered={aircall.outboundUnanswered}
          missedOrVoicemail={aircall.missedOrVoicemail}
          recentCalls={aircall.recentCalls}
          live={!aircall.error}
        />
        <HubstaffCard
          activeCount={hubstaff.activeCount}
          productivityPct={hubstaff.productivityPct}
          avgMemberActivityPct={hubstaff.avgMemberActivityPct}
          hoursTracked={hubstaff.hoursTracked}
          projects={hubstaff.projects}
          live={!hubstaff.error}
        />
      </div>
    </div>
  );
}
