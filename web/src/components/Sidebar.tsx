"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import "./shell-theme.css";

export interface SidebarItem {
  href: string;
  label: string;
  icon: string;
}

const SIDEBAR_COLLAPSED_KEY = "sidebar-collapsed";
const COLLAPSED_WIDTH = 64;

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
  const [collapsed, setCollapsed] = useState(false);

  useEffect(() => {
    try {
      if (localStorage.getItem(SIDEBAR_COLLAPSED_KEY) === "1") {
        // eslint-disable-next-line react-hooks/set-state-in-effect
        setCollapsed(true);
      }
    } catch { /* ignore */ }
  }, []);

  const toggle = () => {
    setCollapsed((prev) => {
      const next = !prev;
      try { localStorage.setItem(SIDEBAR_COLLAPSED_KEY, next ? "1" : "0"); } catch { /* ignore */ }
      return next;
    });
  };

  async function handleSignOut() {
    const supabase = createClient();
    await supabase.auth.signOut();
    router.push("/login");
  }

  return (
    <nav
      className={`sidebar ${collapsed ? "sidebarCollapsed" : ""}`}
      style={{ "--sidebar-width": `${collapsed ? COLLAPSED_WIDTH : width}px` } as React.CSSProperties}
    >
      <div className="sidebarLogo">
        <div className="sidebarLogoIcon">GP</div>
        {!collapsed && (
          <div className="sidebarLogoTextWrap">
            <div className="sidebarLogoText">Operations Hub</div>
            <div className="sidebarLogoSub">GP Bookkeeper Pty Ltd</div>
          </div>
        )}
      </div>

      <button
        className="sidebarToggle"
        onClick={toggle}
        title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
        aria-expanded={!collapsed}
      >
        <span aria-hidden="true">{collapsed ? "»" : "«"}</span>
        {!collapsed && <span>Collapse</span>}
      </button>

      <div className="sidebarNav">
        {items.map((item) => {
          const active = item.href === "/" ? pathname === "/" : pathname === item.href;
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`sidebarLink ${active ? "sidebarLinkActive" : ""}`}
              title={collapsed ? item.label : undefined}
            >
              <span className="sidebarLinkIcon" aria-hidden="true">{item.icon}</span>
              {!collapsed && <span className="sidebarLinkText">{item.label}</span>}
            </Link>
          );
        })}
      </div>

      <div className="sidebarFooter">
        {collapsed ? (
          <div className="sidebarUserAvatar" title={`${userName} · ${userEmail}`}>
            {userName.charAt(0).toUpperCase()}
          </div>
        ) : (
          <div className="sidebarUser">
            <div className="sidebarUserName">{userName}</div>
            <div className="sidebarUserEmail">{userEmail}</div>
          </div>
        )}
        <button className="sidebarSignOut" onClick={handleSignOut} title="Sign Out">
          {collapsed ? "⏻" : "Sign Out"}
        </button>
      </div>
    </nav>
  );
}
