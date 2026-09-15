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

// ---- Artifax room name → Tech Portal space. EDIT to match your rooms. ----
const ROOM_TO_SPACE: Record<string, string> = {
  "The Stage": "The Stage",
  "Studio": "The Studio",
  "The Studio": "The Studio",
  "Mix": "The Mix",
  "The Mix": "The Mix",
  "Screen 1": "Screen One",
  "Screen 2": "Screen Two",
  "Screen 3": "Screen Three",
};

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

// ------------------------------------------------------------
//  Fetch instances from Artifax.
//  TODO: set the exact endpoint + query params from your Artifax API
//  docs (Admin → Configuration → API, or ask Artifax Support). The
//  ArtifaxEvent data model is Arrangements → Events → Instances; you
//  want dated INSTANCES within [from, to], including room + contact.
//  The shape below is what mapInstance() expects — adjust the parsing
//  to whatever Artifax returns.
// ------------------------------------------------------------
interface ArtifaxInstance {
  id: string;            // stable Artifax instance id
  groupId?: string;      // arrangement id / group id for multi-room takeovers
  title: string;
  room: string;          // room/space name
  type?: string;         // booking type / arrangement type
  start: string;         // ISO datetime
  end?: string;          // ISO datetime
  contact?: string;      // primary contact name/org
  notes?: string;        // any tech-relevant custom field(s)
  status?: string;       // e.g. Confirmed / Pencilled / Cancelled
}

async function fetchArtifaxInstances(from: Date, to: Date): Promise<ArtifaxInstance[]> {
  if (!ARTIFAX_URL || !ARTIFAX_API_KEY || !ARTIFAX_USERNAME || !ARTIFAX_PASSWORD) {
    throw new Error("ARTIFAX credentials not fully set — see docs/ARTIFAX-EDGE-FUNCTION.md");
  }
  // --- EXAMPLE call — replace path/params/headers per Artifax docs ---
  const params = new URLSearchParams({
    date: 'between',
    start_date: from.toISOString().slice(0, 10),
    end_date: to.toISOString().slice(0, 10),
    schedule_output: "1"
  });
    // Ensure base URL doesn't have a trailing slash or trailing /api since we append it
  const baseUrl = ARTIFAX_URL.replace(/\/api\/?$/, '').replace(/\/$/, '');
    
  // Use the correct Artifax Events endpoint
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

  // --- Map Artifax's response fields to ArtifaxInstance. Adjust keys. ---
  const list: any[] = Array.isArray(data) ? data : (data.instances ?? data.results ?? []);
  return list.map((r) => {
    const title = String(r.title || r.name || r.EventName || r.arrangement_description || r.arrangement_name || "Untitled");
    const groupId = String(r.arrangement_id || r.arrangementId || r.ArrangementId || r.groupId || r.GroupId || r.event_id || r.EventId || title);
    
    return {
      id: String(r.id || r.instanceId || r.InstanceId || r.event_id),
      groupId: groupId,
      title: title,
      room: String(r.room || r.roomName || r.RoomName || r.room_name || ""),
      type: String(r.type || r.arrangementType || r.ArrangementType || r.arrangement_type_name || ""),
      start: String(r.start || r.startDateTime || r.StartDateTime || r.start_date_time || ""),
      end: String(r.end || r.endDateTime || r.EndDateTime || r.end_date_time || ""),
      contact: String(r.contact || r.contactName || r.CustomerName || r.client_name || r.arrangement_contact_entity_full_name || ""),
      notes: String(r.notes || r.description || ""),
      status: String(r.status || r.Status || r.event_status_name || "Confirmed"),
    };
  });
}

// Artifax instance → the booking fields of an advancing row (tech fields excluded).
function mapInstance(i: ArtifaxInstance) {
  const space = ROOM_TO_SPACE[i.room] ?? "";
  const start = i.start ? new Date(i.start) : null;
  const end = i.end ? new Date(i.end) : null;
  const hhmm = (d: Date | null) => (d ? d.toISOString().slice(11, 16) : "");
  const cancelled = /cancel/i.test(i.status || "");
  return {
    artifaxId: i.id,
    groupId: i.groupId || null,
    name: i.title,
    category: toCategory(i.type || ""),
    space,
    date: start ? start.toISOString().slice(0, 10) : "",
    startTime: hhmm(start),
    finishTime: hhmm(end),
    clientContact: i.contact || "",
    status: cancelled ? "Cancelled" : "Confirmed",
    // NB: techUserId / techInfo / techSpec / guestEngineer are NOT set here —
    // they belong to the Portal and are preserved below.
  };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const from = new Date();
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
        rowsToUpsert.push({ ...existing, ...booking, id: existing.id });
        updated++;
      } else {
        rowsToUpsert.push({ id: `evt-afx-${booking.artifaxId}`, ...booking });
        created++;
      }
    }

    if (rowsToUpsert.length > 0) {
      // Chunk upserts if array is large (e.g. > 500) to be safe, but usually fine up to 1000s
      const { error: upsertError } = await sb.from("advancing").upsert(rowsToUpsert, { onConflict: "id" });
      if (upsertError) throw new Error(`Batch upsert failed: ${upsertError.message}`);
    }

    return json({ ok: true, from: from.toISOString().slice(0, 10), to: to.toISOString().slice(0, 10), created, updated, skipped });
  } catch (e) {
    return json({ ok: false, error: String((e as Error).message ?? e) }, 500);
  }
});
