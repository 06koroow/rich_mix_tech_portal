# Rich Mix — Tech Portal

A scaffold for a web/phone app for Rich Mix technical staff. It's built to grow
into four areas:

- **Procedures** — process documentation & operating procedures (ships as blank
  holding pages, ready for real content)
- **Maintenance** — fault logging & repair tracking
- **Inventory** — equipment tracking
- **Advancing** — event info, tech assignment, tech-spec upload & shift reports

The framework (navigation, routing, data storage, forms, theming) is fully
wired. Procedures are intentionally empty so you can drop in real SOPs;
Maintenance, Inventory and Advancing come with working demo data so you can see
the patterns to build on.

---

## Running it

Just open `index.html` in a browser. No build step, no server. Everything works
from `file://` because there are no ES modules and no `fetch()` of local files.

> First load pulls Tailwind and the fonts from a CDN, so you need an internet
> connection the first time. See "Going to production" for how to remove that.

Data is saved to the browser's **localStorage** — it persists on that device/
browser but isn't shared between devices. There's a **Reset demo data** button
on the dashboard to restore the starter content.

### To use the QR camera scanner, serve the folder

Browsers only allow camera access on a **secure context** — `https://` or
`http://localhost`, never `file://`. So if you just double-click `index.html`,
the app runs fine but the scanner falls back to manual tag entry. To scan for
real, serve the folder (this is *static hosting only — still no backend*):

```bash
# from inside the project folder, either:
npx serve            # then open the printed http://localhost:… URL
python3 -m http.server   # then open http://localhost:8000
```

To scan on your **phone** (the actual use case), put it on any free static host
for an HTTPS URL — e.g. drag the folder onto Netlify Drop, or push to GitHub
Pages. Everything still runs client-side; hosting just supplies HTTPS + a URL
your phone can reach. QR generation (printing labels) works everywhere,
including `file://`.

---

## How it's put together

```
rich-mix-tech-portal/
├── index.html          App shell. Loads Tailwind + fonts, then the scripts
│                       in dependency order. Theming config lives here.
├── css/
│   └── app.css         Theme tokens (:root variables) + component styles.
│                       ← RE-SKIN HERE.
├── js/
│   ├── config.js       Global `RMTP` namespace, app metadata, nav list.
│   ├── store.js        Data layer: adapter seam + in-memory cache (init/reset/CRUD).
│   ├── ui.js           Shared helpers: icons, toasts, modals, pills, escaping.
│   ├── auth.js         Accounts: email/password login, sign-up + approval, `can()`.
│   ├── files.js        Small file store for uploads (tech-spec PDFs).
│   ├── qr.js           QR generate (labels) + camera scan + payload encode/parse.
│   ├── router.js       Hash router (#/view/param/param).
│   ├── app.js          Builds the shell + identity chip, boots.
│   └── views/
│       ├── dashboard.js
│       ├── procedures.js
│       ├── maintenance.js
│       ├── inventory.js    Kit list + QR sign-out/in + print labels.
│       ├── users.js        Team, roles/permissions, and training sign-off.
│       └── advancing.js
├── vendor/
│   ├── qrcode-generator.js   QR image generation (window.qrcode). No build step.
│   └── html5-qrcode.min.js   Camera QR scanning (window.Html5Qrcode).
├── data/
│   └── seed.js         First-run starter content (procedures, inventory, users…).
├── docs/
│   ├── BACKEND.md      Backend review, refactor seams & M365 options.
│   ├── SHAREPOINT-SETUP.md   Wire the app to SharePoint (Microsoft 365).
│   ├── SUPABASE-SETUP.md     Wire the app to Supabase (self-serve, no admin).
│   └── supabase-setup.sql    Paste-and-run schema + seed + RLS for Supabase.
└── assets/
    ├── logo.svg        Placeholder mark.
    └── rm-logo.jpg     Rich Mix brand mark (shown top-left).
```

### Accounts, sign-in & approvals (prototype)

Each user has an **email + password**. Sign-in is required; there's a **Request
access** flow that creates a *pending* account which an **admin approves** (surfaced
in the dashboard in-tray and on the Users page). Passwords are a non-cryptographic
digest in localStorage — a stand-in so the flow is real; swap for Entra ID /
Supabase Auth (see `docs/BACKEND.md`). Demo login: `alex@richmix.local` / `demo1234`.

