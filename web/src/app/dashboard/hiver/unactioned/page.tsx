import UnactionedDashboard from "./UnactionedDashboard";

export const dynamic = "force-dynamic";

export default function HiverUnactionedPage() {
  return (
    <div className="shellPage" style={{ maxWidth: 1400, margin: "0 auto", padding: "28px 28px 64px" }}>
      <UnactionedDashboard />
    </div>
  );
}
