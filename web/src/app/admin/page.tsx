import OverviewStats from "./_components/OverviewStats";

export const dynamic = "force-dynamic";

export default function AdminOverviewPage() {
  return (
    <div className="shellPage">
      <div className="shellPageTitle">Overview</div>
      <div className="shellPageSub">Snapshot of your team and pending invites.</div>
      <OverviewStats />
    </div>
  );
}
