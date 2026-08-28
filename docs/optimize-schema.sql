-- 1. Migrate legacy text 'crew' to jsonb 'technicians'
UPDATE public.advancing 
SET technicians = ('[{"userId":"","role":"' || crew || '"}]')::jsonb 
WHERE crew IS NOT NULL AND crew != '' AND crew != '[]' AND crew != 'null' 
  AND (technicians IS NULL OR technicians::text = '[]' OR technicians::text = 'null');

-- 2. Migrate legacy 'techUserId' to 'responsible_for_advancing'
UPDATE public.advancing 
SET responsible_for_advancing = "techUserId" 
WHERE "techUserId" IS NOT NULL AND "techUserId" != '' 
  AND (responsible_for_advancing IS NULL OR responsible_for_advancing = '');

-- 3. Merge discrete production fields into the 'production_package' JSONB object
UPDATE public.advancing 
SET production_package = jsonb_build_object(
    'lighting_notes', COALESCE(production_package->>'lighting_notes', lighting_notes, ''),
    'floor_package', COALESCE(production_package->>'floor_package', floor_package, ''),
    'floor_tags', COALESCE(production_package->'floor_tags', floor_tags, '[]'::jsonb),
    'specials', COALESCE(production_package->'specials', specials, '{}'::jsonb),
    'special_notes', COALESCE(production_package->>'special_notes', special_notes, '')
)
WHERE lighting_notes IS NOT NULL OR floor_package IS NOT NULL OR floor_tags IS NOT NULL OR specials IS NOT NULL OR special_notes IS NOT NULL;

-- 4. Migrate 'dmx_fixtures' from advancing table into the dedicated 'dmx_patches' table
-- Note: we use ON CONFLICT to avoid overwriting newer data if the patch sheet already exists
INSERT INTO public.dmx_patches (id, title, "eventId", "eventName", space, date, fixtures, "createdAt", "updatedAt")
SELECT 
    'dmx-' || id, 
    COALESCE(name, 'Event') || ' — DMX Patch', 
    id, 
    name, 
    space, 
    date, 
    dmx_fixtures, 
    EXTRACT(EPOCH FROM NOW()) * 1000, 
    EXTRACT(EPOCH FROM NOW()) * 1000
FROM public.advancing 
WHERE dmx_fixtures IS NOT NULL AND dmx_fixtures::text != '[]' AND dmx_fixtures::text != 'null'
ON CONFLICT (id) DO NOTHING;

-- 5. Drop the now-redundant columns from the advancing table
ALTER TABLE public.advancing
  DROP COLUMN IF EXISTS crew,
  DROP COLUMN IF EXISTS "techUserId",
  DROP COLUMN IF EXISTS dmx_fixtures,
  DROP COLUMN IF EXISTS lighting_notes,
  DROP COLUMN IF EXISTS floor_package,
  DROP COLUMN IF EXISTS floor_tags,
  DROP COLUMN IF EXISTS specials,
  DROP COLUMN IF EXISTS special_notes;
