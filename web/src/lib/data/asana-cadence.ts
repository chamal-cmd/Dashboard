import "server-only";
import { effectiveBookkeeper } from "@/lib/asana-client-map";
import { auTodayISODate } from "@/lib/business-tz";

// Real per-period "due vs completed" analysis for the priority trackers.
//
// Why this exists: the tracker tasks carry no due_on in Asana, so the synced
// asana_tasks table can't answer "what was due when". But the boards ARE
// organised into sections of the form "<POD LEADER>- <Name> (Jul- Sep 2025)",
// i.e. one row per client per QUARTER. That section name is the missing
// period key, and the team's cadence rules turn it into a real deadline:
//   • BAS  — ATO quarterly lodgement, the 28th of the month after quarter end
//   • Fathom — monthly reports due the 12th (team-confirmed 2026-07-27)
// Sections aren't in the synced table (adding a column needs DDL we can't run
// with the service key), so this reads task→section straight from Asana in a
// single paginated call per project — cheap enough to run behind a
// client-fetched API route rather than blocking the dashboard's first paint.

const ASANA_BASE = "https://app.asana.com/api/1.0";

export interface CadencePeriod {
  period: string;        // "Jul–Sep 2025"
  sortKey: string;       // "2025-07" — chronological ordering
  dueDate: string | null; // the deadline this period's work was due by
  total: number;         // client rows in this period
  completed: number;
  open: number;
  lateOpen: number;      // still open although the deadline has passed
}

export interface TrackerCadence {
  key: string;
  label: string;
  rule: string;
  periods: CadencePeriod[];
  unsectioned: number;   // rows outside any quarter section (e.g. "Untitled section")
  error?: string;
}

const MONTH_INDEX: Record<string, number> = {
  jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5,
  jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11,
};

// Display names for months derived from a quarter section rather than read
// off a Months tick-box. Short form, matching the Months field's own option
// names so a derived month and a ticked one render identically.
const MONTH_NAMES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

// Section names vary in spacing/hyphenation across pods:
//   "POD LEADER- Jobelle (Jul- Sep 2025)" / "POD LEADER - Mahesh (Jan-Mar 2026)"
//   "Melody (Apr- Jun 2026)"
// Only the parenthesised month-range matters, so match that and ignore the rest.
const QUARTER_RE = /\(\s*([A-Za-z]{3})[a-z]*\s*-\s*([A-Za-z]{3})[a-z]*\s+(\d{4})\s*\)/;

// One calendar month a quarter covers, with its year already resolved.
export interface QuarterMonth {
  name: string;  // "Jun" — short form, matches the Months field's option names
  idx: number;   // 0-11
  year: number;
}

export function parseQuarter(
  sectionName: string
): { label: string; sortKey: string; endMonth: number; endYear: number; months: QuarterMonth[] } | null {
  const m = QUARTER_RE.exec(sectionName);
  if (!m) return null;
  const startIdx = MONTH_INDEX[m[1].toLowerCase()];
  const endIdx = MONTH_INDEX[m[2].toLowerCase()];
  const year = Number(m[3]);
  if (startIdx === undefined || endIdx === undefined) return null;
  // A quarter that wraps the calendar year (e.g. Oct–Dec is fine, but a
  // hypothetical Nov–Jan would end in the following year).
  const endYear = endIdx < startIdx ? year + 1 : year;
  const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1, 3).toLowerCase();

  // Every calendar month the section's range spans, walked start->end so a
  // year-wrapping range (Nov–Jan) resolves each month's year correctly.
  // This — NOT the per-row "Months" tick-boxes — is the authoritative list of
  // what a client in this quarter owes. See the note on monthsOwedBy below.
  const months: QuarterMonth[] = [];
  const span = ((endIdx - startIdx) + 12) % 12;
  for (let i = 0; i <= span; i++) {
    const idx = (startIdx + i) % 12;
    months.push({
      name: MONTH_NAMES[idx],
      idx,
      year: startIdx + i > 11 ? year + 1 : year,
    });
  }

  return {
    label: `${cap(m[1])}–${cap(m[2])} ${year}`,
    sortKey: `${year}-${String(startIdx + 1).padStart(2, "0")}`,
    endMonth: endIdx,
    endYear,
    months,
  };
}

// Australian financial year quarter numbering: Q1 Jul-Sep, Q2 Oct-Dec,
// Q3 Jan-Mar, Q4 Apr-Jun. The FY label uses the year the FY STARTS in (July),
// so Q4 (Apr-Jun 2026) is still "FY2025/26", not FY2026/27.
const FY_Q_BY_END_MONTH: Record<number, number> = { 8: 1, 11: 2, 2: 3, 5: 4 }; // 0-indexed month
export function fyQuarterOf(endMonth: number, endYear: number): { q: number; fyLabel: string } | null {
  const q = FY_Q_BY_END_MONTH[endMonth];
  if (!q) return null; // not a standard AU FY quarter boundary
  const fyStartYear = q <= 2 ? endYear : endYear - 1;
  const fyEndYearShort = String((fyStartYear + 1) % 100).padStart(2, "0");
  return { q, fyLabel: `FY${fyStartYear}/${fyEndYearShort}` };
}

