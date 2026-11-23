# Artifax Two-Way Sync & PDF Integration Setup Guide

This guide covers the complete **Artifax ↔ Rich Mix Tech Portal** v3 integration:
1. **Strict Pull Sync (Artifax → Portal)** — imports only **Contracted** and **Contract Sent** events, maps 1 row per booked Rich Mix venue space (skipping offices/green rooms/blank rooms), auto-removes cancelled/vanished events and cancels linked unworked Rota shifts, and respects DB-persisted portal deletions (with Unhide & Restore).
2. **Non-Destructive Write-Back (Portal → Artifax)** — pushes portal-added advancing info (Tech Notes, Technical Schedule & Timings, Assigned Crew, Spec Summary) into a dedicated **`Tech Portal Advancing`** Custom Form in Artifax so Artifax's native event notes, rooms, and booking fields are never overwritten or looped back.
3. **Two-Way PDF Document Sync** — lists and previews/downloads Artifax PDF attachments inside the portal, and uploads Portal Tech Spec PDFs and generated Technical Advance Sheet PDFs back into Artifax with SHA-256 deduplication.

```
Artifax Events & PDFs  ──(GET pull / list / download)──▶  artifax-sync (Supabase Edge Function v3)  ──▶  Supabase DB & Portal
Artifax Custom Form    ◀──(POST write-back & PDF upload)── artifax-sync (Supabase Edge Function v3)  ◀──  Portal Save / Manual Push
```

All Artifax credentials stay strictly server-side inside **Supabase Edge Function Secrets** and never reach the browser.

---

## Step 1: Create the Dedicated Custom Form in Artifax (One-Time Setup)

You do **not** need custom backend code inside Artifax. Instead, Artifax natively supports Custom Forms that expose REST endpoints for reading and writing structured fields without touching standard Artifax notes.

1. Sign in to **ArtifaxEvent** (`https://richmix.artifaxevent.com`) with an Administrator account.
2. Go to **Admin → Configuration → Custom Forms**.
3. Click **Add Custom Form** and configure:
   - **Name**: `Tech Portal Advancing` *(keep "Tech Portal" at the start so the pull sync automatically skips this form and prevents recursion)*
   - **Attach To / Entity**: **Event** (or **Arrangement** if your workflow attaches technical forms at Arrangement level — the Edge Function supports both)
   - **Active / Enabled**: **Yes**
4. Inside the form, add one Section (e.g., `Technical Advancing Details`) with **4 Multi-line Text (Textarea)** elements:
   1. `Portal Tech Notes`
   2. `Technical Schedule & Timings`
   3. `Assigned Technical Crew`
   4. `Spec & Package Summary`
5. Save and **attach/enable** the form for your Event types so it appears on events in Artifax.

### Check API User Group Permissions
In Artifax, go to **Admin → Configuration → API** (and **Admin → Users → User Groups** for the API user):
- **Arrangements & Events**: Read
- **Custom Forms / Custom Form Data**: Read & Write
- **Documents / Attachments**: Read & Write *(required for two-way PDF sync)*

---

## Step 2: Deploy Edge Function v3 (`artifax-sync`)

The complete server-side code is in `supabase/functions/artifax-sync/index.ts`.

### Option A — Supabase CLI
```bash
supabase login
supabase link --project-ref xumaqyrilbmskcvpmjmk
supabase functions deploy artifax-sync --no-verify-jwt
```

### Option B — Supabase Web Dashboard (No CLI required)
See [`docs/ARTIFAX-EDGE-FUNCTION.md`](./ARTIFAX-EDGE-FUNCTION.md) for copying and pasting `supabase/functions/artifax-sync/index.ts` directly into the Supabase Dashboard.

---

## Step 3: Verify Base Artifax Secrets

In **Supabase Dashboard → Project Settings → Edge Functions → Secrets** (or via CLI), ensure your existing base credentials are set:

| Secret Name | Purpose |
|---|---|
| `ARTIFAX_URL` | `https://richmix.artifaxevent.com` |
| `ARTIFAX_API_KEY` | Your Artifax API key |
| `ARTIFAX_USERNAME` | Artifax API user email/username |
| `ARTIFAX_PASSWORD` | Artifax API user password |

