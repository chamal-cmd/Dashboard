-- The tracker boards' real completion signal.
--
-- The compliance trackers (Fathom Reports, BAS Lodgement) track completion in
-- a "Progress" custom field (Completed / Not Completed / Not Applicable), NOT
-- the task checkbox. Verified against the live boards on 2026-07-31:
--
--   Fathom  144 rows — checkbox ticked on   4, Progress=Completed on 69
--   BAS     164 rows — checkbox ticked on  13, Progress=Completed on 77
--
-- So counting the checkbox reported these trackers as ~0% complete while the
-- boards were substantially done. This column carries the custom field through
-- the sync so tracker stats can read the field that's actually authoritative.
-- NULL means the task's project has no Progress field (most of the workspace),
-- in which case the checkbox remains the correct signal.

alter table public.asana_tasks add column if not exists progress text;

-- Tracker queries filter on this, and it's low-cardinality (4 distinct values
-- plus NULL), so an index keeps those counts cheap.
create index if not exists asana_tasks_progress_idx on public.asana_tasks(progress);
