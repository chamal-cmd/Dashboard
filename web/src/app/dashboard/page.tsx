import { getAircallOverview } from "@/lib/data/aircall";
import { getHubstaffOverview } from "@/lib/data/hubstaff";
import OverviewDashboard from "./OverviewDashboard";
import "@/components/detail-page-theme.css";
import "@/components/info-tip.css";
// hubUnavailable (below) is defined here, not in detail-page-theme.css.
// This is the ONLY file in the app that imports it, yet 17 other files use
// its classes (hubCard, hubUnavailable, etc.) — Next.js is folding it into
// a shared/global CSS chunk from this one import. Don't remove it without
// checking those other call sites first.
import "./dashboard-theme.css";

export const dynamic = "force-dynamic";

// Rebuilt 2026-08-19 to add a real date-range picker (request: "let's have
// the ability to choose the date filters") — Aircall/Hubstaff now behave
// like their own detail pages: this fetches an initial 7-day window
// server-side, then OverviewDashboard (client) re-fetches both on preset
// change via their existing API routes. Asana's own section was replaced
// per a separate request ("just copy... the overall graph from Fathom, BAS
// and then org wide bar chart from Bookkeeper Project") with those actual
// components embedded directly — they're self-contained and fetch their own
// data, independent of this page's day-range picker, same as everywhere else
// they're already used.
export default async function DashboardOverviewPage() {
  const [aircall, hubstaff] = await Promise.all([
    getAircallOverview(10, 7, { skipContacts: true }),
    getHubstaffOverview(7, 10),
  ]);

  return <OverviewDashboard initialAircall={aircall} initialHubstaff={hubstaff} />;
}
