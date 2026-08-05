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

const ARTIFAX_URL = Deno.env.get("ARTIFAX_URL") ?? "";
const ARTIFAX_API_KEY = Deno.env.get("ARTIFAX_API_KEY") ?? "";
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
  if (!ARTIFAX_URL || !ARTIFAX_API_KEY) {
    throw new Error("ARTIFAX_URL / ARTIFAX_API_KEY not set — see docs/ARTIFAX-SETUP.md");
  }
  // --- EXAMPLE call — replace path/params/headers per Artifax docs ---
  const params = new URLSearchParams({
    from: from.toISOString().slice(0, 10),
    to: to.toISOString().slice(0, 10),
  });
  const res = await fetch(`${ARTIFAX_URL}/api/instances?${params}`, {
    headers: { "Authorization": `Bearer ${ARTIFAX_API_KEY}`, "Accept": "application/json" },
  });
  if (!res.ok) throw new Error(`Artifax responded ${res.status}: ${await res.text()}`);
  const data = await res.json();

  // --- Map Artifax's response fields to ArtifaxInstance. Adjust keys. ---
  const list: any[] = Array.isArray(data) ? data : (data.instances ?? data.results ?? []);
  return list.map((r) => ({
    id: String(r.id ?? r.instanceId ?? r.InstanceId),
    title: r.title ?? r.name ?? r.EventName ?? "Untitled",
    room: r.room ?? r.roomName ?? r.RoomName ?? "",
    type: r.type ?? r.arrangementType ?? r.ArrangementType ?? "",
    start: r.start ?? r.startDateTime ?? r.StartDateTime,
    end: r.end ?? r.endDateTime ?? r.EndDateTime,
    contact: r.contact ?? r.contactName ?? r.CustomerName ?? "",
    notes: r.notes ?? r.description ?? "",
    status: r.status ?? r.Status ?? "Confirmed",
  }));
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

    for (const inst of instances) {
      const booking = mapInstance(inst);
      if (!booking.space) { skipped++; continue; }   // unmapped room — skip, don't guess

      // Preserve the Portal's own fields: merge booking fields onto any existing row.
      const { data: existing } = await sb
        .from("advancing").select("*").eq("artifaxId", booking.artifaxId).maybeSingle();

      let row: Record<string, unknown>;
      if (existing) {
        row = { ...existing, ...booking, id: existing.id };   // keep id + tech fields
        updated++;
      } else {
        row = { id: `evt-afx-${booking.artifaxId}`, ...booking };
        created++;
      }
      const { error } = await sb.from("advancing").upsert(row, { onConflict: "id" });
      if (error) throw new Error(`upsert failed for ${booking.artifaxId}: ${error.message}`);
    }

    return json({ ok: true, from: from.toISOString().slice(0, 10), to: to.toISOString().slice(0, 10), created, updated, skipped });
  } catch (e) {
    return json({ ok: false, error: String((e as Error).message ?? e) }, 500);
  }
});