### Backends (both optional, both dormant by default)

The app runs on `localStorage` out of the box. Two backend layers are wired in and
switched **off** until you fill in their config, so double-clicking `index.html`
keeps working:

- **Supabase** (`js/supabase-config.js`) — self-serve, no Microsoft admin needed.
  Postgres + Auth + Storage + Row-Level Security. Fill in `url` + `anonKey`, run
  `docs/supabase-setup.sql`, and follow `docs/SUPABASE-SETUP.md`.
- **SharePoint / Microsoft 365** (`js/graph-config.js`) — stays in your tenant,
  needs an Entra app + admin consent. See `docs/SHAREPOINT-SETUP.md`.

Both hydrate the localStorage cache on load and push changes back through
`store.js`, so no view code changes between modes. Supabase takes priority if both
are configured.

**Roles follow position.** Technical Managers and Senior Techs are automatically
**admins + trainers**; Duty Techs / Freelancers get base permissions and an admin
can tick **Trainer** on them. Only trainers can sign off training (even admins
can't unless they're also a trainer), and each sign-off records who signed it and
the date **and time**. Only admins can assign/reassign shifts, resolve faults, and
return reported kit to circulation.

### Users & permissions (prototype)

On first load the app asks **who you are** (no password — it's a prototype) and
remembers it. That identity does two jobs: it's who actions are recorded as
(sign-outs, training sign-offs), and it's what permission checks read. Switch
user any time from the chip at the bottom of the sidebar.

Permissions live in one place — `auth.js`'s `can(capability)`:

- **admin** → everything (edit inventory catalogue, add/edit users, content).
- **non-admin** → move inventory (sign out/in) and edit shift reports only.
- **trainer** → can sign off other users' training.

> **This is a UX layer, not security.** It hides controls the current user
> shouldn't use, but anyone with devtools can still edit localStorage. That's
> fine for a trusted-team trial. When the backend arrives, the *server* enforces
> this same capability list and these client checks stay as convenience. The
> golden rule: never trust the client.

To add or change a rule, edit the `can()` switch — nothing else references roles
directly, so gating stays consistent. Views call `RMTP.auth.can('inventory.manage')`
etc. and hide/disable buttons accordingly.

### Spaces

The venue's finite performance areas (`RMTP.SPACES` in `config.js`): The Stage,
The Studio, The Mix, Screen One/Two/Three. They're tagged on **events** and
**maintenance faults**, and are one half of an inventory item's location (the
other half being **stores** — `RMTP.STORES`). Change the lists in one place and
every dropdown and filter updates. Inventory can filter by space ("what's in The
Mix right now"), and each item keeps a **movement history** — every location
change logs from/to, who, and when. Open an item (tap its name) to see it.
**Sign-out** can record the destination space, and a **movement log** appears on
the Inventory page and the dashboard.

### Flagged kit

An item is **flagged** when its condition is below Fair (Damaged / Out of service)
**or** it's linked to an unresolved fault. Flagged kit is struck through in
Inventory, can only be moved to a **Store**, and is listed in a panel at the top of
**Maintenance**. **Maintenance.** Faults link to an item by scanning its QR label or typing the
asset tag, and can carry a photo. Only admins get a **Resolve** step that records
how the fault was fixed and returns the linked kit to circulation (clearing its
flag); only admins can sign reported kit back into use. Base users can log faults
and move them between Open / In progress.

### Events

Each event carries: title, category (Cinema / Programme / Private Hires), space,
date, start/finish/soundcheck/doors/curfew times, an assigned tech (a user; only
admins assign or reassign — base users see only shifts assigned to them, filtered
by space and date),
artist/client contact, a guest-engineer flag, a tech-info note, and an optional
**tech-spec PDF**. The card surfaces these fields directly (the old pre-event
checklist was removed in favour of the show information).

> **File caveat:** PDFs and fault photos are stored base64 in localStorage (see
> `files.js`), a ~5MB-total prototype stopgap — files are capped at 3MB. Real file
> storage is a backend job (see `docs/BACKEND.md`); `persist()` is written so it
> can swap to an upload that returns a URL, leaving the record metadata unchanged.

- **Inventory** items carry custody state (`status` in/out, `heldBy`, `outAt`)
  alongside physical `condition`. **Scan** resolves a label to an item and
  toggles it; per-row **Out**/**In** work without a camera. **Labels** prints a
  QR sheet — each encodes `RMTP-INV:<tag>`. **Move** and **sign-out** take a
  **quantity**: moving fewer than all *splits the line* (e.g. 6 SM58 in The Stage,
  move 1 to The Studio → a 5 line and a 1 line), and lines merge back on return.
- **Training** competencies come from `RMTP.TRAINING` in `config.js` — twelve
  space-specific categories (e.g. *The Stage (Sound)*, *Screen One*), each with a
  small competency list. Edit that one array to change what the team is signed off
  on. Each category has a **Sign off all**, and the sheet updates in place so
  ticking a box doesn't scroll you away. Sign-offs record who signed and when, and
  live on each person in the **Users** page.

### End-of-shift reports

Each event in **Advancing** can hold one or more end-of-shift reports (show crew,
get-out crew — each stamped with its author and time). They live in their own
`reports` collection keyed by `eventId`, not on the event record, so a night can
have several and deleting an event cascades to its reports. Open an event's
**Reports** button to file/read them. Filing and editing needs `report.edit`
(any signed-in user); deleting is limited to the report's author or an admin.
This is the "Shift Report" arm of your Reporting sitemap — the collection is
structured so a future unified Reporting view can roll up maintenance faults,
shift reports and incidents together.

Everything hangs off one global object, `RMTP`. There's no bundler, so the
script order in `index.html` matters: foundations → data → UI → views → router →
bootstrap.

### The data layer (`store.js`)

A small wrapper over localStorage. Each "collection" is an array of `{ id, ... }`
records under a namespaced key.

```js
RMTP.store.all('inventory');           // -> array
RMTP.store.find('inventory', id);      // -> record | undefined
RMTP.store.upsert('inventory', record);// insert or update by id
RMTP.store.remove('inventory', id);
RMTP.store.uid('inv');                 // cheap unique id
```

Keep this API and you can later swap the internals for real server calls without
touching the views (see below).

### Views

Each view is a function registered on `RMTP.views`:

```js
RMTP.views.myview = function (el, params) {
  el.innerHTML = '...';        // render into the content area
  // wire up event listeners against el.querySelector(...)
};
```

`params` are the extra hash segments, e.g. `#/procedures/sound/foh-dlive` gives
`params = ['sound', 'foh-dlive']`.

### Shared UI (`ui.js`)

- `RMTP.ui.esc(str)` — **always** wrap user data with this in templates.
- `RMTP.ui.icon(name, cls)` — inline SVG icon (see the `ICONS` map).
- `RMTP.ui.toast(msg, type)` — `type` is `ok | danger | info`.
- `RMTP.ui.modal({ title, body, footer, size })` — returns `{ root, close }`.
- `RMTP.ui.confirm(msg, opts)` — returns a `Promise<boolean>`.
- `RMTP.ui.pill(label, colourVar)` / `RMTP.ui.pageHeader(...)` / `RMTP.ui.empty(...)`.

---

## Common changes

**Re-skin the whole app** — edit the `:root` variables at the top of
`css/app.css`. Every colour resolves back to those (Tailwind classes point at
them too). Swap in Rich Mix brand colours there.

**Add a new section** — add an entry to `RMTP.nav` in `config.js`, create
`js/views/<id>.js` that registers `RMTP.views.<id>`, and add a `<script>` for it
in `index.html`. It appears in the sidebar and mobile tab bar automatically.

**Fill in a procedure** — open the section in the app and hit *Edit*, or edit the
`body` fields in `data/seed.js` (then Reset demo data). Bodies are plain text for
now; wire in a Markdown renderer if you want formatting.

**Change the icons** — add an SVG path to the `ICONS` map in `ui.js` and
reference it by key.

---

## Going to production

This is a single-device prototype. When you want real, shared data:

1. **Replace the CDN Tailwind** with the Tailwind CLI build (removes the console
   warning and lets you purge unused classes). Point it at the `js/` and
   `index.html` for class scanning.
2. **Swap `store.js` internals** for `fetch()` calls to a backend API, keeping
   the same method signatures so the views don't change.
3. **Add auth** if it's staff-only.
4. **Consider a small framework** (or keep it vanilla) once the view logic grows
   — the current structure maps cleanly onto components if you migrate.

---

*v0.1.0 — scaffold. Content and final styling to be added.*
