-- ============================================================
--  Rich Mix — Tech Portal :: Supabase schema + seed + RLS
--  Paste this whole file into the Supabase SQL Editor and Run.
--  Safe to re-run (tables use IF NOT EXISTS, seed uses ON CONFLICT).
--  Column names match the app's record fields (camelCase, quoted)
--  so the sync layer is a near-passthrough.
-- ============================================================

-- ---------- Tables ----------
create table if not exists public.users (
  "id" text primary key,
  "firstName" text, "lastName" text,
  "email" text unique,
  "position" text, "discipline" text,
  "status" text default 'active',
  "admin" boolean default false,
  "trainer" boolean default false
);

create table if not exists public.inventory (
  "id" text primary key,
  "tag" text, "name" text, "category" text, "location" text,
  "qty" integer default 0,
  "condition" text, "status" text default 'in',
  "heldBy" text default '', "outAt" text default '',
  "notes" text default '',
  "movements" jsonb default '[]'::jsonb
);

create table if not exists public.maintenance (
  "id" text primary key,
  "equipment" text, "category" text, "priority" text,
  "status" text default 'Open', "space" text default '',
  "description" text default '',
  "itemId" text default '', "itemTag" text default '', "itemName" text default '',
  "image" jsonb,
  "reportedBy" text default '',
  "resolution" text default '', "resolvedBy" text default '', "resolvedAt" text default '',
  "createdAt" bigint
);

create table if not exists public.advancing (
  "id" text primary key,
  "name" text, "category" text, "space" text,
  "date" text default '', "status" text,
  "startTime" text default '', "finishTime" text default '',
  "soundcheck" text default '', "doors" text default '', "curfew" text default '',
  "techUserId" text default '', "clientContact" text default '',
  "guestEngineer" boolean default false,
  "techInfo" text default '',
  "techSpec" jsonb,
  "checklist" jsonb default '{}'::jsonb
);

create table if not exists public.reports (
  "id" text primary key,
  "eventId" text, "crew" text default '', "shiftDate" text default '',
  "summary" text default '', "issues" text default '', "followUp" text default '',
  "author" text default '', "authorId" text default '',
  "submittedAt" text default '', "updatedAt" text default '', "updatedBy" text default ''
);

create table if not exists public.signoffs (
  "id" text primary key,
  "userId" text, "compId" text, "compLabel" text default '',
  "signedBy" text default '', "date" text default ''
);

create table if not exists public.procedures (
  "id" text primary key,
  "category" text, "title" text,
  "body" text default '', "icon" text default 'book'
);

-- ---------- Role helpers (map the signed-in email -> profile) ----------
create or replace function public.is_admin() returns boolean
  language sql stable security definer set search_path = public as $$
  select coalesce((select "admin" from public.users
     where lower("email") = lower(auth.jwt() ->> 'email') and "status" = 'active' limit 1), false);
$$;

create or replace function public.is_trainer() returns boolean
  language sql stable security definer set search_path = public as $$
  select coalesce((select "trainer" from public.users
     where lower("email") = lower(auth.jwt() ->> 'email') and "status" = 'active' limit 1), false);
$$;

-- ---------- Enable RLS ----------
alter table public.users       enable row level security;
alter table public.inventory   enable row level security;
alter table public.maintenance enable row level security;
alter table public.advancing   enable row level security;
alter table public.reports     enable row level security;
alter table public.signoffs    enable row level security;
alter table public.procedures  enable row level security;

-- ---------- Starter policies (PERMISSIVE — every signed-in user can
--            read + write everything). Get the app working first, then
--            tighten using the commented examples at the bottom. ----------
do $$
declare t text;
begin
  foreach t in array array['users','inventory','maintenance','advancing','reports','signoffs','procedures'] loop
    execute format('drop policy if exists rw_all on public.%I', t);
    execute format('create policy rw_all on public.%I for all to authenticated using (true) with check (true)', t);
  end loop;
