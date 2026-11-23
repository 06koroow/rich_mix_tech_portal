// ============================================================
//  artifax-sync — Supabase Edge Function (v3: Two-Way + PDFs)
//  ------------------------------------------------------------
//  Single-source-of-truth Artifax <-> Rich Mix Tech Portal API bridge.
//  All Artifax API keys & credentials stay strictly server-side in Deno.env.
//
//  Supported actions (via JSON body `{ action: "..." }`):
//   1. `sync` (default — also used by pg_cron):
//        • Strict two-stage status gate: ONLY "Contracted" or "Contract Sent"
//          (hard-excludes Cancelled / Lost / Dead / Declined / Deleted / Archived).
//        • Strict canonical venue space mapper (1 row = 1 booked venue space;
//          skips non-venue/admin/back-of-house/blank rooms).
//        • DB-persisted suppression list (`app_settings.artifax_suppressed_events`).
//        • Zero-recursion guard: skips "Tech Portal*" custom forms & sentinel
//          blocks on pull so pushed portal notes never echo back.
//        • Full reconciliation sweep: auto-removes cancelled, downgraded,
//          non-venue, suppressed, or vanished Artifax events, cancels linked
//          unworked Rota shifts (preserving past worked shifts), and marks
//          linked DCP checks as Cancelled.
//        • Optional `{ dryRun: true }` preview mode.
//   2. `push_event`:
//        • Non-destructive write-back to a dedicated "Tech Portal Advancing"
//          Custom Form in Artifax (4 structured fields: Tech Notes, Schedule &
//          Timings, Assigned Crew, Spec & Package Summary).
//        • SHA-256 payload fingerprint skips unchanged pushes (zero ping-pong).
//   3. `list_documents`:
//        • Fetches PDF document metadata attached to an Artifax event/arrangement,
//          deduplicated against portal-uploaded PDFs.
//   4. `download_document`:
//        • Securely proxies an Artifax PDF binary server-side (<= 25 MB).
//   5. `upload_document`:
//        • Uploads a portal Tech Spec or generated Advance PDF to Artifax with
//          PDF validation + SHA-256 deduplication.
//   6. `discover_schema`:
//        • Read-only probe to discover Artifax Custom Form & Element IDs and
//          verify API permissions/secrets configuration.
//
//  Required Supabase Secrets (Pull):
//    ARTIFAX_URL       e.g. https://richmix.artifaxevent.com
//    ARTIFAX_API_KEY   Artifax API key
//    ARTIFAX_USERNAME  Artifax API username (optional if key-only)
//    ARTIFAX_PASSWORD  Artifax API password (optional if key-only)
//
//  Optional Supabase Secrets (Two-Way Write-Back & PDFs):
//    ARTIFAX_PORTAL_FORM_ID          Numeric ID of "Tech Portal Advancing" custom form
//    ARTIFAX_PORTAL_FIELD_NOTES_ID   Element ID for "Portal Tech Notes"
//    ARTIFAX_PORTAL_FIELD_TIMINGS_ID Element ID for "Technical Schedule & Timings"
//    ARTIFAX_PORTAL_FIELD_CREW_ID    Element ID for "Assigned Technical Crew"
//    ARTIFAX_PORTAL_FIELD_SPEC_ID    Element ID for "Spec & Package Summary"
//    ARTIFAX_WRITE_TARGET            "event" (default) or "arrangement"
//    ARTIFAX_FORM_POST_PATH          Override path template e.g. /api/events/{eventId}/custom_forms
//    ARTIFAX_FORM_POST_METHOD        "POST" (default) or "PUT"
//    ARTIFAX_DOCS_LIST_PATH          Override path template e.g. /api/arrangements/{arrangementId}/documents
//    ARTIFAX_DOCS_UPLOAD_PATH        Override path template e.g. /api/arrangements/{arrangementId}/documents
//    ARTIFAX_DOCS_DOWNLOAD_PATH      Override path template e.g. /api/documents/{documentId}
//    ARTIFAX_DOCS_UPLOAD_FORMAT      "multipart" (default) or "json"
//
//  Deploy via CLI: supabase functions deploy artifax-sync
//  Or paste this entire file directly into Supabase Dashboard -> Edge Functions -> artifax-sync.
// ============================================================

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SYNC_ENGINE_VERSION = 3;
const SUPPRESSED_SETTINGS_KEY = "artifax_suppressed_events";
const LAST_SYNC_SETTINGS_KEY = "artifax_last_sync";
const MAX_PDF_BYTES = 25 * 1024 * 1024; // 25 MB

function buildCorsHeaders(req: Request): Record<string, string> {
  const origin = req.headers.get("origin");
  return {
    "Access-Control-Allow-Origin": origin && /^https?:\/\//i.test(origin) ? origin : "*",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
    "Vary": "Origin",
  };
}

function jsonResponse(payload: unknown, status: number, corsHeaders: Record<string, string>) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

// ---------- Canonical Rich Mix Venue Space Mapping ----------
const EXACT_ROOM_TO_SPACE: Record<string, string> = {
  "the stage (ms)": "The Stage",
  "the stage": "The Stage",
  "stage": "The Stage",
  "main stage": "The Stage",
  "ms": "The Stage",
  "main space": "The Stage",

  "the studio (v1)": "The Studio",
  "the studio": "The Studio",
  "studio": "The Studio",
  "studio 1": "The Studio",
  "v1": "The Studio",
  "venue 1": "The Studio",

  "the mix & bar (v2)": "The Mix",
  "the mix and bar (v2)": "The Mix",
  "the mix & bar": "The Mix",
  "the mix and bar": "The Mix",
  "the mix": "The Mix",
  "mix": "The Mix",
  "mix bar": "The Mix",
  "the mix bar": "The Mix",
  "v2": "The Mix",
  "venue 2": "The Mix",

  "screen 1": "Screen One",
  "screen one": "Screen One",
  "screen1": "Screen One",
  "cinema 1": "Screen One",
  "cinema one": "Screen One",
  "s1": "Screen One",

  "screen 2": "Screen Two",
  "screen two": "Screen Two",
  "screen2": "Screen Two",
  "cinema 2": "Screen Two",
  "cinema two": "Screen Two",
  "s2": "Screen Two",

  "screen 3": "Screen Three",
  "screen three": "Screen Three",
  "screen3": "Screen Three",
  "cinema 3": "Screen Three",
  "cinema three": "Screen Three",
  "s3": "Screen Three",

  "streetside": "Streetside",
  "street side": "Streetside",
  "streetside bar": "Streetside",
  "streetside cafe": "Streetside",
  "streetside foyer": "Streetside",
  "streetside / foyer": "Streetside",
  "foyer": "Streetside",

  "cinema bar / gallery": "Cinema Bar",
  "cinema bar & gallery": "Cinema Bar",
  "cinema bar and gallery": "Cinema Bar",
  "cinema bar": "Cinema Bar",
  "cinema gallery": "Cinema Bar",

  "the lab": "The Lab",
  "lab": "The Lab",
};

const CANONICAL_SPACES = new Set<string>([
  "The Stage",
  "The Studio",
  "The Mix",
  "Screen One",
  "Screen Two",
  "Screen Three",
  "Streetside",
  "Cinema Bar",
  "The Lab",
]);

const AUXILIARY_SPACES = new Set<string>(["Streetside", "Cinema Bar", "The Lab"]);

const NON_VENUE_ROOM_RE = /\b(office|desk|green\s*room|dressing\s*room|back\s*stage|backstage|stage\s*door|loading\s*bay|load[\s-]*in|store|storage|kitchen|staff\s*room|meeting\s*room|board\s*room|boardroom|box\s*office|reception|toilet|wc|corridor|stair|lift|elevator|plant\s*room|server\s*room|admin|hot\s*desk|workshop|car\s*park|parking|external|off[\s-]*site|offsite|tbc|tbd|unassigned|none)\b/i;

function normalizeRoomKey(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ")
    .replace(/^rich\s*mix\s*[-:\/–—]?\s+/i, "")
    .trim();
}

function resolveVenueSpace(roomName: unknown): string | null {
  if (roomName === null || roomName === undefined) return null;
  const raw = String(roomName).trim();
  if (!raw) return null;

  const key = normalizeRoomKey(raw);
  if (!key || key === "rich mix") return null;

  if (EXACT_ROOM_TO_SPACE[key]) return EXACT_ROOM_TO_SPACE[key];
  if (NON_VENUE_ROOM_RE.test(key)) return null;

  if (/\b(screen\s*1|screen\s*one|cinema\s*1|cinema\s*one)\b/i.test(key)) return "Screen One";
  if (/\b(screen\s*2|screen\s*two|cinema\s*2|cinema\s*two)\b/i.test(key)) return "Screen Two";
  if (/\b(screen\s*3|screen\s*three|cinema\s*3|cinema\s*three)\b/i.test(key)) return "Screen Three";
  if (/\bcinema\s*(bar|gallery)\b/i.test(key)) return "Cinema Bar";
  if (/\bstreetside\b/i.test(key)) return "Streetside";
  if (/\bthe\s+lab\b/i.test(key)) return "The Lab";
  if (/\b(the\s+stage|main\s+stage)\b/i.test(key) || /\(ms\)/i.test(key)) return "The Stage";
  if (/\bthe\s+studio\b/i.test(key) || /\(v1\)/i.test(key)) return "The Studio";
  if (/\bthe\s+mix\b/i.test(key) || /\(v2\)/i.test(key)) return "The Mix";

  return null;
}

function extractRawRooms(r: Record<string, unknown>): string[] {
  const found: string[] = [];
  const pushVal = (v: unknown) => {
    if (v === null || v === undefined) return;
    if (typeof v === "string" || typeof v === "number") {
      const s = String(v).trim();
      if (s && !found.includes(s)) found.push(s);
    } else if (Array.isArray(v)) {
      for (const item of v) pushVal(item);
    } else if (typeof v === "object") {
      const obj = v as Record<string, unknown>;
      const name = obj.room_name ?? obj.room_description ?? obj.name ?? obj.roomName ?? obj.RoomName ?? obj.description ?? obj.title;
      if (name) pushVal(name);
    }
  };

  const singleRoom = r.room_name ?? r.room_description ?? r.roomName ?? r.RoomName ?? r.room ?? r.Room ?? r.space ?? r.Space;
  if (singleRoom !== undefined && singleRoom !== null && String(singleRoom).trim() !== "") {
    pushVal(singleRoom);
  } else if (Array.isArray(r.rooms) && r.rooms.length > 0) {
    pushVal(r.rooms);
  } else if (Array.isArray(r.event_rooms) && r.event_rooms.length > 0) {
    pushVal(r.event_rooms);
  }
  return found;
}

