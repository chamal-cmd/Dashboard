import AsanaCard from "./_components/AsanaCard";
import AircallCard from "./_components/AircallCard";
import HiverCard from "./_components/HiverCard";
import HubstaffCard from "./_components/HubstaffCard";
import { getAsanaOverview } from "@/lib/data/asana";
import { getAircallOverview } from "@/lib/data/aircall";
import { getHiverOverview } from "@/lib/data/hiver";
import { getHubstaffOverview } from "@/lib/data/hubstaff";
import { getAdminSettings, statusFor, type HealthStatus } from "@/lib/data/settings";
import "./dashboard-theme.css";

export const dynamic = "force-dynamic";

const HEALTH_COLOR: Record<HealthStatus, string> = { ok: "#22c55e", warn: "#f97316", critical: "#ef4444" };
const HEALTH_LABEL: Record<HealthStatus, string> = { ok: "Healthy", warn: "Warning", critical: "Critical" };

export default async function DashboardOverviewPage() {
  const [asana, aircall, hiver, hubstaff, settings] = await Promise.all([
    getAsanaOverview(),
    getAircallOverview(),
    getHiverOverview(),
    getHubstaffOverview(7, 10),
    getAdminSettings().catch(() => ({} as Record<string, number>)),
  ]);

  const overviewStats = [
    { key: "tasks", label: "Open tasks (Asana)", value: asana.openTotal },
    { key: "calls", label: "Calls received, 7d (Aircall)", value: aircall.total },
    { key: "emails", label: "Unresolved emails (Hiver)", value: hiver.openUnresolved },
    { key: "productivity", label: "Avg productivity (Hubstaff)", value: hubstaff.productivityPct != null ? `${hubstaff.productivityPct}%` : null },
  ];

  // The one place the admin-configured warn/critical thresholds actually do
  // something — each pairs a metric with the exact threshold defined for it
  // in /admin/thresholds, not just whatever happens to be the "headline" stat.
  const healthStats = [
    {
      key: "overdue", label: "Overdue tasks", value: asana.overdueCount,
      status: statusFor(asana.overdueCount, settings["asana.overdue_warn"], settings["asana.overdue_critical"], "highBad"),
    },
    {
      key: "activity", label: "Avg activity", value: hubstaff.avgMemberActivityPct != null ? `${hubstaff.avgMemberActivityPct}%` : null,
      status: statusFor(hubstaff.avgMemberActivityPct, settings["hubstaff.activity_warn"], settings["hubstaff.activity_critical"], "lowBad"),
    },
    {
      key: "missed", label: "Missed calls, 7d", value: aircall.missedOrVoicemail,
      status: statusFor(aircall.missedOrVoicemail, settings["aircall.missed_warn"], settings["aircall.missed_critical"], "highBad"),
    },
    {
      key: "unresolved", label: "Unresolved emails", value: hiver.openUnresolved,
      status: statusFor(hiver.openUnresolved, settings["hiver.open_warn"], settings["hiver.open_critical"], "highBad"),
    },
  ];

  return (
    <div className="shellPage">
      <div className="shellPageTitle">GP Bookkeeper — Operations Dashboard</div>
      <div className="shellPageSub">Live data from Asana, Aircall, Hubstaff, and Hiver.</div>

      <div className="hubOverview">
        <div className="hubOverviewHead">
          <div>
            <div className="hubOverviewTitle">Combined Overview</div>
            <div className="hubOverviewSub">One snapshot — surface stats only, for a quick glance</div>
          </div>
        </div>
        <div className="hubStatRow">
          {overviewStats.map((s) => (
            <div className="hubStat" key={s.key}>
              <div className="hubStatVal">{s.value ?? "—"}</div>
              <div className="hubStatLbl">{s.label}</div>
            </div>
          ))}
        </div>

        <div className="hubHealthRow">
          {healthStats.map((s) => (
            <div className="hubHealthPill" key={s.key} title={HEALTH_LABEL[s.status]}>
              <span className="hubHealthDot" style={{ background: HEALTH_COLOR[s.status] }} />
              <span className="hubHealthVal" style={{ color: s.status === "ok" ? undefined : HEALTH_COLOR[s.status] }}>{s.value ?? "—"}</span>
              <span className="hubHealthLbl">{s.label}</span>
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
        <HiverCard openUnresolved={hiver.openUnresolved} live={!hiver.error} error={hiver.error} />
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
