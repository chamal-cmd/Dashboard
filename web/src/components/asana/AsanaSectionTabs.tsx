"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

// Replaces the old client-side "view" toggle on the single Asana page — each
// of these is now a real page with its own URL, so switching between them is
// real navigation (shareable links, back-button works), not a state flip.
const SECTIONS = [
  { href: "/dashboard/asana", label: "Overview" },
  { href: "/dashboard/asana/trackers", label: "Trackers" },
  { href: "/dashboard/asana/eofy", label: "EOFY" },
  { href: "/dashboard/asana/people", label: "Bookkeepers & Pods" },
  { href: "/dashboard/asana/tasks", label: "Task Lists" },
  { href: "/dashboard/asana/insights", label: "Insights" },
  { href: "/dashboard/asana/projects", label: "Projects" },
] as const;

export function AsanaSectionTabs() {
  const pathname = usePathname();
  return (
    <div
      className="acTabBar"
      style={{ marginBottom: 14, position: "sticky", top: 0, zIndex: 30, background: "rgba(20,21,42,0.92)", backdropFilter: "blur(6px)", padding: "10px 0", marginTop: -10 }}
    >
      {SECTIONS.map((s) => (
        <Link key={s.href} href={s.href} className={`acTab ${pathname === s.href ? "acTabActive" : ""}`}>
          {s.label}
        </Link>
      ))}
    </div>
  );
}
