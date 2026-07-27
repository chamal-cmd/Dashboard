"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import "@/app/dashboard/aircall/aircall-page.css"; // .acTab pill styles

// Refresh control for server-rendered pages: re-runs the page's server
// render (router.refresh) so every card re-fetches, without a full browser
// reload. Client pages with their own fetch state use their local refresh
// instead of this.
export function RefreshButton() {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [spun, setSpun] = useState(false);

  const onClick = () => {
    setSpun(true);
    startTransition(() => router.refresh());
    setTimeout(() => setSpun(false), 1200);
  };

  return (
    <button
      className="acTab"
      onClick={onClick}
      disabled={isPending}
      title="Re-fetch the latest data"
      style={{ opacity: isPending ? 0.6 : 1 }}
    >
      <span style={{ display: "inline-block", transition: "transform 0.8s ease", transform: spun ? "rotate(360deg)" : "none" }}>↻</span>
      {" "}{isPending ? "Refreshing…" : "Refresh"}
    </button>
  );
}
