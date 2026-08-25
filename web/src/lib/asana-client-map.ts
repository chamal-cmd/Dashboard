// Client → bookkeeper roster, transcribed from "Clients_and_Bookkeepers -
// Clients & Bookkeepers" (PDF supplied 2026-07-27, re-supplied and
// re-verified against live Asana data 2026-08-07 — no changes needed from
// that pass, see the 3 pre-emptive entries below). The tracker projects'
// tasks are per-client rows with NO Asana assignee, so this map is how the
// dashboard attributes them to a bookkeeper. Keys are the EXACT task names
// found in the trackers (43 distinct names checked live 2026-07-27) — exact
// match keeps this predictable; add a key when a new client row appears.
// Client-safe module (no secrets): names only, shipped to the dashboard UI.
//
// Notes from reconciling the PDF against live Asana data:
//  - "The Surgery" follows the EOFY tracker's live assignee (Catherine),
//    distinct from "Kylie Yates- David Yates/ Surgery" (Luisa, per PDF).
//  - Tweed appears twice in the PDF (John Nestor older / Eleazar newer);
//    the newer entry (Eleazar) is used, matching the live EOFY tracker.
//  - Email-only bookkeepers in the PDF are shown by mailbox name so they
//    line up with how those people already appear in task data.
//  - "Charles McKibbin - Skin Clinic" (PDF) is the same client as the live
//    task "Skin doctor- WA", already mapped below under that name.
//  - "Leon Levitt - Baby Steps Health" and "Abir - Vibe Natural Health" (PDF)
//    are live tasks ("Baby steps", "Vibe Natural") that already carry a real
//    Asana assignee matching the PDF — no roster entry needed; the real
//    assignee always wins over this fallback map anyway.
export const CLIENT_BOOKKEEPERS: Record<string, string> = {
  "Anj Palmer- Niroga": "Thamuditha Dodanwatte",
  "Niroga": "Thamuditha Dodanwatte",
  "Anna Middleton": "Kalani Fernando",
  "Brooke Shelley": "Megha Fernando",
  "Christian Saad": "Nidhusha Sekar",
  "Dubbo Health Hub": "Thamuditha Dodanwatte",
  "E-med": "Thamuditha Dodanwatte",
  "EMED": "Thamuditha Dodanwatte",
  "Emma Johns- Springs Medical/ Springs Trust": "Megha Fernando",
  "Grace Sia": "Odara Kalansooriya",
  "Kelley Sheppard - Karmveer/ FMP": "John Nestor",
  "Kieran Frampton - GHFP / Nurture": "Eleazar Llorin",
  "Kim Ching": "melodya@gpbookkeeper.com.au",
  "Kim Ching- Other entities": "melodya@gpbookkeeper.com.au",
  "Kylie Yates- David Yates/ Surgery": "Luisa Pequiras",
  "Luke Hurst- All 3 entities": "Luisa Pequiras",
  "M3 Health- HB/ BW/ PPPC/ HO": "Catherine Rose Alforque",
  "Mary Wyatt- Grove/ Cockburn": "Luisa Pequiras",
  "Masood Noroozian Avval": "Kalani Fernando",
  "Matt Cardone- Tweed Health": "Eleazar Llorin",
  "Mead Medical": "Tharushi Athukorala",
  "Peregian Springs Doctors Group": "Megha Fernando",
  "Peter Corredig- All 4 clinics": "Eleazar Llorin",
  "Pragya and Rahul- Rye Medical": "Tharushi Athukorala",
  "Prajna Kosaraju- KSP/ Your Doctor": "fazeen@gpbookkeeper.com.au",
  "Riverstone": "Catherine Rose Alforque",
  "Sachin Patel": "Thamuditha Dodanwatte",
  "Sam Balogun": "Kalani Fernando",
  "Skin doctor- WA": "Catherine Rose Alforque",
  "The Surgery": "Catherine Rose Alforque",
  "Todd Cameron": "Thamuditha Dodanwatte",
  "Tom Maen": "Thamuditha Dodanwatte",
  "Top Health": "abdullah@gpbookkeeper.com.au",
  "Tsoake": "Thamuditha Dodanwatte",
  "Vasuki": "Kalani Fernando",
  "Vincent": "John Nestor",
  "Vincent Au": "John Nestor",
  "Westgate Medical Centre": "Tharushi Athukorala",
  // On the client roster PDF but with no live tracker row found as of
  // 2026-08-07 (checked Fathom, BAS, and both EOFY tracker projects) — added
  // pre-emptively so whichever project their row first appears in is covered
  // immediately, rather than surfacing as "Unmapped" until someone notices.
  "Duncan Stark - Our GP Medical Practice": "melodya@gpbookkeeper.com.au",
  "Linsey King - Mokare Unit Trust": "Catherine Rose Alforque",
  "Ram - Caneland Medical": "Catherine Rose Alforque",
  // In the trackers but not on the client roster PDF — left unmapped on
  // purpose so they surface as "Unmapped" rather than being guessed:
  // "Amtan Medical", "Brunswick", "Caitlin Crowden- Plantagenet",
  // "Clinic Academy", "Michael Clements".
};

