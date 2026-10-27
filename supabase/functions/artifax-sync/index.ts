// ============================================================
//  artifax-sync — Supabase Edge Function
//  Pulls events from Artifax and upserts them into the `advancing`
//  table. Runs SERVER-SIDE so the Artifax API key (a secret) never
//  reaches the browser. One-way: Artifax owns the booking facts;
//  the Tech Portal's own fields (assigned tech, tech info, tech spec)
//  are preserved on every sync.
//
//  Secrets (set with `supabase secrets set ...`):
//    ARTIFAX_URL        e.g. https://yourorg.artifaxevent.com
//    ARTIFAX_API_KEY    from Artifax: Admin → Configuration → API
//  Provided automatically by the Edge runtime:
//    SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
//
//  Deploy:  supabase functions deploy artifax-sync
//  Invoke:  from the app's "Refresh from Artifax" button, or on a
//           schedule (see docs/ARTIFAX-SETUP.md).
// ============================================================
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const ARTIFAX_URL = (Deno.env.get("ARTIFAX_URL") ?? "").trim();
const ARTIFAX_API_KEY = (Deno.env.get("ARTIFAX_API_KEY") ?? "").trim();
const ARTIFAX_USERNAME = (Deno.env.get("ARTIFAX_USERNAME") ?? "").trim();
const ARTIFAX_PASSWORD = (Deno.env.get("ARTIFAX_PASSWORD") ?? "").trim();
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

// How far ahead to sync.
const HORIZON_DAYS = 120;

// ---- Artifax room name → Tech Portal space. Comprehensive alias map. ----
const ROOM_TO_SPACE: Record<string, string> = {
  "The Stage (MS)": "The Stage",
  "The Stage": "The Stage",
  "Stage": "The Stage",
  "Main Stage": "The Stage",
  "MS": "The Stage",
  "The Studio (V1)": "The Studio",
  "The Studio": "The Studio",
  "Studio": "The Studio",
  "Studio 1": "The Studio",
  "Studio 2": "The Studio",
  "V1": "The Studio",
  "The Mix & Bar (V2)": "The Mix",
  "The Mix": "The Mix",
  "Mix": "The Mix",
  "Mix Bar": "The Mix",
  "The Mix Bar": "The Mix",
  "Bar": "The Mix",
  "V2": "The Mix",
  "Screen 1": "Screen One",
  "Screen One": "Screen One",
  "Cinema 1": "Screen One",
  "Cinema One": "Screen One",
  "Cinema Bar / Gallery": "Screen One",
  "Cinema Bar": "Screen One",
  "Screen 2": "Screen Two",
  "Screen Two": "Screen Two",
  "Cinema 2": "Screen Two",
  "Cinema Two": "Screen Two",
  "Screen 3": "Screen Three",
  "Screen Three": "Screen Three",
  "Cinema 3": "Screen Three",
  "Cinema Three": "Screen Three",
  "Streetside": "Streetside",
  "Street Side": "Streetside",
  "Streetside Bar": "Streetside",
  "Streetside Cafe": "Streetside",
  "Streetside Foyer": "Streetside",
  "Foyer": "Streetside",
  "Cafe": "Streetside",
};

function resolveSpace(roomName: string): string {
  const r = (roomName || "").trim();
  if (!r) return "The Stage";
  if (ROOM_TO_SPACE[r]) return ROOM_TO_SPACE[r];
  
  const lower = r.toLowerCase();
  if (lower.includes("cinema bar") || lower.includes("cinema gallery")) return "Screen One";
  if (lower.includes("screen 1") || lower.includes("cinema 1") || lower.includes("screen one") || lower.includes("cinema one")) return "Screen One";
  if (lower.includes("screen 2") || lower.includes("cinema 2") || lower.includes("screen two") || lower.includes("cinema two")) return "Screen Two";
  if (lower.includes("screen 3") || lower.includes("cinema 3") || lower.includes("screen three") || lower.includes("cinema three")) return "Screen Three";
  if (lower.includes("stage")) return "The Stage";
  if (lower.includes("studio")) return "The Studio";
  if (lower.includes("mix") || lower.includes("bar")) return "The Mix";
  if (lower.includes("street") || lower.includes("cafe") || lower.includes("foyer")) return "Streetside";
  
  // Return the original room name rather than dropping the event!
  return r;
}

