/* ============================================================
   config.js — global namespace, app metadata & navigation
   ------------------------------------------------------------
   Everything hangs off the single global `RMTP`. View files
   register themselves onto RMTP.views. To add a new section,
   add an entry to RMTP.nav and create a matching view file.
   ============================================================ */
window.RMTP = window.RMTP || {};

RMTP.meta = {
  name: 'Rich Mix',
  product: 'Tech Portal',
  version: '0.2.0',
  storageKey: 'rmtp',   // localStorage namespace prefix
};

/* Navigation. `id` doubles as the route (#/inventory -> id "inventory")
   and the key used to look up RMTP.views[id].
   `icon` is a key into RMTP.ui.icon(). Order = display order. */
RMTP.nav = [
  { id: 'dashboard',   label: 'Dashboard',   icon: 'grid'  },
  { id: 'advancing',   label: 'Advancing',   icon: 'clip'  },
  { id: 'maintenance', label: 'Maintenance', icon: 'wrench'},
  { id: 'inventory',   label: 'Inventory',   icon: 'box'   },
  { id: 'procedures',  label: 'Procedures',  icon: 'book'  },
  { id: 'users',       label: 'Users',       icon: 'users' },
];

RMTP.HOME = 'dashboard';
RMTP.views = {};

/* ---- Shared vocabularies ----
   Spaces are the venue's finite performance areas — tagged on
   events, inventory (current location) and maintenance faults.
   Stores are the non-performance home locations kit lives in.
   Together they form the set of inventory locations. */
RMTP.SPACES = ['The Stage', 'The Studio', 'The Mix', 'Screen One', 'Screen Two', 'Screen Three'];
RMTP.STORES = ['Store', 'Cable store', 'PA rack', 'RF case', 'Stage store', 'Workshop'];
RMTP.LOCATIONS = RMTP.SPACES.concat(RMTP.STORES);
RMTP.EVENT_CATEGORIES = ['Cinema', 'Programme', 'Private Hires'];
RMTP.isSpace = function (loc) { return RMTP.SPACES.indexOf(loc) > -1; };
RMTP.slug = function (s) { return String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''); };

/* Conditions at or below this are "poor" — such kit is struck through
   in inventory and may only be moved to a Store (see inventory view). */
RMTP.CONDITIONS = ['Good', 'Fair', 'Damaged', 'Out of service'];
RMTP.POOR_CONDITIONS = ['Damaged', 'Out of service'];
RMTP.isPoorCondition = function (c) { return RMTP.POOR_CONDITIONS.indexOf(c) > -1; };

/* ---- Training framework ----
   Space-specific competency categories. Sign-offs are recorded per
   (user, competency). Competency ids are derived from the slugs so
   they're stable across reloads. Edit this list to change what the
   team is signed off on. */
RMTP.TRAINING = [
  { category: 'The Stage (Sound)',    items: ['System startup & line check', 'FOH mixing', 'Monitors / IEM', 'Safe shutdown'] },
  { category: 'The Stage (Lighting)', items: ['Console startup', 'Operation / busking', 'Safe shutdown'] },
  { category: 'The Stage (AV)',       items: ['Projector & screen startup', 'Source switching / playback', 'Safe shutdown'] },
  { category: 'The Studio (Sound)',   items: ['System startup & line check', 'FOH mixing', 'Monitors / IEM', 'Safe shutdown'] },
  { category: 'The Studio (Lighting)',items: ['Console startup', 'Operation / busking', 'Safe shutdown'] },
  { category: 'The Studio (AV)',      items: ['Projector & screen startup', 'Source switching / playback', 'Safe shutdown'] },
  { category: 'The Mix (Sound)',      items: ['System startup & line check', 'FOH mixing', 'Safe shutdown'] },
  { category: 'The Mix (Lighting)',   items: ['Console startup', 'Operation / busking', 'Safe shutdown'] },
  { category: 'The Mix (AV)',         items: ['Projector & screen startup', 'Source switching / playback', 'Safe shutdown'] },
  { category: 'Screen One',           items: ['Projector startup', 'DCP ingest & playback', 'Sound / format check', 'Safe shutdown'] },
  { category: 'Screen Two',           items: ['Projector startup', 'DCP ingest & playback', 'Sound / format check', 'Safe shutdown'] },
  { category: 'Screen Three',         items: ['Projector startup', 'DCP ingest & playback', 'Sound / format check', 'Safe shutdown'] },
];

/* Flattened, most-recent-first log of kit movements across all items.
   Used by the Inventory page and the dashboard. */
RMTP.recentMovements = function (limit) {
  const out = [];
  RMTP.store.all('inventory').forEach((it) => {
    (it.movements || []).forEach((mv) => out.push({
      itemId: it.id, name: it.name, tag: it.tag,
      from: mv.from, to: mv.to, at: mv.at, by: mv.by, note: mv.note || '',
    }));
  });
  out.sort((a, b) => (b.at || '').localeCompare(a.at || ''));
  return limit ? out.slice(0, limit) : out;
};