*(Note: `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are injected automatically by Supabase — do not set them manually.)*

---

## Step 4: Discover Your Exact Artifax Form & Element IDs Automatically

Once Edge Function v3 is deployed, the portal can discover your exact Artifax IDs automatically:

1. Open the **Rich Mix Tech Portal** as a Technical Manager, Senior Tech, or Admin.
2. Go to **Advancing** and click **Sync Log** (diagnostics button next to **Sync Artifax**).
3. Click **Discover Artifax Schema**.
4. The probe queries Artifax read-only and displays:
   - Your **`Tech Portal Advancing`** `form_id` and all 4 `element_id` values
   - A ready-to-paste `supabase secrets set ...` block
   - Live probe results for Artifax's Document endpoints (`/api/events/{id}/documents` and `/api/arrangements/{id}/documents`)

### Add the Write-Back Secrets
Copy the discovered IDs into **Supabase Dashboard → Project Settings → Edge Functions → Secrets** (or run the CLI command shown in the modal):

```bash
supabase secrets set \
  ARTIFAX_PORTAL_FORM_ID="<form_id>" \
  ARTIFAX_FIELD_TECH_NOTES_ID="<element_id_1>" \
  ARTIFAX_FIELD_TIMINGS_ID="<element_id_2>" \
  ARTIFAX_FIELD_CREW_ID="<element_id_3>" \
  ARTIFAX_FIELD_SPEC_SUMMARY_ID="<element_id_4>"
```

### Optional Override Secrets (Only if your Artifax instance uses non-default REST paths)
| Optional Secret | Default Behaviour |
|---|---|
| `ARTIFAX_PORTAL_FORM_SCOPE` | `event` (set to `arrangement` if your custom form is attached to Arrangements) |
| `ARTIFAX_WRITE_PATH` | `/api/events/{eventId}/custom_forms/{formId}` (supports `{eventId}`, `{arrangementId}`, `{formId}`) |
| `ARTIFAX_DOCS_LIST_PATH` | Probes `/api/events/{eventId}/documents` and `/api/arrangements/{arrangementId}/documents` |
| `ARTIFAX_DOCS_UPLOAD_PATH` | `/api/events/{eventId}/documents` (or arrangement path if scope is `arrangement`) |
| `ARTIFAX_DOCS_UPLOAD_FIELD` | `file` (multipart form field name) |
| `ARTIFAX_DOCS_UPLOAD_FORMAT` | `multipart` (set to `json` if your Artifax endpoint expects JSON base64 instead of `multipart/form-data`) |

---

## Step 5: Scheduled Pull Sync (Optional `pg_cron`)

Existing `pg_cron` jobs calling `artifax-sync` with an empty POST body continue to work automatically (`action` defaults to `"sync"`):

```sql
select cron.schedule('artifax-sync', '*/20 * * * *', $$
  select net.http_post(
    url := 'https://xumaqyrilbmskcvpmjmk.functions.supabase.co/artifax-sync',
    headers := jsonb_build_object('Authorization', 'Bearer <SUPABASE_ANON_OR_SERVICE_KEY>')
  );
$$);
```

---

## How the Safeguards Work

### 1. Strict Event Filtering & Space Mapping
- **Allowed stages only**: `Contracted` (→ portal `Confirmed`) and `Contract Sent` (→ portal `Advancing`). Any event flagged as Cancelled, Deleted, Lost, Dead, Declined, Archived, Enquiry, Hold, Pencil, or Tentative is strictly excluded.
- **Canonical Rich Mix spaces only**: `The Stage`, `The Studio`, `The Mix`, `Screen One`, `Screen Two`, `Screen Three`, `Streetside`, `Cinema Bar`, and `The Lab`. Offices, Green Rooms, Dressing Rooms, Box Office, and blank rooms are skipped.
- **One row per booked space**: Multi-room Artifax bookings never collapse into one row or merge unrelated rooms.

### 2. Automatic Cancellation Cleanup & Permanent Portal Suppression
- When a synced event is cancelled, downgraded, or removed in Artifax, the next sync removes it from `advancing`, cancels linked **unworked** Rota shifts (preserving past confirmed worked shifts), and marks linked DCPs as `Cancelled`.
- When a user deletes an Artifax event in the portal, its Artifax ID is saved to `public.app_settings` (`artifax_suppressed_events`). Future syncs skip it across all devices until an admin clicks **Unhide & Restore** in the Advancing **Deleted** tab.

### 3. Three-Layer Zero-Recursion Guarantee (Two-Way Write-Back & PDFs)
1. **Pull Skip & Sentinel Strip**: When pulling from Artifax, `extractArtifaxNotes()` unconditionally skips `ARTIFAX_PORTAL_FORM_ID` and any custom form named `Tech Portal*`, and strips any `[RMTP_PORTAL_SYNC_START]...[RMTP_PORTAL_SYNC_END]` blocks.
2. **SHA-256 Change Hash**: Before writing to Artifax, the Edge Function hashes the structured payload and compares it to `production_package.artifaxLastPushHash`. Unchanged saves are skipped (`0` unnecessary API writes).
3. **PDF Deduplication**: Every portal-uploaded PDF is hashed (SHA-256) and recorded with its Artifax document ID in `production_package.artifaxDocuments`, preventing duplicate uploads and preventing the pull sync from re-importing portal-uploaded PDFs as new external files.
