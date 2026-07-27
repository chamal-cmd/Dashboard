import InboxDashboard from "./InboxDashboard";

export const dynamic = "force-dynamic";

export default async function HiverInboxPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <div className="shellPage" style={{ maxWidth: 1400, margin: "0 auto", padding: "28px 28px 64px" }}>
      <InboxDashboard inboxId={id} />
    </div>
  );
}