// Some bookkeepers' Asana profile names are literally their email address
// (checked live 2026-07-27: abdullah@, ridmal@, fazeen@ in asana_members;
// melodya@ in task assignee names). This maps those to proper display names
// so the dashboard's naming is consistent — the underlying ids/links are
// untouched, only what's shown changes.
const EMAIL_NAMES: Record<string, string> = {
  "melodya@gpbookkeeper.com.au": "Melody Aquino",
  "fazeen@gpbookkeeper.com.au": "Fazeen Fawmy",
  "abdullah@gpbookkeeper.com.au": "Abdullah Fazeel",
  "ridmal@gpbookkeeper.com.au": "Ridmal Perera",
  // Surname not yet provided — still first-name-only pending that.
  "reymondp@financialfanatics.com": "Reymond",
};

// A few bookkeepers show up in Asana as a bare first name (no email at all),
// so EMAIL_NAMES above can't catch them. Keyed lowercase, checked in
// displayName() before falling through to "pass real names through as-is".
const FIRST_NAME_ONLY: Record<string, string> = {
  "ryan": "Ryan Sela",
};

// People to leave out of bookkeeper breakdowns (departed / not bookkeepers),
// removed on request 2026-07-27. This is display-level only — no data is
// deleted, their tasks still count in org totals, and clearing this list
// brings them straight back. Matched on the Asana assignee name AND gid so a
// rename on either side can't quietly re-admit them.
const EXCLUDED_BOOKKEEPERS = new Set([
  "ranindu jayathilaka",
  "tania weerasinghe",
  "shehan ford",
  "mahesh kumara",
  "reymond",
  "shanilka fernando",
  "ryan sela",
]);
const EXCLUDED_BOOKKEEPER_IDS = new Set([
  "1212807725085923", // Ranindu Jayathilaka
  "1211087422766544", // Tania Weerasinghe
  "1212486561050677", // Shehan Ford
  "1209494398419726", // Mahesh Kumara
  "1202477425887838", // Reymond
  "1211870673425674", // Shanilka Fernando
  "1208059593648271", // Ryan Sela
]);

// True when this person should be hidden from bookkeeper lists and charts.
export function isExcludedBookkeeper(name: string | null | undefined, id?: string | null): boolean {
  if (id && EXCLUDED_BOOKKEEPER_IDS.has(id)) return true;
  if (!name) return false;
  return EXCLUDED_BOOKKEEPERS.has(displayName(name).trim().toLowerCase());
}

// Human display name for any bookkeeper string: real names pass through,
// known emails map to their name, unknown emails fall back to a capitalised
// mailbox name (better than showing a raw address).
export function displayName(raw: string | null | undefined): string {
  if (!raw) return "Unassigned";
  const t = raw.trim();
  if (!t.includes("@")) return FIRST_NAME_ONLY[t.toLowerCase()] ?? t;
  const mapped = EMAIL_NAMES[t.toLowerCase()];
  if (mapped) return mapped;
  const local = t.split("@")[0];
  return local.charAt(0).toUpperCase() + local.slice(1);
}

// A tracker task's effective bookkeeper: the real Asana assignee when there
// is one, else the roster mapping, else "Unmapped" — always as a display name.
export function effectiveBookkeeper(taskName: string, assigneeName: string | null): string {
  return displayName(assigneeName ?? CLIENT_BOOKKEEPERS[taskName.trim()] ?? "Unmapped");
}