const iso = (y: number, mZeroBased: number, d: number) =>
  `${y}-${String(mZeroBased + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;

// BAS: ATO quarterly lodgement is the 28th of the month AFTER the quarter
// ends (Sep→28 Oct, Dec→28 Feb, Mar→28 Apr, Jun→28 Jul). Lodging via a
// registered agent can extend this, so it's the baseline, not a guarantee.
function basDueDate(endMonth: number, endYear: number): string {
  const dueMonth = (endMonth + 1) % 12;
  const dueYear = endMonth === 11 ? endYear + 1 : endYear;
  // Dec quarter is the exception: ATO gives until 28 Feb, not 28 Jan.
  if (endMonth === 11) return iso(dueYear, 1, 28);
  return iso(dueYear, dueMonth, 28);
}

// Fathom: monthly reports due the 12th. A row covers a whole quarter, so the
// quarter's final report — the 12th of the month after it ends — is the point
// by which that row should be finished.
function fathomDueDate(endMonth: number, endYear: number): string {
  const dueMonth = (endMonth + 1) % 12;
  const dueYear = endMonth === 11 ? endYear + 1 : endYear;
  return iso(dueYear, dueMonth, 12);
}

type AsanaTask = {
  gid: string;
  completed: boolean;
  memberships?: { section?: { name?: string } | null }[];
};

async function fetchTasksWithSections(projectGid: string, token: string): Promise<AsanaTask[]> {
  const out: AsanaTask[] = [];
  let offset: string | undefined;
  for (;;) {
    const url = new URL(`${ASANA_BASE}/projects/${projectGid}/tasks`);
    url.searchParams.set("limit", "100");
    url.searchParams.set("opt_fields", "gid,completed,memberships.section.name");
    if (offset) url.searchParams.set("offset", offset);
    const res = await fetch(url.toString(), { headers: { Authorization: `Bearer ${token}` } });
    if (!res.ok) throw new Error(`Asana returned ${res.status}`);
    const json = await res.json();
    out.push(...((json.data ?? []) as AsanaTask[]));
    offset = json.next_page?.offset;
    if (!offset) break;
  }
  return out;
}

const TRACKERS = [
  {
    key: "monthly_reporting",
    label: "Fathom Reports",
    projectGid: "1211778930775570",
    rule: "Monthly reports due the 12th — each row covers a quarter, so its deadline is the 12th after quarter end",
    dueFor: fathomDueDate,
  },
  {
    key: "bas_lodgement",
    label: "BAS Lodgement",
    projectGid: "1211778930775523",
    rule: "ATO quarterly lodgement — 28th of the month after each quarter ends",
    dueFor: basDueDate,
  },
];

// A single month's due-date status: a client's June report is due by the 10th
// working day of July (team-confirmed 2026-08-07). "not-applicable" covers
// every month on a row whose Progress is "Not Applicable" — the client doesn't
// owe that report, so it never enters the upcoming/due clock.
//
// "due" is a single state covering everything past its deadline and not sent,
// however long ago — a June report and a January one are both simply Due. The
// UI says "Due" everywhere; there is no separate "delayed" bucket.
export type MonthDueStatus = "done" | "upcoming" | "due" | "not-applicable";

export interface PodLeaderClient {
  name: string;
  // The tracker's real completion signal — a "Progress" custom field
  // (Completed / Not Completed / Not Applicable), NOT the plain checkbox
  // used above. That's the exact reason these numbers don't match what's
  // visible in Asana — this reads the field that's actually authoritative.
  progress: string;
  // Every month this client owes a report for THIS quarter — derived from the
  // quarter section, so it's always the full quarter (see monthsOwedBy), not
  // just whatever is ticked in the Months field. `ticked` records whether
  // Asana's Months field actually has it, so the UI can show which months are
  // being counted despite nobody ticking them. `status` is this specific
  // month's due-date state, computed server-side so the UI never re-derives
  // it from progress + today's date.
  months: { name: string; ticked: boolean; status: MonthDueStatus; dueOn: string }[];
  // Display-only, quarterly trackers (BAS) ONLY: which of the quarter's 2-3
  // calendar months are individually ticked in Asana's Months field, even
  // though the lodgement itself is one report for the whole quarter.
  //
  // Why this exists alongside `months` above rather than folding into it: a
  // BAS row's Months ticks track the MONTHLY PREP WORK behind the one
  // quarterly lodgement (July's and August's books reconciled, September's
  // not yet) — real signal the board carries, but it must never be treated as
  // three separate owed reports, which is exactly what `months` means for
  // Fathom. Splitting it in would triple BAS's counted workload (see
  // quarterOwedBy). Undefined for Fathom, where `months` already IS the
  // per-month breakdown and this would just duplicate it.
  monthTicks?: { name: string; ticked: boolean }[];
  // Resolved the same way as every other tracker on the dashboard: the real
  // Asana assignee if there is one, else the client-roster mapping, else
  // "Unmapped" — these rows carry no assignee in Asana, so this is almost
  // always the roster fallback.
  bookkeeper: string;
}
// Completion measured in REPORTS, not client rows.
//
// One report = one client × one month they owe a report for. A quarter with 4
// clients each tagged for 3 months is 12 reports, so 6 delivered is 50% — NOT
// "how many of the 4 client rows are ticked", which is what a row-level count
// gives and which reads far higher than reality whenever a row is part-done.
// This is the definition every Fathom completion figure in the app uses.
//
// `notApplicable` months are excluded from `total` entirely (the client didn't
// owe that report, so it can neither count as delivered nor as outstanding),
// exactly as "Not Applicable" rows are excluded elsewhere in this file.
export interface ReportCounts {
  completed: number;     // months already sent
  due: number;           // deadline passed, still not sent — any age
  upcoming: number;      // not sent, deadline not yet reached
  outstanding: number;   // due + upcoming
  notApplicable: number; // excluded from `total` and from `pct`
  total: number;         // completed + outstanding — the real denominator
  pct: number | null;    // completed / total, null when nothing is owed
  // Owed months that nobody ticked in Asana's Months field. They are counted
  // in full above (the quarter says they're owed), but a high number here
  // means the board's Months field is being left incomplete — worth showing
  // rather than hiding, since it's the reason these figures differ from a
  // naive read of the board.
  inferredMonths: number;
}

export function countReports(clients: PodLeaderClient[]): ReportCounts {
  let completed = 0, due = 0, upcoming = 0, notApplicable = 0, inferredMonths = 0;

  for (const c of clients) {
    for (const m of c.months) {
      if (!m.ticked) inferredMonths += 1;
      if (m.status === "done") completed += 1;
      else if (m.status === "due") due += 1;
      else if (m.status === "upcoming") upcoming += 1;
      else notApplicable += 1;
    }
  }

  const outstanding = due + upcoming;
  const total = completed + outstanding;
  return {
    completed, due, upcoming, outstanding, notApplicable, total,
    pct: total > 0 ? Math.round((completed / total) * 100) : null,
    inferredMonths,
  };
}

// Sums several quarters' report counts into one (pod-level or tracker-level)
// figure. Percentages can't be averaged — a quarter with 3 reports and one
// with 60 would count equally — so this re-derives `pct` from the summed
// numerator and denominator.
export function sumReportCounts(parts: ReportCounts[]): ReportCounts {
  const t = parts.reduce<ReportCounts>((a, b) => ({
    completed: a.completed + b.completed,
    due: a.due + b.due,
    upcoming: a.upcoming + b.upcoming,
    outstanding: a.outstanding + b.outstanding,
    notApplicable: a.notApplicable + b.notApplicable,
    total: a.total + b.total,
    pct: null,
    inferredMonths: a.inferredMonths + b.inferredMonths,
  }), { completed: 0, due: 0, upcoming: 0, outstanding: 0, notApplicable: 0, total: 0, pct: null, inferredMonths: 0 });
  return { ...t, pct: t.total > 0 ? Math.round((t.completed / t.total) * 100) : null };
}

export interface PodLeaderQuarter {
  period: string;
  sortKey: string;
  // Australian financial-year framing — e.g. fyQuarter=1, fyLabel="FY2025/26"
  // for the Jul-Sep 2025 quarter. Null when the section doesn't line up with
  // a standard AU FY quarter boundary (shouldn't happen for real data, but a
  // stray/malformed section name shouldn't crash the whole report over it).
  fyQuarter: number | null;
  fyLabel: string | null;
  // Progress value -> count of CLIENT ROWS (e.g. "9 Completed, 0 Not
  // Completed, 0 N/A"). Deliberately row-level, and labelled as such in the
  // UI: it describes the state of the Asana board's rows. It is NOT the
  // completion rate — that's `reports` below, which counts client-months.
  summary: Record<string, number>;
  // The quarter's real completion, in reports (client × month). See ReportCounts.
  reports: ReportCounts;
  // True when this quarter has no section on the Asana board yet and has been
  // projected from the previous quarter's client list — see projectNextQuarter.
  // Projected quarters are shown (so the months coming up are visible) but are
  // NOT summed into the pod's completion rate: none of their reports are late,
  // so folding ~100 not-yet-due reports into the denominator would make the
  // headline drop for work nobody is behind on.
  projected: boolean;
  clients: PodLeaderClient[];
}

type RawTaskWithFields = {
  gid: string;
  name: string;
  memberships?: { section?: { name?: string } | null }[];
  assignee?: { name: string } | null;
  custom_fields?: {
    name: string;
    display_value: string | null;
    multi_enum_values?: { name: string; color: string; enabled: boolean }[];
  }[];
};

// Per-request ceiling on the Asana call. Measured 2026-08-09, a full board is
// 2 requests / ~1.9s, so 12s is generous — its job is purely to stop a stalled
// upstream from hanging the Worker until Cloudflare kills the request, which
// reaches the browser as an opaque "Failed to fetch" with no status and no log
// line. With this, a stall becomes a normal caught error and the UI can say
// what actually happened.
const ASANA_REQUEST_TIMEOUT_MS = 12_000;
// Total pages guard: a malformed `offset` that never advances would otherwise
// loop forever. 20 pages x 100 = 2,000 tasks, well clear of the ~164 real ones.
const ASANA_MAX_PAGES = 20;

async function fetchTasksWithProgress(projectGid: string, token: string): Promise<RawTaskWithFields[]> {
  const out: RawTaskWithFields[] = [];
  let offset: string | undefined;
  for (let page = 0; page < ASANA_MAX_PAGES; page++) {
    const url = new URL(`${ASANA_BASE}/projects/${projectGid}/tasks`);
    url.searchParams.set("limit", "100");
    url.searchParams.set("opt_fields", "gid,name,memberships.section.name,assignee.name,custom_fields.name,custom_fields.display_value,custom_fields.multi_enum_values.name,custom_fields.multi_enum_values.color,custom_fields.multi_enum_values.enabled");
    if (offset) url.searchParams.set("offset", offset);

    let res: Response;
    try {
      res = await fetch(url.toString(), {
        headers: { Authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(ASANA_REQUEST_TIMEOUT_MS),
      });
    } catch (e) {
      const reason = e instanceof Error && e.name === "TimeoutError"
        ? `Asana did not respond within ${ASANA_REQUEST_TIMEOUT_MS / 1000}s`
        : `Asana request failed: ${e instanceof Error ? e.message : String(e)}`;
      throw new Error(reason);
    }

    if (!res.ok) throw new Error(`Asana returned ${res.status}`);
    const json = await res.json();
    out.push(...((json.data ?? []) as RawTaskWithFields[]));
    offset = json.next_page?.offset;
    if (!offset) break;
  }
  return out;
}

const FATHOM_PROJECT_GID = "1211778930775570";
const BAS_PROJECT_GID = "1211778930775523";

// The two compliance trackers this pod breakdown covers. They share a board
// layout (quarter sections named after a pod leader) but NOT a cadence, which
// is the whole reason this is a config rather than two copies of the logic:
//
//   fathom — MONTHLY. One report per client per month, so a client in the
//            Apr–Jun quarter owes 3 reports. Due the 10th working day of the
//            following month.
//   bas    — QUARTERLY. One lodgement per client per quarter, so the same
//            client owes exactly 1. Due the ATO date: the 28th of the month
//            after quarter end, except the Dec quarter which gets until 28 Feb.
//
// Because BAS is one-report-per-row, its report count and its row count are
// the same number — unlike Fathom, where a row covers three reports and
// counting rows understated the work by 3x.
export type TrackerKey = "fathom" | "bas";

export const TRACKER_CONFIGS: Record<TrackerKey, {
  key: TrackerKey; label: string; projectGid: string; cadence: "monthly" | "quarterly";
  /** Noun for one reporting period, for UI labels ("month" / "quarter"). */
  periodNoun: string;
}> = {
  fathom: { key: "fathom", label: "Fathom Reports", projectGid: FATHOM_PROJECT_GID, cadence: "monthly", periodNoun: "month" },
  bas: { key: "bas", label: "BAS Lodgement", projectGid: BAS_PROJECT_GID, cadence: "quarterly", periodNoun: "quarter" },
};

// The three real pods, and the first names their Fathom board sections are
// tagged with. Pod names/ids match the `pods` table in Supabase (verified
// 2026-08-07: MAS Legato / Jemajo / Fanatics — corrected 2026-08-19, this had
// been misspelled "Fanatix" everywhere; note it's also not "Philippines" as
// some older docs say).
//
// Several matches per pod because sections are NOT all named after the pod
// leader. Most are "POD LEADER- Ridmal (Jul- Sep 2025)", but four are named
// plainly after the bookkeeper — "Melody (Apr- Jun 2026)". With a single
// leader-name needle those sections matched no pod at all and their 9 client
// rows were silently absent from every breakdown. Melody Aquino
// (melodya@gpbookkeeper.com.au) is in Fanatics per asana_members, so they
// belong there. Add a name here whenever a new non-leader section appears.
export const FATHOM_POD_LEADERS = [
  { podId: "11111111-0000-0000-0000-000000000001", pod: "MAS Legato", sectionMatches: ["ridmal"] },
  { podId: "11111111-0000-0000-0000-000000000002", pod: "Jemajo", sectionMatches: ["mahesh"] },
  { podId: "11111111-0000-0000-0000-000000000003", pod: "Fanatics", sectionMatches: ["jobelle", "melody"] },
] as const;

// A month's due date is the 10th working day of the month AFTER it
// (team-confirmed 2026-08-07) — same rule the deleted standalone monthly-status
// report used, now computed inline so the pod breakdown's own month pills
// carry it directly instead of needing a second table alongside this one.
//
// `sent` is what makes a month "done", NOT the row's Progress field on its
// own. A row covering Apr–Jun can be marked Progress=Completed while only Apr
// and May are ticked in Months — on the live board (checked 2026-08-07) that
// is the norm, not the exception: Jun was ticked on just 9 of the quarter's 38
// rows, against 23 for Apr. Treating Progress=Completed as "all three months
// delivered" would have declared those Junes done; treating the untagged Jun
// as simply absent (what this did before) hid it from the numbers entirely.
// Neither is true — the report hasn't been sent, so it is delayed.
function monthDueStatus(
  monthIdx: number, year: number, progress: string, sent: boolean, todayISO: string
): MonthDueStatus {
  if (progress === "Not Applicable") return "not-applicable";
  if (sent) return "done";
  const dueMonthIdx = (monthIdx + 1) % 12;
  const dueYear = monthIdx === 11 ? year + 1 : year;
  return todayISO >= nthWorkingDayISO(dueYear, dueMonthIdx, 10) ? "due" : "upcoming";
}

// Every month a client row owes a report for, and whether each has been sent.
//
// The month list comes from the row's QUARTER SECTION, not from its Months
// tick-boxes: a client in the Apr–Jun quarter owes Apr, May and Jun, full
// stop. The tick-boxes are maintained by hand and are routinely incomplete
// (see monthDueStatus above), so using them as the list of what's owed made
// the denominator drift month by month and let an unsent June vanish rather
// than show up late.
//
// A month counts as sent only when it is BOTH ticked in Months AND the row's
// Progress is Completed — a ticked month on a row nobody has marked complete
// isn't evidence the report went out.
//
// Ticked months that fall outside the row's own quarter (one real case on the
// live board: a row in Apr–Jun 2026 also ticked "Mar") are deliberately
// ignored. That month belongs to its own quarter's section, where the client
// has its own row and the month is already counted; resolving a stray tick
// against this quarter's year would invent a month in the wrong year.
//
// How many owed months went unticked is derived by countReports from the
// `ticked` flag below, so it isn't returned separately here.
// The ONE reporting period a quarterly tracker's row owes — BAS lodgement.
//
// The row is still one report — a BAS row IS the quarter's lodgement, and
// splitting it into three would triple the amount of work the team appears to
// owe, exactly as before. What changed (team-confirmed 2026-08-10): whether
// that one report counts as DONE is no longer taken from the Progress field
// alone. Progress can say Completed while the board's own Months field shows
// only 1 or 2 of the quarter's 3 months ticked — 21 rows are like this on the
// live board — and a quarter isn't actually finished until every month's
// prep is. So "done" now requires every month ticked, full stop; Progress is
// only consulted for "Not Applicable" (an explicit "this client owes
// nothing" signal that must not be overridden by an incomplete month list).
//
// Each month's own deadline is the 25th of the month AFTER it — e.g. June's
// prep is due July 25th (team rule, corrected 2026-08-18: this used to be
// the 12th working day of the following month, mirroring Fathom's
// nthWorkingDayISO mechanism, but BAS's real deadline is a fixed calendar
// date, not a working-day count). The quarter is "due" once ANY unticked
// month has passed its own deadline this way, "upcoming" while none has yet,
// "done" once all three are ticked. The displayed deadline is the LAST
// month's own due date — the point by which the whole quarter's prep should
// be finished — since that's what determines whether the quarter as a whole
// is due.
//
// Note this board has NO "Not Applicable" Progress values in the live data
// (checked 2026-08-09: 77 Completed, 9 Not Completed, 78 unset) — N/A is
// written into a free-text Comments field instead, which can't be parsed
// reliably. The branch is kept anyway so the day someone starts using the
// field properly, it works without a code change.
function quarterOwedBy(
  q: { label: string; months: QuarterMonth[] }, tickedNames: string[], progress: string, todayISO: string
): PodLeaderClient["months"] {
  if (progress === "Not Applicable") {
    const last = q.months[q.months.length - 1];
    const dueOn = last
      ? iso(last.idx === 11 ? last.year + 1 : last.year, (last.idx + 1) % 12, 25)
      : todayISO;
    return [{ name: q.label, ticked: true, status: "not-applicable", dueOn }];
  }

  const ticked = new Set(tickedNames.map((n) => n.slice(0, 3).toLowerCase()));
  const monthDeadlines = q.months.map((qm) => {
    const isTicked = ticked.has(qm.name.slice(0, 3).toLowerCase());
    const dueMonthIdx = (qm.idx + 1) % 12;
    const dueYear = qm.idx === 11 ? qm.year + 1 : qm.year;
    return { isTicked, dueOn: iso(dueYear, dueMonthIdx, 25) };
  });

  const allTicked = monthDeadlines.length > 0 && monthDeadlines.every((m) => m.isTicked);
  const anyOverdue = monthDeadlines.some((m) => !m.isTicked && todayISO >= m.dueOn);
  const status: MonthDueStatus = allTicked ? "done" : anyOverdue ? "due" : "upcoming";
  const dueOn = monthDeadlines[monthDeadlines.length - 1]?.dueOn ?? todayISO;
  return [{ name: q.label, ticked: allTicked, status, dueOn }];
}

function monthsOwedBy(
  quarterMonths: QuarterMonth[], tickedNames: string[], progress: string, todayISO: string
): PodLeaderClient["months"] {
  const ticked = new Set(tickedNames.map((n) => n.slice(0, 3).toLowerCase()));
  return quarterMonths.map((qm) => {
    const isTicked = ticked.has(qm.name.slice(0, 3).toLowerCase());
    const dueMonthIdx = (qm.idx + 1) % 12;
    const dueYear = qm.idx === 11 ? qm.year + 1 : qm.year;
    return {
      name: qm.name,
      ticked: isTicked,
      dueOn: nthWorkingDayISO(dueYear, dueMonthIdx, 10),
      status: monthDueStatus(qm.idx, qm.year, progress, isTicked && progress === "Completed", todayISO),
    };
  });
}

// Which of a quarter's calendar months are individually ticked in Asana's
// Months field — see PodLeaderClient.monthTicks for why this is kept
// separate from the report-owed months a quarterly tracker counts.
function tickedMonthList(quarterMonths: QuarterMonth[], tickedNames: string[]): { name: string; ticked: boolean }[] {
  const ticked = new Set(tickedNames.map((n) => n.slice(0, 3).toLowerCase()));
  return quarterMonths.map((qm) => ({ name: qm.name, ticked: ticked.has(qm.name.slice(0, 3).toLowerCase()) }));
}

function bucketByLeader(
  tasks: RawTaskWithFields[], sectionMatches: readonly string[], todayISO: string,
  cadence: "monthly" | "quarterly"
): PodLeaderQuarter[] {
  const needles = sectionMatches.map((n) => n.toLowerCase());
  const byQuarter = new Map<string, PodLeaderQuarter>();

  for (const t of tasks) {
    const sectionName = t.memberships?.[0]?.section?.name ?? "";
    const lower = sectionName.toLowerCase();
    if (!needles.some((n) => lower.includes(n))) continue;
    const q = parseQuarter(sectionName);
    if (!q) continue;
    const progress = t.custom_fields?.find((f) => f.name === "Progress")?.display_value ?? "—";
    const ticked = (t.custom_fields?.find((f) => f.name === "Months")?.multi_enum_values ?? [])
      .filter((m) => m.enabled)
      .map((m) => m.name);
    const months = cadence === "quarterly"
      ? quarterOwedBy({ label: q.label, months: q.months }, ticked, progress, todayISO)
      : monthsOwedBy(q.months, ticked, progress, todayISO);
    // Only meaningful for a quarterly tracker — see PodLeaderClient.monthTicks.
    // For a monthly tracker `months` above already IS this breakdown.
    const monthTicks = cadence === "quarterly" ? tickedMonthList(q.months, ticked) : undefined;
    // Rows whose client isn't on the bookkeeper roster used to be dropped here
    // ("excluded from the pod breakdown entirely", 2026-08-07). That removed
    // real client rows from the denominator: not knowing WHO owns a client
    // doesn't mean the client is owed no reports, and 12 live rows were
    // vanishing this way. They're kept and shown as "Unmapped" so the count is
    // complete and the roster gap is visible instead of hidden.
    const bookkeeper = effectiveBookkeeper(t.name, t.assignee?.name ?? null);
    const fy = fyQuarterOf(q.endMonth, q.endYear);
    const cur = byQuarter.get(q.sortKey) ?? {
      period: q.label, sortKey: q.sortKey,
      fyQuarter: fy?.q ?? null, fyLabel: fy?.fyLabel ?? null,
      summary: {}, reports: countReports([]), projected: false, clients: [],
    };
    cur.clients.push({ name: t.name, progress, months, monthTicks, bookkeeper });
    cur.summary[progress] = (cur.summary[progress] ?? 0) + 1;
    byQuarter.set(q.sortKey, cur);
  }

  // Report counts are derived once per quarter, after every client row has
  // been collected — not incrementally above, where each row only knows about
  // itself and the untagged-row checks couldn't see the quarter as a whole.
  return Array.from(byQuarter.values())
    .map((q) => ({ ...q, reports: countReports(q.clients) }))
    .sort((a, b) => a.sortKey.localeCompare(b.sortKey));
}

export interface FathomPodBreakdown {
  podId: string;
  pod: string;
  quarters: PodLeaderQuarter[];
  // This pod's completion across every REAL quarter, in reports — summed from
  // the quarters' own counts rather than averaging their percentages, so a
  // small quarter can't outweigh a large one. Projected quarters are excluded
  // (see PodLeaderQuarter.projected). See sumReportCounts.
  reports: ReportCounts;
}

// The AU financial-year quarter containing `todayISO`. FY quarters start in
// Jul/Oct/Jan/Apr, which are exactly the calendar quarter boundaries, so the
// start month is the month index rounded down to a multiple of 3.
function currentQuarterStart(todayISO: string): { startIdx: number; year: number } {
  const year = Number(todayISO.slice(0, 4));
  const monthIdx = Number(todayISO.slice(5, 7)) - 1;
  return { startIdx: Math.floor(monthIdx / 3) * 3, year };
}

const SHORT_MONTH = (idx: number) => MONTH_NAMES[idx];

// Builds the quarter we're currently IN when the Asana board has no section
// for it yet.
//
// Why this exists: the board is set up a quarter at a time, by hand. On
// 2026-08-07 the newest section was "Apr–Jun 2026" — so Q1 FY2026/27
// (Jul–Sep 2026) was already a month underway with July's report approaching
// its deadline, and the dashboard showed nothing at all for it. Waiting for
// someone to create the section means the first visibility of a quarter's work
// arrives after it has started slipping.
//
// The client list is carried forward from the pod's most recent real quarter —
// there is no other source for it, and in practice the roster barely changes
// quarter to quarter. "Not Applicable" carries forward too (a client who
// doesn't take Fathom reports generally still doesn't); every other row starts
// with no Progress, i.e. nothing sent yet. Because it's a projection, it is
// flagged `projected` and kept out of the pod's completion rate.
function projectNextQuarter(
  realQuarters: PodLeaderQuarter[], todayISO: string, cadence: "monthly" | "quarterly"
): PodLeaderQuarter | null {
  if (realQuarters.length === 0) return null;

  const { startIdx, year } = currentQuarterStart(todayISO);
  const sortKey = `${year}-${String(startIdx + 1).padStart(2, "0")}`;
  // Already on the board (or somehow ahead of it) — nothing to project.
  if (realQuarters.some((q) => q.sortKey >= sortKey)) return null;

  const previous = realQuarters[realQuarters.length - 1];
  const months: QuarterMonth[] = [0, 1, 2].map((i) => {
    const idx = (startIdx + i) % 12;
    return { name: SHORT_MONTH(idx), idx, year: startIdx + i > 11 ? year + 1 : year };
  });
  const endMonth = months[months.length - 1].idx;
  const endYear = months[months.length - 1].year;
  const fy = fyQuarterOf(endMonth, endYear);
  const label = `${SHORT_MONTH(startIdx)}–${SHORT_MONTH(endMonth)} ${year}`;

  const clients: PodLeaderClient[] = previous.clients.map((c) => {
    // "—" is exactly what bucketByLeader uses for a real row whose Progress
    // field is unset, so a projected quarter's rows, chips and month columns
    // render identically to a real quarter's — the only visible difference is
    // the Projected badge.
    const progress = c.progress === "Not Applicable" ? "Not Applicable" : "—";
    return {
      name: c.name,
      progress,
      // Nothing is ticked on a quarter that doesn't exist yet, so every period
      // is unsent — which the deadline rule turns into upcoming or due on its
      // own, exactly as it would for a real section.
      months: cadence === "quarterly"
        ? quarterOwedBy({ label, months }, [], progress, todayISO)
        : monthsOwedBy(months, [], progress, todayISO),
      // Nothing can be ticked yet on a quarter with no section to tick it in.
      monthTicks: cadence === "quarterly" ? tickedMonthList(months, []) : undefined,
      bookkeeper: c.bookkeeper,
    };
  });

  const summary: Record<string, number> = {};
  for (const c of clients) summary[c.progress] = (summary[c.progress] ?? 0) + 1;

  return {
    period: label,
    sortKey,
    fyQuarter: fy?.q ?? null,
    fyLabel: fy?.fyLabel ?? null,
    summary,
    reports: countReports(clients),
    projected: true,
    clients,
  };
}

// Every pod's client list per quarter for one compliance tracker. Fetches the
// project's tasks ONCE and buckets them by pod in memory rather than
// re-fetching per pod: the underlying Asana call downloads the whole project
// regardless of which pod you're filtering for, so calling it once per pod
// would triple the same download for no benefit.
//
// Both trackers share this path; only TRACKER_CONFIGS[key].cadence changes what
// one row owes (3 monthly reports vs 1 quarterly lodgement).
export async function getTrackerPodBreakdown(
  trackerKey: TrackerKey
): Promise<{ tracker: TrackerKey; label: string; periodNoun: string; cadence: "monthly" | "quarterly"; pods: FathomPodBreakdown[]; error?: string }> {
  const cfg = TRACKER_CONFIGS[trackerKey];
  const base = { tracker: cfg.key, label: cfg.label, periodNoun: cfg.periodNoun, cadence: cfg.cadence };
  const token = process.env.ASANA_ACCESS_TOKEN;
  if (!token) return { ...base, pods: [], error: "not configured" };
  try {
    const tasks = await fetchTasksWithProgress(cfg.projectGid, token);
    // Australian "today", like every other date comparison in the app — a
    // UTC date is a full day behind AU for ~10 hours daily, which on a
    // deadline boundary keeps a period reading "upcoming" for a day after it
    // has actually gone overdue. See lib/business-tz.ts.
    const todayISO = auTodayISODate();
    const pods = FATHOM_POD_LEADERS.map(({ podId, pod, sectionMatches }) => {
      const real = bucketByLeader(tasks, sectionMatches, todayISO, cfg.cadence);
      const projection = projectNextQuarter(real, todayISO, cfg.cadence);
      return {
        podId,
        pod,
        quarters: projection ? [...real, projection] : real,
        // Real quarters only — a projected quarter's reports are none of them
        // late, so counting them would dilute the rate (see `projected`).
        reports: sumReportCounts(real.map((q) => q.reports)),
      };
    });
    return { ...base, pods };
  } catch (e) {
    return { ...base, pods: [], error: e instanceof Error ? e.message : String(e) };
  }
}

// EOFY has a different shape to Fathom/BAS entirely, not a third cadence
// value: no quarters (it's an annual close, run once), no Progress custom
// field (checked live 2026-08-10: 100% of rows have the checkbox false too —
// completion lives in which KANBAN COLUMN a client sits in, not a field), and
// every row already carries a real Asana assignee (no roster fallback
// usually needed, kept anyway for the rare unassigned row).
//
// Board columns, in workflow order: Not started -> In progress -> Ready for
// GM review -> Signed off. Only "Signed off" counts as complete — "in
// review" is still open work, not done, and a client with no section at all
// (falls outside the board's columns) is treated the same as not started
// rather than silently dropped.
const EOFY_SIGNED_OFF_SECTION = "signed off";

export interface EofyClient {
  gid: string;
  name: string;
  status: string; // the raw column name, or "Unclassified" for no section
  complete: boolean;
  bookkeeper: string;
}

export interface EofyPodBreakdown {
  podId: string;
  pod: string;
  clients: EofyClient[];
  complete: number;
  incomplete: number;
}

// Only two of the three pods have an EOFY client tracker on the board today
// (checked live 2026-08-10 — Jemajo/Mahesh has none yet). `projectGid: null`
// pods are still listed, so the pod switcher stays the familiar three tabs
// used everywhere else, with an honest empty state rather than quietly
// hiding a pod that has no tracker set up.
const EOFY_PROJECTS: { podId: string; pod: string; projectGid: string | null }[] = [
  { podId: "11111111-0000-0000-0000-000000000001", pod: "MAS Legato", projectGid: "1216282489860040" }, // Ridmal pod
  { podId: "11111111-0000-0000-0000-000000000002", pod: "Jemajo", projectGid: null }, // no tracker yet
  { podId: "11111111-0000-0000-0000-000000000003", pod: "Fanatics", projectGid: "1215522972190265" }, // Jobelle pod
];

type EofyRawTask = {
  gid: string;
  name: string;
  assignee?: { name: string } | null;
  memberships?: { section?: { name?: string } | null }[];
};

async function fetchEofyTasks(projectGid: string, token: string): Promise<EofyRawTask[]> {
  const out: EofyRawTask[] = [];
  let offset: string | undefined;
  for (let page = 0; page < ASANA_MAX_PAGES; page++) {
    const url = new URL(`${ASANA_BASE}/projects/${projectGid}/tasks`);
    url.searchParams.set("limit", "100");
    url.searchParams.set("opt_fields", "gid,name,assignee.name,memberships.section.name");
    if (offset) url.searchParams.set("offset", offset);
    let res: Response;
    try {
      res = await fetch(url.toString(), { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(ASANA_REQUEST_TIMEOUT_MS) });
    } catch (e) {
      const reason = e instanceof Error && e.name === "TimeoutError"
        ? `Asana did not respond within ${ASANA_REQUEST_TIMEOUT_MS / 1000}s`
        : `Asana request failed: ${e instanceof Error ? e.message : String(e)}`;
      throw new Error(reason);
    }
    if (!res.ok) throw new Error(`Asana returned ${res.status}`);
    const json = await res.json();
    out.push(...((json.data ?? []) as EofyRawTask[]));
    offset = json.next_page?.offset;
    if (!offset) break;
  }
  return out;
}

export async function getEofyPodBreakdown(): Promise<{ pods: EofyPodBreakdown[]; error?: string }> {
  const token = process.env.ASANA_ACCESS_TOKEN;
  if (!token) return { pods: [], error: "not configured" };
  try {
    const pods = await Promise.all(EOFY_PROJECTS.map(async ({ podId, pod, projectGid }) => {
      if (!projectGid) return { podId, pod, clients: [], complete: 0, incomplete: 0 };

      const tasks = await fetchEofyTasks(projectGid, token);
      const clients: EofyClient[] = tasks.map((t) => {
        const status = t.memberships?.[0]?.section?.name ?? "Unclassified";
        return {
          gid: t.gid,
          name: t.name,
          status,
          complete: status.trim().toLowerCase() === EOFY_SIGNED_OFF_SECTION,
          bookkeeper: effectiveBookkeeper(t.name, t.assignee?.name ?? null),
        };
      });
      const complete = clients.filter((c) => c.complete).length;
      return { podId, pod, clients, complete, incomplete: clients.length - complete };
    }));
    return { pods };
  } catch (e) {
    return { pods: [], error: e instanceof Error ? e.message : String(e) };
  }
}

// Per-client drill-down (added 2026-08-10): each EOFY client task turned out
// to carry a real checklist as Asana subtasks — verified live, 18 per client,
// e.g. "1.4  STP finalisation due (ATO deadline) — 14 Jul 2026". Fetched lazily
// per client (own API route) rather than baked into getEofyPodBreakdown above,
// so opening the EOFY panel doesn't fire one subtasks call per client up front.
export interface EofyActivity {
  name: string;
  complete: boolean;
  dueOn: string | null;
}

type EofySubtask = {
  name: string;
  completed: boolean;
  due_on: string | null;
};

// The checklist's numbering ("1.4", "5.2", ...) is the order a human would
// expect to read it in, but Asana's subtasks endpoint does not return them in
// that order — verified live, came back scrambled. Sorting by the leading
// "N.M" restores it; anything without that prefix sorts after, in whatever
// order Asana gave it.
function sortByChecklistNumber(activities: EofyActivity[]): EofyActivity[] {
  const keyOf = (name: string): number => {
    const m = name.match(/^(\d+)\.(\d+)/);
    return m ? parseInt(m[1], 10) * 1000 + parseInt(m[2], 10) : Number.MAX_SAFE_INTEGER;
  };
  return activities
    .map((a, i) => ({ a, i, k: keyOf(a.name) }))
    .sort((x, y) => x.k - y.k || x.i - y.i)
    .map(({ a }) => a);
}

export async function getEofyClientActivities(taskGid: string): Promise<{ activities: EofyActivity[]; error?: string }> {
  const token = process.env.ASANA_ACCESS_TOKEN;
  if (!token) return { activities: [], error: "not configured" };
  try {
    const url = new URL(`${ASANA_BASE}/tasks/${taskGid}/subtasks`);
    url.searchParams.set("limit", "100");
    url.searchParams.set("opt_fields", "name,completed,due_on");
    let res: Response;
    try {
      res = await fetch(url.toString(), { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(ASANA_REQUEST_TIMEOUT_MS) });
    } catch (e) {
      const reason = e instanceof Error && e.name === "TimeoutError"
        ? `Asana did not respond within ${ASANA_REQUEST_TIMEOUT_MS / 1000}s`
        : `Asana request failed: ${e instanceof Error ? e.message : String(e)}`;
      throw new Error(reason);
    }
    if (!res.ok) throw new Error(`Asana returned ${res.status}`);
    const json = await res.json();
    const activities: EofyActivity[] = ((json.data ?? []) as EofySubtask[]).map((s) => ({
      name: s.name,
      complete: s.completed,
      dueOn: s.due_on ?? null,
    }));
    return { activities: sortByChecklistNumber(activities) };
  } catch (e) {
    return { activities: [], error: e instanceof Error ? e.message : String(e) };
  }
}

// Superseded 2026-08-10 by getClientProjectBreakdown in asana.ts — that
// tracker-based (Fathom/BAS/EOFY) rollup collapsed each client to one
// complete/incomplete flag, but the user actually wanted a pie chart PER
// CLIENT, sourced from each client's own dedicated Asana project (see the
// "04. Kim Ching..." style numbered projects, verified live 2026-08-10),
// not from the compliance trackers.

export interface FathomMonthOutstanding {
  client: string;
  bookkeeper: string;
  // "Not Completed" (explicitly flagged) vs "" (nobody has set Progress yet) —
  // both block the month, but they mean different things operationally.
  reason: "Not Completed" | "Not marked";
}

export interface FathomMonth {
  key: string;    // "2026-01" — chronological sort
  label: string;  // "Jan 2026"
  completed: number;
  outstanding: number;
  notApplicable: number;
  clients: FathomMonthOutstanding[]; // the rows still blocking this month
  // A month with no completed AND no outstanding rows only has N/A rows, so
  // "complete" would overstate it — nothing was actually required.
  status: "complete" | "incomplete" | "nothing-required";
}

export interface FathomMonthSplit {
  complete: FathomMonth[];
  incomplete: FathomMonth[];
  // Rows with nothing ticked in the Months field. These ARE counted now — the
  // quarter section says what they owe — so this is purely a data-quality
  // signal about how well the board is being filled in, not a coverage gap.
  rowsWithoutMonths: number;
  // Rows outside any quarter section (e.g. "Untitled section"). These are the
  // real coverage gap: with no section there's no quarter, so no months can be
  // derived and the row is genuinely not counted anywhere.
  rowsWithoutSection: number;
  totalRows: number;
  // Tracker-wide completion in reports (client × month), summed across every
  // month below — the same denominator rule as ReportCounts. This view has no
  // due-date status of its own, so it can't split outstanding into
  // delayed/upcoming the way the pod breakdown does; `outstanding` is both.
  reports: { completed: number; outstanding: number; notApplicable: number; total: number; pct: number | null };
  error?: string;
}

// "Complete months" vs "incomplete months" for the Fathom tracker.
//
// Two things make this non-obvious, both verified against the live board:
//  1. Completion is the "Progress" custom field, NOT the task checkbox. On the
//     real tracker only 4 of 144 rows have the checkbox ticked while 69 are
//     Progress=Completed — reading the checkbox would report almost everything
//     as outstanding.
//  2. A row's "Months" multi-select says which months its work covers, but the
//     option names carry no year ("Aug"). The year comes from the row's
//     section ("POD LEADER- Jobelle (Jul- Sep 2025)"), so month+section
//     together give an unambiguous key.
// "Not Applicable" rows are excluded from outstanding — that state means the
// client didn't need the work, so it must not hold a month open.
export async function getFathomMonthSplit(): Promise<FathomMonthSplit> {
  const empty: FathomMonthSplit = {
    complete: [], incomplete: [], rowsWithoutMonths: 0, rowsWithoutSection: 0, totalRows: 0,
    reports: { completed: 0, outstanding: 0, notApplicable: 0, total: 0, pct: null },
  };
  const token = process.env.ASANA_ACCESS_TOKEN;
  if (!token) return { ...empty, error: "not configured" };

  try {
    const tasks = await fetchTasksWithProgress(FATHOM_PROJECT_GID, token);
    const byMonth = new Map<string, FathomMonth>();
    let rowsWithoutMonths = 0;
    let rowsWithoutSection = 0;

    for (const t of tasks) {
      const sectionName = t.memberships?.[0]?.section?.name ?? "";
      const q = parseQuarter(sectionName);
      if (!q) { rowsWithoutSection += 1; continue; }

      const progress = t.custom_fields?.find((f) => f.name === "Progress")?.display_value ?? "";
      const bookkeeper = effectiveBookkeeper(t.name, t.assignee?.name ?? null);
      const ticked = new Set(
        (t.custom_fields?.find((f) => f.name === "Months")?.multi_enum_values ?? [])
          .filter((m) => m.enabled)
          .map((m) => m.name.slice(0, 3).toLowerCase())
      );
      if (ticked.size === 0) rowsWithoutMonths += 1; // still counted below — tracked only as a data-quality signal

      // Months come from the quarter section, exactly as in monthsOwedBy — a
      // row in the Apr–Jun quarter owes Apr, May and Jun whether or not its
      // Months field says so. This view and the pod breakdown have to agree,
      // and they can only do that if they derive the month list the same way.
      for (const qm of q.months) {
        const key = `${qm.year}-${String(qm.idx + 1).padStart(2, "0")}`;
        const cur = byMonth.get(key) ?? {
          key, label: `${qm.name} ${qm.year}`,
          completed: 0, outstanding: 0, notApplicable: 0, clients: [], status: "incomplete" as const,
        };
        const sent = ticked.has(qm.name.slice(0, 3).toLowerCase()) && progress === "Completed";
        if (progress === "Not Applicable") cur.notApplicable += 1;
        else if (sent) cur.completed += 1;
        else {
          cur.outstanding += 1;
          cur.clients.push({
            client: t.name,
            bookkeeper,
            reason: progress === "Not Completed" ? "Not Completed" : "Not marked",
          });
        }
        byMonth.set(key, cur);
      }
    }

    const all = Array.from(byMonth.values())
      .map((m) => ({
        ...m,
        clients: m.clients.sort((a, b) => a.client.localeCompare(b.client)),
        status: (m.outstanding > 0
          ? "incomplete"
          : m.completed > 0
            ? "complete"
            : "nothing-required") as FathomMonth["status"],
      }))
      .sort((a, b) => a.key.localeCompare(b.key));

    // Each month's completed/outstanding are already per client-month, so the
    // tracker-wide report figure is just their sum — no re-derivation needed.
    const completedReports = all.reduce((s, m) => s + m.completed, 0);
    const outstandingReports = all.reduce((s, m) => s + m.outstanding, 0);
    const totalReports = completedReports + outstandingReports;

    return {
      // "nothing-required" months sit with the complete group — nothing is
      // outstanding in them — but keep their own status so the UI can say why.
      complete: all.filter((m) => m.status !== "incomplete"),
      incomplete: all.filter((m) => m.status === "incomplete"),
      rowsWithoutMonths,
      rowsWithoutSection,
      totalRows: tasks.length,
      reports: {
        completed: completedReports,
        outstanding: outstandingReports,
        notApplicable: all.reduce((s, m) => s + m.notApplicable, 0),
        total: totalReports,
        pct: totalReports > 0 ? Math.round((completedReports / totalReports) * 100) : null,
      },
    };
  } catch (e) {
    return { ...empty, error: e instanceof Error ? e.message : String(e) };
  }
}

// Memoised because this is called per client, per month, on every request:
// ~143 client rows x 3 months x 2 call sites is ~850 invocations, each looping
// up to 31 days and allocating a Date per day — roughly 15,000 Date objects
// per page load, all of it recomputing the same handful of answers. The board
// only ever spans a couple of dozen distinct (year, month) pairs, so the cache
// collapses that to one loop each. Cloudflare Workers bill CPU time per
// request and drop the connection when a request exceeds it, which surfaces in
// the browser as an opaque "Failed to fetch" rather than an HTTP error.
//
// Safe to cache for the process lifetime: the Nth working day of a given month
// is a fixed fact about the calendar, not something that changes over time.
const workingDayCache = new Map<string, string>();

// The Nth working day (Mon-Fri) of a given month, as an ISO date string.
// No public-holiday calendar — a holiday shifts the real deadline by one
// working day and this doesn't account for that, so treat a status right at
// the boundary as approximate, not exact to the hour.
function nthWorkingDayISO(year: number, monthZeroBased: number, n: number): string {
  const cacheKey = `${year}-${monthZeroBased}-${n}`;
  const hit = workingDayCache.get(cacheKey);
  if (hit) return hit;
  const computed = computeNthWorkingDayISO(year, monthZeroBased, n);
  workingDayCache.set(cacheKey, computed);
  return computed;
}

function computeNthWorkingDayISO(year: number, monthZeroBased: number, n: number): string {
  let count = 0;
  for (let day = 1; day <= 31; day++) {
    const d = new Date(Date.UTC(year, monthZeroBased, day));
    if (d.getUTCMonth() !== monthZeroBased) break; // ran past the month's last day
    const dow = d.getUTCDay(); // 0 = Sunday, 6 = Saturday
    if (dow !== 0 && dow !== 6) {
      count++;
      if (count === n) {
        return `${year}-${String(monthZeroBased + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
      }
    }
  }
  throw new Error(`nthWorkingDayISO: month ${year}-${monthZeroBased + 1} has fewer than ${n} working days`);
}

