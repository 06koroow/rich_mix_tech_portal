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
  "static" boolean default false,
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
  "load_in" text default '',
  "soundcheck" text default '', "doors" text default '',
  "off_stage" text default '', "curfew" text default '', "load_out" text default '',
  "schedule_items" jsonb default '[]'::jsonb,
  "screening_starts_time" text default '',
  "film_duration" text default '',
  "media_type" text default '',
  "dcp_received" boolean default false,
  "checks_completed" boolean default false,
  "intermission" boolean default false,
  "qa" boolean default false,
  "dcp_tester_user_id" text default '',
  "dcp_test_datetime" text default '',
  "dcp_test_event_id" text default null,
  "parent_event_id" text default null,
  "linked_maintenance_ids" jsonb default '[]'::jsonb,
  "techUserId" text default '', "clientContact" text default '',
  "technicians" jsonb default '[]'::jsonb,
  "guestEngineer" boolean default false,
  "techInfo" text default '',
  "email_recipients" text default '',
  "tech_requirements" jsonb default '{}'::jsonb,
  "techSpec" jsonb,
  "checklist" jsonb default '{}'::jsonb,
  "artifaxId" text
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

create table if not exists public.patch_presets (
  "id" text primary key,
  "name" text not null,
  "type" text not null default 'input',
  "channels" jsonb not null default '[]'::jsonb,
  "createdAt" bigint,
  "updatedAt" bigint
);

-- ---------- Migrations for already-live databases ----------
-- Safe to re-run. Only needed once per environment; adds the new
-- multi-technician, cinema screening, live schedule & DCP testing columns to an `advancing`
-- table created before these features existed.
alter table public.advancing add column if not exists "technicians" jsonb default '[]'::jsonb;
alter table public.advancing add column if not exists "screening_starts_time" text default '';
alter table public.advancing add column if not exists "film_duration" text default '';
alter table public.advancing add column if not exists "media_type" text default '';
alter table public.advancing add column if not exists "dcp_received" boolean default false;
alter table public.advancing add column if not exists "checks_completed" boolean default false;
alter table public.advancing add column if not exists "intermission" boolean default false;
alter table public.advancing add column if not exists "qa" boolean default false;
alter table public.advancing add column if not exists "load_in" text default '';
alter table public.advancing add column if not exists "off_stage" text default '';
alter table public.advancing add column if not exists "load_out" text default '';
alter table public.advancing add column if not exists "schedule_items" jsonb default '[]'::jsonb;
alter table public.advancing add column if not exists "dcp_tester_user_id" text default '';
alter table public.advancing add column if not exists "dcp_test_datetime" text default '';
alter table public.advancing add column if not exists "dcp_test_event_id" text default null;
alter table public.advancing add column if not exists "parent_event_id" text default null;
alter table public.advancing add column if not exists "linked_maintenance_ids" jsonb default '[]'::jsonb;
alter table public.advancing add column if not exists "email_recipients" text default '';
alter table public.advancing add column if not exists "tech_requirements" jsonb default '{}'::jsonb;

create table if not exists public.patch_presets (
  "id" text primary key,
  "name" text not null,
  "type" text not null default 'input',
  "channels" jsonb not null default '[]'::jsonb,
  "createdAt" bigint,
  "updatedAt" bigint
);

alter table public.patch_presets enable row level security;
drop policy if exists rw_all_patch_presets on public.patch_presets;
create policy rw_all_patch_presets on public.patch_presets for all to authenticated using (true) with check (true);

-- Global system configuration & recipient rules (optional persistence table for app-wide settings)
create table if not exists public.app_settings (
  "key" text primary key,
  "value" jsonb not null,
  "updatedAt" timestamptz default now()
);

-- Seed default category-routed report recipients
insert into public.app_settings ("key", "value") values
  ('report_recipients', '[
    {"email": "tech@richmix.org.uk", "category": "All"},
    {"email": "dutymanager@richmix.org.uk", "category": "All"},
    {"email": "production@richmix.org.uk", "category": "Programme"},
    {"email": "cinema@richmix.org.uk", "category": "Cinema"},
    {"email": "events@richmix.org.uk", "category": "Private Hires"}
  ]'::jsonb)
on conflict ("key") do nothing;

alter table public.app_settings enable row level security;
drop policy if exists rw_all_settings on public.app_settings;
create policy rw_all_settings on public.app_settings for all to authenticated using (true) with check (true);

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

