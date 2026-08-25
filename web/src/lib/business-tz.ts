import "server-only";

// The business (GP Bookkeeper) operates on Australian time; due dates,
// "today", and "overdue" all need to mean the same thing they'd mean to
// someone looking at a calendar in Australia. Computing these via
// `new Date().toISOString().slice(0,10)` instead gives the UTC calendar
// date, which is a full day behind Australian time for ~10 hours every day
// (AU midnight through ~10am) — audited and confirmed live: 61 real Asana
// tasks were miscategorized as "not yet overdue" at the moment this was
// written. Intl.DateTimeFormat with a real IANA zone handles AEST/AEDT
// daylight-saving transitions correctly, unlike a fixed UTC+10 offset.
const AU_ZONE = "Australia/Sydney";

const auDateFormatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: AU_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

// "en-CA" formats as YYYY-MM-DD, matching the due_on/date-string format
// already used throughout the Asana/Hubstaff data layers.
export function auTodayISODate(): string {
  return auDateFormatter.format(new Date());
}

export function auDateISODate(daysFromToday: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + daysFromToday);
  return auDateFormatter.format(d);
}