end $$;


-- ---------- Seed data ----------
insert into public.users ("id", "firstName", "lastName", "email", "position", "discipline", "status", "admin", "trainer") values
  ('user-1', 'Alex', 'Morgan', 'alex@richmix.local', 'Technical Manager', 'Sound', 'active', true, true),
  ('user-2', 'Priya', 'Shah', 'priya@richmix.local', 'Senior Tech', 'Lighting', 'active', true, true),
  ('user-3', 'Sam', 'Okafor', 'sam@richmix.local', 'Duty Tech', 'Sound', 'active', false, false),
  ('user-4', 'Danny', 'Cole', 'danny@richmix.local', 'Duty Tech', 'Cinema', 'active', false, true)
on conflict ("id") do nothing;

insert into public.inventory ("id","tag","name","category","location","qty","condition","status","heldBy","outAt","notes","movements") values
  ('inv-1', 'MIC-058', 'Shure SM58', 'Microphones', 'Store', 12, 'Good', 'in', '', '', '', '[]'::jsonb),
  ('inv-2', 'MIC-057', 'Shure SM57', 'Microphones', 'Store', 8, 'Good', 'in', '', '', '', '[]'::jsonb),
  ('inv-3', 'DI-001', 'Radial ProDI', 'DI Boxes', 'Store', 6, 'Good', 'in', '', '', '', '[]'::jsonb),
  ('inv-4', 'CAB-X10', 'XLR cable 10m', 'Cables', 'Cable store', 30, 'Good', 'in', '', '', '', '[]'::jsonb),
  ('inv-5', 'CAB-IEC', 'IEC power lead', 'Cables', 'Cable store', 24, 'Good', 'in', '', '', '', '[]'::jsonb),
  ('inv-6', 'SPK-Y7', 'd&b Y7P', 'Speakers', 'The Stage', 4, 'Good', 'in', '', '', 'Main hangs', '[{"from":"PA rack","to":"The Stage","at":"2026-07-20T09:00:00.000Z","by":"Alex Morgan"}]'::jsonb),
  ('inv-7', 'IEM-P10', 'Shure PSM300', 'IEM', 'RF case', 4, 'Good', 'in', '', '', '', '[]'::jsonb),
  ('inv-8', 'STD-K&M', 'K&M tall stand', 'Stands', 'Stage store', 10, 'Damaged', 'in', '', '', '2 need clutches', '[]'::jsonb)
on conflict ("id") do nothing;
insert into public.maintenance ("id", "equipment", "category", "priority", "status", "space", "description", "itemId", "itemTag", "itemName", "reportedBy", "createdAt") values
  ('fault-seed-1', 'PSM300 pack — intermittent dropout', 'Sound', 'High', 'Open', 'The Stage', 'RF dropout on beltpack 2 during soundcheck. Needs bench testing.', 'inv-7', 'IEM-P10', 'Shure PSM300', 'Sam Okafor', 1753700000000)
on conflict ("id") do nothing;
insert into public.advancing ("id", "name", "category", "space", "date", "status", "startTime", "finishTime", "soundcheck", "doors", "curfew", "techUserId", "clientContact", "guestEngineer", "techInfo") values
  ('evt-1', 'Kokoroko — live', 'Programme', 'The Stage', '2026-07-31', 'Confirmed', '19:00', '23:00', '17:00', '19:30', '23:00', 'user-3', 'Tour manager — Jess', true, 'Guest FOH engineer touring with the band. 32-way split needed. Backline hired in.'),
  ('evt-2', 'Private hire — product launch', 'Private Hires', 'The Studio', '2026-07-31', 'Confirmed', '18:00', '22:00', '', '18:30', '22:00', 'user-4', 'Client — Aria Events', false, 'Speeches + playback from a laptop. Two handhelds, a lectern mic, HDMI to the projector.'),
  ('evt-3', 'Short film premiere', 'Cinema', 'Screen One', '2026-08-01', 'Advancing', '19:30', '22:00', '', '19:00', '', 'user-3', 'Producer — Sam', false, 'DCP arriving day before — ingest and test. Q&A after with two radio mics.'),
  ('evt-4', 'Wedding reception', 'Private Hires', 'The Mix', '2026-08-03', 'Advancing', '17:00', '00:00', '', '', '00:00', '', 'Client — the Osei family', false, 'DJ on later, playback earlier. Needs uplighters and a couple of radio mics for speeches.'),
  ('evt-5', 'Jazz night', 'Programme', 'The Stage', '2026-07-25', 'Complete', '20:00', '23:00', '18:30', '19:30', '23:00', 'user-3', '', false, 'House engineer. Standard jazz input list.')