insert into public.inventory ("id", "tag", "name", "category", "location", "qty", "condition", "status", "heldBy", "outAt", "notes", "static", "movements") values
  ('inv-stg-001', 'STG-001', 'Behringer Wing', 'Sound - Console/Stageboxes', 'The Stage', 1, 'Good', 'in', '', '', 'Behringer Wing digital mixing console', true, '[]'::jsonb),
  ('inv-stg-002', 'STG-002', 'Midas S16', 'Sound - Console/Stageboxes', 'The Stage', 2, 'Good', 'in', '', '', 'Midas S16 stage box (32 in / 16 out total across 2 units)', true, '[]'::jsonb),
  ('inv-stg-003', 'STG-003', '8-way XLR input stage box', 'Sound - Console/Stageboxes', 'The Stage', 4, 'Good', 'in', '', '', '', true, '[]'::jsonb),
  ('inv-stg-004', 'STG-004', 'JBL VRX918SP', 'Sound - PA/Speakers', 'The Stage', 4, 'Good', 'in', '', '', 'Powered bass-reflex subwoofer, 18" (under-stage)', true, '[]'::jsonb),
  ('inv-stg-005', 'STG-005', 'JBL VRX932LAP', 'Sound - PA/Speakers', 'The Stage', 6, 'Good', 'in', '', '', 'Powered 2-way line-array speaker, 12"', true, '[]'::jsonb),
  ('inv-stg-006', 'STG-006', 'RCF NX10-SMA', 'Sound - PA/Speakers', 'The Stage', 6, 'Good', 'in', '', '', 'Active stage monitor, full range, 400W', true, '[]'::jsonb),
  ('inv-stg-007', 'STG-007', 'RCF NX12-SMA', 'Sound - PA/Speakers', 'The Stage', 2, 'Good', 'in', '', '', 'Active stage monitor, full range, 700W', true, '[]'::jsonb),
  ('inv-stg-sm58', 'STG-008', 'Shure SM58', 'Sound - Microphones', 'The Stage', 8, 'Good', 'in', '', '', 'Vocal dynamic mic', false, '[]'::jsonb),
  ('inv-stg-009', 'STG-009', 'Shure Beta 58A', 'Sound - Microphones', 'The Stage', 1, 'Good', 'in', '', '', 'Vocal dynamic mic (super-cardioid)', false, '[]'::jsonb),
  ('inv-stg-010', 'STG-010', 'Shure SM57', 'Sound - Microphones', 'The Stage', 8, 'Good', 'in', '', '', 'Instrument dynamic mic', false, '[]'::jsonb),
  ('inv-stg-011', 'STG-011', 'Shure Beta 91A', 'Sound - Microphones', 'The Stage', 1, 'Good', 'in', '', '', 'Kick drum mic', false, '[]'::jsonb),
  ('inv-stg-012', 'STG-012', 'Sennheiser MD 421-II', 'Sound - Microphones', 'The Stage', 2, 'Good', 'in', '', '', 'Large-diaphragm dynamic mic', false, '[]'::jsonb),
  ('inv-stg-013', 'STG-013', 'Sennheiser E906', 'Sound - Microphones', 'The Stage', 1, 'Good', 'in', '', '', 'Instrument dynamic mic', false, '[]'::jsonb),
  ('inv-stg-014', 'STG-014', 'Sennheiser E602', 'Sound - Microphones', 'The Stage', 2, 'Good', 'in', '', '', 'Kick drum mic', false, '[]'::jsonb),
  ('inv-stg-015', 'STG-015', 'Sennheiser E604', 'Sound - Microphones', 'The Stage', 6, 'Good', 'in', '', '', 'Tom/snare drum mic', false, '[]'::jsonb),
  ('inv-stg-016', 'STG-016', 'Sennheiser E614', 'Sound - Microphones', 'The Stage', 4, 'Good', 'in', '', '', 'Instrument condenser mic', false, '[]'::jsonb),
  ('inv-stg-017', 'STG-017', 'AKG 300B/CK91', 'Sound - Microphones', 'The Stage', 1, 'Good', 'in', '', '', 'Condenser capsule mic', false, '[]'::jsonb),
  ('inv-stg-018', 'STG-018', 'Sennheiser E3', 'Sound - Microphones', 'The Stage', 4, 'Good', 'in', '', '', 'Radio/wireless mic system', false, '[]'::jsonb),
  ('inv-stg-019', 'STG-019', 'Active DI box', 'Sound - DI/Stands', 'The Stage', 7, 'Good', 'in', '', '', '', false, '[]'::jsonb),
  ('inv-stg-020', 'STG-020', 'Microphone stands, various (small and large)', 'Sound - DI/Stands', 'The Stage', 1, 'Good', 'in', '', '', 'various / unquantified', false, '[]'::jsonb),
  ('inv-stg-021', 'STG-021', 'Yamaha Stage Custom', 'Backline', 'The Stage', 1, 'Good', 'in', '', '', 'Drum kit, Stage Custom, 20" kick (no cymbals)', false, '[]'::jsonb),
  ('inv-stg-022', 'STG-022', 'Fender Deluxe', 'Backline', 'The Stage', 1, 'Good', 'in', '', '', 'Guitar amplifier, 180W', false, '[]'::jsonb),
  ('inv-stg-023', 'STG-023', 'Markbass CMD 103', 'Backline', 'The Stage', 1, 'Good', 'in', '', '', 'Bass amplifier', false, '[]'::jsonb),
  ('inv-stg-024', 'STG-024', 'Pioneer DJM850', 'DJ Equipment', 'The Stage', 1, 'Good', 'in', '', '', 'DJ mixer', false, '[]'::jsonb),
  ('inv-stg-025', 'STG-025', 'Pioneer CDJ2000', 'DJ Equipment', 'The Stage', 2, 'Good', 'in', '', '', 'CD player/deck', false, '[]'::jsonb),
  ('inv-stg-026', 'STG-026', 'Technics 1210 Mk5', 'DJ Equipment', 'The Stage', 2, 'Good', 'in', '', '', 'Turntable', false, '[]'::jsonb),
  ('inv-stg-027', 'STG-027', 'FBT Jolly', 'DJ Equipment', 'The Stage', 1, 'Good', 'in', '', '', 'DJ booth monitor, 6"', false, '[]'::jsonb),
  ('inv-stg-028', 'STG-028', 'Avolites Tiger Touch II', 'Lighting - Control', 'The Stage', 1, 'Good', 'in', '', '', 'Lighting control desk', true, '[]'::jsonb),
  ('inv-stg-029', 'STG-029', '15A dimmer channel', 'Lighting - Control', 'The Stage', 54, 'Good', 'in', '', '', '', true, '[]'::jsonb),
  ('inv-stg-030', 'STG-030', 'Control points', 'Lighting - Control', 'The Stage', 2, 'Good', 'in', '', '', '', true, '[]'::jsonb),
  ('inv-stg-031', 'STG-031', 'Working lights (separate system)', 'Lighting - Control', 'The Stage', 1, 'Good', 'in', '', '', 'various / unquantified', true, '[]'::jsonb),
  ('inv-stg-032', 'STG-032', 'Prolights Studio CobFC', 'Lighting - Fixtures', 'The Stage', 12, 'Good', 'in', '', '', 'LED RGB 150W parcan (moving)', true, '[]'::jsonb),
  ('inv-stg-033', 'STG-033', 'Prolights Diamond 19', 'Lighting - Fixtures', 'The Stage', 6, 'Good', 'in', '', '', 'LED RGB moving wash light', true, '[]'::jsonb),
  ('inv-stg-034', 'STG-034', 'Prolights CromoSpot500', 'Lighting - Fixtures', 'The Stage', 6, 'Good', 'in', '', '', 'LED RGB moving spot light', true, '[]'::jsonb),
  ('inv-stg-035', 'STG-035', 'Prolights EclFresnel TW', 'Lighting - Fixtures', 'The Stage', 2, 'Good', 'in', '', '', 'LED stage wash fixture', true, '[]'::jsonb),
  ('inv-stg-036', 'STG-036', '500W Fresnel (lower bars)', 'Lighting - Fixtures', 'The Stage', 9, 'Good', 'in', '', '', '', true, '[]'::jsonb),
  ('inv-stg-037', 'STG-037', 'Panasonic PT DZ770EK', 'AV - Projection/Screens', 'The Stage', 1, 'Good', 'in', '', '', 'Projector, WUXGA 1920x1200', true, '[]'::jsonb),
  ('inv-stg-038', 'STG-038', 'Retractable ceiling screen, 5m wide (projection area 3.5m x 4.2m)', 'AV - Projection/Screens', 'The Stage', 1, 'Good', 'in', '', '', '', true, '[]'::jsonb),
  ('inv-stg-039', 'STG-039', '50" plasma screen on stage pillar (VGA feed)', 'AV - Projection/Screens', 'The Stage', 2, 'Good', 'in', '', '', '', true, '[]'::jsonb),
  ('inv-stg-040', 'STG-040', 'Extron', 'AV - Projection/Screens', 'The Stage', 1, 'Good', 'in', '', '', 'Extron HDMI routing system to projector', true, '[]'::jsonb),
  ('inv-stu-001', 'STU-001', 'Roland M400', 'Sound - Console/Stageboxes', 'The Studio', 1, 'Good', 'in', '', '', 'Digital mixing desk', true, '[]'::jsonb),
  ('inv-stu-002', 'STU-002', 'Stage box, 16 XLR in / 8 XLR out via Cat5', 'Sound - Console/Stageboxes', 'The Studio', 2, 'Good', 'in', '', '', '', true, '[]'::jsonb),
  ('inv-stu-003', 'STU-003', 'KV2 Audio EX10', 'Sound - PA/Speakers', 'The Studio', 1, 'Good', 'in', '', '', 'Active full-range speaker, 500W', true, '[]'::jsonb),
  ('inv-stu-004', 'STU-004', 'KV2 Audio EX10', 'Sound - PA/Speakers', 'The Studio', 2, 'Good', 'in', '', '', 'Active monitor, 500W', true, '[]'::jsonb),
  ('inv-stu-005', 'STU-005', 'RCF art705AS', 'Sound - PA/Speakers', 'The Studio', 2, 'Good', 'in', '', '', 'Active bass unit, 800W', true, '[]'::jsonb),
  ('inv-stu-006', 'STU-006', 'RCF art325A', 'Sound - PA/Speakers', 'The Studio', 1, 'Good', 'in', '', '', 'Active monitor, 400W', true, '[]'::jsonb),
  ('inv-stu-007', 'STU-007', 'Sennheiser EW300 G3', 'Sound - Microphones', 'The Studio', 3, 'Good', 'in', '', '', 'Wireless mic system', false, '[]'::jsonb),
  ('inv-stu-008', 'STU-008', 'Sennheiser EW100 G3', 'Sound - Microphones', 'The Studio', 3, 'Good', 'in', '', '', 'Wireless mic system', false, '[]'::jsonb),
  ('inv-stu-009', 'STU-009', 'Shure SM58', 'Sound - Microphones', 'The Studio', 4, 'Good', 'in', '', '', 'Vocal dynamic mic', false, '[]'::jsonb),
  ('inv-stu-010', 'STU-010', 'Sennheiser EW145 G3', 'Sound - Microphones', 'The Studio', 4, 'Good', 'in', '', '', 'Wireless mic system', false, '[]'::jsonb),
  ('inv-stu-011', 'STU-011', 'Studio Spares', 'Sound - DI/Stands', 'The Studio', 2, 'Good', 'in', '', '', 'DI box', false, '[]'::jsonb),
  ('inv-stu-012', 'STU-012', 'Tascam CD-200', 'Sound - Playback', 'The Studio', 2, 'Good', 'in', '', '', 'CD player', false, '[]'::jsonb),
  ('inv-stu-013', 'STU-013', 'Pioneer DJM850', 'DJ Equipment', 'The Studio', 1, 'Good', 'in', '', '', 'DJ mixer', false, '[]'::jsonb),
  ('inv-stu-014', 'STU-014', 'Pioneer CDJ2000', 'DJ Equipment', 'The Studio', 2, 'Good', 'in', '', '', 'CD player/deck', false, '[]'::jsonb),
  ('inv-stu-015', 'STU-015', 'Technics 1210 Mk5', 'DJ Equipment', 'The Studio', 2, 'Fair', 'in', '', '', 'Turntable', false, '[]'::jsonb),
  ('inv-stu-016', 'STU-016', 'ETC Element 60', 'Lighting - Control', 'The Studio', 1, 'Good', 'in', '', '', 'Lighting control desk', true, '[]'::jsonb),
  ('inv-stu-017', 'STU-017', 'Zero88 Chilli', 'Lighting - Control', 'The Studio', 48, 'Good', 'in', '', '', '2Kw dimmer (36 rig + 12 floor; 44 of 48 fully working)', true, '[]'::jsonb),
  ('inv-stu-018', 'STU-018', '13A non-dimmed circuit', 'Lighting - Control', 'The Studio', 8, 'Good', 'in', '', '', '', true, '[]'::jsonb),
  ('inv-stu-019', 'STU-019', 'DMX outlet', 'Lighting - Control', 'The Studio', 4, 'Good', 'in', '', '', '', true, '[]'::jsonb),
  ('inv-stu-020', 'STU-020', 'Prolight EclFresnel', 'Lighting - Fixtures', 'The Studio', 12, 'Good', 'in', '', '', 'Fixed-position fixture', true, '[]'::jsonb),
  ('inv-stu-021', 'STU-021', 'Prolight Diamond 7', 'Lighting - Fixtures', 'The Studio', 8, 'Good', 'in', '', '', 'Fixed-position fixture', true, '[]'::jsonb),
  ('inv-stu-022', 'STU-022', 'Prolight Studio CobFC', 'Lighting - Fixtures', 'The Studio', 12, 'Good', 'in', '', '', 'LED RGB 150W parcan, fixed position', true, '[]'::jsonb),
  ('inv-stu-023', 'STU-023', 'ETC Junior Source 4', 'Lighting - Fixtures', 'The Studio', 12, 'Good', 'in', '', '', 'Zoom profile (25/50)', true, '[]'::jsonb),
  ('inv-stu-024', 'STU-024', 'CCT Eco', 'Lighting - Fixtures', 'The Studio', 18, 'Good', 'in', '', '', '800W Fresnel', true, '[]'::jsonb),
  ('inv-stu-025', 'STU-025', 'CCT Minuette', 'Lighting - Fixtures', 'The Studio', 12, 'Good', 'in', '', '', '500W Fresnel', true, '[]'::jsonb),
  ('inv-stu-026', 'STU-026', 'Parcan with CP62 head', 'Lighting - Fixtures', 'The Studio', 12, 'Good', 'in', '', '', '', true, '[]'::jsonb),
  ('inv-stu-027', 'STU-027', 'Floor can with CP62 head', 'Lighting - Fixtures', 'The Studio', 6, 'Good', 'in', '', '', '', true, '[]'::jsonb),
  ('inv-stu-028', 'STU-028', '500W flood', 'Lighting - Fixtures', 'The Studio', 4, 'Good', 'in', '', '', '', true, '[]'::jsonb),
  ('inv-stu-029', 'STU-029', 'Tank trap with 3m Ali pole', 'Lighting - Rigging/Other', 'The Studio', 6, 'Good', 'in', '', '', '', false, '[]'::jsonb),
  ('inv-stu-030', 'STU-030', 'Single floor stand', 'Lighting - Rigging/Other', 'The Studio', 6, 'Good', 'in', '', '', '', false, '[]'::jsonb),
  ('inv-stu-031', 'STU-031', '15amp cable, selection', 'Lighting - Rigging/Other', 'The Studio', 1, 'Good', 'in', '', '', 'various / unquantified', false, '[]'::jsonb),
  ('inv-stu-032', 'STU-032', 'Panasonic PT DZ770EK', 'AV - Projection/Screens', 'The Studio', 1, 'Good', 'in', '', '', 'Projector, WUXGA 1920x1200, fixed position (projects 3m x 4m onto back wall)', true, '[]'::jsonb),
  ('inv-stu-033', 'STU-033', 'Harlequin', 'Staging/Flooring', 'The Studio', 4, 'Good', 'in', '', '', 'Harlequin black vinyl dance floor, 2m x 10m', true, '[]'::jsonb),
  ('inv-stu-034', 'STU-034', 'Staging block, 1m x 1m x 30cm', 'Staging/Flooring', 'The Studio', 8, 'Good', 'in', '', '', '', true, '[]'::jsonb),
  ('inv-stu-035', 'STU-035', 'Hard black flat, 3.5m tall x 1.5m wide', 'Staging/Flooring', 'The Studio', 2, 'Good', 'in', '', '', '', true, '[]'::jsonb),
  ('inv-mix-001', 'MIX-001', 'Soundcraft EMP12', 'Sound - Console/Stageboxes', 'The Mix', 1, 'Good', 'in', '', '', '12-way mixing desk', true, '[]'::jsonb),
  ('inv-mix-002', 'MIX-002', 'KV2 Audio EX10', 'Sound - PA/Speakers', 'The Mix', 2, 'Good', 'in', '', '', 'Active speaker', true, '[]'::jsonb),
  ('inv-mix-003', 'MIX-003', 'Tascam CD200', 'Sound - Playback', 'The Mix', 1, 'Good', 'in', '', '', 'CD player', false, '[]'::jsonb),
  ('inv-mix-004', 'MIX-004', 'Sennheiser EW145 G3', 'Sound - Microphones', 'The Mix', 2, 'Good', 'in', '', '', 'Wireless mic system', false, '[]'::jsonb),
  ('inv-mix-005', 'MIX-005', 'Microphones, various', 'Sound - Microphones', 'The Mix', 1, 'Good', 'in', '', '', 'various / unquantified', false, '[]'::jsonb),
  ('inv-mix-006', 'MIX-006', 'Studio Spares', 'Sound - DI/Stands', 'The Mix', 2, 'Good', 'in', '', '', 'DI box', false, '[]'::jsonb),
  ('inv-mix-007', 'MIX-007', '6-way LED controller', 'Lighting - Control', 'The Mix', 1, 'Good', 'in', '', '', '', true, '[]'::jsonb),
  ('inv-mix-008', 'MIX-008', '5A dimmer', 'Lighting - Control', 'The Mix', 3, 'Good', 'in', '', '', '', true, '[]'::jsonb),
  ('inv-mix-009', 'MIX-009', 'ETC Junior Source 4', 'Lighting - Fixtures', 'The Mix', 1, 'Good', 'in', '', '', 'Spot and track lighting, separately dimmable', true, '[]'::jsonb),
  ('inv-mix-010', 'MIX-010', 'LED RGB 36W parcan, fixed position', 'Lighting - Fixtures', 'The Mix', 4, 'Good', 'in', '', '', '', true, '[]'::jsonb),
  ('inv-mix-011', 'MIX-011', 'Panasonic PT LB90NT', 'AV - Projection/Screens', 'The Mix', 1, 'Good', 'in', '', '', 'Projector, XGA 1024x768, 3500 ANSI lumens (projects 1.6m x 2.4m onto back wall)', true, '[]'::jsonb),
  ('inv-mix-012', 'MIX-012', 'Le Mark', 'Staging/Flooring', 'The Mix', 3, 'Good', 'in', '', '', 'Le Mark black Sonata compression vinyl dance floor, 2m x 6m', true, '[]'::jsonb),
  ('inv-mix-013', 'MIX-013', 'Staging block, 1m x 1m x 30cm', 'Staging/Flooring', 'The Mix', 8, 'Good', 'in', '', '', '', true, '[]'::jsonb),
  ('inv-s1-001', 'S1-001', 'Behringer X Air 12', 'Sound - Console/Stageboxes', 'Screen One', 1, 'Excellent', 'in', '', '', '12-way mixing desk · Location: Booth', true, '[]'::jsonb),
  ('inv-s1-002', 'S1-002', 'iPad 11"', 'Sound - Control', 'Screen One', 1, 'Excellent', 'in', '', '', 'iPad · Location: Booth', false, '[]'::jsonb),
  ('inv-s1-003', 'S1-003', 'Christie Vive Audio LS5S', 'Sound - PA/Speakers', 'Screen One', 12, 'Good', 'in', '', '', 'Passive speaker (Surrounds) · Location: Screen', true, '[]'::jsonb),
  ('inv-s1-004', 'S1-004', 'Martin Audio Screen 3', 'Sound - PA/Speakers', 'Screen One', 3, 'Good', 'in', '', '', 'Passive speaker (L, C, R) · Location: Screen', true, '[]'::jsonb),
  ('inv-s1-005', 'S1-005', 'Martin Audio Sub 1A', 'Sound - PA/Speakers', 'Screen One', 1, 'Good', 'in', '', '', 'Passive speaker (Sub) · Location: Screen', true, '[]'::jsonb),
  ('inv-s1-amp', 'S1-006', 'Christie Vive Audio CDA5 5000W', 'Sound - PA/Speakers', 'Screen One', 6, 'Fair', 'in', '', '', 'Amplifiers · Location: Booth · Amp for channels 7 & 8 faulty and removed from rack. All amps need thorough cleaning.', true, '[]'::jsonb),
  ('inv-s1-007', 'S1-007', 'Dolby AP20', 'Sound - PA/Speakers', 'Screen One', 1, 'Good', 'in', '', '', 'Processor · Location: Booth', true, '[]'::jsonb),
  ('inv-s1-008', 'S1-008', 'Sennheiser E3', 'Sound - Microphones', 'Screen One', 2, 'Fair', 'in', '', '', 'Wireless mic system · Location: Booth', false, '[]'::jsonb),
  ('inv-s1-009', 'S1-009', 'Shure SM58', 'Sound - Microphones', 'Screen One', 4, 'Fair', 'in', '', '', 'Microphones, various · Location: Booth', false, '[]'::jsonb),
  ('inv-s1-010', 'S1-010', 'Transcension SDC-6 DMX Controller', 'Lighting - Control', 'Screen One', 1, 'Fair', 'in', '', '', 'Lighting console · Location: Booth · Does the job. Power cable or input need checking, can cause lights to flicker if knocked', true, '[]'::jsonb),
  ('inv-s1-011', 'S1-011', '1Kw flood lights', 'Lighting - Fixtures', 'Screen One', 2, 'Fair', 'in', '', '', 'Location: Screen lighting bar · I would guess these have not been cleaned since being rigged.', true, '[]'::jsonb),
  ('inv-s1-012', 'S1-012', '500w fresnel', 'Lighting - Fixtures', 'Screen One', 2, 'Fair', 'in', '', '', 'Location: Screen lighting bar · "', true, '[]'::jsonb),
  ('inv-s1-013', 'S1-013', 'Spot unknown wattage', 'Lighting - Fixtures', 'Screen One', 1, 'Fair', 'in', '', '', 'Location: Screen lighting bar · "', true, '[]'::jsonb),
  ('inv-s1-014', 'S1-014', 'Christie CP4220', 'AV - Projection/Screens', 'Screen One', 1, 'Good', 'in', '', '', 'Cinema Projector · Location: Booth', true, '[]'::jsonb),
  ('inv-s1-015', 'S1-015', 'Cine IMP2K', 'AV - Projection/Screens', 'Screen One', 1, 'Good', 'in', '', '', 'Cinema Projector expansion module · Location: Booth · Obsolete. Large 3U rack mount box. Previously in use with our old Christie CP2000 projectors. The board itself is an expansion module to allow legacy projectors to process non-cinema signals such as HDMI/VGA/DVI.', true, '[]'::jsonb),
  ('inv-s1-016', 'S1-016', '24ft x 10.21ft silver screen', 'AV - Projection/Screens', 'Screen One', 1, 'Poor', 'in', '', '', 'Location: Screen · Screen is way past its lifespan. Silver paint is tarnishing and picture is noticeably cloudy and mottled.', true, '[]'::jsonb),
  ('inv-s1-017', 'S1-017', 'Kramer VP-444', 'AV - Projection/Screens', 'Screen One', 1, 'Good', 'in', '', '', 'HDMI Splitter · Location: Booth rack', true, '[]'::jsonb),
  ('inv-s2-001', 'S2-001', 'Behringer X Air 12', 'Sound - Console/Stageboxes', 'Screen Two', 1, 'Excellent', 'in', '', '', '12-way mixing desk · Location: Booth', true, '[]'::jsonb),
  ('inv-s2-002', 'S2-002', 'iPad 11"', 'Sound - Control', 'Screen Two', 1, 'Good', 'in', '', '', 'iPad · Location: Booth', false, '[]'::jsonb),
  ('inv-s2-003', 'S2-003', 'Christie Vive Audio LS3S', 'Sound - PA/Speakers', 'Screen Two', 12, 'Good', 'in', '', '', 'Passive speaker (Surround) · Location: Screen', true, '[]'::jsonb),
  ('inv-s2-004', 'S2-004', 'Turbosound Impact 50', 'Sound - PA/Speakers', 'Screen Two', 2, 'Good', 'in', '', '', 'Passive speaker (Surround) · Location: Screen', true, '[]'::jsonb),
  ('inv-s2-005', 'S2-005', 'Martin Audio Screen 2', 'Sound - PA/Speakers', 'Screen Two', 3, 'Good', 'in', '', '', 'Passive speaker (L, C, R) · Location: Screen', true, '[]'::jsonb),
  ('inv-s2-006', 'S2-006', 'Martin Audio Sub 1A', 'Sound - PA/Speakers', 'Screen Two', 1, 'Good', 'in', '', '', 'Passive Speaker (Sub) · Location: Screen', true, '[]'::jsonb),
  ('inv-s2-007', 'S2-007', 'Christie Vive Audio CDA5 5000W', 'Sound - PA/Speakers', 'Screen Two', 4, 'Fair', 'in', '', '', 'Amplifiers · Location: Booth · All amps need thorough cleaning.', true, '[]'::jsonb),
  ('inv-s2-008', 'S2-008', 'Dolby AP20', 'Sound - PA/Speakers', 'Screen Two', 1, 'Good', 'in', '', '', 'Processor · Location: Booth', true, '[]'::jsonb),
  ('inv-s2-009', 'S2-009', 'Sennheiser E3', 'Sound - Microphones', 'Screen Two', 2, 'Poor', 'in', '', '', 'Wireless mic system · Location: Booth', false, '[]'::jsonb),
  ('inv-s2-010', 'S2-010', 'Shure SM58', 'Sound - Microphones', 'Screen Two', 4, 'Fair', 'in', '', '', 'Microphones, various · Location: Booth', false, '[]'::jsonb),
  ('inv-s2-011', 'S2-011', 'Transcension SDC-6 DMX Controller', 'Lighting - Control', 'Screen Two', 1, 'Fair', 'in', '', '', 'Lighting console', true, '[]'::jsonb),
  ('inv-s2-012', 'S2-012', '1Kw flood lights', 'Lighting - Fixtures', 'Screen Two', 2, 'Good', 'in', '', '', 'Location: Screen lighting bar', true, '[]'::jsonb),
  ('inv-s2-013', 'S2-013', '500w fresnel', 'Lighting - Fixtures', 'Screen Two', 2, 'Good', 'in', '', '', 'Location: Screen lighting bar', true, '[]'::jsonb),
  ('inv-s2-014', 'S2-014', 'Christie CP4220', 'AV - Projection/Screens', 'Screen Two', 1, 'Good', 'in', '', '', 'Cinema Projector', true, '[]'::jsonb),
  ('inv-s2-015', 'S2-015', 'Cine IMP2K', 'AV - Projection/Screens', 'Screen Two', 1, 'Good', 'in', '', '', 'Cinema Projector expansion module · Obsolete. Large 3U rack mount box. Previously in use with our old Christie CP2000 projectors. The board itself is an expansion module to allow legacy projectors to process non-cinema signals such as HDMI/VGA/DVI.', true, '[]'::jsonb),
  ('inv-s2-016', 'S2-016', '23ft x 9.791ft silver screen', 'AV - Projection/Screens', 'Screen Two', 1, 'Poor', 'in', '', '', 'Screen is way past its lifespan. Silver paint is tarnishing and picture is noticeably cloudy and mottled.', true, '[]'::jsonb),
  ('inv-s2-017', 'S2-017', 'Kramer VP-444', 'AV - Projection/Screens', 'Screen Two', 1, 'Good', 'in', '', '', 'HDMI Splitter', true, '[]'::jsonb),
  ('inv-s3-001', 'S3-001', 'Turbosound Impact 50', 'Sound - PA/Speakers', 'Screen Three', 8, 'Good', 'in', '', '', 'Passive speaker (Surrounds) · Location: Screen', true, '[]'::jsonb),
  ('inv-s3-002', 'S3-002', 'EV Evid 6.2', 'Sound - PA/Speakers', 'Screen Three', 2, 'Good', 'in', '', '', 'Passive speaker (Surrounds) · Location: Screen', true, '[]'::jsonb),
  ('inv-s3-003', 'S3-003', 'Martin Audio Screen 2', 'Sound - PA/Speakers', 'Screen Three', 3, 'Good', 'in', '', '', 'Passive speaker (L, C, R) · Location: Screen', true, '[]'::jsonb),
  ('inv-s3-004', 'S3-004', 'Passive speaker (Sub)', 'Sound - PA/Speakers', 'Screen Three', 1, 'Good', 'in', '', '', 'Location: Screen · Could be Martin Audio, label not visible', true, '[]'::jsonb),
  ('inv-s3-005', 'S3-005', 'QSC RMX145', 'Sound - PA/Speakers', 'Screen Three', 3, 'Fair', 'in', '', '', 'Amplifiers · Location: Booth · Crackly level pots, right surround known to output a lower level. Intermittently fixed by wiggling the pot. Ideally should be upgraded, but do the job well enough.', true, '[]'::jsonb),
  ('inv-s3-006', 'S3-006', 'Dolby CP750', 'Sound - PA/Speakers', 'Screen Three', 1, 'Good', 'in', '', '', 'Processor · Location: Booth · No known issues.', true, '[]'::jsonb),
  ('inv-s3-007', 'S3-007', 'Ultra Stereo Labs CM-680', 'Sound - PA/Speakers', 'Screen Three', 1, 'Good', 'in', '', '', 'Monitor · Location: Booth · No known issues.', true, '[]'::jsonb),
  ('inv-s3-008', 'S3-008', 'Strand 6 Pack', 'Lighting - Control', 'Screen Three', 2, 'Fair', 'in', '', '', 'Dimmer · Location: Booth · Only dimmer 1 on the top 6 pack works to light the stage. Dimmer 2 does not work the audience lights, needs investigating. Bottom 6 Pack only operates a lecturn mic on dimmer 2.', true, '[]'::jsonb),
  ('inv-s3-009', 'S3-009', '1Kw flood lights', 'Lighting - Fixtures', 'Screen Three', 4, 'Fair', 'in', '', '', 'Location: Screen lighting bar · Do not turn on via dimmer, could be dimmer issue, or bulb or disconnected.', true, '[]'::jsonb),
  ('inv-s3-010', 'S3-010', 'Fresnel', 'Lighting - Fixtures', 'Screen Three', 1, 'Fair', 'in', '', '', 'Location: Screen lighting bar · Works fine, should be cleaned.', true, '[]'::jsonb),
  ('inv-s3-011', 'S3-011', 'Birdie', 'Lighting - Fixtures', 'Screen Three', 1, 'Fair', 'in', '', '', 'Location: Screen lighting bar · Works fine, should be cleaned.', true, '[]'::jsonb),
  ('inv-s3-012', 'S3-012', 'Christie CP2215 with Cine IPM2K', 'AV - Projection/Screens', 'Screen Three', 1, 'Good', 'in', '', '', 'Cinema Projector · Location: Booth', true, '[]'::jsonb),
  ('inv-s3-013', 'S3-013', '16ft x 6.801ft white screen', 'AV - Projection/Screens', 'Screen Three', 1, 'Good', 'in', '', '', 'Location: Booth rack', true, '[]'::jsonb),
  ('inv-s3-014', 'S3-014', 'Kramer VP-444', 'AV - Projection/Screens', 'Screen Three', 1, 'Good', 'in', '', '', 'HDMI Splitter · Location: Booth rack', true, '[]'::jsonb),
  ('inv-s3-015', 'S3-015', 'AAM01', 'Network - Projection/Screens', 'Screen Three', 1, 'Good', 'in', '', '', 'Arts Alliance Media · Location: Booth rack · Rack mounted computer, runs Linux and Screenwriter software', true, '[]'::jsonb),
  ('inv-s3-016', 'S3-016', 'LANsat Rack', 'Network - Projection/Screens', 'Screen Three', 1, 'Good', 'in', '', '', 'Omnex TMS · Location: Booth rack · This is the storage for Screenwriter. RAID setup housed in a 2U rack mount case with additional cinebox reader slot and USB port. RAID 0 configuration - approx 22tb of storage', true, '[]'::jsonb),
  ('inv-s3-017', 'S3-017', 'D-link Managed Switch DGS-3100-24', 'Network - Projection/Screens', 'Screen Three', 1, 'Good', 'in', '', '', 'Network switch · Location: Booth rack', true, '[]'::jsonb),
  ('inv-s3-018', 'S3-018', 'Superflex DVB-S / DVB-S2 Duo', 'Network - Projection/Screens', 'Screen Three', 1, 'Good', 'in', '', '', 'Satellite IRD · Location: Booth rack', true, '[]'::jsonb),
  ('inv-s3-019', 'S3-019', 'APC SUA1500RMI2U', 'Power', 'Screen Three', 1, 'Good', 'in', '', '', 'Uninterruptible power supply · Location: Booth rack', true, '[]'::jsonb),
  ('inv-s3-020', 'S3-020', 'Draytek Vigor 2830', 'Network - Projection/Screens', 'Screen Three', 1, 'Good', 'in', '', '', 'Router · Location: Booth rack', true, '[]'::jsonb),
  ('inv-s3-021', 'S3-021', 'LANsat Rack', 'Network - Projection/Screens', 'Screen Three', 1, 'Good', 'in', '', '', 'LANsat · Location: Booth rack · Identical rack configuration as the Omnex TMS. Accessible as LANSAT via Screenwriter. It is the local storage for DCP delivery sent electronically via MPS. LANSAT comes with 12tb of storage', true, '[]'::jsonb)
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

-- maintenance, reports + signoffs start empty (created in-app).


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

