import OverviewStats from "./_components/OverviewStats";

export default function AdminOverviewPage() {
  return (
    <div className="shellPage">
      <div className="shellPageTitle">Overview</div>
      <div className="shellPageSub">Snapshot of your team and pending invites.</div>
      <OverviewStats />
    </div>
  );
}