export async function getTrackerCadence(todayISO: string): Promise<TrackerCadence[]> {
  const token = process.env.ASANA_ACCESS_TOKEN;
  if (!token) {
    return TRACKERS.map((t) => ({ key: t.key, label: t.label, rule: t.rule, periods: [], unsectioned: 0, error: "not configured" }));
  }

  return Promise.all(
    TRACKERS.map(async (t): Promise<TrackerCadence> => {
      try {
        const tasks = await fetchTasksWithSections(t.projectGid, token);
        const byPeriod = new Map<string, CadencePeriod>();
        let unsectioned = 0;

        for (const task of tasks) {
          const sectionName = task.memberships?.[0]?.section?.name ?? "";
          const q = parseQuarter(sectionName);
          if (!q) { unsectioned += 1; continue; }

          const dueDate = t.dueFor(q.endMonth, q.endYear);
          const cur = byPeriod.get(q.sortKey) ?? {
            period: q.label, sortKey: q.sortKey, dueDate,
            total: 0, completed: 0, open: 0, lateOpen: 0,
          };
          cur.total += 1;
          if (task.completed) cur.completed += 1;
          else {
            cur.open += 1;
            if (dueDate < todayISO) cur.lateOpen += 1;
          }
          byPeriod.set(q.sortKey, cur);
        }

        const periods = Array.from(byPeriod.values()).sort((a, b) => a.sortKey.localeCompare(b.sortKey));
        return { key: t.key, label: t.label, rule: t.rule, periods, unsectioned };
      } catch (e) {
        return {
          key: t.key, label: t.label, rule: t.rule, periods: [], unsectioned: 0,
          error: e instanceof Error ? e.message : String(e),
        };
      }
    })
  );
}
