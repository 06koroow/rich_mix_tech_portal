-- ============================================================
--  Rich Mix — Tech Portal :: Technician Availability Table
--  Paste into the Supabase SQL Editor and click Run.
--  Safe to re-run (IF NOT EXISTS + idempotent RLS policy).
--  Note: Until this migration is run, the portal automatically
--  persists availability rows into public.app_settings and will
--  auto-migrate them into public.availability on next load.
-- ============================================================

create table if not exists public.availability (
  "id" text primary key,
  "userId" text default '',
  "userName" text default '',
  "date" text default '',
  "type" text default 'available',
  "dayPart" text default 'all_day',
  "startTime" text default '',
  "finishTime" text default '',
  "notes" text default '',
  "updatedAt" text default ''
);

create index if not exists idx_availability_user_date
  on public.availability ("userId", "date");

create index if not exists idx_availability_date
  on public.availability ("date");

alter table public.availability enable row level security;

drop policy if exists rw_all_availability on public.availability;
create policy rw_all_availability
  on public.availability
  for all
  to authenticated, anon
  using (true)
  with check (true);

notify pgrst, 'reload schema';