function resolveStatus(statusStr: string): string {
  const s = (statusStr || "").toLowerCase();
  if (s.includes("cancel")) return "Cancelled";
  if (s.includes("tentative") || s.includes("provisional") || s.includes("pencil") || s.includes("enquiry") || s.includes("inquiry") || s.includes("hold")) return "Tentative";
  return "Confirmed";
}

// Extract all technical, layout, and event notes from Artifax response without overly strict filtering
function extractArtifaxNotes(r: any): string {
  const parts: string[] = [];
  const seenNotes = new Set<string>();

  const addNote = (label: string, text: any) => {
    if (text === null || text === undefined) return;
    const str = String(text).trim();
    if (!str || seenNotes.has(str)) return;
    seenNotes.add(str);
    if (label) {
      parts.push(`[${label}]: ${str}`);
    } else {
      parts.push(str);
    }
  };

  // 1. Check all standard and custom note fields (including PascalCase)
  const candidateFields = [
    { key: 'notes', label: '' },
    { key: 'description', label: 'Description' },
    { key: 'event_notes', label: 'Event Notes' },
    { key: 'arrangement_notes', label: 'Arrangement Notes' },
    { key: 'internal_notes', label: 'Internal Notes' },
    { key: 'public_description', label: 'Public Description' },
    { key: 'event_description', label: 'Event Description' },
    { key: 'arrangement_description', label: 'Arrangement Description' },
    { key: 'comments', label: 'Comments' },
    { key: 'event_comments', label: 'Event Comments' },
    { key: 'arrangement_comments', label: 'Arrangement Comments' },
    { key: 'technical_requirements', label: 'Technical Requirements' },
    { key: 'tech_requirements', label: 'Tech Requirements' },
    { key: 'technical_notes', label: 'Technical Notes' },
    { key: 'tech_notes', label: 'Tech Notes' },
    { key: 'requirements', label: 'Requirements' },
    { key: 'setup_notes', label: 'Setup Notes' },
    { key: 'set_up_notes', label: 'Setup Notes' },
    { key: 'staging_notes', label: 'Staging Notes' },
    { key: 'av_notes', label: 'AV Notes' },
    { key: 'sound_notes', label: 'Sound Notes' },
    { key: 'lighting_notes', label: 'Lighting Notes' },
    { key: 'catering_notes', label: 'Catering Notes' },
    { key: 'special_instructions', label: 'Special Instructions' },
    { key: 'memo', label: 'Memo' },
    { key: 'memos', label: 'Memos' },
    { key: 'summary', label: 'Summary' },
    { key: 'details', label: 'Details' },
    { key: 'task_notes', label: 'Tasks' },
    { key: 'roster_notes', label: 'Roster Notes' },
    { key: 'Notes', label: '' },
    { key: 'Description', label: 'Description' },
    { key: 'EventNotes', label: 'Event Notes' },
    { key: 'ArrangementNotes', label: 'Arrangement Notes' },
    { key: 'TechnicalNotes', label: 'Technical Notes' },
    { key: 'Comments', label: 'Comments' },
  ];

  for (const { key, label } of candidateFields) {
    if (r[key] !== undefined && r[key] !== null) {
      if (typeof r[key] === 'string' || typeof r[key] === 'number') {
        addNote(label, r[key]);
      } else if (Array.isArray(r[key])) {
        for (const item of r[key]) {
          if (typeof item === 'string') addNote(label, item);
          else if (item && typeof item === 'object') {
            const itemText = item.text || item.note || item.content || item.description || item.value || '';
            if (itemText) addNote(item.title || item.label || label, itemText);
          }
        }
      }
    }
  }

  // 2. Custom forms: loosen the filter completely so no real user event data is discarded
  const forms = Array.isArray(r.custom_forms) ? r.custom_forms : (Array.isArray(r.forms) ? r.forms : []);
  for (const form of forms) {
    if (!form || typeof form !== 'object') continue;
    const formTitle = String(form.custom_form_name || form.form_name || form.name || form.title || form.label || '').trim();
    const lowerForm = formTitle.toLowerCase();
    
    // Only exclude strictly sensitive payment credentials
    if (/credit\s*card|bank\s*account|stripe\s*token/i.test(lowerForm)) {
      continue;
    }

    const formElements: any[] = [];
    
    // Collect from sections if present
    const sections = Array.isArray(form.custom_form_sections) ? form.custom_form_sections : (Array.isArray(form.sections) ? form.sections : []);
    for (const sec of sections) {
      if (!sec) continue;
      const elements = Array.isArray(sec.custom_form_elements) ? sec.custom_form_elements : (Array.isArray(sec.elements) ? sec.elements : (Array.isArray(sec.fields) ? sec.fields : []));
      formElements.push(...elements);
    }
    
    // Also collect direct elements on form
    const directElements = Array.isArray(form.custom_form_elements) ? form.custom_form_elements : (Array.isArray(form.elements) ? form.elements : (Array.isArray(form.fields) ? form.fields : []));
    formElements.push(...directElements);

    for (const el of formElements) {
      if (!el || typeof el !== 'object') continue;
      const elName = String(el.custom_form_element_name || el.element_name || el.name || el.label || el.title || el.prompt || el.field_name || '').trim();
      if (!elName) continue;

      let val = el.custom_form_data_text !== undefined && el.custom_form_data_text !== null && el.custom_form_data_text !== ''
        ? el.custom_form_data_text
        : (el.custom_form_data_value !== undefined && el.custom_form_data_value !== null ? el.custom_form_data_value : (el.value ?? el.data_value ?? el.text_value ?? el.display_value ?? el.selected_option_label ?? ''));

      if (val === true) val = 'Yes';
      if (val === false) val = 'No';
      if (Array.isArray(val)) val = val.join(', ');
      
      const valStr = String(val ?? '').trim();
      // Keep informative values like 'No', '0', 'None', 'n/a' so requirements aren't left blank
      if (valStr.length === 0) continue;

      const prefix = formTitle ? `[${formTitle}] ${elName}` : elName;
      addNote(prefix, valStr);
    }
  }

  // 3. Direct custom fields array
  const customFields = Array.isArray(r.custom_fields) ? r.custom_fields : (Array.isArray(r.custom_form_elements) ? r.custom_form_elements : []);
  for (const cf of customFields) {
    if (!cf || typeof cf !== 'object') continue;
    const name = String(cf.name || cf.label || cf.title || cf.field_name || cf.custom_form_element_name || '').trim();
    let val = cf.value ?? cf.custom_form_data_text ?? cf.custom_form_data_value ?? cf.text ?? '';
    if (val === true) val = 'Yes';
    if (val === false) val = 'No';
    if (Array.isArray(val)) val = val.join(', ');
    const valStr = String(val ?? '').trim();
    if (name && valStr.length > 0) {
      addNote(name, valStr);
    }
  }

  // 4. Custom form data key-value dictionary
  if (r.custom_form_data && typeof r.custom_form_data === 'object' && !Array.isArray(r.custom_form_data)) {
    for (const [k, v] of Object.entries(r.custom_form_data)) {
      if (v !== null && v !== undefined) {
        const vStr = String(v).trim();
        if (vStr) addNote(k, vStr);
      }
    }
  }

  return parts.join('\n').trim();
}