on conflict ("id") do nothing;
insert into public.procedures ("id", "category", "title", "body", "icon") values
  ('venue-open', 'Opening & Closing', 'Venue opening checklist', '', 'power'),
  ('night-close', 'Opening & Closing', 'End-of-night shutdown', '', 'power'),
  ('pa-powerup', 'Sound', 'PA power-up sequence', '', 'wave'),
  ('foh-dlive', 'Sound', 'FOH desk (dLive) startup', '', 'wave'),
  ('monitors', 'Sound', 'Monitor world setup', '', 'wave'),
  ('rf-management', 'Sound', 'Radio mic / IEM management', '', 'wave'),
  ('lx-startup', 'Lighting', 'Lighting desk startup', '', 'bulb'),
  ('house-lights', 'Lighting', 'House lights & presets', '', 'bulb'),
  ('haze', 'Lighting', 'Haze / smoke operation', '', 'bulb'),
  ('projector', 'AV & Presentation', 'Projector & screen setup', '', 'screen'),
  ('patching', 'AV & Presentation', 'Laptop / HDMI patching', '', 'screen'),
  ('hybrid', 'AV & Presentation', 'Hybrid / streamed event setup', '', 'screen'),
  ('get-in', 'Stage & Rigging', 'Stage build & get-in', '', 'box'),
  ('rigging', 'Stage & Rigging', 'Rigging & flying points', '', 'box'),
  ('get-out', 'Stage & Rigging', 'Get-out procedure', '', 'box'),
  ('evac', 'Health & Safety', 'Fire & evacuation procedure', '', 'shield'),
  ('height', 'Health & Safety', 'Working at height', '', 'shield'),
  ('handling', 'Health & Safety', 'Manual handling', '', 'shield'),
  ('incident', 'Health & Safety', 'Incident reporting', '', 'shield'),
  ('pat', 'Health & Safety', 'Electrical safety (PAT)', '', 'shield')
on conflict ("id") do nothing;

-- reports + signoffs start empty (created in-app).

-- ============================================================
--  OPTIONAL: tighten security once it's working.
--  Replace the permissive rw_all policies per table, e.g.:
--
--  drop policy if exists rw_all on public.signoffs;
--  create policy sel on public.signoffs for select to authenticated using (true);
--  create policy ins on public.signoffs for insert to authenticated with check (public.is_trainer());
--  create policy del on public.signoffs for delete to authenticated using (public.is_admin());
--
--  drop policy if exists rw_all on public.maintenance;
--  create policy sel on public.maintenance for select to authenticated using (true);
--  create policy ins on public.maintenance for insert to authenticated with check (true);
--  create policy upd on public.maintenance for update to authenticated using (true) with check (true);
--  -- (resolving is app-gated; enforce here with is_admin() if you want it hard)
--
--  drop policy if exists rw_all on public.users;
--  create policy sel on public.users for select to authenticated using (true);
--  create policy ins on public.users for insert to authenticated with check (true);   -- self sign-up (pending)
--  create policy upd on public.users for update to authenticated using (public.is_admin()) with check (public.is_admin());
-- ============================================================

