-- ============================================================
--  Rich Mix — Tech Portal :: DMX Lighting & Rig Schema
--  Run this SQL block in your Supabase SQL Editor to make
--  DMX Lighting Patches, Fixture Personalities & Advancing Rigs
--  fully persistent in the backend database.
-- ============================================================

-- 1. Table for Reusable DMX Fixture Personalities (Profiles)
create table if not exists public.dmx_personalities (
  "id" text primary key,
  "manufacturer" text not null,
  "model" text not null,
  "mode" text not null default 'Standard',
  "channels" integer not null default 1,
  "category" text not null default 'Fixtures',
  "isFactory" boolean not null default false,
  "notes" text default '',
  "createdAt" bigint,
  "updatedAt" bigint
);

-- 2. Table for Saved DMX Lighting Patches & House Rig Templates
create table if not exists public.dmx_patches (
  "id" text primary key,
  "title" text not null default 'DMX Lighting Patch',
  "eventId" text default null,
  "eventName" text default '',
  "space" text default '',
  "date" text default '',
  "notes" text default '',
  "fixtures" jsonb not null default '[]'::jsonb,
  "createdAt" bigint,
  "updatedAt" bigint
);

-- 3. Ensure DMX fixtures column exists on Event Advancing and Patch Sheets
alter table public.advancing add column if not exists "dmx_fixtures" jsonb default '[]'::jsonb;
alter table public.patch_sheets add column if not exists "dmx_fixtures" jsonb default '[]'::jsonb;

-- 4. Enable Row Level Security (RLS)
alter table public.dmx_personalities enable row level security;
alter table public.dmx_patches enable row level security;

-- 5. Set Permissive Policies for Authenticated & App Access
drop policy if exists rw_all_dmx_personalities on public.dmx_personalities;
create policy rw_all_dmx_personalities on public.dmx_personalities
  for all
  to authenticated, anon
  using (true)
  with check (true);

drop policy if exists rw_all_dmx_patches on public.dmx_patches;
create policy rw_all_dmx_patches on public.dmx_patches
  for all
  to authenticated, anon
  using (true)
  with check (true);

-- 6. Pre-seed Standard / Factory Personalities into Database
insert into public.dmx_personalities ("id", "manufacturer", "model", "mode", "channels", "category", "isFactory", "createdAt", "updatedAt")
values
  ('fix-robe-spiider-27', 'Robe', 'Spiider', 'Mode 1 (Standard Wash/Beam)', 27, 'Moving Wash / Beam', true, 1700000000000, 1700000000000),
  ('fix-robe-spiider-49', 'Robe', 'Spiider', 'Mode 2 (Enhanced FX)', 49, 'Moving Wash / Beam', true, 1700000000000, 1700000000000),
  ('fix-robe-pointe-16', 'Robe', 'Pointe', 'Mode 1 (Standard Beam/Spot)', 16, 'Moving Beam / Spot', true, 1700000000000, 1700000000000),
  ('fix-robe-pointe-24', 'Robe', 'Pointe', 'Mode 2 (Extended)', 24, 'Moving Beam / Spot', true, 1700000000000, 1700000000000),
  ('fix-chauvet-mav-force-s', 'Chauvet Professional', 'Maverick Force S Spot', 'Standard (24ch)', 24, 'Moving Spot / Profile', true, 1700000000000, 1700000000000),
  ('fix-chauvet-colorado-1-quad-12', 'Chauvet Professional', 'COLORado 1-Quad Zoom', 'TOUR (12ch)', 12, 'LED Par / Wash', true, 1700000000000, 1700000000000),
  ('fix-chauvet-colorado-1-quad-7', 'Chauvet Professional', 'COLORado 1-Quad Zoom', 'ARC.2 (7ch)', 7, 'LED Par / Wash', true, 1700000000000, 1700000000000),
  ('fix-etc-s4-led-s3-10', 'ETC', 'Source Four LED Series 3', 'Lustr X8 Direct (10ch)', 10, 'Profile / Leko', true, 1700000000000, 1700000000000),
  ('fix-etc-s4-led-s2-8', 'ETC', 'Source Four LED Series 2', 'Lustr Direct (8ch)', 8, 'Profile / Leko', true, 1700000000000, 1700000000000),
  ('fix-astera-titan-4', 'Astera', 'Titan Tube (FP1)', 'RGB CCT Dim 8-bit (4ch)', 4, 'Battery / Wireless Pixel Tube', true, 1700000000000, 1700000000000),
  ('fix-astera-titan-16px', 'Astera', 'Titan Tube (FP1)', '16 Pixels RGB (48ch)', 48, 'Battery / Wireless Pixel Tube', true, 1700000000000, 1700000000000),
  ('fix-martin-mac-aura-xb-14', 'Martin', 'MAC Aura XB', 'Standard Mode (14ch)', 14, 'Moving Wash', true, 1700000000000, 1700000000000),
  ('fix-martin-mac-quantum-prof-27', 'Martin', 'MAC Quantum Profile', 'Extended Mode (27ch)', 27, 'Moving Profile', true, 1700000000000, 1700000000000),
  ('fix-claypaky-mythos2-30', 'Clay Paky', 'Mythos 2', 'Standard (30ch)', 30, 'Moving Hybrid Beam/Spot', true, 1700000000000, 1700000000000),
  ('fix-chauvet-intimidator-375z', 'Chauvet DJ', 'Intimidator Spot 375Z', '15 Channel Mode', 15, 'Moving Spot', true, 1700000000000, 1700000000000),
  ('fix-generic-dimmer-1', 'Generic', 'Dimmer / Conventional', '1 Channel (0-100% Intensity)', 1, 'Conventional / Tungsten', true, 1700000000000, 1700000000000),
  ('fix-generic-rgbw-4', 'Generic', 'LED Par RGBW', '4 Channel (R/G/B/W)', 4, 'LED Par / Wash', true, 1700000000000, 1700000000000),
  ('fix-generic-rgbwa-uv-6', 'Generic', 'LED Par RGBWA+UV', '6 Channel (R/G/B/W/A/UV)', 6, 'LED Par / Wash', true, 1700000000000, 1700000000000),
  ('fix-showtec-sunstrip-10', 'Showtec', 'Sunstrip Active DMX', '10 Channel (Individual Cell)', 10, 'Batten / Blinder', true, 1700000000000, 1700000000000),
  ('fix-look-unique-hazer-2', 'Look Solutions', 'Unique 2.1 Hazer', '2 Channel (Pump / Fan)', 2, 'Atmospheric / FX', true, 1700000000000, 1700000000000),
  ('fix-look-viper-smoke-1', 'Look Solutions', 'Viper NT Fogger', '1 Channel (Pump)', 1, 'Atmospheric / FX', true, 1700000000000, 1700000000000)
on conflict ("id") do update set
  "manufacturer" = excluded."manufacturer",
  "model" = excluded."model",
  "mode" = excluded."mode",
  "channels" = excluded."channels",
  "category" = excluded."category",
  "isFactory" = excluded."isFactory";