// ---- Artifax booking type/label → advancing category ----
function toCategory(type: string): string {
  const t = (type || "").toLowerCase();
  if (/cinema|film|screening|dcp/.test(t)) return "Cinema";
  if (/hire|private|wedding|corporate|conference|launch/.test(t)) return "Private Hires";
  return "Programme";
}

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

function parseSafeDate(rawDate: any): string {
  if (!rawDate) return "";
  const s = String(rawDate).trim();
  if (!s) return "";
  
  // Format 1: DD/MM/YYYY or DD-MM-YYYY (e.g. 27/10/2026 as shown in Artifax UK UI)
  const dmyMatch = s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})/);
  if (dmyMatch) {
    const day = dmyMatch[1].padStart(2, "0");
    const month = dmyMatch[2].padStart(2, "0");
    const year = dmyMatch[3];
    return `${year}-${month}-${day}`;
  }

  // Format 2: ISO YYYY-MM-DD
  const ymdMatch = s.match(/^(\d{4})[\/\-](\d{1,2})[\/\-](\d{1,2})/);
  if (ymdMatch) {
    const year = ymdMatch[1];
    const month = ymdMatch[2].padStart(2, "0");
    const day = ymdMatch[3].padStart(2, "0");
    return `${year}-${month}-${day}`;
  }

  // Fallback: new Date()
  const d = new Date(s);
  if (!isNaN(d.getTime())) {
    return d.toISOString().slice(0, 10);
  }
  return "";
}