// ---------- Strict Two-Stage Status Gate ----------
const EXCLUDED_STATUS_RE = /\b(cancel(?:led|ed|ing)?|lost|dead|declin(?:ed)?|reject(?:ed)?|withdraw(?:n)?|releas(?:ed)?|delet(?:ed)?|archiv(?:ed)?|void(?:ed)?|abandoned|no[\s_-]*show|uncontracted|not\s+contracted|non[\s_-]*contracted)\b/i;

function normalizeStageLabel(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/^[\[\(]?\d+[\]\)\.\-\s:]+/, "")
    .replace(/\s+/g, " ")
    .trim();
}

interface StatusEval {
  allowed: boolean;
  portalStatus: "Confirmed" | "Advancing" | "Cancelled" | "Excluded";
  artifaxStage: string;
  rawStatusSummary: string;
  reason: string;
}

function evaluateArtifaxStatus(r: Record<string, unknown>): StatusEval {
  const truthyFlag = (v: unknown) => v === true || v === 1 || v === "1" || String(v ?? "").trim().toLowerCase() === "true";
  const falsyActiveFlag = (v: unknown) => v === false || v === 0 || v === "0" || String(v ?? "").trim().toLowerCase() === "false";

  const flagDeleted = truthyFlag(r.deleted) || truthyFlag(r.is_deleted) || truthyFlag(r.isDeleted);
  const flagCancelled = truthyFlag(r.cancelled) || truthyFlag(r.canceled) || truthyFlag(r.is_cancelled) || truthyFlag(r.is_canceled) || truthyFlag(r.isCancelled);
  const flagArchived = truthyFlag(r.archived) || truthyFlag(r.is_archived) || truthyFlag(r.isArchived);
  const flagLost = truthyFlag(r.lost) || truthyFlag(r.is_lost) || truthyFlag(r.isLost);
  const flagInactive = (r.active !== undefined && r.active !== null && falsyActiveFlag(r.active)) ||
                       (r.is_active !== undefined && r.is_active !== null && falsyActiveFlag(r.is_active));

  const candidateKeys = [
    "sales_process_stage_name", "sales_process_stage", "salesProcessStage",
    "arrangement_status_name", "arrangement_status", "arrangementStatus",
    "event_status_name", "event_status", "eventStatus",
    "booking_status_name", "booking_status", "bookingStatus",
    "status_name", "status", "Status", "stage_name", "stage", "state",
  ];

  const seenValues: string[] = [];
  for (const k of candidateKeys) {
    const v = r[k];
    if (v === null || v === undefined) continue;
    if (typeof v === "string" || typeof v === "number") {
      const s = String(v).trim();
      if (s && !seenValues.includes(s)) seenValues.push(s);
    } else if (typeof v === "object") {
      const obj = v as Record<string, unknown>;
      const nested = obj.name ?? obj.label ?? obj.description ?? obj.title ?? obj.status;
      if (nested) {
        const s = String(nested).trim();
        if (s && !seenValues.includes(s)) seenValues.push(s);
      }
    }
  }

  const rawSummary = seenValues.length ? seenValues.join(" | ") : "(blank)";

  if (flagDeleted || flagCancelled || flagArchived || flagLost || flagInactive) {
    return { allowed: false, portalStatus: "Cancelled", artifaxStage: rawSummary, rawStatusSummary: rawSummary, reason: "excluded_flag" };
  }
  for (const val of seenValues) {
    if (EXCLUDED_STATUS_RE.test(val)) {
      return { allowed: false, portalStatus: "Cancelled", artifaxStage: val, rawStatusSummary: rawSummary, reason: "excluded_status" };
    }
  }

  let matchedStage: "Contracted" | "Contract Sent" | null = null;
  for (const val of seenValues) {
    const norm = normalizeStageLabel(val);
    if (/^contract\s*sent\b/.test(norm) || /\bcontract\s+sent\b/.test(norm)) {
      matchedStage = "Contract Sent";
      break;
    }
    if (/^contracted\b/.test(norm) || /\bcontracted\b/.test(norm)) {
      matchedStage = "Contracted";
      break;
    }
  }

  if (!matchedStage) {
    return { allowed: false, portalStatus: "Excluded", artifaxStage: rawSummary, rawStatusSummary: rawSummary, reason: "not_contracted_stage" };
  }

  return {
    allowed: true,
    portalStatus: matchedStage === "Contracted" ? "Confirmed" : "Advancing",
    artifaxStage: matchedStage,
    rawStatusSummary: rawSummary,
    reason: "allowed",
  };
}

// ---------- Date, Time, Category, Hashing & Notes Parsers ----------
function parseSafeDate(raw: unknown): string {
  if (!raw) return "";
  const s = String(raw).trim();
  if (!s) return "";
  const dmyMatch = s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})/);
  if (dmyMatch) return `${dmyMatch[3]}-${dmyMatch[2].padStart(2, "0")}-${dmyMatch[1].padStart(2, "0")}`;
  const ymdMatch = s.match(/^(\d{4})[\/\-](\d{1,2})[\/\-](\d{1,2})/);
  if (ymdMatch) return `${ymdMatch[1]}-${ymdMatch[2].padStart(2, "0")}-${ymdMatch[3].padStart(2, "0")}`;
  const d = new Date(s);
  return isNaN(d.getTime()) ? "" : d.toISOString().slice(0, 10);
}

function parseSafeTime(raw: unknown): string {
  if (!raw) return "";
  const s = String(raw).trim();
  if (!s) return "";
  const m = s.match(/(\d{1,2}):(\d{2})/);
  if (m) return `${m[1].padStart(2, "0")}:${m[2]}`;
  const d = new Date(s);
  return isNaN(d.getTime()) ? "" : d.toISOString().slice(11, 16);
}

function toCategory(type: string, title = "", space = ""): string {
  const combined = `${type} ${title} ${space}`.toLowerCase();
  if (
    /cinema|film|screening|dcp|premiere|q&a|preview|docu|movie/.test(combined) ||
    /screen (one|two|three|1|2|3)|cinema (1|2|3|one|two|three)/.test(combined)
  ) {
    return "Cinema";
  }
  if (/hire|private|wedding|corporate|conference|launch/.test(combined)) return "Private Hires";
  return "Programme";
}

