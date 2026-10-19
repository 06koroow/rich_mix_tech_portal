-- ============================================================
--  Rich Mix — Tech Portal :: Supabase Storage Setup
--  Run this SQL block in your Supabase SQL Editor to make
--  PDF tech specs, riders, fault photos & SOP docs persistent
--  in Supabase Cloud Storage.
-- ============================================================

-- 1. Create the 'techfiles' storage bucket
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'techfiles',
  'techfiles',
  true,
  52428800, -- 50MB limit
  array[
    'application/pdf',
    'image/jpeg',
    'image/png',
    'image/webp',
    'image/gif',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'text/plain'
  ]
)
on conflict (id) do update set
  public = true,
  file_size_limit = 52428800;

-- 2. Ensure RLS is enabled on storage.objects
alter table storage.objects enable row level security;

-- 3. Read policy: Allow anyone with the URL / portal users to view documents
drop policy if exists "Public Access techfiles" on storage.objects;
create policy "Public Access techfiles"
  on storage.objects for select
  using (bucket_id = 'techfiles');

-- 4. Insert policy: Allow authenticated technicians & portal users to upload files
drop policy if exists "Upload techfiles" on storage.objects;
create policy "Upload techfiles"
  on storage.objects for insert
  to authenticated, anon
  with check (bucket_id = 'techfiles');

-- 5. Update policy: Allow updating/overwriting existing files
drop policy if exists "Update techfiles" on storage.objects;
create policy "Update techfiles"
  on storage.objects for update
  to authenticated, anon
  using (bucket_id = 'techfiles')
  with check (bucket_id = 'techfiles');

-- 6. Delete policy: Allow removing attachments
drop policy if exists "Delete techfiles" on storage.objects;
create policy "Delete techfiles"
  on storage.objects for delete
  to authenticated, anon
  using (bucket_id = 'techfiles');
