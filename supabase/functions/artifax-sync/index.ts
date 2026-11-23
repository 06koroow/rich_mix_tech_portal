// ============================================================
//  artifax-sync — Supabase Edge Function (v2)
//  ------------------------------------------------------------
//  Single-source-of-truth Artifax -> Rich Mix Tech Portal sync.
//
//  Capabilities:
//   1. Strict two-stage status gate:
//        - Hard-excludes Cancelled / Lost / Dead / Declined / Deleted /
//          Withdrawn / Archived / Inactive on ANY status/stage/flag field.
//        - Strict allowlist: ONLY accepts "Contracted" or "Contract Sent"
//          (tolerating optional leading Artifax stage numbers like "4. Contract Sent").
//   2. Strict canonical venue space mapper:
//        - Maps only Rich Mix performance/cinema spaces (1 row = 1 booked space).
//        - Skips all non-venue, admin, back-of-house, and blank rooms.
//        - Eliminates "Rich Mix ..." -> "The Mix" & default-to-Stage bugs.
//   3. Database-persisted suppression list:
//        - Reads `public.app_settings` key `artifax_suppressed_events`.
//        - Never resurrects events manually deleted in the portal.
//   4. Authoritative reconciliation sweep:
//        - Auto-removes cancelled, downgraded, non-venue, suppressed, or
//          vanished Artifax events from `public.advancing`.
//        - Cancels linked unworked Rota shifts in `public.bookings`
//          (leaving past worked shifts intact).
//        - Marks linked DCP screenings in `public.dcps` as Cancelled.
//   5. Dry-run & Diagnostics mode (`{ "dryRun": true }`):
//        - Inspects raw Artifax stages, rooms, and planned actions without writing.
//
//  Required Supabase Edge Function Secrets:
//    ARTIFAX_URL       e.g. https://richmix.artifaxevent.com
//    ARTIFAX_API_KEY   Artifax API key
//    ARTIFAX_USERNAME  Artifax API username (optional if key-only)
//    ARTIFAX_PASSWORD  Artifax API password (optional if key-only)
//    SUPABASE_URL & SUPABASE_SERVICE_ROLE_KEY (injected automatically)
//
//  Deploy via CLI: supabase functions deploy artifax-sync
//  Or paste this entire file directly into Supabase Dashboard -> Edge Functions -> artifax-sync.
// ============================================================

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SYNC_ENGINE_VERSION = 2;
const SUPPRESSED_SETTINGS_KEY = "artifax_suppressed_events";
const LAST_SYNC_SETTINGS_KEY = "artifax_last_sync";

function buildCorsHeaders(req: Request): Record<string, string> {
  const origin = req.headers.get("origin");
  return {
    "Access-Control-Allow-Origin": origin && /^https?:\/\//i.test(origin) ? origin : "*",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
    "Vary": "Origin",
  };
}