function slugify(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

async function sha256Hex(input: string | Uint8Array): Promise<string> {
  const bytes = typeof input === "string" ? new TextEncoder().encode(input) : input;
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}

function base64ToBytes(b64: string): Uint8Array {
  const cleaned = b64.includes(",") ? b64.split(",").pop() || "" : b64;
  const bin = atob(cleaned.trim());
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

// Strip any portal-owned sentinel blocks so portal-pushed text can NEVER recursively re-enter pull notes
const PORTAL_SENTINEL_RE = /---\s*\[TECH PORTAL(?: SYNC)? START\]\s*---[\s\S]*?---\s*\[TECH PORTAL(?: SYNC)? END\]\s*---/gi;

function stripPortalSentinelBlocks(text: string): string {
  return text.replace(PORTAL_SENTINEL_RE, "").trim();
}

function isPortalOwnedCustomForm(form: Record<string, unknown>, configuredFormId: string): boolean {
  const formId = String(form.custom_form_id ?? form.form_id ?? form.id ?? "").trim();
  if (configuredFormId && formId && formId === configuredFormId) return true;
  const formTitle = String(form.custom_form_name ?? form.form_name ?? form.name ?? form.title ?? form.label ?? "").trim();
  if (/^tech\s*portal\b/i.test(formTitle)) return true;
  return false;
}

function extractArtifaxNotes(r: Record<string, unknown>, portalFormId: string): string {
  const parts: string[] = [];
  const seenNotes = new Set<string>();

  const addNote = (label: string, text: unknown) => {
    if (text === null || text === undefined) return;
    const str = stripPortalSentinelBlocks(String(text).trim());
    if (!str || seenNotes.has(str)) return;
    seenNotes.add(str);
    parts.push(label ? `[${label}]: ${str}` : str);
  };

  const candidateFields: Array<{ key: string; label: string }> = [
    { key: "notes", label: "" },
    { key: "description", label: "Description" },
    { key: "event_notes", label: "Event Notes" },
    { key: "arrangement_notes", label: "Arrangement Notes" },
    { key: "internal_notes", label: "Internal Notes" },
    { key: "public_description", label: "Public Description" },
    { key: "event_description", label: "Event Description" },
    { key: "arrangement_description", label: "Arrangement Description" },
    { key: "comments", label: "Comments" },
    { key: "event_comments", label: "Event Comments" },
    { key: "arrangement_comments", label: "Arrangement Comments" },
    { key: "technical_requirements", label: "Technical Requirements" },
    { key: "tech_requirements", label: "Tech Requirements" },
    { key: "technical_notes", label: "Technical Notes" },
    { key: "tech_notes", label: "Tech Notes" },
    { key: "requirements", label: "Requirements" },
    { key: "setup_notes", label: "Setup Notes" },
    { key: "set_up_notes", label: "Setup Notes" },
    { key: "staging_notes", label: "Staging Notes" },
    { key: "av_notes", label: "AV Notes" },
    { key: "sound_notes", label: "Sound Notes" },
    { key: "lighting_notes", label: "Lighting Notes" },
    { key: "catering_notes", label: "Catering Notes" },
    { key: "special_instructions", label: "Special Instructions" },
    { key: "memo", label: "Memo" },
    { key: "memos", label: "Memos" },
    { key: "summary", label: "Summary" },
    { key: "details", label: "Details" },
    { key: "task_notes", label: "Tasks" },
    { key: "roster_notes", label: "Roster Notes" },
    { key: "Notes", label: "" },
    { key: "Description", label: "Description" },
    { key: "EventNotes", label: "Event Notes" },
    { key: "ArrangementNotes", label: "Arrangement Notes" },
    { key: "InternalNotes", label: "Internal Notes" },
    { key: "TechnicalNotes", label: "Technical Notes" },
    { key: "Comments", label: "Comments" },
  ];

  for (const { key, label } of candidateFields) {
    const val = r[key];
    if (val === undefined || val === null) continue;
    if (typeof val === "string" || typeof val === "number") {
      addNote(label, val);
    } else if (Array.isArray(val)) {
      for (const item of val) {
        if (typeof item === "string") addNote(label, item);
        else if (item && typeof item === "object") {
          const obj = item as Record<string, unknown>;
          const itemText = obj.text ?? obj.note ?? obj.content ?? obj.description ?? obj.value ?? "";
          if (itemText) addNote(String(obj.title ?? obj.label ?? label), itemText);
        }
      }
    }
  }

  // Custom forms — STRICTLY SKIP our own "Tech Portal*" custom form (Layer 1 loop prevention!)
  const forms = Array.isArray(r.custom_forms) ? r.custom_forms : (Array.isArray(r.forms) ? r.forms : []);
  for (const form of forms) {
    if (!form || typeof form !== "object") continue;
    const f = form as Record<string, unknown>;
    if (isPortalOwnedCustomForm(f, portalFormId)) continue;

    const formTitle = String(f.custom_form_name ?? f.form_name ?? f.name ?? f.title ?? f.label ?? "").trim();
    if (/credit\s*card|bank\s*account|stripe\s*token|password|secret/i.test(formTitle)) continue;

    const formElements: unknown[] = [];
    const sections = Array.isArray(f.custom_form_sections) ? f.custom_form_sections : (Array.isArray(f.sections) ? f.sections : []);
    for (const sec of sections) {
      if (!sec || typeof sec !== "object") continue;
      const s = sec as Record<string, unknown>;
      const elems = Array.isArray(s.custom_form_elements)
        ? s.custom_form_elements
        : (Array.isArray(s.elements) ? s.elements : (Array.isArray(s.fields) ? s.fields : []));
      formElements.push(...elems);
    }
    const directElems = Array.isArray(f.custom_form_elements)
      ? f.custom_form_elements
      : (Array.isArray(f.elements) ? f.elements : (Array.isArray(f.fields) ? f.fields : []));
    formElements.push(...directElems);

    for (const el of formElements) {
      if (!el || typeof el !== "object") continue;
      const e = el as Record<string, unknown>;
      const elName = String(
        e.custom_form_element_name ?? e.element_name ?? e.name ?? e.label ?? e.title ?? e.prompt ?? e.field_name ?? ""
      ).trim();
      if (!elName) continue;

      let val: unknown =
        e.custom_form_data_text !== undefined && e.custom_form_data_text !== null && e.custom_form_data_text !== ""
          ? e.custom_form_data_text
          : (e.custom_form_data_value !== undefined && e.custom_form_data_value !== null
              ? e.custom_form_data_value
              : (e.value ?? e.data_value ?? e.text_value ?? e.display_value ?? e.selected_option_label ?? ""));

      if (val === true) val = "Yes";
      if (val === false) val = "No";
      if (Array.isArray(val)) val = val.join(", ");

      const valStr = String(val ?? "").trim();
      if (!valStr) continue;
      addNote(formTitle ? `[${formTitle}] ${elName}` : elName, valStr);
    }
  }

  const customFields = Array.isArray(r.custom_fields)
    ? r.custom_fields
    : (Array.isArray(r.custom_form_elements) ? r.custom_form_elements : []);
  for (const cf of customFields) {
    if (!cf || typeof cf !== "object") continue;
    const c = cf as Record<string, unknown>;
    const name = String(c.name ?? c.label ?? c.title ?? c.field_name ?? c.custom_form_element_name ?? "").trim();
    if (/^portal\s+tech|^tech\s+portal/i.test(name)) continue;
    let val: unknown = c.value ?? c.custom_form_data_text ?? c.custom_form_data_value ?? c.text ?? "";
    if (val === true) val = "Yes";
    if (val === false) val = "No";
    if (Array.isArray(val)) val = val.join(", ");
    const valStr = String(val ?? "").trim();
    if (name && valStr) addNote(name, valStr);
  }

  if (r.custom_form_data && typeof r.custom_form_data === "object" && !Array.isArray(r.custom_form_data)) {
    for (const [k, v] of Object.entries(r.custom_form_data as Record<string, unknown>)) {
      if (/^portal\s+tech|^tech\s+portal/i.test(k)) continue;
      if (v !== null && v !== undefined) {
        const vStr = String(v).trim();
        if (vStr) addNote(k, vStr);
      }
    }
  }

  return parts.join("\n").trim();
}

// ---------- Artifax Connection & Auth Helpers ----------
function validateArtifaxBaseUrl(rawUrl: string): string {
  const cleaned = rawUrl.trim().replace(/\/api\/?$/, "").replace(/\/$/, "");
  let parsed: URL;
  try {
    parsed = new URL(cleaned);
  } catch {
    throw new Error("Invalid ARTIFAX_URL format");
  }
  if (parsed.protocol !== "https:") {
    throw new Error("ARTIFAX_URL must use https://");
  }
  const host = parsed.hostname.toLowerCase();
  if (
    host === "localhost" ||
    host === "127.0.0.1" ||
    host === "::1" ||
    host.startsWith("10.") ||
    host.startsWith("192.168.") ||
    host.startsWith("169.254.") ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(host)
  ) {
    throw new Error("ARTIFAX_URL cannot target private or loopback addresses");
  }
  return cleaned;
}

function getArtifaxAuthConfig() {
  const rawBaseUrl = Deno.env.get("ARTIFAX_URL") || "https://richmix.artifaxevent.com";
  const baseUrl = validateArtifaxBaseUrl(rawBaseUrl);
  const apiKey = (Deno.env.get("ARTIFAX_API_KEY") || "").trim();
  const username = (Deno.env.get("ARTIFAX_USERNAME") || "").trim();
  const password = (Deno.env.get("ARTIFAX_PASSWORD") || "").trim();

  if (!apiKey) {
    throw new Error("Missing ARTIFAX_API_KEY in Edge Function secrets");
  }

  const headers: Record<string, string> = {
    "X-API-Key": apiKey,
    "Accept": "application/json",
  };
  if (username && password) {
    headers["Authorization"] = "Basic " + btoa(`${username}:${password}`);
  }

  return { baseUrl, headers };
}

function getPortalWriteConfig() {
  return {
    formId: (Deno.env.get("ARTIFAX_PORTAL_FORM_ID") || "").trim(),
    fieldNotesId: (Deno.env.get("ARTIFAX_PORTAL_FIELD_NOTES_ID") || "").trim(),
    fieldTimingsId: (Deno.env.get("ARTIFAX_PORTAL_FIELD_TIMINGS_ID") || "").trim(),
    fieldCrewId: (Deno.env.get("ARTIFAX_PORTAL_FIELD_CREW_ID") || "").trim(),
    fieldSpecId: (Deno.env.get("ARTIFAX_PORTAL_FIELD_SPEC_ID") || "").trim(),
    writeTarget: ((Deno.env.get("ARTIFAX_WRITE_TARGET") || "event").trim().toLowerCase() === "arrangement") ? "arrangement" : "event",
    formPostPath: (Deno.env.get("ARTIFAX_FORM_POST_PATH") || "").trim(),
    formPostMethod: ((Deno.env.get("ARTIFAX_FORM_POST_METHOD") || "POST").trim().toUpperCase() === "PUT") ? "PUT" : "POST",
    docsListPath: (Deno.env.get("ARTIFAX_DOCS_LIST_PATH") || "").trim(),
    docsUploadPath: (Deno.env.get("ARTIFAX_DOCS_UPLOAD_PATH") || "").trim(),
    docsDownloadPath: (Deno.env.get("ARTIFAX_DOCS_DOWNLOAD_PATH") || "").trim(),
    docsUploadFormat: ((Deno.env.get("ARTIFAX_DOCS_UPLOAD_FORMAT") || "multipart").trim().toLowerCase() === "json") ? "json" : "multipart",
  };
}

function safeIdToken(raw: unknown): string {
  const s = String(raw ?? "").trim();
  if (!s) return "";
  const base = s.startsWith("evt-afx-") ? s.slice(8) : s;
  const root = base.includes("__") ? base.split("__")[0] : base;
  return /^[a-zA-Z0-9._-]+$/.test(root) ? root : "";
}

function interpolatePathTemplate(template: string, vars: Record<string, string>): string {
  const path = template.replace(/\{([a-zA-Z0-9_]+)\}/g, (_, k) => encodeURIComponent(vars[k] || ""));
  if (!path.startsWith("/") || path.includes("..")) {
    throw new Error("Invalid Artifax API path template");
  }
  return path;
}

// ---------- PDF Document Normalization Helpers ----------
interface NormalizedArtifaxDoc {
  artifaxDocId: string;
  name: string;
  size: number | null;
  mimeType: string;
  updatedAt: string;
  downloadPath: string;
  direction: "artifax_to_portal" | "portal_to_artifax";
  sha256?: string;
}

function extractInlinePdfDocuments(r: Record<string, unknown>): NormalizedArtifaxDoc[] {
  const rawArrays = [r.documents, r.attachments, r.files, r.event_documents, r.arrangement_documents];
  const out: NormalizedArtifaxDoc[] = [];
  const seen = new Set<string>();

  for (const arr of rawArrays) {
    if (!Array.isArray(arr)) continue;
    for (const item of arr) {
      if (!item || typeof item !== "object") continue;
      const d = item as Record<string, unknown>;
      const docId = String(d.document_id ?? d.attachment_id ?? d.file_id ?? d.id ?? "").trim();
      const name = String(d.filename ?? d.file_name ?? d.document_name ?? d.name ?? d.title ?? "").trim();
      const mime = String(d.mime_type ?? d.content_type ?? d.type ?? "").trim().toLowerCase();
      const isPdf = mime.includes("pdf") || /\.pdf$/i.test(name);
      if (!isPdf) continue;
      const key = docId || name;
      if (!key || seen.has(key)) continue;
      seen.add(key);

      const rawPath = String(d.download_path ?? d.path ?? d.relative_url ?? "").trim();
      out.push({
        artifaxDocId: docId || slugify(name),
        name: name || `Document-${docId}.pdf`,
        size: d.size !== undefined && d.size !== null ? Number(d.size) || null : (d.file_size ? Number(d.file_size) || null : null),
        mimeType: "application/pdf",
        updatedAt: String(d.updated_at ?? d.created_at ?? d.uploaded_at ?? "").trim(),
        downloadPath: rawPath.startsWith("/") && !rawPath.includes("..") ? rawPath : "",
        direction: "artifax_to_portal",
      });
    }
  }
  return out;
}

function mergeArtifaxDocuments(
  existingDocs: NormalizedArtifaxDoc[],
  incomingArtifaxDocs: NormalizedArtifaxDoc[]
): NormalizedArtifaxDoc[] {
  const result: NormalizedArtifaxDoc[] = [];
  const seenIds = new Set<string>();
  const portalNames = new Set<string>();

  for (const doc of existingDocs) {
    if (!doc || !doc.artifaxDocId) continue;
    result.push(doc);
    seenIds.add(String(doc.artifaxDocId));
    if (doc.direction === "portal_to_artifax" && doc.name) {
      portalNames.add(doc.name.trim().toLowerCase());
    }
  }

  for (const inc of incomingArtifaxDocs) {
    if (!inc || !inc.artifaxDocId) continue;
    if (seenIds.has(String(inc.artifaxDocId))) continue;
    // Prevent portal-uploaded PDFs from duplicating when pulled back from Artifax
    if (inc.name && (portalNames.has(inc.name.trim().toLowerCase()) || /^\[tech\s*portal\]/i.test(inc.name.trim()))) {
      continue;
    }
    seenIds.add(String(inc.artifaxDocId));
    result.push(inc);
  }
  return result;
}

// ---------- Action 1: PULL SYNC (`action: "sync"`) ----------
interface ParsedBooking {
  artifaxId: string;
  rawId: string;
  arrangementId: string;
  name: string;
  category: string;
  space: string;
  rawRoom: string;
  date: string;
  startTime: string;
  finishTime: string;
  clientContact: string;
  status: "Confirmed" | "Advancing";
  artifaxStage: string;
  rawStatusSummary: string;
  notes: string;
  inlineDocs: NormalizedArtifaxDoc[];
}

function incrementMap(map: Record<string, number>, key: string) {
  const k = key || "(blank)";
  map[k] = (map[k] || 0) + 1;
}

async function fetchArtifaxRawEvents(startDate: string, endDate: string): Promise<Record<string, unknown>[]> {
  const { baseUrl, headers } = getArtifaxAuthConfig();
  const params = new URLSearchParams({
    date: "between",
    start_date: startDate,
    end_date: endDate,
    schedule_output: "1",
  });
  const url = `${baseUrl}/api/arrangements/event?${params.toString()}`;
  const res = await fetch(url, { method: "GET", headers });
  if (!res.ok) {
    const errText = await res.text().catch(() => "");
    throw new Error(`Artifax API responded ${res.status}: ${errText.slice(0, 300)}`);
  }
  const data = await res.json();
  if (Array.isArray(data)) return data as Record<string, unknown>[];
  if (data && typeof data === "object") {
    const obj = data as Record<string, unknown>;
    const list = obj.events ?? obj.instances ?? obj.results ?? obj.data;
    if (Array.isArray(list)) return list as Record<string, unknown>[];
  }
  throw new Error("Unexpected Artifax API response shape (expected array of events)");
}

async function handleSyncAction(
  sb: ReturnType<typeof createClient>,
  body: Record<string, unknown>,
  corsHeaders: Record<string, string>
) {
  const writeCfg = getPortalWriteConfig();
  const dryRun = body.dryRun === true;
  const lookbackDays = Math.min(Math.max(Number(body.lookbackDays ?? 1) || 1, 0), 30);
  const lookaheadDays = Math.min(Math.max(Number(body.lookaheadDays ?? 180) || 180, 1), 365);

  const now = new Date();
  const nowIso = now.toISOString();
  const todayIso = nowIso.slice(0, 10);
  const fromDate = new Date(now.getTime() - lookbackDays * 864e5);
  const toDate = new Date(now.getTime() + lookaheadDays * 864e5);
  const startDate = typeof body.startDate === "string" && /^\d{4}-\d{2}-\d{2}$/.test(body.startDate)
    ? body.startDate
    : fromDate.toISOString().slice(0, 10);
  const endDate = typeof body.endDate === "string" && /^\d{4}-\d{2}-\d{2}$/.test(body.endDate)
    ? body.endDate
    : toDate.toISOString().slice(0, 10);

  // 1. Load DB-persisted suppression list
  const suppressedIds = new Set<string>();
  try {
    const { data: supRow } = await sb
      .from("app_settings")
      .select("value")
      .eq("key", SUPPRESSED_SETTINGS_KEY)
      .maybeSingle();

    if (supRow && supRow.value && typeof supRow.value === "object" && !Array.isArray(supRow.value)) {
      for (const [k, v] of Object.entries(supRow.value as Record<string, unknown>)) {
        if (!v || typeof v !== "object") continue;
        const entry = v as Record<string, unknown>;
        suppressedIds.add(String(k));
        if (entry.artifaxId) suppressedIds.add(String(entry.artifaxId));
        if (entry.id) {
          const eid = String(entry.id);
          suppressedIds.add(eid);
          if (eid.startsWith("evt-afx-")) suppressedIds.add(eid.slice(8));
        }
      }
    }
  } catch (e) {
    console.warn("[artifax-sync] Could not read suppression list:", e);
  }

  const isSuppressed = (artifaxId: string, rawId?: string): boolean => {
    if (suppressedIds.has(artifaxId) || suppressedIds.has(`evt-afx-${artifaxId}`)) return true;
    if (rawId && (suppressedIds.has(rawId) || suppressedIds.has(`evt-afx-${rawId}`))) return true;
    return false;
  };

  // 2. Fetch raw events from Artifax
  const rawEvents = await fetchArtifaxRawEvents(startDate, endDate);

  // 3. Filter, classify, and map into canonical single-space bookings
  const validBookings: ParsedBooking[] = [];
  const seenValidArtifaxIds = new Set<string>();
  const explicitlyExcludedRawIds = new Set<string>();

  const diagIncludedStatuses: Record<string, number> = {};
  const diagSkippedStatuses: Record<string, number> = {};
  const diagMappedRooms: Record<string, { space: string; count: number }> = {};
  const diagSkippedRooms: Record<string, number> = {};

  let skippedStatusCount = 0;
  let skippedRoomCount = 0;
  let suppressedCount = 0;

  for (const r of rawEvents) {
    if (!r || typeof r !== "object") continue;
    const rawId = String(r.event_id ?? r.id ?? r.instanceId ?? r.InstanceId ?? "").trim();
    if (!rawId || rawId === "undefined" || rawId === "null") continue;

    const statusEval = evaluateArtifaxStatus(r);
    if (!statusEval.allowed) {
      skippedStatusCount++;
      incrementMap(diagSkippedStatuses, statusEval.rawStatusSummary);
      explicitlyExcludedRawIds.add(rawId);
      continue;
    }

    const rawRooms = extractRawRooms(r);
    if (rawRooms.length === 0) {
      skippedRoomCount++;
      incrementMap(diagSkippedRooms, "(blank room)");
      explicitlyExcludedRawIds.add(rawId);
      continue;
    }

    const resolvedRooms: Array<{ space: string; rawRoom: string }> = [];
    const seenSpacesOnRecord = new Set<string>();
    for (const rr of rawRooms) {
      const sp = resolveVenueSpace(rr);
      if (sp) {
        if (!seenSpacesOnRecord.has(sp)) {
          seenSpacesOnRecord.add(sp);
          resolvedRooms.push({ space: sp, rawRoom: rr });
        }
        if (!diagMappedRooms[rr]) diagMappedRooms[rr] = { space: sp, count: 0 };
        diagMappedRooms[rr].count++;
      } else {
        incrementMap(diagSkippedRooms, rr);
      }
    }

    if (resolvedRooms.length === 0) {
      skippedRoomCount++;
      explicitlyExcludedRawIds.add(rawId);
      continue;
    }

    const arrangementId = String(r.arrangement_id ?? r.arrangementId ?? r.ArrangementId ?? r.groupId ?? r.GroupId ?? "").trim();
    const title = String(r.arrangement_description ?? r.name ?? r.title ?? r.EventName ?? r.arrangement_name ?? r.event_description ?? "Untitled").trim() || "Untitled";
    const rawDate = r.event_date ?? r.start_date ?? r.date ?? r.StartDate ?? r.Date ?? r.start ?? r.startDateTime ?? r.StartDateTime ?? r.start_date_time;
    const rawStart = r.start_time ?? r.start_time_text ?? r.time_start ?? r.StartTime ?? r.start ?? r.startDateTime ?? r.StartDateTime ?? r.start_date_time;
    const rawEnd = r.end_time ?? r.end_time_text ?? r.time_end ?? r.EndTime ?? r.end ?? r.endDateTime ?? r.EndDateTime ?? r.end_date_time;

    const dateIso = parseSafeDate(rawDate);
    const startTime = parseSafeTime(rawStart);
    const finishTime = parseSafeTime(rawEnd);
    const contact = String(r.contact ?? r.contactName ?? r.CustomerName ?? r.client_name ?? r.arrangement_contact_entity_full_name ?? "").trim();
    const rawType = String(r.arrangement_type_name ?? r.type ?? r.arrangementType ?? r.ArrangementType ?? "").trim();
    // Layer 1 loop prevention: skips "Tech Portal*" custom form & configured portalFormId
    const notes = extractArtifaxNotes(r, writeCfg.formId);
    const inlineDocs = extractInlinePdfDocuments(r);

    incrementMap(diagIncludedStatuses, `${statusEval.artifaxStage} (${statusEval.rawStatusSummary})`);

    for (const { space, rawRoom } of resolvedRooms) {
      const artifaxId = resolvedRooms.length === 1 ? rawId : `${rawId}__${slugify(space)}`;

      if (isSuppressed(artifaxId, rawId)) {
        suppressedCount++;
        explicitlyExcludedRawIds.add(artifaxId);
        continue;
      }

      if (seenValidArtifaxIds.has(artifaxId)) continue;
      seenValidArtifaxIds.add(artifaxId);

      validBookings.push({
        artifaxId,
        rawId,
        arrangementId,
        name: title,
        category: toCategory(rawType, title, space),
        space,
        rawRoom,
        date: dateIso,
        startTime,
        finishTime,
        clientContact: contact,
        status: statusEval.portalStatus === "Advancing" ? "Advancing" : "Confirmed",
        artifaxStage: statusEval.artifaxStage,
        rawStatusSummary: statusEval.rawStatusSummary,
        notes,
        inlineDocs,
      });
    }
  }

  // 4. Load existing Artifax-managed rows from public.advancing
  const { data: existingRows, error: fetchExistingErr } = await sb
    .from("advancing")
    .select("*")
    .or("artifaxId.not.is.null,id.like.evt-afx-%");

  if (fetchExistingErr) {
    throw new Error(`Failed to read advancing table: ${fetchExistingErr.message}`);
  }

  const existingList = (existingRows || []) as Record<string, unknown>[];
  const existingByArtifaxId = new Map<string, Record<string, unknown>>();
  for (const row of existingList) {
    const aid = String(row.artifaxId || (String(row.id || "").startsWith("evt-afx-") ? String(row.id).slice(8) : "")).trim();
    if (aid) existingByArtifaxId.set(aid, row);
  }

  // 5. Build upsert payloads (preserving ALL technician-enriched portal fields + write-back metadata)
  const rowsToUpsert: Record<string, unknown>[] = [];
  let created = 0;
  let updated = 0;

  for (const booking of validBookings) {
    const existing = existingByArtifaxId.get(booking.artifaxId);
    const isAux = AUXILIARY_SPACES.has(booking.space);

    if (existing) {
      const changes: string[] = [];
      if (existing.date !== booking.date && booking.date) changes.push(`[Date Change]: Date moved to ${booking.date}`);
      if (existing.startTime !== booking.startTime && booking.startTime) changes.push(`[Time Change]: Start time updated to ${booking.startTime}`);
      if (existing.finishTime !== booking.finishTime && booking.finishTime) changes.push(`[Time Change]: Finish time updated to ${booking.finishTime}`);
      if (existing.space !== booking.space && booking.space) changes.push(`[Space Change]: Moved to ${booking.space}`);
      if (existing.name !== booking.name && booking.name) changes.push(`[Title Change]: Renamed to ${booking.name}`);
      if (existing.clientContact !== booking.clientContact && booking.clientContact) changes.push(`[Contact Change]: Contact updated to ${booking.clientContact}`);

      const existingPkg = (existing.production_package && typeof existing.production_package === "object" && !Array.isArray(existing.production_package))
        ? { ...(existing.production_package as Record<string, unknown>) }
        : {};

      const prevHistory = Array.isArray(existing.artifaxHistory)
        ? [...(existing.artifaxHistory as Record<string, unknown>[])]
        : (Array.isArray(existingPkg.artifaxHistory) ? [...(existingPkg.artifaxHistory as Record<string, unknown>[])] : []);

      const lastNotes = prevHistory.length > 0 ? String(prevHistory[prevHistory.length - 1].notes || "") : "";
      if (booking.notes && booking.notes !== lastNotes) {
        changes.push("[Artifax Notes Updated]");
      }
      if (existingPkg.artifaxStage && existingPkg.artifaxStage !== booking.artifaxStage) {
        changes.push(`[Artifax Stage]: ${existingPkg.artifaxStage} -> ${booking.artifaxStage}`);
      }

      if (changes.length > 0) {
        prevHistory.push({ date: nowIso, notes: booking.notes || lastNotes || "", changes });
      } else if (prevHistory.length === 0 && booking.notes) {
        prevHistory.push({ date: nowIso, notes: booking.notes, changes: ["Initial sync from Artifax"] });
      }

      let resolvedPortalStatus: string = booking.status;
      if (existing.status === "Complete") resolvedPortalStatus = "Complete";
      else if (existing.status === "Confirmed" && booking.status === "Advancing") resolvedPortalStatus = "Confirmed";

      const prevDocs = Array.isArray(existingPkg.artifaxDocuments)
        ? (existingPkg.artifaxDocuments as NormalizedArtifaxDoc[])
        : [];
      const mergedDocs = mergeArtifaxDocuments(prevDocs, booking.inlineDocs);

      existingPkg.artifaxHistory = prevHistory;
      existingPkg.artifaxNotes = booking.notes || existingPkg.artifaxNotes || "";
      existingPkg.artifaxStage = booking.artifaxStage;
      existingPkg.artifaxRoomRaw = booking.rawRoom;
      existingPkg.artifaxArrangementId = booking.arrangementId || existingPkg.artifaxArrangementId || null;
      existingPkg.artifaxSyncedAt = nowIso;
      if (mergedDocs.length > 0) existingPkg.artifaxDocuments = mergedDocs;
      if (existingPkg.techRequiredManual !== true && existingPkg.noTechNeeded === undefined && isAux) {
        existingPkg.noTechNeeded = true;
      }

      const existingTechInfo = String(existing.techInfo || "").trim();
      const updatedRow: Record<string, unknown> = {
        ...existing,
        artifaxId: booking.artifaxId,
        groupId: null,
        name: booking.name,
        category: booking.category,
        space: booking.space,
        date: booking.date,
        startTime: booking.startTime,
        finishTime: booking.finishTime,
        clientContact: booking.clientContact,
        status: resolvedPortalStatus,
        techInfo: existingTechInfo ? existingTechInfo : (booking.notes || ""),
        artifaxHistory: prevHistory,
        production_package: existingPkg,
      };
      delete updatedRow.artifaxNotes;
      delete updatedRow.deleted;
      rowsToUpsert.push(updatedRow);
      updated++;
    } else {
      const initialHistory = booking.notes
        ? [{ date: nowIso, notes: booking.notes, changes: ["Initial sync from Artifax"] }]
        : [];

      const newRow: Record<string, unknown> = {
        id: `evt-afx-${booking.artifaxId}`,
        artifaxId: booking.artifaxId,
        groupId: null,
        name: booking.name,
        category: booking.category,
        space: booking.space,
        date: booking.date,
        startTime: booking.startTime,
        finishTime: booking.finishTime,
        clientContact: booking.clientContact,
        status: booking.status,
        techInfo: booking.notes || "",
        artifaxHistory: initialHistory,
        technicians: isAux
          ? [{ userId: "", role: "None", isNoTech: true, isFreelancer: false, freelancerName: "", startTime: "", finishTime: "", bookingStatus: "confirmed" }]
          : [],
        production_package: {
          artifaxHistory: initialHistory,
          artifaxNotes: booking.notes || "",
          artifaxStage: booking.artifaxStage,
          artifaxRoomRaw: booking.rawRoom,
          artifaxArrangementId: booking.arrangementId || null,
          artifaxSyncedAt: nowIso,
          artifaxDocuments: booking.inlineDocs,
          noTechNeeded: isAux,
        },
      };
      rowsToUpsert.push(newRow);
      created++;
    }
  }

  // 6. Authoritative Reconciliation Sweep
  const canSweepWindow = rawEvents.length > 0;
  const rowsToRemove: Array<{ id: string; artifaxId: string; name: string; date: string; space: string; reason: string }> = [];

  for (const row of existingList) {
    const rowId = String(row.id || "");
    const aid = String(row.artifaxId || (rowId.startsWith("evt-afx-") ? rowId.slice(8) : "")).trim();
    const baseAid = aid.includes("__") ? aid.split("__")[0] : aid;
    if (!rowId || !aid) continue;
    if (seenValidArtifaxIds.has(aid)) continue;

    const rowDate = parseSafeDate(row.date);
    const rowStatus = String(row.status || "").trim().toLowerCase();
    const rowSpace = String(row.space || "").trim();
    const inSyncWindow = !!rowDate && rowDate >= startDate && rowDate <= endDate;

    let removeReason: string | null = null;
    if (isSuppressed(aid, baseAid)) {
      removeReason = "portal_suppressed";
    } else if (explicitlyExcludedRawIds.has(aid) || explicitlyExcludedRawIds.has(baseAid)) {
      removeReason = "cancelled_or_non_contracted_in_artifax";
    } else if (rowStatus === "cancelled" || rowStatus === "canceled") {
      removeReason = "legacy_cancelled_cleanup";
    } else if (rowSpace && !CANONICAL_SPACES.has(rowSpace)) {
      removeReason = "non_venue_space_cleanup";
    } else if (canSweepWindow && inSyncWindow) {
      removeReason = "removed_or_moved_in_artifax";
    }

    if (removeReason) {
      rowsToRemove.push({
        id: rowId,
        artifaxId: aid,
        name: String(row.name || "Untitled"),
        date: rowDate,
        space: rowSpace,
        reason: removeReason,
      });
    }
  }

  // 7. Execute Database Writes (unless dryRun)
  let cancelledShiftsCount = 0;
  let cancelledDcpsCount = 0;

  if (!dryRun) {
    if (rowsToUpsert.length > 0) {
      const CHUNK = 100;
      const strippedCols = new Set<string>();
      for (let i = 0; i < rowsToUpsert.length; i += CHUNK) {
        let batch = rowsToUpsert.slice(i, i + CHUNK).map((r) => {
          const copy = { ...r };
          for (const c of strippedCols) delete copy[c];
          return copy;
        });

        let attempts = 0;
        while (attempts < 6) {
          const { error: upsertErr } = await sb.from("advancing").upsert(batch, { onConflict: "id" });
          if (!upsertErr) break;
          const m = upsertErr.message?.match(/Could not find the '([^']+)' column/i) ||
                    upsertErr.message?.match(/column "([^"]+)" of relation "advancing" does not exist/i);
          const missingCol = m ? m[1] : (upsertErr.message?.includes("artifaxHistory") ? "artifaxHistory" : null);
          if (missingCol) {
            strippedCols.add(missingCol);
            batch = batch.map((r) => {
              const copy = { ...r };
              delete copy[missingCol];
              return copy;
            });
            attempts++;
            continue;
          }
          throw new Error(`Supabase advancing upsert failed: ${upsertErr.message}`);
        }
      }
    }

    if (rowsToRemove.length > 0) {
      const removeIds = rowsToRemove.map((r) => r.id);
      const CHUNK = 100;
      for (let i = 0; i < removeIds.length; i += CHUNK) {
        const chunkIds = removeIds.slice(i, i + CHUNK);

        try {
          const { data: linkedBookings } = await sb.from("bookings").select("*").in("eventId", chunkIds);
          if (Array.isArray(linkedBookings) && linkedBookings.length > 0) {
            const shiftsToCancel: Record<string, unknown>[] = [];
            for (const b of linkedBookings as Record<string, unknown>[]) {
              const st = String(b.status || "").trim().toLowerCase();
              if (st === "cancelled" || st === "canceled") continue;
              const shiftDate = parseSafeDate(b.date);
              const isPastWorked = !!shiftDate && shiftDate < todayIso && st === "confirmed";
              if (isPastWorked) continue;
              shiftsToCancel.push({
                ...b,
                status: "cancelled",
                cancellationReason: "Event cancelled or removed in Artifax",
                cancelledAt: nowIso,
                updatedAt: nowIso,
              });
            }
            if (shiftsToCancel.length > 0) {
              const { error: bErr } = await sb.from("bookings").upsert(shiftsToCancel, { onConflict: "id" });
              if (!bErr) cancelledShiftsCount += shiftsToCancel.length;
            }
          }
        } catch (e) {
          console.warn("[artifax-sync] Linked bookings cancellation warning:", e);
        }

        try {
          const { data: linkedDcps } = await sb.from("dcps").select("*").in("eventId", chunkIds);
          if (Array.isArray(linkedDcps) && linkedDcps.length > 0) {
            const dcpsToCancel: Record<string, unknown>[] = [];
            for (const d of linkedDcps as Record<string, unknown>[]) {
              if (d.isCancelled === true && d.outcome === "Cancelled") continue;
              dcpsToCancel.push({ ...d, isCancelled: true, outcome: "Cancelled", updatedAt: nowIso });
            }
            if (dcpsToCancel.length > 0) {
              const { error: dErr } = await sb.from("dcps").upsert(dcpsToCancel, { onConflict: "id" });
              if (!dErr) cancelledDcpsCount += dcpsToCancel.length;
            }
          }
        } catch (e) {
          console.warn("[artifax-sync] Linked DCP cancellation warning:", e);
        }

        const { error: delErr } = await sb.from("advancing").delete().in("id", chunkIds);
        if (delErr) {
          console.warn("[artifax-sync] Failed deleting reconciled advancing rows:", delErr.message);
        }
      }
    }
  }

  const summary = {
    version: SYNC_ENGINE_VERSION,
    syncedServerSide: true,
    writeBackConfigured: !!writeCfg.formId,
    dryRun,
    syncedAt: nowIso,
    window: { startDate, endDate },
    counts: {
      fetched: rawEvents.length,
      valid: validBookings.length,
      created,
      updated,
      removed: rowsToRemove.length,
      cancelledShifts: cancelledShiftsCount,
      cancelledDcps: cancelledDcpsCount,
      suppressed: suppressedCount,
      skippedStatus: skippedStatusCount,
      skippedRoom: skippedRoomCount,
    },
    created,
    updated,
    removed: rowsToRemove.length,
    skipped: skippedStatusCount + skippedRoomCount + suppressedCount,
    diagnostics: {
      includedStatuses: diagIncludedStatuses,
      skippedStatuses: diagSkippedStatuses,
      mappedRooms: diagMappedRooms,
      skippedRooms: diagSkippedRooms,
      removedEvents: rowsToRemove.slice(0, 100),
      sampleSynced: dryRun
        ? validBookings.slice(0, 50).map((b) => ({
            artifaxId: b.artifaxId,
            name: b.name,
            space: b.space,
            rawRoom: b.rawRoom,
            date: b.date,
            startTime: b.startTime,
            finishTime: b.finishTime,
            artifaxStage: b.artifaxStage,
            portalStatus: b.status,
          }))
        : [],
    },
  };

  if (!dryRun) {
    try {
      await sb.from("app_settings").upsert(
        {
          key: LAST_SYNC_SETTINGS_KEY,
          value: {
            version: SYNC_ENGINE_VERSION,
            syncedServerSide: true,
            writeBackConfigured: !!writeCfg.formId,
            syncedAt: nowIso,
            window: summary.window,
            counts: summary.counts,
            diagnostics: {
              includedStatuses: diagIncludedStatuses,
              skippedStatuses: diagSkippedStatuses,
              mappedRooms: diagMappedRooms,
              skippedRooms: diagSkippedRooms,
              removedEvents: rowsToRemove.slice(0, 50),
            },
          },
          updatedAt: nowIso,
        },
        { onConflict: "key" }
      );
    } catch (e) {
      console.warn("[artifax-sync] Could not save artifax_last_sync:", e);
    }
  }

  return jsonResponse(summary, 200, corsHeaders);
}

