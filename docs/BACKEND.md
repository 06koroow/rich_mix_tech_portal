# Going to a backend — review & options

This is a working note for the next phase: moving the portal from a single-device
prototype to a real multi-user app. It covers (1) what in the current code is a
genuine inefficiency, (2) the exact seams that change when a backend lands, and
(3) backend options — leading with what's likely already paid for via Microsoft 365.

---

## 1. Where the current code is weak (and where it's fine)

**Fine for now, by design:**

- **`store.js` is a clean single seam.** Every read/write goes through
  `read/write/all/find/upsert/remove`. Nothing else should talk to storage —
  that's what makes the swap tractable.
- **Per-record API already matches REST.** `upsert(name, {id,...})` and
  `remove(name, id)` map 1:1 onto `PUT/POST /name/:id` and `DELETE /name/:id`.
- **Client-side filter/search is a full scan** (inventory, flagged kit, movement
  log). At the venue's scale — hundreds of items, not millions — this is a
  non-issue and not worth optimising yet.

**Real weaknesses to fix at backend time:**

1. **Whole-collection writes.** `write('inventory', [...])` serialises the entire
   array on every change. Locally that's invisible; over a network it's wasteful
   and races badly. The fix comes free with a per-record REST layer — call the
   single-item endpoint, not a bulk PUT.
2. **Synchronous storage assumption.** The whole app assumes `store.all()` returns
   data *now*. A network backend is async. This is the single biggest structural
   change — see §2.
3. **Files in localStorage.** `files.js` base64s PDFs/images into the ~5MB
   localStorage budget. It's capped and isolated, but it's a stopgap. `persist()`
   is deliberately the only write point so it can become an upload-returning-a-URL.
4. **Permissions are UX-only.** `auth.can()` hides buttons; it does not secure
   anything. Anyone can open devtools and write to localStorage. Real RBAC must be
   enforced **server-side**. The capability names (`inventory.manage`,
   `training.signoff`, …) are already a good policy vocabulary to port.
5. **Direct localStorage access outside `store.js`.** `auth.js` (current user) and
   `files.js` (blobs) read/write localStorage directly. Before the swap, route
   these through `store.js` too, so there's exactly one I/O layer to replace.
6. **Client-generated IDs** (`store.uid`). Fine if the server accepts client UUIDs;
   otherwise the create path must reconcile a server-assigned id.
7. **No concurrency model.** Two people editing the same fault = last-write-wins
   with no warning. A backend needs at least an `updatedAt` check (optimistic
   concurrency) on write.

---

## 2. The migration seam: make `store.js` async, add a sync layer

Two viable shapes:

**A. Async store (simplest correct).** Change `read/all/find/upsert/remove` to
return Promises and `await` at every call site. Honest but invasive — every view
touches the store synchronously today.

**B. Offline-first cache + background sync (recommended).** Keep the synchronous
`store` API backed by localStorage as a *cache*, and add a `sync` module that:
- on load, pulls each collection from the backend into the cache;
- on every `upsert/remove`, writes the cache immediately (instant UI) **and**
  queues a REST call;
- reconciles server responses (ids, `updatedAt`) back into the cache and re-renders.

Shape B preserves the current architecture almost entirely — views stay
synchronous, the app stays fast and works offline, and `store.js` gains a queue
and a `sync.pull()/push()`. It's more code than A but far less churn across the
views, and it's the right model for techs on flaky venue Wi-Fi.

Either way, `files.js.persist()` becomes an upload call and the record keeps the
same `{id,name,size,type}` metadata (add a `url`).

---

## 3. Backend options

### Likely already paid for — Microsoft 365

**SharePoint Lists via Microsoft Graph (recommended "included" path).**
- Each collection (`inventory`, `maintenance`, `advancing`, `users`, `signoffs`)
  becomes a **List**; records become list items. CRUD via Graph REST
  (`/sites/{id}/lists/{id}/items`).
- **Files** (tech-spec PDFs, fault photos) → a SharePoint **document library** or
  OneDrive via Graph upload; store the returned URL on the record. This kills the
  localStorage file problem outright.
- **Auth & RBAC** → **Entra ID** (MSAL.js) for SSO with work accounts; enforce
  the role vocabulary with Entra groups / SharePoint permissions so `can()`
  becomes a real gate, not a hint.
- **Pros:** no new subscription; data stays in-tenant (governance/IT will like
  this); SSO with existing staff accounts; audit trail built in.
- **Cons:** Graph auth + CORS setup is fiddly; API throttling; list schemas are
  rigid; local dev is less smooth than a Postgres. List view threshold (5,000
  items) is irrelevant at this scale.

**Power Platform / Dataverse.** Relational tables, proper row-level security, and
**Power Automate** for workflows — e.g. auto-notify the TM when kit is flagged, or
push a fault to Teams. Powerful and low-code, but Dataverse usually needs
per-user/per-app **Power Apps licensing** beyond base M365, so confirm entitlement
before committing.

**Azure Static Web Apps + Functions + Table/Cosmos.** Clean SPA hosting, serverless
API, Entra auth baked in. Not "included" but has a free tier; the most
conventional-web-app option if you want a real API rather than talking to Graph.

### Free / low-cost alternatives (fastest to a *correct* multi-user app)

- **Supabase** — hosted Postgres + Auth + Storage + **row-level security**.
  Generous free tier. RLS lets you enforce the exact role rules server-side with
  little code, and Storage handles files. This is the shortest path from the
  current prototype to a secure shared app, and the store-swap maps cleanly onto
  its REST/JS client. Worth prototyping shape B against even if you ultimately
  land on SharePoint for governance reasons.
- **Firebase** (Firestore + Auth + Storage) — similar, document-oriented.
- **Cloudflare** (D1 + Workers + R2) — cheap, fast, more assembly required.

---

## 4. Recommendation

If IT mandates staying in-tenant and SSO with staff accounts matters most:
**SharePoint Lists (data) + SharePoint library (files) + Entra ID (auth/roles)** —
it's already paid for and governed.

If developer velocity and clean, enforced RBAC + file storage matter most:
**Supabase**, using migration **shape B** (offline-first cache + sync) so the
existing synchronous views survive untouched.

**Progress so far (done in code):** `store.js` now has the adapter seam described
in §2 — a `LocalStorageAdapter` behind a small `{get,set,remove,keys}` interface,
an in-memory cache, and `setAdapter()` to swap it. `auth.js` and `files.js` no
longer touch `localStorage` directly; they route through `store` (`read/write` and
`readRaw/writeRaw/removeRaw`). So there is now exactly **one** place to implement a
backend. Accounts (email/password, sign-up → admin approval) and the capability
policy in `can()` are also in place as the vocabulary the server should enforce.

**Remaining step:** implement a `RemoteAdapter` (Supabase client or Graph calls)
plus a small `sync` module that hydrates the cache on `init()` and pushes writes,
and move password hashing + session to real server-side auth. No view changes
required.
