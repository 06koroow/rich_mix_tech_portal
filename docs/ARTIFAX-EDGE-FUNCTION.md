# Deploying the Artifax Edge Function (v3) via Supabase Dashboard

If you prefer not to use the Supabase CLI, you can deploy or update the `artifax-sync` Edge Function directly in the **Supabase Web Dashboard**.

Version **v3** runs all six Artifax operations securely from a single Edge Function (`supabase/functions/artifax-sync/index.ts`):
- `sync` *(default)* — strict pull sync (`Contracted` / `Contract Sent` only, 1 row per venue space, cancellation & Rota cleanup, DB-backed suppression, dry-run preview)
- `push_event` — non-destructive write-back to your **`Tech Portal Advancing`** Custom Form in Artifax
- `list_documents` — lists PDF attachments on an Artifax event/arrangement
- `download_document` — secure server-side PDF proxy for in-portal viewing & download
- `upload_document` — uploads Portal Tech Spec PDFs and generated Advance Sheet PDFs back into Artifax (with SHA-256 deduplication)
- `discover_schema` — read-only probe that finds your Artifax Custom Form & Element IDs

---

## Step 1: Verify Secrets in Supabase Dashboard

1. Open the [Supabase Dashboard](https://app.supabase.com/) and select your Rich Mix Tech Portal project.
2. Go to **Project Settings (gear icon) → Edge Functions → Secrets**.
3. Ensure the base Artifax secrets exist:
   - `ARTIFAX_API_KEY` — your Artifax API key
   - `ARTIFAX_USERNAME` — your Artifax API user email
   - `ARTIFAX_PASSWORD` — your Artifax API password
   - `ARTIFAX_URL` — `https://richmix.artifaxevent.com`
4. *(For two-way write-back, after creating the `Tech Portal Advancing` Custom Form in Artifax and running **Discover Artifax Schema** in the portal's Sync Log)*, add:
   - `ARTIFAX_PORTAL_FORM_ID`
   - `ARTIFAX_FIELD_TECH_NOTES_ID`
   - `ARTIFAX_FIELD_TIMINGS_ID`
   - `ARTIFAX_FIELD_CREW_ID`
   - `ARTIFAX_FIELD_SPEC_SUMMARY_ID`

*(Do **not** manually set `SUPABASE_URL` or `SUPABASE_SERVICE_ROLE_KEY`; Supabase provides those automatically.)*

---

## Step 2: Update the `artifax-sync` Function Code

1. In the Supabase Dashboard sidebar, open **Edge Functions**.
2. Open the existing **`artifax-sync`** function (or click **Create a new Edge Function** and name it `artifax-sync`).
3. Ensure **Enforce JWT Verification** is **OFF** (so both scheduled `pg_cron` jobs and the GitHub Pages frontend can invoke it cleanly).
4. Open **`supabase/functions/artifax-sync/index.ts`** in this repository, copy its entire contents, and replace all code in the Supabase Dashboard editor.
5. Click **Deploy**.

> **Note**: `supabase/functions/artifax-sync/index.ts` is completely self-contained (zero relative imports), so pasting it directly into the Supabase Web Editor works out of the box.

---

## Step 3: Verify in the Tech Portal

1. Open the **Rich Mix Tech Portal → Advancing**.
2. Click **Sync Log** next to **Sync Artifax**:
   - Confirm the badge reads **Server Engine v3**.
   - Click **Run Dry-Run Preview** to verify which Artifax stages and rooms are included vs excluded before modifying records.
   - Click **Discover Artifax Schema** to inspect your Custom Form IDs and Document endpoints.
3. Click **Sync Now** to run a live pull & cleanup sweep.
4. Open any Artifax event detail modal → **Tech** tab to test **Push to Artifax**, **Push Spec PDF to Artifax**, **Send Advance Sheet PDF to Artifax**, and viewing/downloading Artifax PDFs.

For the full Custom Form creation walkthrough in Artifax, see [`docs/ARTIFAX-SETUP.md`](./ARTIFAX-SETUP.md).