// ---------- Action 2: PUSH EVENT TO DEDICATED CUSTOM FORM (`action: "push_event"`) ----------
async function handlePushEventAction(
  sb: ReturnType<typeof createClient>,
  body: Record<string, unknown>,
  corsHeaders: Record<string, string>
) {
  const writeCfg = getPortalWriteConfig();
  const missingSecrets: string[] = [];
  if (!writeCfg.formId) missingSecrets.push("ARTIFAX_PORTAL_FORM_ID");
  if (!writeCfg.fieldNotesId) missingSecrets.push("ARTIFAX_PORTAL_FIELD_NOTES_ID");
  if (!writeCfg.fieldTimingsId) missingSecrets.push("ARTIFAX_PORTAL_FIELD_TIMINGS_ID");
  if (!writeCfg.fieldCrewId) missingSecrets.push("ARTIFAX_PORTAL_FIELD_CREW_ID");
  if (!writeCfg.fieldSpecId) missingSecrets.push("ARTIFAX_PORTAL_FIELD_SPEC_ID");

  if (missingSecrets.length > 0) {
    return jsonResponse(
      {
        ok: false,
        notConfigured: true,
        missingSecrets,
        message: `Artifax write-back custom form secrets not configured yet (${missingSecrets.join(", ")}). Run Discover Artifax Schema in Sync Log after creating the "Tech Portal Advancing" custom form in Artifax.`,
      },
      200,
      corsHeaders
    );
  }

  const eventId = String(body.eventId || "").trim();
  const force = body.force === true;
  const payload = (body.payload && typeof body.payload === "object") ? (body.payload as Record<string, unknown>) : {};

  let dbRow: Record<string, unknown> | null = null;
  if (eventId) {
    const { data } = await sb.from("advancing").select("*").eq("id", eventId).maybeSingle();
    if (data) dbRow = data as Record<string, unknown>;
  }

  const existingPkg = (dbRow && dbRow.production_package && typeof dbRow.production_package === "object" && !Array.isArray(dbRow.production_package))
    ? { ...(dbRow.production_package as Record<string, unknown>) }
    : {};

  const artifaxEventId = safeIdToken(body.artifaxId ?? dbRow?.artifaxId ?? eventId);
  const arrangementId = safeIdToken(body.arrangementId ?? existingPkg.artifaxArrangementId);

  if (!artifaxEventId && !arrangementId) {
    return jsonResponse({ ok: false, error: "Event is not linked to an Artifax ID" }, 400, corsHeaders);
  }

  const nowIso = new Date().toISOString();
  const updatedBy = String(payload.updatedBy || "Tech Portal").trim().slice(0, 120);
  const stamp = `\n\n[Updated via Rich Mix Tech Portal · ${nowIso.slice(0, 16).replace("T", " ")} UTC by ${updatedBy}]`;

  const fieldNotes = String(payload.techNotes || "").trim();
  const fieldTimings = String(payload.timings || "").trim();
  const fieldCrew = String(payload.crew || "").trim();
  const fieldSpec = String(payload.specSummary || "").trim();

  // Layer 2 loop prevention: deterministic SHA-256 fingerprint of outgoing portal data
  const canonicalPayload = JSON.stringify({ fieldNotes, fieldTimings, fieldCrew, fieldSpec });
  const pushHash = await sha256Hex(canonicalPayload);

  if (!force && existingPkg.artifaxLastPushHash === pushHash) {
    return jsonResponse(
      {
        ok: true,
        skippedUnchanged: true,
        hash: pushHash,
        lastPushedAt: existingPkg.artifaxLastPushedAt || nowIso,
      },
      200,
      corsHeaders
    );
  }

  const { baseUrl, headers } = getArtifaxAuthConfig();
  const targetTemplate = writeCfg.formPostPath ||
    (writeCfg.writeTarget === "arrangement" && arrangementId
      ? "/api/arrangements/{arrangementId}/custom_forms"
      : "/api/events/{eventId}/custom_forms");

  const path = interpolatePathTemplate(targetTemplate, {
    eventId: artifaxEventId,
    arrangementId: arrangementId || artifaxEventId,
    formId: writeCfg.formId,
  });

  const elementsPayload = [
    {
      custom_form_element_id: Number(writeCfg.fieldNotesId) || writeCfg.fieldNotesId,
      custom_form_data_value: (fieldNotes || "No portal tech notes yet.") + stamp,
      custom_form_data_text: (fieldNotes || "No portal tech notes yet.") + stamp,
    },
    {
      custom_form_element_id: Number(writeCfg.fieldTimingsId) || writeCfg.fieldTimingsId,
      custom_form_data_value: fieldTimings || "No technical timings recorded yet.",
      custom_form_data_text: fieldTimings || "No technical timings recorded yet.",
    },
    {
      custom_form_element_id: Number(writeCfg.fieldCrewId) || writeCfg.fieldCrewId,
      custom_form_data_value: fieldCrew || "Unassigned",
      custom_form_data_text: fieldCrew || "Unassigned",
    },
    {
      custom_form_element_id: Number(writeCfg.fieldSpecId) || writeCfg.fieldSpecId,
      custom_form_data_value: fieldSpec || "No spec or package details recorded yet.",
      custom_form_data_text: fieldSpec || "No spec or package details recorded yet.",
    },
  ];

  const artifaxRequestBody = {
    custom_form_id: Number(writeCfg.formId) || writeCfg.formId,
    event_id: Number(artifaxEventId) || artifaxEventId,
    ...(arrangementId ? { arrangement_id: Number(arrangementId) || arrangementId } : {}),
    custom_form_elements: elementsPayload,
    elements: elementsPayload,
  };

  const url = `${baseUrl}${path}`;
  const reqHeaders = { ...headers, "Content-Type": "application/json" };

  let res = await fetch(url, {
    method: writeCfg.formPostMethod,
    headers: reqHeaders,
    body: JSON.stringify(artifaxRequestBody),
  });

  // Automatically try PUT if POST returned 405 Method Not Allowed (some Artifax versions update via PUT)
  if (res.status === 405 && writeCfg.formPostMethod === "POST") {
    res = await fetch(url, {
      method: "PUT",
      headers: reqHeaders,
      body: JSON.stringify(artifaxRequestBody),
    });
  }

  const respText = await res.text().catch(() => "");
  if (!res.ok) {
    if (dbRow && eventId) {
      existingPkg.artifaxLastPushStatus = "error";
      existingPkg.artifaxLastPushError = `Artifax ${res.status}: ${respText.slice(0, 240)}`;
      await sb.from("advancing").update({ production_package: existingPkg }).eq("id", eventId);
    }
    return jsonResponse(
      {
        ok: false,
        status: res.status,
        endpoint: path,
        error: `Artifax rejected custom form update (${res.status}): ${respText.slice(0, 240)}`,
      },
      200,
      corsHeaders
    );
  }

  // Persist successful push hash & timestamp into Supabase production_package
  if (dbRow && eventId) {
    existingPkg.artifaxLastPushHash = pushHash;
    existingPkg.artifaxLastPushedAt = nowIso;
    existingPkg.artifaxLastPushedBy = updatedBy;
    existingPkg.artifaxLastPushStatus = "ok";
    existingPkg.artifaxLastPushError = null;
    await sb.from("advancing").update({ production_package: existingPkg }).eq("id", eventId);
  }

  return jsonResponse(
    {
      ok: true,
      pushedAt: nowIso,
      hash: pushHash,
      endpoint: path,
      artifaxEventId,
      arrangementId: arrangementId || null,
    },
    200,
    corsHeaders
  );
}

