-- ============================================================
--  Rich Mix — Tech Portal :: Venues & Spaces Schema
--  Run this SQL block in your Supabase SQL Editor to make
--  Venue specifications and spaces persistent in the database.
-- ============================================================

create table if not exists public.venues (
  "id" text primary key,
  "name" text not null,
  "capacity" text default '',
  "stageDimensions" text default '',
  "inventory" text default '',
  "audio" jsonb default '{}'::jsonb,
  "dmx" jsonb default '[]'::jsonb,
  "createdAt" text
);

-- Enable RLS
alter table public.venues enable row level security;

-- Create policies allowing authenticated users to manage venues
create policy "Allow read venues" on public.venues for select to authenticated using (true);
create policy "Allow insert venues" on public.venues for insert to authenticated with check (true);
create policy "Allow update venues" on public.venues for update to authenticated using (true);
create policy "Allow delete venues" on public.venues for delete to authenticated using (true);