function parseSafeTime(rawTime: any): string {
  if (!rawTime) return "";
  const s = String(rawTime).trim();
  if (!s) return "";
  
  const m = s.match(/(\d{1,2}):(\d{2})/);
  if (m) {
    return `${m[1].padStart(2, "0")}:${m[2]}`;
  }
  
  const d = new Date(s);
  if (!isNaN(d.getTime())) {
    return d.toISOString().slice(11, 16);
  }
  return "";
}

interface ArtifaxInstance {
  id: string;            // stable Artifax instance id
  groupId?: string;      // arrangement id / group id for multi-room takeovers
  title: string;
  room: string;          // room/space name
  type?: string;         // booking type / arrangement type
  date: string;          // YYYY-MM-DD
  startTime: string;     // HH:MM
  finishTime: string;    // HH:MM
  contact?: string;      // primary contact name/org
  notes?: string;        // full technical and custom field notes
  status?: string;       // e.g. Confirmed / Tentative / Cancelled
}

async function fetchArtifaxInstances(from: Date, to: Date): Promise<ArtifaxInstance[]> {
  if (!ARTIFAX_URL || !ARTIFAX_API_KEY || !ARTIFAX_USERNAME || !ARTIFAX_PASSWORD) {
    throw new Error("ARTIFAX credentials not fully set — see docs/ARTIFAX-EDGE-FUNCTION.md");
  }
  
  const params = new URLSearchParams({
    date: 'between',
    start_date: from.toISOString().slice(0, 10),
    end_date: to.toISOString().slice(0, 10),
    schedule_output: "1",
  });
  
  const baseUrl = ARTIFAX_URL.replace(/\/api\/?$/, '').replace(/\/$/, '');
  const endpoint = `${baseUrl}/api/arrangements/event?${params}`;
  const basicAuth = 'Basic ' + btoa(ARTIFAX_USERNAME + ':' + ARTIFAX_PASSWORD);

  const res = await fetch(endpoint, {
    method: 'GET',
    headers: { 
      "X-API-Key": ARTIFAX_API_KEY,
      "Authorization": basicAuth,
      "Accept": "application/json" 
    },
  });
  if (!res.ok) throw new Error(`Artifax responded ${res.status}: ${await res.text()}`);
  const data = await res.json();

  // --- Map Artifax's response fields to ArtifaxInstance with comprehensive note extraction ---
  const list: any[] = Array.isArray(data) ? data : (data.instances ?? data.results ?? data.events ?? []);
  return list.map((r) => {
    const title = String(r.title || r.name || r.EventName || r.arrangement_description || r.arrangement_name || "Untitled");
    const groupId = String(r.arrangement_id || r.arrangementId || r.ArrangementId || r.groupId || r.GroupId || r.event_id || r.EventId || title);
    const combinedStatus = String(r.status || r.Status || r.event_status_name || r.sales_process_stage_name || "Confirmed");
    
    const rawDate = r.date ?? r.event_date ?? r.start_date ?? r.StartDate ?? r.Date ?? r.start ?? r.startDateTime ?? r.StartDateTime ?? r.start_date_time;
    const rawStart = r.start_time ?? r.start_time_text ?? r.time_start ?? r.StartTime ?? r.start ?? r.startDateTime ?? r.StartDateTime ?? r.start_date_time;
    const rawEnd = r.end_time ?? r.end_time_text ?? r.time_end ?? r.EndTime ?? r.end ?? r.endDateTime ?? r.EndDateTime ?? r.end_date_time;

    return {
      id: String(r.id || r.instanceId || r.InstanceId || r.event_id),
      groupId: groupId,
      title: title,
      room: String(r.room || r.roomName || r.RoomName || r.room_name || ""),
      type: String(r.type || r.arrangementType || r.ArrangementType || r.arrangement_type_name || ""),
      date: parseSafeDate(rawDate),
      startTime: parseSafeTime(rawStart),
      finishTime: parseSafeTime(rawEnd),
      contact: String(r.contact || r.contactName || r.CustomerName || r.client_name || r.arrangement_contact_entity_full_name || ""),
      notes: extractArtifaxNotes(r),
      status: resolveStatus(combinedStatus),
    };
  });
}

