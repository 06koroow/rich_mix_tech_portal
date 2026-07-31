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
    { id: 'inv-1', tag: 'MIC-058', name: 'Shure SM58',        category: 'Microphones', location: 'Store',       qty: 12, condition: 'Good', notes: '',              status: 'in', heldBy: '', outAt: '', movements: [] },
    { id: 'inv-2', tag: 'MIC-057', name: 'Shure SM57',        category: 'Microphones', location: 'Store',       qty: 8,  condition: 'Good', notes: '',              status: 'in', heldBy: '', outAt: '', movements: [] },
    { id: 'inv-3', tag: 'DI-001',  name: 'Radial ProDI',      category: 'DI Boxes',    location: 'Store',       qty: 6,  condition: 'Good', notes: '',              status: 'in', heldBy: '', outAt: '', movements: [] },
    { id: 'inv-4', tag: 'CAB-X10', name: 'XLR cable 10m',     category: 'Cables',      location: 'Cable store', qty: 30, condition: 'Good', notes: '',              status: 'in', heldBy: '', outAt: '', movements: [] },
    { id: 'inv-5', tag: 'CAB-IEC', name: 'IEC power lead',    category: 'Cables',      location: 'Cable store', qty: 24, condition: 'Good', notes: '',              status: 'in', heldBy: '', outAt: '', movements: [] },
    { id: 'inv-6', tag: 'SPK-Y7',  name: 'd&b Y7P',           category: 'Speakers',    location: 'The Stage',   qty: 4,  condition: 'Good', notes: 'Main hangs',    status: 'in', heldBy: '', outAt: '',
      movements: [ { from: 'PA rack', to: 'The Stage', at: '2026-07-20T09:00:00.000Z', by: 'Alex Morgan' } ] },
    { id: 'inv-7', tag: 'IEM-P10', name: 'Shure PSM300',      category: 'IEM',         location: 'RF case',     qty: 4,  condition: 'Good', notes: '',              status: 'in', heldBy: '', outAt: '', movements: [] },
    { id: 'inv-8', tag: 'STD-K&M', name: 'K&M tall stand',    category: 'Stands',      location: 'Stage store', qty: 10, condition: 'Damaged', notes: '2 need clutches', status: 'in', heldBy: '', outAt: '', movements: [] },
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
