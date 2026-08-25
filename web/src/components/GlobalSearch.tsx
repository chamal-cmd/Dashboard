"use client";

import { useState, useEffect, useRef } from "react";
import { displayName, isExcludedBookkeeper } from "@/lib/asana-client-map";
import { useRouter } from "next/navigation";
import "./global-search.css";

interface SearchIndex {
  pods: { id: string; name: string }[];
  people: { id: string; name: string }[];
  hiverInboxes: { id: string; name: string }[];
}

interface PageLink {
  href: string;
  label: string;
}

// Every dashboard area gets a static quick-link here regardless of live
// data — the "Pages" group works even before /api/search-index resolves
// (or if it fails entirely), so search-as-navigation is never blocked on a
// network round trip.
const PAGES: PageLink[] = [
  { href: "/dashboard", label: "Overview" },
  { href: "/dashboard/asana", label: "Asana" },
  { href: "/dashboard/aircall", label: "Aircall" },
  { href: "/dashboard/hubstaff", label: "Hubstaff" },
  { href: "/dashboard/fathom-tracker", label: "Fathom Tracker" },
  // Hiver page shortcuts hidden for now, matching the sidebar nav.
  { href: "/dashboard/settings", label: "Settings" },
];

// Live groups: pods + Asana bookkeepers (Supabase). The search index still
// returns Hiver inboxes, but they are not surfaced while Hiver is hidden.
// Hubstaff/Aircall aren't indexed — those would need a live external API
// call on every page load just for search.
export default function GlobalSearch() {
  const router = useRouter();
  const [index, setIndex] = useState<SearchIndex | null>(null);
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    fetch("/api/search-index")
      .then((r) => (r.ok ? (r.json() as Promise<SearchIndex>) : null))
      .then((d) => { if (d) setIndex(d); })
      .catch(() => { /* live groups just stay empty if this fails; Pages still works */ });
  }, []);

  useEffect(() => {
    function onClickOutside(e: MouseEvent) {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    }
    function onKeyDown(e: globalThis.KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onClickOutside);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onClickOutside);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, []);

  const q = query.trim().toLowerCase();
  const matchedPages = q ? PAGES.filter((p) => p.label.toLowerCase().includes(q)) : PAGES;
  const matchedPods = q && index ? index.pods.filter((p) => p.name.toLowerCase().includes(q)).slice(0, 5) : [];
  const matchedPeople = q && index ? index.people.filter((p) => !isExcludedBookkeeper(p.name, p.id) && p.name.toLowerCase().includes(q)).slice(0, 8) : [];
  const hasResults = matchedPages.length > 0 || matchedPods.length > 0 || matchedPeople.length > 0;

  function go(href: string) {
    setQuery("");
    setOpen(false);
    router.push(href);
  }

  return (
    <div className="gsWrap" ref={wrapRef}>
      <span className="gsIcon">🔍</span>
      <input
        className="gsInput"
        type="text"
        placeholder="Search pods, bookkeepers, or jump to a page…"
        value={query}
        onChange={(e) => { setQuery(e.target.value); setOpen(true); }}
        onFocus={() => setOpen(true)}
      />
      {open && (
        <div className="gsDropdown">
          {!hasResults ? (
            <div className="gsEmpty">No matches</div>
          ) : (
            <>
              {matchedPages.length > 0 && (
                <div className="gsGroup">
                  <div className="gsGroupLbl">Pages</div>
                  {matchedPages.map((p) => (
                    <button key={p.href} className="gsItem" onClick={() => go(p.href)}>
                      {p.label}
                    </button>
                  ))}
                </div>
              )}
              {matchedPods.length > 0 && (
                <div className="gsGroup">
                  <div className="gsGroupLbl">Pods</div>
                  {matchedPods.map((p) => (
                    <button key={p.id} className="gsItem" onClick={() => go(`/dashboard/asana/pod/${p.id}`)}>
                      {displayName(p.name)}
                    </button>
                  ))}
                </div>
              )}
              {matchedPeople.length > 0 && (
                <div className="gsGroup">
                  <div className="gsGroupLbl">Bookkeepers</div>
                  {matchedPeople.map((p) => (
                    <button key={p.id} className="gsItem" onClick={() => go(`/dashboard/asana/person/${p.id}`)}>
                      {displayName(p.name)}
                    </button>
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
