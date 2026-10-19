-- ============================================================
--  Rich Mix — Tech Portal :: Venues & Spaces Schema
--  Run this SQL block in your Supabase SQL Editor to make
--  Venue specifications and spaces persistent in the database.
-- ============================================================

-- 1. Ensure public.venues table exists
create table if not exists public.venues (
  "id" text primary key,
  "name" text not null,
  "capacity" text default '',
  "stageDimensions" text default '',
  "inventory" text default '',
  "basicCrew" integer default 1,
  "audio" jsonb default '{}'::jsonb,
  "dmx" jsonb default '[]'::jsonb,
  "createdAt" text
);

-- 2. Resilient migration if venues.id was previously UUID and has foreign keys (e.g. venue_audio_trunks)
do $$
declare
  r record;
begin
  -- Temporary table to track any foreign key constraints pointing to public.venues(id)
  create temp table if not exists _tmp_venue_fkeys (
    schema_name text,
    table_name text,
    column_name text,
    constraint_name text
  ) on commit drop;

  truncate _tmp_venue_fkeys;

  -- 2a. Find all foreign keys referencing public.venues(id)
  for r in (
    select
      c.conname as constraint_name,
      ns.nspname as schema_name,
      cl.relname as table_name,
      att.attname as column_name,
      t.typname as data_type
    from pg_constraint c
    join pg_class cl on cl.oid = c.conrelid
    join pg_namespace ns on ns.oid = cl.relnamespace
    join pg_attribute att on att.attrelid = cl.oid and att.attnum = any(c.conkey)
    join pg_type t on t.oid = att.atttypid
    where c.confrelid = 'public.venues'::regclass
      and c.contype = 'f'
  ) loop
    insert into _tmp_venue_fkeys values (r.schema_name, r.table_name, r.column_name, r.constraint_name);

    -- Temporarily drop the foreign key constraint so types can be altered
    execute format('alter table %I.%I drop constraint if exists %I', r.schema_name, r.table_name, r.constraint_name);

    -- If referencing column was uuid, convert it to text
    if r.data_type = 'uuid' then
      execute format('alter table %I.%I alter column %I type text using %I::text', r.schema_name, r.table_name, r.column_name, r.column_name);
    end if;
  end loop;

  -- 2b. If venues.id is UUID, drop default and alter to text
  if exists (
    select 1 from information_schema.columns 
    where table_schema = 'public' and table_name = 'venues' and column_name = 'id' and data_type = 'uuid'
  ) then
    alter table public.venues alter column "id" drop default;
    alter table public.venues alter column "id" type text using "id"::text;
  end if;

  -- 2c. Update child referencing tables to map old UUIDs to venue names
  for r in select * from _tmp_venue_fkeys loop
    begin
      execute format(
        'update %I.%I t set %I = v.name from public.venues v where t.%I = v.id and v.name in (''The Stage'', ''The Studio'', ''The Mix'', ''Screen One'', ''Screen Two'', ''Screen Three'', ''Streetside'', ''Foyer'') and t.%I != v.name',
        r.schema_name, r.table_name, r.column_name, r.column_name, r.column_name
      );
    exception when others then
      null;
    end;
  end loop;

  -- 2d. Update venues.id from UUID to space name
  update public.venues set "id" = name 
  where name in ('The Stage', 'The Studio', 'The Mix', 'Screen One', 'Screen Two', 'Screen Three', 'Streetside', 'Foyer')
    and "id" != name;

  -- 2e. Re-establish foreign key constraints
  for r in select * from _tmp_venue_fkeys loop
    begin
      execute format(
        'alter table %I.%I add constraint %I foreign key (%I) references public.venues("id") on update cascade on delete cascade',
        r.schema_name, r.table_name, r.constraint_name, r.column_name
      );
    exception when others then
      begin
        execute format(
          'alter table %I.%I add constraint %I foreign key (%I) references public.venues("id") on update cascade on delete cascade not valid',
          r.schema_name, r.table_name, r.constraint_name, r.column_name
        );
      exception when others then
        null;
      end;
    end;
  end loop;
end $$;

-- 3. Idempotent column addition if table already exists
alter table public.venues add column if not exists "basicCrew" integer default 1;

-- 4. Seed Rich Mix space defaults
insert into public.venues ("id", "name", "basicCrew")
values
  ('The Stage', 'The Stage', 2),
  ('The Studio', 'The Studio', 2),
  ('The Mix', 'The Mix', 1),
  ('Screen One', 'Screen One', 1),
  ('Screen Two', 'Screen Two', 1),
  ('Screen Three', 'Screen Three', 1),
  ('Streetside', 'Streetside', 1),
  ('Foyer', 'Foyer', 1)
on conflict ("id") do update
set "basicCrew" = excluded."basicCrew";

update public.venues set "basicCrew" = 2 where name in ('The Stage', 'The Studio');
update public.venues set "basicCrew" = 1 where name in ('The Mix', 'Screen One', 'Screen Two', 'Screen Three', 'Streetside', 'Foyer');

-- 5. Enable RLS and set policies
alter table public.venues enable row level security;
drop policy if exists "Allow read venues" on public.venues;
drop policy if exists "Allow insert venues" on public.venues;
drop policy if exists "Allow update venues" on public.venues;
drop policy if exists "Allow delete venues" on public.venues;
drop policy if exists rw_all_venues on public.venues;
create policy rw_all_venues on public.venues for all to authenticated, anon using (true) with check (true);

-- 6. Ensure bookings table exists (fixes 42P01 error if not previously run)
create table if not exists public.bookings (
  "id" text primary key,
  "eventId" text default '',
  "eventName" text default '',
  "space" text default '',
  "date" text default '',
  "startTime" text default '',
  "finishTime" text default '',
  "userId" text default '',
  "userName" text default '',
  "role" text default 'Sound',
  "status" text default 'pencil',
  "rate" text default '',
  "notes" text default '',
  "isTakeover" boolean default false,
  "penciledAt" text default null,
  "confirmedAt" text default null,
  "cancelledAt" text default null,
  "cancellationReason" text default '',
  "updatedAt" text default ''
);
alter table public.bookings enable row level security;
drop policy if exists rw_all_bookings on public.bookings;
create policy rw_all_bookings on public.bookings for all to authenticated, anon using (true) with check (true);
