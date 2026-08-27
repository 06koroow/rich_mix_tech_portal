-- ============================================================
--  Rich Mix — Tech Portal :: Patch Sheets & Presets Schema
--  Run this SQL block in your Supabase SQL Editor to make
--  Patch Sheets and Stagebox Presets fully persistent.
-- ============================================================

-- 1. Table for Event Patch Sheets & Multi-Act Stagebox Plans
create table if not exists public.patch_sheets (
  "id" text primary key,
  "name" text not null,
  "eventId" text default null,
  "eventName" text default '',
  "space" text default '',
  "date" text default '',
  "notes" text default '',
  "acts" jsonb not null default '[]'::jsonb,
  "patchPoints" jsonb not null default '[]'::jsonb,
  "stageboxes" jsonb not null default '[]'::jsonb,
  "repatches" jsonb not null default '[]'::jsonb,
  "homeRun" jsonb not null default '{}'::jsonb,
  "createdAt" bigint,
  "updatedAt" bigint
);

-- 2. Table for Channel List Presets (Inputs, Outputs & Reusable Stagebox Templates)
create table if not exists public.patch_presets (
  "id" text primary key,
  "name" text not null,
  "type" text not null default 'input',  -- 'input', 'output', 'stagebox_preset'
  "category" text default 'General',
  "description" text default '',
  "channels" jsonb not null default '[]'::jsonb,
  "capacityIn" integer default 0,
  "capacityOut" integer default 0,
  "createdAt" bigint,
  "updatedAt" bigint
);

-- 3. Ensure columns exist if tables were created earlier
alter table public.patch_presets add column if not exists "category" text default 'General';
alter table public.patch_presets add column if not exists "description" text default '';
alter table public.patch_presets add column if not exists "capacityIn" integer default 0;
alter table public.patch_presets add column if not exists "capacityOut" integer default 0;

alter table public.patch_sheets add column if not exists "eventId" text default null;
alter table public.patch_sheets add column if not exists "eventName" text default '';
alter table public.patch_sheets add column if not exists "space" text default '';
alter table public.patch_sheets add column if not exists "date" text default '';
alter table public.patch_sheets add column if not exists "notes" text default '';
alter table public.patch_sheets add column if not exists "acts" jsonb not null default '[]'::jsonb;
alter table public.patch_sheets add column if not exists "patchPoints" jsonb not null default '[]'::jsonb;
alter table public.patch_sheets add column if not exists "stageboxes" jsonb not null default '[]'::jsonb;
alter table public.patch_sheets add column if not exists "repatches" jsonb not null default '[]'::jsonb;
alter table public.patch_sheets add column if not exists "homeRun" jsonb not null default '{}'::jsonb;

-- 4. Enable Row Level Security (RLS)
alter table public.patch_sheets enable row level security;
alter table public.patch_presets enable row level security;

-- 5. Set Permissive Policies for Authenticated Techs
drop policy if exists rw_all_patch_sheets on public.patch_sheets;
create policy rw_all_patch_sheets on public.patch_sheets for all to authenticated using (true) with check (true);

drop policy if exists rw_all_patch_presets on public.patch_presets;
create policy rw_all_patch_presets on public.patch_presets for all to authenticated using (true) with check (true);