// ---------- Canonical Rich Mix Venue Space Mapping ----------
// Explicit allowlist of exact Artifax room labels -> canonical portal spaces.
const EXACT_ROOM_TO_SPACE: Record<string, string> = {
  // The Stage
  "the stage (ms)": "The Stage",
  "the stage": "The Stage",
  "stage": "The Stage",
  "main stage": "The Stage",
  "ms": "The Stage",
  "main space": "The Stage",

  // The Studio
  "the studio (v1)": "The Studio",
  "the studio": "The Studio",
  "studio": "The Studio",
  "studio 1": "The Studio",
  "v1": "The Studio",
  "venue 1": "The Studio",

  // The Mix
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

  // Cinema Screens
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

  // Auxiliary Venue Spaces
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

const AUXILIARY_SPACES = new Set<string>([
  "Streetside",
  "Cinema Bar",
  "The Lab",
]);

// Back-of-house / non-venue rooms that must NEVER match a venue space
const NON_VENUE_ROOM_RE = /\b(office|desk|green\s*room|dressing\s*room|back\s*stage|backstage|stage\s*door|loading\s*bay|load[\s-]*in|store|storage|kitchen|staff\s*room|meeting\s*room|board\s*room|boardroom|box\s*office|reception|toilet|wc|corridor|stair|lift|elevator|plant\s*room|server\s*room|admin|hot\s*desk|workshop|car\s*park|parking|external|off[\s-]*site|offsite|tbc|tbd|unassigned|none)\b/i;

function normalizeRoomKey(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ")
    // Strip leading "rich mix - " / "rich mix: " / "rich mix " venue prefix
    // so "Rich Mix Office" becomes "office" (skipped) instead of matching "mix"!
    .replace(/^rich\s*mix\s*[-:\/–—]?\s+/i, "")
    .trim();
}

function resolveVenueSpace(roomName: unknown): string | null {
  if (roomName === null || roomName === undefined) return null;
  const raw = String(roomName).trim();
  if (!raw) return null;

  const key = normalizeRoomKey(raw);
  if (!key || key === "rich mix") return null;

  // 1. Exact allowlist match (fastest & safest)
  if (EXACT_ROOM_TO_SPACE[key]) return EXACT_ROOM_TO_SPACE[key];

  // 2. Explicit non-venue / back-of-house blocklist
  if (NON_VENUE_ROOM_RE.test(key)) return null;

  // 3. Tight, unambiguous room code / name patterns
  if (/\b(screen\s*1|screen\s*one|cinema\s*1|cinema\s*one)\b/i.test(key)) return "Screen One";
  if (/\b(screen\s*2|screen\s*two|cinema\s*2|cinema\s*two)\b/i.test(key)) return "Screen Two";
  if (/\b(screen\s*3|screen\s*three|cinema\s*3|cinema\s*three)\b/i.test(key)) return "Screen Three";
  if (/\bcinema\s*(bar|gallery)\b/i.test(key)) return "Cinema Bar";
  if (/\bstreetside\b/i.test(key)) return "Streetside";
  if (/\bthe\s+lab\b/i.test(key)) return "The Lab";
  if (/\b(the\s+stage|main\s+stage)\b/i.test(key) || /\(ms\)/i.test(key)) return "The Stage";
  if (/\bthe\s+studio\b/i.test(key) || /\(v1\)/i.test(key)) return "The Studio";
  if (/\bthe\s+mix\b/i.test(key) || /\(v2\)/i.test(key)) return "The Mix";

  // 4. Anything else is a non-venue / admin room -> skip cleanly
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

  // Prefer explicit single-room fields on an Artifax event row first
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
// ONLY "Contracted" or "Contract Sent" pass; ANY cancelled/lost/dead/deleted
// indicator on ANY field immediately disqualifies the record.

const EXCLUDED_STATUS_RE = /\b(cancel(?:led|ed|ing)?|lost|dead|declin(?:ed)?|reject(?:ed)?|withdraw(?:n)?|releas(?:ed)?|delet(?:ed)?|archiv(?:ed)?|void(?:ed)?|abandoned|no[\s_-]*show|uncontracted|not\s+contracted|non[\s_-]*contracted)\b/i;

function normalizeStageLabel(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    // Strip optional Artifax numbered stage prefixes e.g. "04 - Contract Sent", "5. Contracted", "[4] Contract Sent"
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
  // 1. Check boolean / numeric exclusion flags first
  const truthyFlag = (v: unknown) => v === true || v === 1 || v === "1" || String(v ?? "").trim().toLowerCase() === "true";
  const falsyActiveFlag = (v: unknown) => v === false || v === 0 || v === "0" || String(v ?? "").trim().toLowerCase() === "false";

  const flagDeleted = truthyFlag(r.deleted) || truthyFlag(r.is_deleted) || truthyFlag(r.isDeleted);
  const flagCancelled = truthyFlag(r.cancelled) || truthyFlag(r.canceled) || truthyFlag(r.is_cancelled) || truthyFlag(r.is_canceled) || truthyFlag(r.isCancelled);
  const flagArchived = truthyFlag(r.archived) || truthyFlag(r.is_archived) || truthyFlag(r.isArchived);
  const flagLost = truthyFlag(r.lost) || truthyFlag(r.is_lost) || truthyFlag(r.isLost);
  const flagInactive = (r.active !== undefined && r.active !== null && falsyActiveFlag(r.active)) ||
                       (r.is_active !== undefined && r.is_active !== null && falsyActiveFlag(r.is_active));

  // 2. Gather ALL status & stage text fields (never short-circuit with ||)
  const candidateKeys = [
    "sales_process_stage_name",
    "sales_process_stage",
    "salesProcessStage",
    "arrangement_status_name",
    "arrangement_status",
    "arrangementStatus",
    "event_status_name",
    "event_status",
    "eventStatus",
    "booking_status_name",
    "booking_status",
    "bookingStatus",
    "status_name",
    "status",
    "Status",
    "stage_name",
    "stage",
    "state",
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

  // Gate 1: Hard Exclusion ALWAYS wins
  if (flagDeleted || flagCancelled || flagArchived || flagLost || flagInactive) {
    return {
      allowed: false,
      portalStatus: "Cancelled",
      artifaxStage: rawSummary,
      rawStatusSummary: rawSummary,
      reason: "excluded_flag",
    };
  }

  for (const val of seenValues) {
    if (EXCLUDED_STATUS_RE.test(val)) {
      return {
        allowed: false,
        portalStatus: "Cancelled",
        artifaxStage: val,
        rawStatusSummary: rawSummary,
        reason: "excluded_status",
      };
    }
  }

  // Gate 2: Strict Allowlist — ONLY "Contracted" or "Contract Sent"
  let matchedStage: "Contracted" | "Contract Sent" | null = null;
  for (const val of seenValues) {
    const norm = normalizeStageLabel(val);
    if (/^contract\s*sent\b/.test(norm) || /\bcontract\s+sent\b/.test(norm)) {
      matchedStage = "Contract Sent";
      break;
    }
    if (/^contracted\b/.test(norm) || /\bcontracted\b/.test(norm)) {
      matchedStage = "Contracted";
      // Keep scanning in case another field says "Contract Sent" or cancelled (cancelled already checked above)
      break;
    }
  }

  if (!matchedStage) {
    return {
      allowed: false,
      portalStatus: "Excluded",
      artifaxStage: rawSummary,
      rawStatusSummary: rawSummary,
      reason: "not_contracted_stage",
    };
  }

  return {
    allowed: true,
    portalStatus: matchedStage === "Contracted" ? "Confirmed" : "Advancing",
    artifaxStage: matchedStage,
    rawStatusSummary: rawSummary,
    reason: "allowed",
  };
}

// ---------- Date, Time, Category & Notes Parsers ----------
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

function extractArtifaxNotes(r: Record<string, unknown>): string {
  const parts: string[] = [];
  const seenNotes = new Set<string>();

  const addNote = (label: string, text: unknown) => {
    if (text === null || text === undefined) return;
    const str = String(text).trim();
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

  // Custom forms (exclude sensitive payment fields)
  const forms = Array.isArray(r.custom_forms) ? r.custom_forms : (Array.isArray(r.forms) ? r.forms : []);
  for (const form of forms) {
    if (!form || typeof form !== "object") continue;
    const f = form as Record<string, unknown>;
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
    let val: unknown = c.value ?? c.custom_form_data_text ?? c.custom_form_data_value ?? c.text ?? "";
    if (val === true) val = "Yes";
    if (val === false) val = "No";
    if (Array.isArray(val)) val = val.join(", ");
    const valStr = String(val ?? "").trim();
    if (name && valStr) addNote(name, valStr);
  }

  if (r.custom_form_data && typeof r.custom_form_data === "object" && !Array.isArray(r.custom_form_data)) {
    for (const [k, v] of Object.entries(r.custom_form_data as Record<string, unknown>)) {
      if (v !== null && v !== undefined) {
        const vStr = String(v).trim();
        if (vStr) addNote(k, vStr);
      }
    }
  }

  return parts.join("\n").trim();
}

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
}

function incrementMap(map: Record<string, number>, key: string) {
  const k = key || "(blank)";
  map[k] = (map[k] || 0) + 1;
}

async function fetchArtifaxRawEvents(startDate: string, endDate: string): Promise<Record<string, unknown>[]> {
  const rawBaseUrl = Deno.env.get("ARTIFAX_URL") || "https://richmix.artifaxevent.com";
  const baseUrl = validateArtifaxBaseUrl(rawBaseUrl);
  const apiKey = (Deno.env.get("ARTIFAX_API_KEY") || "").trim();
  const username = (Deno.env.get("ARTIFAX_USERNAME") || "").trim();
  const password = (Deno.env.get("ARTIFAX_PASSWORD") || "").trim();

  if (!apiKey) {
    throw new Error("Missing ARTIFAX_API_KEY in Edge Function secrets");
  }

  const params = new URLSearchParams({
    date: "between",
    start_date: startDate,
    end_date: endDate,
    schedule_output: "1",
  });

  const url = `${baseUrl}/api/arrangements/event?${params.toString()}`;
  const headers: Record<string, string> = {
    "X-API-Key": apiKey,
    "Accept": "application/json",
  };
  if (username && password) {
    headers["Authorization"] = "Basic " + btoa(`${username}:${password}`);
  }

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

// ---------- Main Edge Function Handler ----------
Deno.serve(async (req: Request) => {
  const corsHeaders = buildCorsHeaders(req);

  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    // Parse bounded optional request body
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
        return new Response(JSON.stringify({ error: "Invalid JSON request body" }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    }

    const dryRun = body.dryRun === true;
    const lookbackDays = Math.min(Math.max(Number(body.lookbackDays ?? 1) || 1, 0), 30);
    const lookaheadDays = Math.min(Math.max(Number(body.lookaheadDays ?? 180) || 180, 1), 365);

    const now = new Date();
    const todayIso = now.toISOString().slice(0, 10);
    const fromDate = new Date(now.getTime() - lookbackDays * 864e5);
    const toDate = new Date(now.getTime() + lookaheadDays * 864e5);
    const startDate = typeof body.startDate === "string" && /^\d{4}-\d{2}-\d{2}$/.test(body.startDate)
      ? body.startDate
      : fromDate.toISOString().slice(0, 10);
    const endDate = typeof body.endDate === "string" && /^\d{4}-\d{2}-\d{2}$/.test(body.endDate)
      ? body.endDate
      : toDate.toISOString().slice(0, 10);

    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!supabaseUrl || !serviceRoleKey) {
      throw new Error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in Edge Function environment");
    }

    const sb = createClient(supabaseUrl, serviceRoleKey);

    // 1. Load DB-persisted suppression list from public.app_settings
    const suppressedMap: Record<string, Record<string, unknown>> = {};
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
          suppressedMap[k] = entry;
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
      console.warn("[artifax-sync] Could not read suppression list from app_settings:", e);
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

      // Gate A: Strict Status & Stage Evaluation (Contracted / Contract Sent only)
      const statusEval = evaluateArtifaxStatus(r);
      if (!statusEval.allowed) {
        skippedStatusCount++;
        incrementMap(diagSkippedStatuses, statusEval.rawStatusSummary);
        explicitlyExcludedRawIds.add(rawId);
        continue;
      }

      // Gate B: Strict Canonical Venue Room Mapping (1 row per booked venue space; skip non-venue rooms)
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

      // Extract shared event facts
      const arrangementId = String(
        r.arrangement_id ?? r.arrangementId ?? r.ArrangementId ?? r.groupId ?? r.GroupId ?? ""
      ).trim();

      const title = String(
        r.arrangement_description ?? r.name ?? r.title ?? r.EventName ?? r.arrangement_name ?? r.event_description ?? "Untitled"
      ).trim() || "Untitled";

      const rawDate = r.event_date ?? r.start_date ?? r.date ?? r.StartDate ?? r.Date ?? r.start ?? r.startDateTime ?? r.StartDateTime ?? r.start_date_time;
      const rawStart = r.start_time ?? r.start_time_text ?? r.time_start ?? r.StartTime ?? r.start ?? r.startDateTime ?? r.StartDateTime ?? r.start_date_time;
      const rawEnd = r.end_time ?? r.end_time_text ?? r.time_end ?? r.EndTime ?? r.end ?? r.endDateTime ?? r.EndDateTime ?? r.end_date_time;

      const dateIso = parseSafeDate(rawDate);
      const startTime = parseSafeTime(rawStart);
      const finishTime = parseSafeTime(rawEnd);
      const contact = String(
        r.contact ?? r.contactName ?? r.CustomerName ?? r.client_name ?? r.arrangement_contact_entity_full_name ?? ""
      ).trim();
      const rawType = String(r.arrangement_type_name ?? r.type ?? r.arrangementType ?? r.ArrangementType ?? "").trim();
      const notes = extractArtifaxNotes(r);

      incrementMap(diagIncludedStatuses, `${statusEval.artifaxStage} (${statusEval.rawStatusSummary})`);

      // Emit strictly 1 booking row per booked canonical venue space
      for (const { space, rawRoom } of resolvedRooms) {
        const artifaxId = resolvedRooms.length === 1 ? rawId : `${rawId}__${slugify(space)}`;

        // Gate C: Check DB-persisted suppression list
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
        });
      }
    }

    // 4. Load all existing Artifax-managed rows from public.advancing
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

    // 5. Build upsert payloads (preserving ALL technician-enriched portal fields)
    const rowsToUpsert: Record<string, unknown>[] = [];
    let created = 0;
    let updated = 0;
    const nowIso = now.toISOString();

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
          prevHistory.push({
            date: nowIso,
            notes: booking.notes || lastNotes || "",
            changes,
          });
        } else if (prevHistory.length === 0 && booking.notes) {
          prevHistory.push({
            date: nowIso,
            notes: booking.notes,
            changes: ["Initial sync from Artifax"],
          });
        }

        // Preserve manual status progression ("Complete", or manually confirmed)
        let resolvedPortalStatus: string = booking.status;
        if (existing.status === "Complete") {
          resolvedPortalStatus = "Complete";
        } else if (existing.status === "Confirmed" && booking.status === "Advancing") {
          resolvedPortalStatus = "Confirmed";
        }

        existingPkg.artifaxHistory = prevHistory;
        existingPkg.artifaxNotes = booking.notes || existingPkg.artifaxNotes || "";
        existingPkg.artifaxStage = booking.artifaxStage;
        existingPkg.artifaxRoomRaw = booking.rawRoom;
        existingPkg.artifaxArrangementId = booking.arrangementId || null;
        existingPkg.artifaxSyncedAt = nowIso;
        if (existingPkg.techRequiredManual !== true && existingPkg.noTechNeeded === undefined && isAux) {
          existingPkg.noTechNeeded = true;
        }

        const existingTechInfo = String(existing.techInfo || "").trim();
        const updatedRow: Record<string, unknown> = {
          ...existing,
          artifaxId: booking.artifaxId,
          // Never set cross-room groupId on Artifax events — 1 row = 1 booked venue space
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
            noTechNeeded: isAux,
          },
        };
        rowsToUpsert.push(newRow);
        created++;
      }
    }

    // 6. Authoritative Reconciliation Sweep:
    //    Identify existing Artifax rows that must be auto-removed because they were:
    //    (a) suppressed/deleted in portal,
    //    (b) explicitly returned by Artifax as Cancelled/Lost/Enquiry/Non-venue,
    //    (c) previously marked Cancelled or mapped to a non-venue space, or
    //    (d) inside the sync window [startDate, endDate] and vanished from Artifax's active set.
    //    Safety guard: only perform window-vanished sweep when Artifax returned >= 1 raw event
    //    (so an empty API glitch never wipes the database).
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

    // 7. Execute Database Writes (unless dryRun === true)
    let cancelledShiftsCount = 0;
    let cancelledDcpsCount = 0;

    if (!dryRun) {
      // 7a. Upsert valid active bookings (resilient to missing optional columns like artifaxHistory)
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

      // 7b. Auto-remove cancelled/downgraded/non-venue/suppressed rows & cancel linked unworked Rota shifts + DCPs
      if (rowsToRemove.length > 0) {
        const removeIds = rowsToRemove.map((r) => r.id);
        const CHUNK = 100;

        for (let i = 0; i < removeIds.length; i += CHUNK) {
          const chunkIds = removeIds.slice(i, i + CHUNK);

          // Cancel linked unworked Rota shifts (preserve past confirmed/worked shifts!)
          try {
            const { data: linkedBookings } = await sb
              .from("bookings")
              .select("*")
              .in("eventId", chunkIds);

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

          // Mark linked DCP checks as Cancelled
          try {
            const { data: linkedDcps } = await sb
              .from("dcps")
              .select("*")
              .in("eventId", chunkIds);

            if (Array.isArray(linkedDcps) && linkedDcps.length > 0) {
              const dcpsToCancel: Record<string, unknown>[] = [];
              for (const d of linkedDcps as Record<string, unknown>[]) {
                if (d.isCancelled === true && d.outcome === "Cancelled") continue;
                dcpsToCancel.push({
                  ...d,
                  isCancelled: true,
                  outcome: "Cancelled",
                  updatedAt: nowIso,
                });
              }
              if (dcpsToCancel.length > 0) {
                const { error: dErr } = await sb.from("dcps").upsert(dcpsToCancel, { onConflict: "id" });
                if (!dErr) cancelledDcpsCount += dcpsToCancel.length;
              }
            }
          } catch (e) {
            console.warn("[artifax-sync] Linked DCP cancellation warning:", e);
          }

          // Delete removed rows from public.advancing
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
      // Legacy top-level keys kept for backwards compatibility
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

    // Persist last sync metadata in app_settings (non-fatal)
    if (!dryRun) {
      try {
        await sb.from("app_settings").upsert(
          {
            key: LAST_SYNC_SETTINGS_KEY,
            value: {
              version: SYNC_ENGINE_VERSION,
              syncedServerSide: true,
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
        console.warn("[artifax-sync] Could not save artifax_last_sync metadata:", e);
      }
    }

    return new Response(JSON.stringify(summary), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 200,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[artifax-sync] Error:", message);
    return new Response(JSON.stringify({ error: message }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 500,
    });
  }
});
