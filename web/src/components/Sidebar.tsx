"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import "./shell-theme.css";

export interface SidebarItem {
  href: string;
  label: string;
}

export default function Sidebar({
  items,
  userName,
  userEmail,
  width = 220,
}: {
  items: SidebarItem[];
  userName: string;
  userEmail: string;
  width?: number;
}) {
  const pathname = usePathname();
  const router = useRouter();

  async function handleSignOut() {
    const supabase = createClient();
    await supabase.auth.signOut();
    router.push("/login");
  }

  return (
    <nav className="sidebar" style={{ "--sidebar-width": `${width}px` } as React.CSSProperties}>
      <div className="sidebarLogo">
        <div className="sidebarLogoIcon">GP</div>
        <div>
          <div className="sidebarLogoText">Operations Hub</div>
          <div className="sidebarLogoSub">GP Bookkeeper Pty Ltd</div>
        </div>
      </div>

      <div className="sidebarNav">
        {items.map((item) => {
          const active = item.href === "/" ? pathname === "/" : pathname === item.href;
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`sidebarLink ${active ? "sidebarLinkActive" : ""}`}
            >
              {item.label}
            </Link>
          );
        })}
      </div>

      <div className="sidebarFooter">
        <div className="sidebarUser">
          <div className="sidebarUserName">{userName}</div>
          <div className="sidebarUserEmail">{userEmail}</div>
        </div>
        <button className="sidebarSignOut" onClick={handleSignOut}>Sign Out</button>
      </div>
    </nav>
  );
}
