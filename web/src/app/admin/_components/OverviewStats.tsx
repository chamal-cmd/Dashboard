"use client";

import { useEffect, useState } from "react";
import { authedFetch } from "@/lib/supabase/authed-fetch";
import type { AdminUserView } from "@/lib/auth/types";
import "../admin-theme.css";

export default function OverviewStats() {
  const [users, setUsers] = useState<AdminUserView[] | null>(null);

  useEffect(() => {
    authedFetch("/api/admin/users").then(async (res) => {
      if (res.ok) setUsers(await res.json());
    });
  }, []);

  const total = users?.length ?? 0;
  const active = users?.filter((u) => u.status === "active").length ?? 0;
  const pending = users?.filter((u) => u.status === "pending").length ?? 0;
  const suspended = users?.filter((u) => u.status === "suspended").length ?? 0;

  return (
    <div className="chips">
      <div className="chip"><div className="chipVal">{users ? total : "—"}</div><div className="chipLbl">Total Users</div></div>
      <div className="chip"><div className="chipVal">{users ? active : "—"}</div><div className="chipLbl">Active</div></div>
      <div className="chip"><div className="chipVal">{users ? pending : "—"}</div><div className="chipLbl">Pending Invite</div></div>
      <div className="chip"><div className="chipVal">{users ? suspended : "—"}</div><div className="chipLbl">Suspended</div></div>
    </div>
  );
}
