/* ============================================================
   seed.js — starter content
   ------------------------------------------------------------
   Embedded as JS (not fetched JSON) so the app runs from file://
   with no server. This is only the FIRST-RUN seed: once the app
   has written to localStorage it uses that copy, so edits made in
   the UI persist. To reset to this seed, use "Reset demo data" in
   the dashboard (or clear the browser's storage for this file).

   Procedures ship as intentionally-blank holding pages — the
   structure is here, you drop the real SOP content into `body`.
   ============================================================ */
/* Sample-shift dates are relative to first run so "today" always has
   something to show. iso(n) = n days from today, YYYY-MM-DD. */
(function () {
  const iso = (n) => { const d = new Date(); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10); };
  RMTP._seedDates = { today: iso(0), tomorrow: iso(1), plus3: iso(3), lastWeek: iso(-6) };
})();

RMTP.seed = {

  /* ---- Process documentation / operating procedures ----
     Grouped by area. Each procedure has a placeholder body you
     replace with the real step-by-step. `updated` is a stamp you
     can maintain, or wire to something automatic later. */
  procedures: [
    {
      id: 'opening-closing', name: 'Opening & Closing', icon: 'power',
      items: [
        { id: 'venue-open',  title: 'Venue opening checklist', updated: '', body: '' },
        { id: 'night-close', title: 'End-of-night shutdown',    updated: '', body: '' },
      ],
    },
    {
      id: 'sound', name: 'Sound', icon: 'wave',
      items: [
        { id: 'pa-powerup',   title: 'PA power-up sequence',       updated: '', body: '' },
        { id: 'foh-dlive',    title: 'FOH desk (dLive) startup',    updated: '', body: '' },
        { id: 'monitors',     title: 'Monitor world setup',         updated: '', body: '' },
        { id: 'rf-management', title: 'Radio mic / IEM management',  updated: '', body: '' },
      ],
    },
    {
      id: 'lighting', name: 'Lighting', icon: 'bulb',
      items: [
        { id: 'lx-startup',  title: 'Lighting desk startup',   updated: '', body: '' },
        { id: 'house-lights',title: 'House lights & presets',  updated: '', body: '' },
        { id: 'haze',        title: 'Haze / smoke operation',  updated: '', body: '' },
      ],
    },
    {
      id: 'av', name: 'AV & Presentation', icon: 'screen',
      items: [
        { id: 'projector', title: 'Projector & screen setup',    updated: '', body: '' },
        { id: 'patching',  title: 'Laptop / HDMI patching',       updated: '', body: '' },
        { id: 'hybrid',    title: 'Hybrid / streamed event setup',updated: '', body: '' },
      ],
    },
    {
      id: 'stage', name: 'Stage & Rigging', icon: 'box',
      items: [
        { id: 'get-in',  title: 'Stage build & get-in', updated: '', body: '' },
        { id: 'rigging', title: 'Rigging & flying points', updated: '', body: '' },
        { id: 'get-out', title: 'Get-out procedure',     updated: '', body: '' },
      ],
    },
    {
      id: 'hs', name: 'Health & Safety', icon: 'shield',
      items: [
        { id: 'evac',     title: 'Fire & evacuation procedure', updated: '', body: '' },
        { id: 'height',   title: 'Working at height',           updated: '', body: '' },
        { id: 'handling', title: 'Manual handling',             updated: '', body: '' },
        { id: 'incident', title: 'Incident reporting',          updated: '', body: '' },
        { id: 'pat',      title: 'Electrical safety (PAT)',     updated: '', body: '' },
      ],
    },
  ],

  /* ---- Inventory ----
     Each item has custody state: status 'in'|'out', heldBy, outAt.
     The `tag` is what a QR label encodes (RMTP-INV:<tag>). */
  inventory: [
    { id: "inv-stg-001", tag: "STG-001", name: "Behringer Wing", category: "Sound - Console/Stageboxes", location: "The Stage", qty: 1, condition: "Good", notes: "Behringer Wing digital mixing console", status: "in", heldBy: "", outAt: "", static: true, movements: [] },
    { id: "inv-stg-002", tag: "STG-002", name: "Midas S16", category: "Sound - Console/Stageboxes", location: "The Stage", qty: 2, condition: "Good", notes: "Midas S16 stage box (32 in / 16 out total across 2 units)", status: "in", heldBy: "", outAt: "", static: true, movements: [] },
    { id: "inv-stg-003", tag: "STG-003", name: "8-way XLR input stage box", category: "Sound - Console/Stageboxes", location: "The Stage", qty: 4, condition: "Good", notes: "", status: "in", heldBy: "", outAt: "", static: true, movements: [] },
    { id: "inv-stg-004", tag: "STG-004", name: "JBL VRX918SP", category: "Sound - PA/Speakers", location: "The Stage", qty: 4, condition: "Good", notes: "Powered bass-reflex subwoofer, 18\" (under-stage)", status: "in", heldBy: "", outAt: "", static: true, movements: [] },
    { id: "inv-stg-005", tag: "STG-005", name: "JBL VRX932LAP", category: "Sound - PA/Speakers", location: "The Stage", qty: 6, condition: "Good", notes: "Powered 2-way line-array speaker, 12\"", status: "in", heldBy: "", outAt: "", static: true, movements: [] },
    { id: "inv-stg-006", tag: "STG-006", name: "RCF NX10-SMA", category: "Sound - PA/Speakers", location: "The Stage", qty: 6, condition: "Good", notes: "Active stage monitor, full range, 400W", status: "in", heldBy: "", outAt: "", static: true, movements: [] },
    { id: "inv-stg-007", tag: "STG-007", name: "RCF NX12-SMA", category: "Sound - PA/Speakers", location: "The Stage", qty: 2, condition: "Good", notes: "Active stage monitor, full range, 700W", status: "in", heldBy: "", outAt: "", static: true, movements: [] },
    { id: "inv-stg-sm58", tag: "STG-008", name: "Shure SM58", category: "Sound - Microphones", location: "The Stage", qty: 8, condition: "Good", notes: "Vocal dynamic mic", status: "in", heldBy: "", outAt: "", static: false, movements: [] },
    { id: "inv-stg-009", tag: "STG-009", name: "Shure Beta 58A", category: "Sound - Microphones", location: "The Stage", qty: 1, condition: "Good", notes: "Vocal dynamic mic (super-cardioid)", status: "in", heldBy: "", outAt: "", static: false, movements: [] },
    { id: "inv-stg-010", tag: "STG-010", name: "Shure SM57", category: "Sound - Microphones", location: "The Stage", qty: 8, condition: "Good", notes: "Instrument dynamic mic", status: "in", heldBy: "", outAt: "", static: false, movements: [] },
    { id: "inv-stg-011", tag: "STG-011", name: "Shure Beta 91A", category: "Sound - Microphones", location: "The Stage", qty: 1, condition: "Good", notes: "Kick drum mic", status: "in", heldBy: "", outAt: "", static: false, movements: [] },
    { id: "inv-stg-012", tag: "STG-012", name: "Sennheiser MD 421-II", category: "Sound - Microphones", location: "The Stage", qty: 2, condition: "Good", notes: "Large-diaphragm dynamic mic", status: "in", heldBy: "", outAt: "", static: false, movements: [] },
    { id: "inv-stg-013", tag: "STG-013", name: "Sennheiser E906", category: "Sound - Microphones", location: "The Stage", qty: 1, condition: "Good", notes: "Instrument dynamic mic", status: "in", heldBy: "", outAt: "", static: false, movements: [] },
    { id: "inv-stg-014", tag: "STG-014", name: "Sennheiser E602", category: "Sound - Microphones", location: "The Stage", qty: 2, condition: "Good", notes: "Kick drum mic", status: "in", heldBy: "", outAt: "", static: false, movements: [] },
    { id: "inv-stg-015", tag: "STG-015", name: "Sennheiser E604", category: "Sound - Microphones", location: "The Stage", qty: 6, condition: "Good", notes: "Tom/snare drum mic", status: "in", heldBy: "", outAt: "", static: false, movements: [] },
    { id: "inv-stg-016", tag: "STG-016", name: "Sennheiser E614", category: "Sound - Microphones", location: "The Stage", qty: 4, condition: "Good", notes: "Instrument condenser mic", status: "in", heldBy: "", outAt: "", static: false, movements: [] },
    { id: "inv-stg-017", tag: "STG-017", name: "AKG 300B/CK91", category: "Sound - Microphones", location: "The Stage", qty: 1, condition: "Good", notes: "Condenser capsule mic", status: "in", heldBy: "", outAt: "", static: false, movements: [] },
    { id: "inv-stg-018", tag: "STG-018", name: "Sennheiser E3", category: "Sound - Microphones", location: "The Stage", qty: 4, condition: "Good", notes: "Radio/wireless mic system", status: "in", heldBy: "", outAt: "", static: false, movements: [] },
    { id: "inv-stg-019", tag: "STG-019", name: "Active DI box", category: "Sound - DI/Stands", location: "The Stage", qty: 7, condition: "Good", notes: "", status: "in", heldBy: "", outAt: "", static: false, movements: [] },
    { id: "inv-stg-020", tag: "STG-020", name: "Microphone stands, various (small and large)", category: "Sound - DI/Stands", location: "The Stage", qty: 1, condition: "Good", notes: "various / unquantified", status: "in", heldBy: "", outAt: "", static: false, movements: [] },
    { id: "inv-stg-021", tag: "STG-021", name: "Yamaha Stage Custom", category: "Backline", location: "The Stage", qty: 1, condition: "Good", notes: "Drum kit, Stage Custom, 20\" kick (no cymbals)", status: "in", heldBy: "", outAt: "", static: false, movements: [] },
    { id: "inv-stg-022", tag: "STG-022", name: "Fender Deluxe", category: "Backline", location: "The Stage", qty: 1, condition: "Good", notes: "Guitar amplifier, 180W", status: "in", heldBy: "", outAt: "", static: false, movements: [] },
    { id: "inv-stg-023", tag: "STG-023", name: "Markbass CMD 103", category: "Backline", location: "The Stage", qty: 1, condition: "Good", notes: "Bass amplifier", status: "in", heldBy: "", outAt: "", static: false, movements: [] },
    { id: "inv-stg-024", tag: "STG-024", name: "Pioneer DJM850", category: "DJ Equipment", location: "The Stage", qty: 1, condition: "Good", notes: "DJ mixer", status: "in", heldBy: "", outAt: "", static: false, movements: [] },
    { id: "inv-stg-025", tag: "STG-025", name: "Pioneer CDJ2000", category: "DJ Equipment", location: "The Stage", qty: 2, condition: "Good", notes: "CD player/deck", status: "in", heldBy: "", outAt: "", static: false, movements: [] },
    { id: "inv-stg-026", tag: "STG-026", name: "Technics 1210 Mk5", category: "DJ Equipment", location: "The Stage", qty: 2, condition: "Good", notes: "Turntable", status: "in", heldBy: "", outAt: "", static: false, movements: [] },
    { id: "inv-stg-027", tag: "STG-027", name: "FBT Jolly", category: "DJ Equipment", location: "The Stage", qty: 1, condition: "Good", notes: "DJ booth monitor, 6\"", status: "in", heldBy: "", outAt: "", static: false, movements: [] },
    { id: "inv-stg-028", tag: "STG-028", name: "Avolites Tiger Touch II", category: "Lighting - Control", location: "The Stage", qty: 1, condition: "Good", notes: "Lighting control desk", status: "in", heldBy: "", outAt: "", static: true, movements: [] },
    { id: "inv-stg-029", tag: "STG-029", name: "15A dimmer channel", category: "Lighting - Control", location: "The Stage", qty: 54, condition: "Good", notes: "", status: "in", heldBy: "", outAt: "", static: true, movements: [] },
    { id: "inv-stg-030", tag: "STG-030", name: "Control points", category: "Lighting - Control", location: "The Stage", qty: 2, condition: "Good", notes: "", status: "in", heldBy: "", outAt: "", static: true, movements: [] },
    { id: "inv-stg-031", tag: "STG-031", name: "Working lights (separate system)", category: "Lighting - Control", location: "The Stage", qty: 1, condition: "Good", notes: "various / unquantified", status: "in", heldBy: "", outAt: "", static: true, movements: [] },
    { id: "inv-stg-032", tag: "STG-032", name: "Prolights Studio CobFC", category: "Lighting - Fixtures", location: "The Stage", qty: 12, condition: "Good", notes: "LED RGB 150W parcan (moving)", status: "in", heldBy: "", outAt: "", static: true, movements: [] },
    { id: "inv-stg-033", tag: "STG-033", name: "Prolights Diamond 19", category: "Lighting - Fixtures", location: "The Stage", qty: 6, condition: "Good", notes: "LED RGB moving wash light", status: "in", heldBy: "", outAt: "", static: true, movements: [] },
    { id: "inv-stg-034", tag: "STG-034", name: "Prolights CromoSpot500", category: "Lighting - Fixtures", location: "The Stage", qty: 6, condition: "Good", notes: "LED RGB moving spot light", status: "in", heldBy: "", outAt: "", static: true, movements: [] },
    { id: "inv-stg-035", tag: "STG-035", name: "Prolights EclFresnel TW", category: "Lighting - Fixtures", location: "The Stage", qty: 2, condition: "Good", notes: "LED stage wash fixture", status: "in", heldBy: "", outAt: "", static: true, movements: [] },
    { id: "inv-stg-036", tag: "STG-036", name: "500W Fresnel (lower bars)", category: "Lighting - Fixtures", location: "The Stage", qty: 9, condition: "Good", notes: "", status: "in", heldBy: "", outAt: "", static: true, movements: [] },
    { id: "inv-stg-037", tag: "STG-037", name: "Panasonic PT DZ770EK", category: "AV - Projection/Screens", location: "The Stage", qty: 1, condition: "Good", notes: "Projector, WUXGA 1920x1200", status: "in", heldBy: "", outAt: "", static: true, movements: [] },
    { id: "inv-stg-038", tag: "STG-038", name: "Retractable ceiling screen, 5m wide (projection area 3.5m x 4.2m)", category: "AV - Projection/Screens", location: "The Stage", qty: 1, condition: "Good", notes: "", status: "in", heldBy: "", outAt: "", static: true, movements: [] },
    { id: "inv-stg-039", tag: "STG-039", name: "50\" plasma screen on stage pillar (VGA feed)", category: "AV - Projection/Screens", location: "The Stage", qty: 2, condition: "Good", notes: "", status: "in", heldBy: "", outAt: "", static: true, movements: [] },
    { id: "inv-stg-040", tag: "STG-040", name: "Extron", category: "AV - Projection/Screens", location: "The Stage", qty: 1, condition: "Good", notes: "Extron HDMI routing system to projector", status: "in", heldBy: "", outAt: "", static: true, movements: [] },
    { id: "inv-stu-001", tag: "STU-001", name: "Roland M400", category: "Sound - Console/Stageboxes", location: "The Studio", qty: 1, condition: "Good", notes: "Digital mixing desk", status: "in", heldBy: "", outAt: "", static: true, movements: [] },
    { id: "inv-stu-002", tag: "STU-002", name: "Stage box, 16 XLR in / 8 XLR out via Cat5", category: "Sound - Console/Stageboxes", location: "The Studio", qty: 2, condition: "Good", notes: "", status: "in", heldBy: "", outAt: "", static: true, movements: [] },
    { id: "inv-stu-003", tag: "STU-003", name: "KV2 Audio EX10", category: "Sound - PA/Speakers", location: "The Studio", qty: 1, condition: "Good", notes: "Active full-range speaker, 500W", status: "in", heldBy: "", outAt: "", static: true, movements: [] },
    { id: "inv-stu-004", tag: "STU-004", name: "KV2 Audio EX10", category: "Sound - PA/Speakers", location: "The Studio", qty: 2, condition: "Good", notes: "Active monitor, 500W", status: "in", heldBy: "", outAt: "", static: true, movements: [] },
    { id: "inv-stu-005", tag: "STU-005", name: "RCF art705AS", category: "Sound - PA/Speakers", location: "The Studio", qty: 2, condition: "Good", notes: "Active bass unit, 800W", status: "in", heldBy: "", outAt: "", static: true, movements: [] },
    { id: "inv-stu-006", tag: "STU-006", name: "RCF art325A", category: "Sound - PA/Speakers", location: "The Studio", qty: 1, condition: "Good", notes: "Active monitor, 400W", status: "in", heldBy: "", outAt: "", static: true, movements: [] },
    { id: "inv-stu-007", tag: "STU-007", name: "Sennheiser EW300 G3", category: "Sound - Microphones", location: "The Studio", qty: 3, condition: "Good", notes: "Wireless mic system", status: "in", heldBy: "", outAt: "", static: false, movements: [] },
    { id: "inv-stu-008", tag: "STU-008", name: "Sennheiser EW100 G3", category: "Sound - Microphones", location: "The Studio", qty: 3, condition: "Good", notes: "Wireless mic system", status: "in", heldBy: "", outAt: "", static: false, movements: [] },
    { id: "inv-stu-009", tag: "STU-009", name: "Shure SM58", category: "Sound - Microphones", location: "The Studio", qty: 4, condition: "Good", notes: "Vocal dynamic mic", status: "in", heldBy: "", outAt: "", static: false, movements: [] },
    { id: "inv-stu-010", tag: "STU-010", name: "Sennheiser EW145 G3", category: "Sound - Microphones", location: "The Studio", qty: 4, condition: "Good", notes: "Wireless mic system", status: "in", heldBy: "", outAt: "", static: false, movements: [] },
    { id: "inv-stu-011", tag: "STU-011", name: "Studio Spares", category: "Sound - DI/Stands", location: "The Studio", qty: 2, condition: "Good", notes: "DI box", status: "in", heldBy: "", outAt: "", static: false, movements: [] },
    { id: "inv-stu-012", tag: "STU-012", name: "Tascam CD-200", category: "Sound - Playback", location: "The Studio", qty: 2, condition: "Good", notes: "CD player", status: "in", heldBy: "", outAt: "", static: false, movements: [] },
    { id: "inv-stu-013", tag: "STU-013", name: "Pioneer DJM850", category: "DJ Equipment", location: "The Studio", qty: 1, condition: "Good", notes: "DJ mixer", status: "in", heldBy: "", outAt: "", static: false, movements: [] },
    { id: "inv-stu-014", tag: "STU-014", name: "Pioneer CDJ2000", category: "DJ Equipment", location: "The Studio", qty: 2, condition: "Good", notes: "CD player/deck", status: "in", heldBy: "", outAt: "", static: false, movements: [] },
    { id: "inv-stu-015", tag: "STU-015", name: "Technics 1210 Mk5", category: "DJ Equipment", location: "The Studio", qty: 2, condition: "Fair", notes: "Turntable", status: "in", heldBy: "", outAt: "", static: false, movements: [] },
    { id: "inv-stu-016", tag: "STU-016", name: "ETC Element 60", category: "Lighting - Control", location: "The Studio", qty: 1, condition: "Good", notes: "Lighting control desk", status: "in", heldBy: "", outAt: "", static: true, movements: [] },
    { id: "inv-stu-017", tag: "STU-017", name: "Zero88 Chilli", category: "Lighting - Control", location: "The Studio", qty: 48, condition: "Good", notes: "2Kw dimmer (36 rig + 12 floor; 44 of 48 fully working)", status: "in", heldBy: "", outAt: "", static: true, movements: [] },
    { id: "inv-stu-018", tag: "STU-018", name: "13A non-dimmed circuit", category: "Lighting - Control", location: "The Studio", qty: 8, condition: "Good", notes: "", status: "in", heldBy: "", outAt: "", static: true, movements: [] },
    { id: "inv-stu-019", tag: "STU-019", name: "DMX outlet", category: "Lighting - Control", location: "The Studio", qty: 4, condition: "Good", notes: "", status: "in", heldBy: "", outAt: "", static: true, movements: [] },
    { id: "inv-stu-020", tag: "STU-020", name: "Prolight EclFresnel", category: "Lighting - Fixtures", location: "The Studio", qty: 12, condition: "Good", notes: "Fixed-position fixture", status: "in", heldBy: "", outAt: "", static: true, movements: [] },
    { id: "inv-stu-021", tag: "STU-021", name: "Prolight Diamond 7", category: "Lighting - Fixtures", location: "The Studio", qty: 8, condition: "Good", notes: "Fixed-position fixture", status: "in", heldBy: "", outAt: "", static: true, movements: [] },
    { id: "inv-stu-022", tag: "STU-022", name: "Prolight Studio CobFC", category: "Lighting - Fixtures", location: "The Studio", qty: 12, condition: "Good", notes: "LED RGB 150W parcan, fixed position", status: "in", heldBy: "", outAt: "", static: true, movements: [] },
    { id: "inv-stu-023", tag: "STU-023", name: "ETC Junior Source 4", category: "Lighting - Fixtures", location: "The Studio", qty: 12, condition: "Good", notes: "Zoom profile (25/50)", status: "in", heldBy: "", outAt: "", static: true, movements: [] },
    { id: "inv-stu-024", tag: "STU-024", name: "CCT Eco", category: "Lighting - Fixtures", location: "The Studio", qty: 18, condition: "Good", notes: "800W Fresnel", status: "in", heldBy: "", outAt: "", static: true, movements: [] },
    { id: "inv-stu-025", tag: "STU-025", name: "CCT Minuette", category: "Lighting - Fixtures", location: "The Studio", qty: 12, condition: "Good", notes: "500W Fresnel", status: "in", heldBy: "", outAt: "", static: true, movements: [] },
    { id: "inv-stu-026", tag: "STU-026", name: "Parcan with CP62 head", category: "Lighting - Fixtures", location: "The Studio", qty: 12, condition: "Good", notes: "", status: "in", heldBy: "", outAt: "", static: true, movements: [] },
    { id: "inv-stu-027", tag: "STU-027", name: "Floor can with CP62 head", category: "Lighting - Fixtures", location: "The Studio", qty: 6, condition: "Good", notes: "", status: "in", heldBy: "", outAt: "", static: true, movements: [] },
    { id: "inv-stu-028", tag: "STU-028", name: "500W flood", category: "Lighting - Fixtures", location: "The Studio", qty: 4, condition: "Good", notes: "", status: "in", heldBy: "", outAt: "", static: true, movements: [] },
    { id: "inv-stu-029", tag: "STU-029", name: "Tank trap with 3m Ali pole", category: "Lighting - Rigging/Other", location: "The Studio", qty: 6, condition: "Good", notes: "", status: "in", heldBy: "", outAt: "", static: false, movements: [] },
    { id: "inv-stu-030", tag: "STU-030", name: "Single floor stand", category: "Lighting - Rigging/Other", location: "The Studio", qty: 6, condition: "Good", notes: "", status: "in", heldBy: "", outAt: "", static: false, movements: [] },
    { id: "inv-stu-031", tag: "STU-031", name: "15amp cable, selection", category: "Lighting - Rigging/Other", location: "The Studio", qty: 1, condition: "Good", notes: "various / unquantified", status: "in", heldBy: "", outAt: "", static: false, movements: [] },
    { id: "inv-stu-032", tag: "STU-032", name: "Panasonic PT DZ770EK", category: "AV - Projection/Screens", location: "The Studio", qty: 1, condition: "Good", notes: "Projector, WUXGA 1920x1200, fixed position (projects 3m x 4m onto back wall)", status: "in", heldBy: "", outAt: "", static: true, movements: [] },
    { id: "inv-stu-033", tag: "STU-033", name: "Harlequin", category: "Staging/Flooring", location: "The Studio", qty: 4, condition: "Good", notes: "Harlequin black vinyl dance floor, 2m x 10m", status: "in", heldBy: "", outAt: "", static: true, movements: [] },
    { id: "inv-stu-034", tag: "STU-034", name: "Staging block, 1m x 1m x 30cm", category: "Staging/Flooring", location: "The Studio", qty: 8, condition: "Good", notes: "", status: "in", heldBy: "", outAt: "", static: true, movements: [] },
    { id: "inv-stu-035", tag: "STU-035", name: "Hard black flat, 3.5m tall x 1.5m wide", category: "Staging/Flooring", location: "The Studio", qty: 2, condition: "Good", notes: "", status: "in", heldBy: "", outAt: "", static: true, movements: [] },
    { id: "inv-mix-001", tag: "MIX-001", name: "Soundcraft EMP12", category: "Sound - Console/Stageboxes", location: "The Mix", qty: 1, condition: "Good", notes: "12-way mixing desk", status: "in", heldBy: "", outAt: "", static: true, movements: [] },
    { id: "inv-mix-002", tag: "MIX-002", name: "KV2 Audio EX10", category: "Sound - PA/Speakers", location: "The Mix", qty: 2, condition: "Good", notes: "Active speaker", status: "in", heldBy: "", outAt: "", static: true, movements: [] },
    { id: "inv-mix-003", tag: "MIX-003", name: "Tascam CD200", category: "Sound - Playback", location: "The Mix", qty: 1, condition: "Good", notes: "CD player", status: "in", heldBy: "", outAt: "", static: false, movements: [] },
    { id: "inv-mix-004", tag: "MIX-004", name: "Sennheiser EW145 G3", category: "Sound - Microphones", location: "The Mix", qty: 2, condition: "Good", notes: "Wireless mic system", status: "in", heldBy: "", outAt: "", static: false, movements: [] },
    { id: "inv-mix-005", tag: "MIX-005", name: "Microphones, various", category: "Sound - Microphones", location: "The Mix", qty: 1, condition: "Good", notes: "various / unquantified", status: "in", heldBy: "", outAt: "", static: false, movements: [] },
    { id: "inv-mix-006", tag: "MIX-006", name: "Studio Spares", category: "Sound - DI/Stands", location: "The Mix", qty: 2, condition: "Good", notes: "DI box", status: "in", heldBy: "", outAt: "", static: false, movements: [] },
    { id: "inv-mix-007", tag: "MIX-007", name: "6-way LED controller", category: "Lighting - Control", location: "The Mix", qty: 1, condition: "Good", notes: "", status: "in", heldBy: "", outAt: "", static: true, movements: [] },
    { id: "inv-mix-008", tag: "MIX-008", name: "5A dimmer", category: "Lighting - Control", location: "The Mix", qty: 3, condition: "Good", notes: "", status: "in", heldBy: "", outAt: "", static: true, movements: [] },
    { id: "inv-mix-009", tag: "MIX-009", name: "ETC Junior Source 4", category: "Lighting - Fixtures", location: "The Mix", qty: 1, condition: "Good", notes: "Spot and track lighting, separately dimmable", status: "in", heldBy: "", outAt: "", static: true, movements: [] },
    { id: "inv-mix-010", tag: "MIX-010", name: "LED RGB 36W parcan, fixed position", category: "Lighting - Fixtures", location: "The Mix", qty: 4, condition: "Good", notes: "", status: "in", heldBy: "", outAt: "", static: true, movements: [] },
    { id: "inv-mix-011", tag: "MIX-011", name: "Panasonic PT LB90NT", category: "AV - Projection/Screens", location: "The Mix", qty: 1, condition: "Good", notes: "Projector, XGA 1024x768, 3500 ANSI lumens (projects 1.6m x 2.4m onto back wall)", status: "in", heldBy: "", outAt: "", static: true, movements: [] },
    { id: "inv-mix-012", tag: "MIX-012", name: "Le Mark", category: "Staging/Flooring", location: "The Mix", qty: 3, condition: "Good", notes: "Le Mark black Sonata compression vinyl dance floor, 2m x 6m", status: "in", heldBy: "", outAt: "", static: true, movements: [] },
    { id: "inv-mix-013", tag: "MIX-013", name: "Staging block, 1m x 1m x 30cm", category: "Staging/Flooring", location: "The Mix", qty: 8, condition: "Good", notes: "", status: "in", heldBy: "", outAt: "", static: true, movements: [] },
    { id: "inv-s1-001", tag: "S1-001", name: "Behringer X Air 12", category: "Sound - Console/Stageboxes", location: "Screen One", qty: 1, condition: "Excellent", notes: "12-way mixing desk · Location: Booth", status: "in", heldBy: "", outAt: "", static: true, movements: [] },
    { id: "inv-s1-002", tag: "S1-002", name: "iPad 11\"", category: "Sound - Control", location: "Screen One", qty: 1, condition: "Excellent", notes: "iPad · Location: Booth", status: "in", heldBy: "", outAt: "", static: false, movements: [] },
    { id: "inv-s1-003", tag: "S1-003", name: "Christie Vive Audio LS5S", category: "Sound - PA/Speakers", location: "Screen One", qty: 12, condition: "Good", notes: "Passive speaker (Surrounds) · Location: Screen", status: "in", heldBy: "", outAt: "", static: true, movements: [] },
    { id: "inv-s1-004", tag: "S1-004", name: "Martin Audio Screen 3", category: "Sound - PA/Speakers", location: "Screen One", qty: 3, condition: "Good", notes: "Passive speaker (L, C, R) · Location: Screen", status: "in", heldBy: "", outAt: "", static: true, movements: [] },
    { id: "inv-s1-005", tag: "S1-005", name: "Martin Audio Sub 1A", category: "Sound - PA/Speakers", location: "Screen One", qty: 1, condition: "Good", notes: "Passive speaker (Sub) · Location: Screen", status: "in", heldBy: "", outAt: "", static: true, movements: [] },
    { id: "inv-s1-amp", tag: "S1-006", name: "Christie Vive Audio CDA5 5000W", category: "Sound - PA/Speakers", location: "Screen One", qty: 6, condition: "Fair", notes: "Amplifiers · Location: Booth · Amp for channels 7 & 8 faulty and removed from rack. All amps need thorough cleaning.", status: "in", heldBy: "", outAt: "", static: true, movements: [] },
    { id: "inv-s1-007", tag: "S1-007", name: "Dolby AP20", category: "Sound - PA/Speakers", location: "Screen One", qty: 1, condition: "Good", notes: "Processor · Location: Booth", status: "in", heldBy: "", outAt: "", static: true, movements: [] },
    { id: "inv-s1-008", tag: "S1-008", name: "Sennheiser E3", category: "Sound - Microphones", location: "Screen One", qty: 2, condition: "Fair", notes: "Wireless mic system · Location: Booth", status: "in", heldBy: "", outAt: "", static: false, movements: [] },
    { id: "inv-s1-009", tag: "S1-009", name: "Shure SM58", category: "Sound - Microphones", location: "Screen One", qty: 4, condition: "Fair", notes: "Microphones, various · Location: Booth", status: "in", heldBy: "", outAt: "", static: false, movements: [] },
    { id: "inv-s1-010", tag: "S1-010", name: "Transcension SDC-6 DMX Controller", category: "Lighting - Control", location: "Screen One", qty: 1, condition: "Fair", notes: "Lighting console · Location: Booth · Does the job. Power cable or input need checking, can cause lights to flicker if knocked", status: "in", heldBy: "", outAt: "", static: true, movements: [] },
    { id: "inv-s1-011", tag: "S1-011", name: "1Kw flood lights", category: "Lighting - Fixtures", location: "Screen One", qty: 2, condition: "Fair", notes: "Location: Screen lighting bar · I would guess these have not been cleaned since being rigged.", status: "in", heldBy: "", outAt: "", static: true, movements: [] },
    { id: "inv-s1-012", tag: "S1-012", name: "500w fresnel", category: "Lighting - Fixtures", location: "Screen One", qty: 2, condition: "Fair", notes: "Location: Screen lighting bar · \"", status: "in", heldBy: "", outAt: "", static: true, movements: [] },
    { id: "inv-s1-013", tag: "S1-013", name: "Spot unknown wattage", category: "Lighting - Fixtures", location: "Screen One", qty: 1, condition: "Fair", notes: "Location: Screen lighting bar · \"", status: "in", heldBy: "", outAt: "", static: true, movements: [] },
    { id: "inv-s1-014", tag: "S1-014", name: "Christie CP4220", category: "AV - Projection/Screens", location: "Screen One", qty: 1, condition: "Good", notes: "Cinema Projector · Location: Booth", status: "in", heldBy: "", outAt: "", static: true, movements: [] },
    { id: "inv-s1-015", tag: "S1-015", name: "Cine IMP2K", category: "AV - Projection/Screens", location: "Screen One", qty: 1, condition: "Good", notes: "Cinema Projector expansion module · Location: Booth · Obsolete. Large 3U rack mount box. Previously in use with our old Christie CP2000 projectors. The board itself is an expansion module to allow legacy projectors to process non-cinema signals such as HDMI/VGA/DVI.", status: "in", heldBy: "", outAt: "", static: true, movements: [] },
    { id: "inv-s1-016", tag: "S1-016", name: "24ft x 10.21ft silver screen", category: "AV - Projection/Screens", location: "Screen One", qty: 1, condition: "Poor", notes: "Location: Screen · Screen is way past its lifespan. Silver paint is tarnishing and picture is noticeably cloudy and mottled.", status: "in", heldBy: "", outAt: "", static: true, movements: [] },
    { id: "inv-s1-017", tag: "S1-017", name: "Kramer VP-444", category: "AV - Projection/Screens", location: "Screen One", qty: 1, condition: "Good", notes: "HDMI Splitter · Location: Booth rack", status: "in", heldBy: "", outAt: "", static: true, movements: [] },
    { id: "inv-s2-001", tag: "S2-001", name: "Behringer X Air 12", category: "Sound - Console/Stageboxes", location: "Screen Two", qty: 1, condition: "Excellent", notes: "12-way mixing desk · Location: Booth", status: "in", heldBy: "", outAt: "", static: true, movements: [] },
    { id: "inv-s2-002", tag: "S2-002", name: "iPad 11\"", category: "Sound - Control", location: "Screen Two", qty: 1, condition: "Good", notes: "iPad · Location: Booth", status: "in", heldBy: "", outAt: "", static: false, movements: [] },
    { id: "inv-s2-003", tag: "S2-003", name: "Christie Vive Audio LS3S", category: "Sound - PA/Speakers", location: "Screen Two", qty: 12, condition: "Good", notes: "Passive speaker (Surround) · Location: Screen", status: "in", heldBy: "", outAt: "", static: true, movements: [] },
    { id: "inv-s2-004", tag: "S2-004", name: "Turbosound Impact 50", category: "Sound - PA/Speakers", location: "Screen Two", qty: 2, condition: "Good", notes: "Passive speaker (Surround) · Location: Screen", status: "in", heldBy: "", outAt: "", static: true, movements: [] },
    { id: "inv-s2-005", tag: "S2-005", name: "Martin Audio Screen 2", category: "Sound - PA/Speakers", location: "Screen Two", qty: 3, condition: "Good", notes: "Passive speaker (L, C, R) · Location: Screen", status: "in", heldBy: "", outAt: "", static: true, movements: [] },
    { id: "inv-s2-006", tag: "S2-006", name: "Martin Audio Sub 1A", category: "Sound - PA/Speakers", location: "Screen Two", qty: 1, condition: "Good", notes: "Passive Speaker (Sub) · Location: Screen", status: "in", heldBy: "", outAt: "", static: true, movements: [] },
    { id: "inv-s2-007", tag: "S2-007", name: "Christie Vive Audio CDA5 5000W", category: "Sound - PA/Speakers", location: "Screen Two", qty: 4, condition: "Fair", notes: "Amplifiers · Location: Booth · All amps need thorough cleaning.", status: "in", heldBy: "", outAt: "", static: true, movements: [] },
    { id: "inv-s2-008", tag: "S2-008", name: "Dolby AP20", category: "Sound - PA/Speakers", location: "Screen Two", qty: 1, condition: "Good", notes: "Processor · Location: Booth", status: "in", heldBy: "", outAt: "", static: true, movements: [] },
    { id: "inv-s2-009", tag: "S2-009", name: "Sennheiser E3", category: "Sound - Microphones", location: "Screen Two", qty: 2, condition: "Poor", notes: "Wireless mic system · Location: Booth", status: "in", heldBy: "", outAt: "", static: false, movements: [] },
    { id: "inv-s2-010", tag: "S2-010", name: "Shure SM58", category: "Sound - Microphones", location: "Screen Two", qty: 4, condition: "Fair", notes: "Microphones, various · Location: Booth", status: "in", heldBy: "", outAt: "", static: false, movements: [] },
    { id: "inv-s2-011", tag: "S2-011", name: "Transcension SDC-6 DMX Controller", category: "Lighting - Control", location: "Screen Two", qty: 1, condition: "Fair", notes: "Lighting console", status: "in", heldBy: "", outAt: "", static: true, movements: [] },
    { id: "inv-s2-012", tag: "S2-012", name: "1Kw flood lights", category: "Lighting - Fixtures", location: "Screen Two", qty: 2, condition: "Good", notes: "Location: Screen lighting bar", status: "in", heldBy: "", outAt: "", static: true, movements: [] },
    { id: "inv-s2-013", tag: "S2-013", name: "500w fresnel", category: "Lighting - Fixtures", location: "Screen Two", qty: 2, condition: "Good", notes: "Location: Screen lighting bar", status: "in", heldBy: "", outAt: "", static: true, movements: [] },
    { id: "inv-s2-014", tag: "S2-014", name: "Christie CP4220", category: "AV - Projection/Screens", location: "Screen Two", qty: 1, condition: "Good", notes: "Cinema Projector", status: "in", heldBy: "", outAt: "", static: true, movements: [] },
    { id: "inv-s2-015", tag: "S2-015", name: "Cine IMP2K", category: "AV - Projection/Screens", location: "Screen Two", qty: 1, condition: "Good", notes: "Cinema Projector expansion module · Obsolete. Large 3U rack mount box. Previously in use with our old Christie CP2000 projectors. The board itself is an expansion module to allow legacy projectors to process non-cinema signals such as HDMI/VGA/DVI.", status: "in", heldBy: "", outAt: "", static: true, movements: [] },
    { id: "inv-s2-016", tag: "S2-016", name: "23ft x 9.791ft silver screen", category: "AV - Projection/Screens", location: "Screen Two", qty: 1, condition: "Poor", notes: "Screen is way past its lifespan. Silver paint is tarnishing and picture is noticeably cloudy and mottled.", status: "in", heldBy: "", outAt: "", static: true, movements: [] },
    { id: "inv-s2-017", tag: "S2-017", name: "Kramer VP-444", category: "AV - Projection/Screens", location: "Screen Two", qty: 1, condition: "Good", notes: "HDMI Splitter", status: "in", heldBy: "", outAt: "", static: true, movements: [] },
    { id: "inv-s3-001", tag: "S3-001", name: "Turbosound Impact 50", category: "Sound - PA/Speakers", location: "Screen Three", qty: 8, condition: "Good", notes: "Passive speaker (Surrounds) · Location: Screen", status: "in", heldBy: "", outAt: "", static: true, movements: [] },
    { id: "inv-s3-002", tag: "S3-002", name: "EV Evid 6.2", category: "Sound - PA/Speakers", location: "Screen Three", qty: 2, condition: "Good", notes: "Passive speaker (Surrounds) · Location: Screen", status: "in", heldBy: "", outAt: "", static: true, movements: [] },
    { id: "inv-s3-003", tag: "S3-003", name: "Martin Audio Screen 2", category: "Sound - PA/Speakers", location: "Screen Three", qty: 3, condition: "Good", notes: "Passive speaker (L, C, R) · Location: Screen", status: "in", heldBy: "", outAt: "", static: true, movements: [] },
    { id: "inv-s3-004", tag: "S3-004", name: "Passive speaker (Sub)", category: "Sound - PA/Speakers", location: "Screen Three", qty: 1, condition: "Good", notes: "Location: Screen · Could be Martin Audio, label not visible", status: "in", heldBy: "", outAt: "", static: true, movements: [] },
    { id: "inv-s3-005", tag: "S3-005", name: "QSC RMX145", category: "Sound - PA/Speakers", location: "Screen Three", qty: 3, condition: "Fair", notes: "Amplifiers · Location: Booth · Crackly level pots, right surround known to output a lower level. Intermittently fixed by wiggling the pot. Ideally should be upgraded, but do the job well enough.", status: "in", heldBy: "", outAt: "", static: true, movements: [] },
    { id: "inv-s3-006", tag: "S3-006", name: "Dolby CP750", category: "Sound - PA/Speakers", location: "Screen Three", qty: 1, condition: "Good", notes: "Processor · Location: Booth · No known issues.", status: "in", heldBy: "", outAt: "", static: true, movements: [] },
    { id: "inv-s3-007", tag: "S3-007", name: "Ultra Stereo Labs CM-680", category: "Sound - PA/Speakers", location: "Screen Three", qty: 1, condition: "Good", notes: "Monitor · Location: Booth · No known issues.", status: "in", heldBy: "", outAt: "", static: true, movements: [] },
    { id: "inv-s3-008", tag: "S3-008", name: "Strand 6 Pack", category: "Lighting - Control", location: "Screen Three", qty: 2, condition: "Fair", notes: "Dimmer · Location: Booth · Only dimmer 1 on the top 6 pack works to light the stage. Dimmer 2 does not work the audience lights, needs investigating. Bottom 6 Pack only operates a lecturn mic on dimmer 2.", status: "in", heldBy: "", outAt: "", static: true, movements: [] },
    { id: "inv-s3-009", tag: "S3-009", name: "1Kw flood lights", category: "Lighting - Fixtures", location: "Screen Three", qty: 4, condition: "Fair", notes: "Location: Screen lighting bar · Do not turn on via dimmer, could be dimmer issue, or bulb or disconnected.", status: "in", heldBy: "", outAt: "", static: true, movements: [] },
    { id: "inv-s3-010", tag: "S3-010", name: "Fresnel", category: "Lighting - Fixtures", location: "Screen Three", qty: 1, condition: "Fair", notes: "Location: Screen lighting bar · Works fine, should be cleaned.", status: "in", heldBy: "", outAt: "", static: true, movements: [] },
    { id: "inv-s3-011", tag: "S3-011", name: "Birdie", category: "Lighting - Fixtures", location: "Screen Three", qty: 1, condition: "Fair", notes: "Location: Screen lighting bar · Works fine, should be cleaned.", status: "in", heldBy: "", outAt: "", static: true, movements: [] },
    { id: "inv-s3-012", tag: "S3-012", name: "Christie CP2215 with Cine IPM2K", category: "AV - Projection/Screens", location: "Screen Three", qty: 1, condition: "Good", notes: "Cinema Projector · Location: Booth", status: "in", heldBy: "", outAt: "", static: true, movements: [] },
    { id: "inv-s3-013", tag: "S3-013", name: "16ft x 6.801ft white screen", category: "AV - Projection/Screens", location: "Screen Three", qty: 1, condition: "Good", notes: "Location: Booth rack", status: "in", heldBy: "", outAt: "", static: true, movements: [] },
    { id: "inv-s3-014", tag: "S3-014", name: "Kramer VP-444", category: "AV - Projection/Screens", location: "Screen Three", qty: 1, condition: "Good", notes: "HDMI Splitter · Location: Booth rack", status: "in", heldBy: "", outAt: "", static: true, movements: [] },
    { id: "inv-s3-015", tag: "S3-015", name: "AAM01", category: "Network - Projection/Screens", location: "Screen Three", qty: 1, condition: "Good", notes: "Arts Alliance Media · Location: Booth rack · Rack mounted computer, runs Linux and Screenwriter software", status: "in", heldBy: "", outAt: "", static: true, movements: [] },
    { id: "inv-s3-016", tag: "S3-016", name: "LANsat Rack", category: "Network - Projection/Screens", location: "Screen Three", qty: 1, condition: "Good", notes: "Omnex TMS · Location: Booth rack · This is the storage for Screenwriter. RAID setup housed in a 2U rack mount case with additional cinebox reader slot and USB port. RAID 0 configuration - approx 22tb of storage", status: "in", heldBy: "", outAt: "", static: true, movements: [] },
    { id: "inv-s3-017", tag: "S3-017", name: "D-link Managed Switch DGS-3100-24", category: "Network - Projection/Screens", location: "Screen Three", qty: 1, condition: "Good", notes: "Network switch · Location: Booth rack", status: "in", heldBy: "", outAt: "", static: true, movements: [] },
    { id: "inv-s3-018", tag: "S3-018", name: "Superflex DVB-S / DVB-S2 Duo", category: "Network - Projection/Screens", location: "Screen Three", qty: 1, condition: "Good", notes: "Satellite IRD · Location: Booth rack", status: "in", heldBy: "", outAt: "", static: true, movements: [] },
    { id: "inv-s3-019", tag: "S3-019", name: "APC SUA1500RMI2U", category: "Power", location: "Screen Three", qty: 1, condition: "Good", notes: "Uninterruptible power supply · Location: Booth rack", status: "in", heldBy: "", outAt: "", static: true, movements: [] },
    { id: "inv-s3-020", tag: "S3-020", name: "Draytek Vigor 2830", category: "Network - Projection/Screens", location: "Screen Three", qty: 1, condition: "Good", notes: "Router · Location: Booth rack", status: "in", heldBy: "", outAt: "", static: true, movements: [] },
    { id: "inv-s3-021", tag: "S3-021", name: "LANsat Rack", category: "Network - Projection/Screens", location: "Screen Three", qty: 1, condition: "Good", notes: "LANsat · Location: Booth rack · Identical rack configuration as the Omnex TMS. Accessible as LANSAT via Screenwriter. It is the local storage for DCP delivery sent electronically via MPS. LANSAT comes with 12tb of storage", status: "in", heldBy: "", outAt: "", static: true, movements: [] },
  ],

  /* ---- Users ----
     position: Technical Manager | Senior Tech | Duty Tech | Freelancer
     discipline: Sound | Lighting | Cinema
     admin  -> sees & edits everything (inventory catalogue, users, content)
     trainer -> can sign off other users' training
     Non-admins can move inventory (sign out/in) and edit shift reports only.
     Competencies themselves are derived from `procedures` at runtime. */
  users: [
    { id: 'user-1', firstName: 'Alex',  lastName: 'Morgan', email: 'alex@richmix.local',  password: 'h977ad04b', status: 'active', position: 'Technical Manager', discipline: 'Sound',    admin: true,  trainer: true  },
    { id: 'user-2', firstName: 'Priya', lastName: 'Shah',   email: 'priya@richmix.local', password: 'h977ad04b', status: 'active', position: 'Senior Tech',       discipline: 'Lighting', admin: true,  trainer: true  },
    { id: 'user-3', firstName: 'Sam',   lastName: 'Okafor', email: 'sam@richmix.local',   password: 'h977ad04b', status: 'active', position: 'Duty Tech',         discipline: 'Sound',    admin: false, trainer: false },
    { id: 'user-4', firstName: 'Danny', lastName: 'Cole',   email: 'danny@richmix.local', password: 'h977ad04b', status: 'active', position: 'Duty Tech',         discipline: 'Cinema',   admin: false, trainer: true  },
  ],
  signoffs: [],

  /* ---- Advancing (upcoming events) ---- */
  advancing: [
    {
      id: 'evt-1', name: 'Kokoroko \u2014 live', category: 'Programme', space: 'The Stage',
      date: RMTP._seedDates.today, status: 'Confirmed',
      startTime: '19:00', finishTime: '23:00', soundcheck: '17:00', doors: '19:30', curfew: '23:00',
      techUserId: 'user-3', clientContact: 'Tour manager \u2014 Jess', guestEngineer: true,
      techInfo: 'Guest FOH engineer touring with the band. 32-way split needed. Backline hired in.', techSpec: null,
      checklist: {},
    },
    {
      id: 'evt-2', name: 'Private hire \u2014 product launch', category: 'Private Hires', space: 'The Studio',
      date: RMTP._seedDates.today, status: 'Confirmed',
      startTime: '18:00', finishTime: '22:00', soundcheck: '', doors: '18:30', curfew: '22:00',
      techUserId: 'user-4', clientContact: 'Client \u2014 Aria Events', guestEngineer: false,
      techInfo: 'Speeches + playback from a laptop. Two handhelds, a lectern mic, HDMI to the projector.', techSpec: null,
      checklist: {},
    },
    {
      id: 'evt-3', name: 'Short film premiere', category: 'Cinema', space: 'Screen One',
      date: RMTP._seedDates.tomorrow, status: 'Advancing',
      startTime: '19:30', finishTime: '22:00', soundcheck: '', doors: '19:00', curfew: '',
      techUserId: 'user-3', clientContact: 'Producer \u2014 Sam', guestEngineer: false,
      techInfo: 'DCP arriving day before \u2014 ingest and test. Q&A after with two radio mics.', techSpec: null,
      checklist: {},
    },
    {
      id: 'evt-4', name: 'Wedding reception', category: 'Private Hires', space: 'The Mix',
      date: RMTP._seedDates.plus3, status: 'Advancing',
      startTime: '17:00', finishTime: '00:00', soundcheck: '', doors: '', curfew: '00:00',
      techUserId: '', clientContact: 'Client \u2014 the Osei family', guestEngineer: false,
      techInfo: 'DJ on later, playback earlier. Needs uplighters and a couple of radio mics for speeches.', techSpec: null,
      checklist: {},
    },
    {
      id: 'evt-5', name: 'Jazz night', category: 'Programme', space: 'The Stage',
      date: RMTP._seedDates.lastWeek, status: 'Complete',
      startTime: '20:00', finishTime: '23:00', soundcheck: '18:30', doors: '19:30', curfew: '23:00',
      techUserId: 'user-3', clientContact: '', guestEngineer: false,
      techInfo: 'House engineer. Standard jazz input list.', techSpec: null,
      checklist: {},
    },
  ],

  /* ---- End-of-shift reports (keyed by eventId; see views/advancing.js) ---- */
  reports: [],
};