// ---------- Action 3: LIST PDF DOCUMENTS IN ARTIFAX (`action: "list_documents"`) ----------
async function handleListDocumentsAction(
  sb: ReturnType<typeof createClient>,
  body: Record<string, unknown>,
  corsHeaders: Record<string, string>
) {
  const writeCfg = getPortalWriteConfig();
  const { baseUrl, headers } = getArtifaxAuthConfig();
  const eventId = String(body.eventId || "").trim();

  let dbRow: Record<string, unknown> | null = null;
  if (eventId) {
    const { data } = await sb.from("advancing").select("*").eq("id", eventId).maybeSingle();
    if (data) dbRow = data as Record<string, unknown>;
  }
  const existingPkg = (dbRow && dbRow.production_package && typeof dbRow.production_package === "object" && !Array.isArray(dbRow.production_package))
    ? { ...(dbRow.production_package as Record<string, unknown>) }
    : {};

  const artifaxEventId = safeIdToken(body.artifaxId ?? dbRow?.artifaxId ?? eventId);
  const arrangementId = safeIdToken(body.arrangementId ?? existingPkg.artifaxArrangementId);

  if (!artifaxEventId && !arrangementId) {
    return jsonResponse({ ok: false, error: "Event is not linked to an Artifax ID" }, 400, corsHeaders);
  }

  const candidatePaths: string[] = [];
  if (writeCfg.docsListPath) {
    candidatePaths.push(interpolatePathTemplate(writeCfg.docsListPath, {
      eventId: artifaxEventId,
      arrangementId: arrangementId || artifaxEventId,
    }));
  } else {
    if (artifaxEventId) candidatePaths.push(`/api/events/${encodeURIComponent(artifaxEventId)}/documents`);
    if (arrangementId) candidatePaths.push(`/api/arrangements/${encodeURIComponent(arrangementId)}/documents`);
  }

  const discoveredDocs: NormalizedArtifaxDoc[] = [];
  const probeErrors: string[] = [];

  for (const p of candidatePaths) {
    try {
      const res = await fetch(`${baseUrl}${p}`, { method: "GET", headers });
      if (!res.ok) {
        probeErrors.push(`${p} -> ${res.status}`);
        continue;
      }
      const data = await res.json().catch(() => null);
      const rawList = Array.isArray(data)
        ? data
        : (data && typeof data === "object"
            ? ((data as Record<string, unknown>).documents ?? (data as Record<string, unknown>).attachments ?? (data as Record<string, unknown>).data ?? [])
            : []);
      if (Array.isArray(rawList)) {
        const normalized = extractInlinePdfDocuments({ documents: rawList });
        for (const doc of normalized) {
          if (!doc.downloadPath && doc.artifaxDocId) {
            doc.downloadPath = `${p}/${encodeURIComponent(doc.artifaxDocId)}`;
          }
          discoveredDocs.push(doc);
        }
      }
    } catch (e) {
      probeErrors.push(`${p} -> ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  const existingDocs = Array.isArray(existingPkg.artifaxDocuments)
    ? (existingPkg.artifaxDocuments as NormalizedArtifaxDoc[])
    : [];
  const merged = mergeArtifaxDocuments(existingDocs, discoveredDocs);

  if (dbRow && eventId && merged.length !== existingDocs.length) {
    existingPkg.artifaxDocuments = merged;
    await sb.from("advancing").update({ production_package: existingPkg }).eq("id", eventId);
  }

  return jsonResponse(
    {
      ok: true,
      documents: merged,
      fetchedFromArtifax: discoveredDocs.length,
      probeErrors,
    },
    200,
    corsHeaders
  );
}

// ---------- Action 4: DOWNLOAD PDF FROM ARTIFAX (`action: "download_document"`) ----------
async function handleDownloadDocumentAction(
  body: Record<string, unknown>,
  corsHeaders: Record<string, string>
) {
  const writeCfg = getPortalWriteConfig();
  const { baseUrl, headers } = getArtifaxAuthConfig();
  const documentId = safeIdToken(body.documentId);
  const eventId = safeIdToken(body.artifaxId ?? body.eventId);
  const arrangementId = safeIdToken(body.arrangementId);
  const rawDownloadPath = String(body.downloadPath || "").trim();

  if (!documentId && !rawDownloadPath) {
    return jsonResponse({ ok: false, error: "Missing documentId" }, 400, corsHeaders);
  }

  const candidatePaths: string[] = [];
  if (rawDownloadPath && rawDownloadPath.startsWith("/") && !rawDownloadPath.includes("..") && !rawDownloadPath.startsWith("//")) {
    candidatePaths.push(rawDownloadPath);
  }
  if (writeCfg.docsDownloadPath && documentId) {
    candidatePaths.push(interpolatePathTemplate(writeCfg.docsDownloadPath, {
      documentId,
      eventId,
      arrangementId: arrangementId || eventId,
    }));
  } else if (documentId) {
    candidatePaths.push(`/api/documents/${encodeURIComponent(documentId)}`);
    candidatePaths.push(`/api/documents/${encodeURIComponent(documentId)}/download`);
    if (arrangementId) candidatePaths.push(`/api/arrangements/${encodeURIComponent(arrangementId)}/documents/${encodeURIComponent(documentId)}`);
    if (eventId) candidatePaths.push(`/api/events/${encodeURIComponent(eventId)}/documents/${encodeURIComponent(documentId)}`);
  }

  let lastError = "Document not found";
  for (const p of candidatePaths) {
    const res = await fetch(`${baseUrl}${p}`, {
      method: "GET",
      headers: { ...headers, "Accept": "application/pdf, application/octet-stream, */*" },
    });
    if (!res.ok) {
      lastError = `Artifax ${res.status} on ${p}`;
      continue;
    }

    const buf = new Uint8Array(await res.arrayBuffer());
    if (buf.byteLength === 0) {
      lastError = `Empty response from ${p}`;
      continue;
    }
    if (buf.byteLength > MAX_PDF_BYTES) {
      return jsonResponse({ ok: false, error: "PDF exceeds 25 MB size limit" }, 413, corsHeaders);
    }

    // Some Artifax endpoints wrap base64 inside JSON; handle both raw binary PDF and JSON base64
    const ct = (res.headers.get("content-type") || "").toLowerCase();
    let pdfBytes = buf;
    let filename = String(body.filename || `artifax-document-${documentId || "file"}.pdf`);
    if (ct.includes("application/json")) {
      try {
        const parsed = JSON.parse(new TextDecoder().decode(buf)) as Record<string, unknown>;
        const b64 = String(parsed.content ?? parsed.data ?? parsed.base64 ?? parsed.file_content ?? "");
        if (b64) {
          pdfBytes = base64ToBytes(b64);
          if (parsed.filename || parsed.name) filename = String(parsed.filename || parsed.name);
        }
      } catch { /* fall through */ }
    }

    return jsonResponse(
      {
        ok: true,
        filename: filename.endsWith(".pdf") ? filename : `${filename}.pdf`,
        contentType: "application/pdf",
        size: pdfBytes.byteLength,
        base64: bytesToBase64(pdfBytes),
      },
      200,
      corsHeaders
    );
  }

  return jsonResponse({ ok: false, error: lastError }, 200, corsHeaders);
}

// ---------- Action 5: UPLOAD PORTAL PDF TO ARTIFAX (`action: "upload_document"`) ----------
async function handleUploadDocumentAction(
  sb: ReturnType<typeof createClient>,
  body: Record<string, unknown>,
  corsHeaders: Record<string, string>
) {
  const writeCfg = getPortalWriteConfig();
  const { baseUrl, headers } = getArtifaxAuthConfig();
  const supabaseUrl = (Deno.env.get("SUPABASE_URL") || "").replace(/\/$/, "");

  const eventId = String(body.eventId || "").trim();
  const force = body.force === true;
  const rawFilename = String(body.filename || "tech-spec.pdf").trim().replace(/[^a-zA-Z0-9._\-\s()]/g, "_");
  const filename = rawFilename.toLowerCase().endsWith(".pdf") ? rawFilename : `${rawFilename}.pdf`;
  const kind = String(body.kind || "tech_spec").trim();

  let dbRow: Record<string, unknown> | null = null;
  if (eventId) {
    const { data } = await sb.from("advancing").select("*").eq("id", eventId).maybeSingle();
    if (data) dbRow = data as Record<string, unknown>;
  }
  const existingPkg = (dbRow && dbRow.production_package && typeof dbRow.production_package === "object" && !Array.isArray(dbRow.production_package))
    ? { ...(dbRow.production_package as Record<string, unknown>) }
    : {};

  const artifaxEventId = safeIdToken(body.artifaxId ?? dbRow?.artifaxId ?? eventId);
  const arrangementId = safeIdToken(body.arrangementId ?? existingPkg.artifaxArrangementId);

  if (!artifaxEventId && !arrangementId) {
    return jsonResponse({ ok: false, error: "Event is not linked to an Artifax ID" }, 400, corsHeaders);
  }

  // Acquire PDF bytes either from base64 payload or validated Supabase Storage URL
  let pdfBytes: Uint8Array | null = null;
  if (typeof body.base64 === "string" && body.base64.trim()) {
    pdfBytes = base64ToBytes(body.base64);
  } else if (typeof body.sourceUrl === "string" && body.sourceUrl.trim()) {
    const srcUrl = body.sourceUrl.trim();
    // SSRF guard: only allow fetching from our own Supabase project storage URL
    if (!supabaseUrl || !srcUrl.startsWith(`${supabaseUrl}/storage/v1/object/`)) {
      return jsonResponse({ ok: false, error: "Invalid PDF sourceUrl (must belong to portal storage)" }, 400, corsHeaders);
    }
    const fetchRes = await fetch(srcUrl);
    if (!fetchRes.ok) {
      return jsonResponse({ ok: false, error: `Could not read PDF from storage (${fetchRes.status})` }, 200, corsHeaders);
    }
    pdfBytes = new Uint8Array(await fetchRes.arrayBuffer());
  }

  if (!pdfBytes || pdfBytes.byteLength === 0) {
    return jsonResponse({ ok: false, error: "No PDF file data provided" }, 400, corsHeaders);
  }
  if (pdfBytes.byteLength > MAX_PDF_BYTES) {
    return jsonResponse({ ok: false, error: "PDF exceeds 25 MB upload limit" }, 413, corsHeaders);
  }

  // Validate PDF magic header (%PDF-)
  const magic = new TextDecoder().decode(pdfBytes.subarray(0, 5));
  if (magic !== "%PDF-") {
    return jsonResponse({ ok: false, error: "Only valid PDF documents (%PDF-) can be uploaded to Artifax" }, 400, corsHeaders);
  }

  // SHA-256 deduplication check
  const fileSha = await sha256Hex(pdfBytes);
  const existingDocs = Array.isArray(existingPkg.artifaxDocuments)
    ? (existingPkg.artifaxDocuments as NormalizedArtifaxDoc[])
    : [];

  if (!force) {
    const already = existingDocs.find((d) => d && d.sha256 === fileSha);
    if (already) {
      return jsonResponse(
        {
          ok: true,
          skippedDuplicate: true,
          artifaxDocId: already.artifaxDocId,
          sha256: fileSha,
          filename: already.name,
        },
        200,
        corsHeaders
      );
    }
  }

  const uploadTemplate = writeCfg.docsUploadPath ||
    (writeCfg.writeTarget === "arrangement" && arrangementId
      ? "/api/arrangements/{arrangementId}/documents"
      : "/api/events/{eventId}/documents");

  const path = interpolatePathTemplate(uploadTemplate, {
    eventId: artifaxEventId,
    arrangementId: arrangementId || artifaxEventId,
  });

  const url = `${baseUrl}${path}`;
  let res: Response;

  if (writeCfg.docsUploadFormat === "json") {
    res = await fetch(url, {
      method: "POST",
      headers: { ...headers, "Content-Type": "application/json" },
      body: JSON.stringify({
        filename,
        mime_type: "application/pdf",
        content_base64: bytesToBase64(pdfBytes),
        description: `Uploaded from Rich Mix Tech Portal (${kind})`,
        event_id: Number(artifaxEventId) || artifaxEventId,
        ...(arrangementId ? { arrangement_id: Number(arrangementId) || arrangementId } : {}),
      }),
    });
  } else {
    const formData = new FormData();
    formData.append("file", new Blob([pdfBytes], { type: "application/pdf" }), filename);
    formData.append("filename", filename);
    formData.append("description", `Uploaded from Rich Mix Tech Portal (${kind})`);
    if (artifaxEventId) formData.append("event_id", artifaxEventId);
    if (arrangementId) formData.append("arrangement_id", arrangementId);
    res = await fetch(url, {
      method: "POST",
      headers,
      body: formData,
    });
  }

  const respText = await res.text().catch(() => "");
  if (!res.ok) {
    return jsonResponse(
      {
        ok: false,
        status: res.status,
        endpoint: path,
        error: `Artifax rejected PDF upload (${res.status}): ${respText.slice(0, 240)}`,
      },
      200,
      corsHeaders
    );
  }

  let artifaxDocId = `portal-${fileSha.slice(0, 12)}`;
  try {
    const parsed = JSON.parse(respText) as Record<string, unknown>;
    const returnedId = parsed.document_id ?? parsed.attachment_id ?? parsed.id ?? (parsed.data && (parsed.data as Record<string, unknown>).id);
    if (returnedId) artifaxDocId = String(returnedId);
  } catch { /* non-JSON 201 OK */ }

  const nowIso = new Date().toISOString();
  const docEntry: NormalizedArtifaxDoc = {
    artifaxDocId,
    name: filename,
    size: pdfBytes.byteLength,
    mimeType: "application/pdf",
    updatedAt: nowIso,
    downloadPath: `${path}/${encodeURIComponent(artifaxDocId)}`,
    direction: "portal_to_artifax",
    sha256: fileSha,
  };

  if (dbRow && eventId) {
    const nextDocs = existingDocs.filter((d) => d && d.sha256 !== fileSha && d.artifaxDocId !== artifaxDocId);
    nextDocs.push(docEntry);
    existingPkg.artifaxDocuments = nextDocs;
    await sb.from("advancing").update({ production_package: existingPkg }).eq("id", eventId);
  }

  return jsonResponse(
    {
      ok: true,
      artifaxDocId,
      sha256: fileSha,
      filename,
      size: pdfBytes.byteLength,
      uploadedAt: nowIso,
      endpoint: path,
    },
    200,
    corsHeaders
  );
}

// ---------- Action 6: DISCOVER ARTIFAX SCHEMA (`action: "discover_schema"`) ----------
async function handleDiscoverSchemaAction(corsHeaders: Record<string, string>) {
  const writeCfg = getPortalWriteConfig();
  const { baseUrl, headers } = getArtifaxAuthConfig();

  const discoveredForms: Array<{
    id: string;
    name: string;
    isTechPortalMatch: boolean;
    elements: Array<{ id: string; name: string }>;
  }> = [];
  const formMap = new Map<string, { id: string; name: string; elements: Map<string, string> }>();

  const collectForm = (f: Record<string, unknown>) => {
    const fid = String(f.custom_form_id ?? f.form_id ?? f.id ?? "").trim();
    const fname = String(f.custom_form_name ?? f.form_name ?? f.name ?? f.title ?? "").trim();
    if (!fid && !fname) return;
    const key = fid || fname;
    if (!formMap.has(key)) {
      formMap.set(key, { id: fid, name: fname, elements: new Map() });
    }
    const entry = formMap.get(key)!;
    const allEls: unknown[] = [];
    const sections = Array.isArray(f.custom_form_sections) ? f.custom_form_sections : (Array.isArray(f.sections) ? f.sections : []);
    for (const sec of sections) {
      if (!sec || typeof sec !== "object") continue;
      const s = sec as Record<string, unknown>;
      const els = Array.isArray(s.custom_form_elements) ? s.custom_form_elements : (Array.isArray(s.elements) ? s.elements : []);
      allEls.push(...els);
    }
    const direct = Array.isArray(f.custom_form_elements) ? f.custom_form_elements : (Array.isArray(f.elements) ? f.elements : []);
    allEls.push(...direct);
    for (const el of allEls) {
      if (!el || typeof el !== "object") continue;
      const e = el as Record<string, unknown>;
      const eid = String(e.custom_form_element_id ?? e.element_id ?? e.id ?? "").trim();
      const ename = String(e.custom_form_element_name ?? e.element_name ?? e.name ?? e.label ?? "").trim();
      if (eid || ename) entry.elements.set(eid || ename, ename || eid);
    }
  };

  const probeNotes: string[] = [];

  // 1. Try GET /api/custom_forms directly
  try {
    const res = await fetch(`${baseUrl}/api/custom_forms`, { method: "GET", headers });
    if (res.ok) {
      const data = await res.json().catch(() => null);
      const list = Array.isArray(data) ? data : (data && typeof data === "object" ? ((data as Record<string, unknown>).custom_forms ?? (data as Record<string, unknown>).data ?? []) : []);
      if (Array.isArray(list)) {
        for (const f of list) if (f && typeof f === "object") collectForm(f as Record<string, unknown>);
      }
      probeNotes.push(`GET /api/custom_forms -> OK (${formMap.size} forms)`);
    } else {
      probeNotes.push(`GET /api/custom_forms -> HTTP ${res.status}`);
    }
  } catch (e) {
    probeNotes.push(`GET /api/custom_forms -> ${e instanceof Error ? e.message : String(e)}`);
  }

  // 2. Also inspect upcoming events to pick up embedded custom_forms + sample document endpoint test
  let sampleDocEndpointStatus = "Not tested (no upcoming event found)";
  try {
    const today = new Date().toISOString().slice(0, 10);
    const plus60 = new Date(Date.now() + 60 * 864e5).toISOString().slice(0, 10);
    const events = await fetchArtifaxRawEvents(today, plus60);
    for (const ev of events.slice(0, 25)) {
      const forms = Array.isArray(ev.custom_forms) ? ev.custom_forms : [];
      for (const f of forms) if (f && typeof f === "object") collectForm(f as Record<string, unknown>);
    }

    const sampleEv = events.find((e) => e && (e.event_id || e.id));
    if (sampleEv) {
      const sid = safeIdToken(sampleEv.event_id ?? sampleEv.id);
      const aid = safeIdToken(sampleEv.arrangement_id ?? sampleEv.arrangementId);
      const tests: string[] = [];
      if (sid) {
        const r1 = await fetch(`${baseUrl}/api/events/${encodeURIComponent(sid)}/documents`, { method: "GET", headers });
        tests.push(`/api/events/${sid}/documents -> HTTP ${r1.status}`);
      }
      if (aid) {
        const r2 = await fetch(`${baseUrl}/api/arrangements/${encodeURIComponent(aid)}/documents`, { method: "GET", headers });
        tests.push(`/api/arrangements/${aid}/documents -> HTTP ${r2.status}`);
      }
      sampleDocEndpointStatus = tests.join(" | ");
    }
  } catch (e) {
    probeNotes.push(`Sample event scan -> ${e instanceof Error ? e.message : String(e)}`);
  }

  for (const entry of formMap.values()) {
    discoveredForms.push({
      id: entry.id,
      name: entry.name,
      isTechPortalMatch: /tech\s*portal/i.test(entry.name) || (!!writeCfg.formId && entry.id === writeCfg.formId),
      elements: Array.from(entry.elements.entries()).map(([id, name]) => ({ id, name })),
    });
  }

  // Sort Tech Portal matches to the top
  discoveredForms.sort((a, b) => Number(b.isTechPortalMatch) - Number(a.isTechPortalMatch) || a.name.localeCompare(b.name));

  return jsonResponse(
    {
      ok: true,
      version: SYNC_ENGINE_VERSION,
      configuredSecrets: {
        ARTIFAX_PORTAL_FORM_ID: !!writeCfg.formId,
        ARTIFAX_PORTAL_FIELD_NOTES_ID: !!writeCfg.fieldNotesId,
        ARTIFAX_PORTAL_FIELD_TIMINGS_ID: !!writeCfg.fieldTimingsId,
        ARTIFAX_PORTAL_FIELD_CREW_ID: !!writeCfg.fieldCrewId,
        ARTIFAX_PORTAL_FIELD_SPEC_ID: !!writeCfg.fieldSpecId,
        ARTIFAX_WRITE_TARGET: writeCfg.writeTarget,
        ARTIFAX_DOCS_UPLOAD_FORMAT: writeCfg.docsUploadFormat,
      },
      discoveredForms,
      sampleDocEndpointStatus,
      probeNotes,
    },
    200,
    corsHeaders
  );
}

// ---------- Main Edge Function Router ----------
Deno.serve(async (req: Request) => {
  const corsHeaders = buildCorsHeaders(req);
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    let body: Record<string, unknown> = {};
    if (req.method === "POST") {
      try {
        const text = await req.text();
        if (text && text.trim()) {
          const parsed = JSON.parse(text);
          if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
            body = parsed as Record<string, unknown>;
          }
        }
      } catch {
        return jsonResponse({ error: "Invalid JSON request body" }, 400, corsHeaders);
      }
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!supabaseUrl || !serviceRoleKey) {
      throw new Error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in Edge Function environment");
    }
    const sb = createClient(supabaseUrl, serviceRoleKey);

    const action = String(body.action || "sync").trim().toLowerCase();
    switch (action) {
      case "sync":
        return await handleSyncAction(sb, body, corsHeaders);
      case "push_event":
        return await handlePushEventAction(sb, body, corsHeaders);
      case "list_documents":
        return await handleListDocumentsAction(sb, body, corsHeaders);
      case "download_document":
        return await handleDownloadDocumentAction(body, corsHeaders);
      case "upload_document":
        return await handleUploadDocumentAction(sb, body, corsHeaders);
      case "discover_schema":
        return await handleDiscoverSchemaAction(corsHeaders);
      default:
        return jsonResponse({ error: `Unknown artifax-sync action: ${action}` }, 400, corsHeaders);
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[artifax-sync] Error:", message);
    return jsonResponse({ error: message }, 500, corsHeaders);
  }
});