// Artifax instance → advancing row format
function mapInstance(i: ArtifaxInstance) {
  const space = resolveSpace(i.room);
  return {
    artifaxId: i.id,
    groupId: i.groupId || null,
    name: i.title,
    category: toCategory(i.type || ""),
    space,
    date: i.date || "",
    startTime: i.startTime || "",
    finishTime: i.finishTime || "",
    clientContact: i.contact || "",
    status: i.status || "Confirmed",
    notes: i.notes || "",
    techInfo: i.notes || "",
    artifaxNotes: i.notes || "",
  };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    // 7-day lookback so current day and recently started events are never excluded
    const from = new Date(Date.now() - 7 * 864e5);
    const to = new Date(Date.now() + HORIZON_DAYS * 864e5);
    const instances = await fetchArtifaxInstances(from, to);

    const sb = createClient(SUPABASE_URL, SERVICE_ROLE);
    let created = 0, updated = 0, skipped = 0;

    // Filter to mapped spaces and convert to our format
    const validBookings = instances.map(mapInstance).filter(b => {
      if (!b.space) { skipped++; return false; }
      return true;
    });

    if (validBookings.length === 0) {
      return json({ ok: true, from: from.toISOString().slice(0, 10), to: to.toISOString().slice(0, 10), created, updated, skipped });
    }

    // Batch fetch existing events to preserve Portal fields
    const artifaxIds = validBookings.map(b => b.artifaxId);
    
    // We might have more than 1000 instances, so chunk the select if necessary, 
    // but typically HORIZON_DAYS=120 won't exceed PostgREST limits for `in`.
    const { data: existingData, error: fetchError } = await sb
      .from("advancing")
      .select("*")
      .in("artifaxId", artifaxIds);

    if (fetchError) throw new Error(`Batch select failed: ${fetchError.message}`);

    const existingMap = new Map((existingData || []).map(r => [r.artifaxId, r]));
    const rowsToUpsert = [];

    for (const booking of validBookings) {
      const existing = existingMap.get(booking.artifaxId);
      if (existing) {
        const changes: string[] = [];
        if (existing.date !== booking.date && booking.date) changes.push(`[Date Change]: Date moved to ${booking.date}`);
        if (existing.startTime !== booking.startTime && booking.startTime) changes.push(`[Time Change]: Start time updated to ${booking.startTime}`);
        if (existing.finishTime !== booking.finishTime && booking.finishTime) changes.push(`[Time Change]: Finish time updated to ${booking.finishTime}`);
        if (existing.space !== booking.space && booking.space) changes.push(`[Space Change]: Moved to ${booking.space}`);
        if (existing.name !== booking.name && booking.name) changes.push(`[Title Change]: Renamed to ${booking.name}`);
        if (existing.status !== booking.status && booking.status) changes.push(`[Status Change]: Status updated to ${booking.status}`);
        if (existing.clientContact !== booking.clientContact && booking.clientContact) changes.push(`[Contact Change]: Contact updated to ${booking.clientContact}`);

        const artifaxHistory = Array.isArray(existing.artifaxHistory) 
          ? [...existing.artifaxHistory] 
          : (existing.production_package && Array.isArray(existing.production_package.artifaxHistory)
              ? [...existing.production_package.artifaxHistory]
              : []);
        const lastNotes = artifaxHistory.length > 0 ? (artifaxHistory[artifaxHistory.length - 1].notes || "") : "";
        const currentNotes = booking.notes || lastNotes || "";

        if (booking.notes && booking.notes !== lastNotes) {
          changes.push(`[Artifax Notes Updated]`);
        }

        if (changes.length > 0) {
          artifaxHistory.push({
            date: new Date().toISOString(),
            notes: currentNotes,
            changes
          });
        }

        const prodPkg = (existing && typeof existing.production_package === "object" && existing.production_package !== null)
          ? { ...existing.production_package }
          : {};
        prodPkg.artifaxHistory = artifaxHistory;

        booking.artifaxHistory = artifaxHistory;
        const existingTech = (existing.techInfo || "").trim();
        const techInfoVal = existingTech ? existingTech : currentNotes;

        const row: Record<string, any> = { 
          ...existing, 
          ...booking, 
          techInfo: techInfoVal,
          artifaxHistory: artifaxHistory,
          id: existing.id, 
          production_package: prodPkg 
        };
        // Clean out extra properties that are not columns in standard advancing SQL schema
        delete row.notes;
        delete row.artifaxNotes;

        rowsToUpsert.push(row);
        updated++;
      } else {
        const currentNotes = booking.notes || "";
        const artifaxHistory = currentNotes ? [{
          date: new Date().toISOString(),
          notes: currentNotes,
          changes: ["Initial sync from Artifax"]
        }] : [];
        booking.artifaxHistory = artifaxHistory;

        const row: Record<string, any> = { 
          id: `evt-afx-${booking.artifaxId}`, 
          ...booking, 
          techInfo: currentNotes,
          artifaxHistory: artifaxHistory,
          production_package: { artifaxHistory, artifaxNotes: currentNotes } 
        };
        delete row.notes;
        delete row.artifaxNotes;

        rowsToUpsert.push(row);
        created++;
      }
    }

    if (rowsToUpsert.length > 0) {
      // Chunk upserts if array is large (e.g. > 500) to be safe, but usually fine up to 1000s
      let currentRows = rowsToUpsert;
      let lastError: any = null;
      for (let attempt = 0; attempt < 3; attempt++) {
        const { error: upsertError } = await sb.from("advancing").upsert(currentRows, { onConflict: "id" });
        if (!upsertError) {
          lastError = null;
          break;
        }
        lastError = upsertError;
        const missingMatch = upsertError.message?.match(/Could not find the '([^']+)' column/i);
        const missingCol = missingMatch ? missingMatch[1] : (upsertError.message?.includes("artifaxHistory") ? "artifaxHistory" : null);
        if (missingCol) {
          console.warn(`[artifax-sync] Column '${missingCol}' missing from advancing schema cache. Retrying upsert without it (data safely preserved in production_package)...`);
          currentRows = currentRows.map(r => {
            const copy = { ...r };
            delete copy[missingCol];
            return copy;
          });
        } else {
          break;
        }
      }
      if (lastError) throw new Error(`Batch upsert failed: ${lastError.message}`);
    }

    return json({ ok: true, from: from.toISOString().slice(0, 10), to: to.toISOString().slice(0, 10), created, updated, skipped, instances: validBookings });
  } catch (e) {
    return json({ ok: false, error: String((e as Error).message ?? e) }, 500);
  }
});
