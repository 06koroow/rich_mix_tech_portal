# Hosting the app & connecting it to SharePoint

The lists exist. This is the rest: put the app on a real HTTPS address, let
staff sign in with their work accounts, and point it at your lists. The code is
already in the project (`js/graph.js`, `js/sync.js`) and stays dormant until you
fill in `js/graph-config.js` — so you can do this in stages without breaking the
local demo.

---

## 1. Host it (you can't run it from a file any more)

Adding Entra sign-in means the app needs a fixed HTTPS origin to register as a
redirect URI — double-clicking `index.html` (a `file://` URL) no longer works,
and **you can't just drop the files in a SharePoint library**: SharePoint Online
serves `.html` as a download, not a running app.

**Recommended: Azure Static Web Apps** (free tier, in your Microsoft tenant,
gives an HTTPS URL and plays nicely with Entra):

1. Put the project in a GitHub or Azure DevOps repo.
2. Azure Portal → *Create resource* → *Static Web App* → point it at the repo,
   build preset *Custom*, app location `/`, leave the API empty.
3. It deploys to a URL like `https://tech-portal.azurestaticapps.net`. That URL
   is your app's origin — note it for step 2.

Alternatives: **Azure Blob Storage static website** (also cheap/in-tenant), or a
static host like Netlify / Cloudflare Pages / GitHub Pages if in-tenant hosting
isn't required. Any of them work — you just need one stable HTTPS URL.

## 2. Register the app in Entra ID

Entra admin center → **App registrations → New registration**:

- Name: *Rich Mix Tech Portal*.
- Supported accounts: *Accounts in this organizational directory only*.
- Platform: **Single-page application (SPA)**, Redirect URI = your hosted URL
  from step 1 (exactly, including `https://`). Add `http://localhost:8000` too if
  you want to test locally with a dev server.
- Register, then note the **Application (client) ID** and **Directory (tenant) ID**.
- **API permissions → Add → Microsoft Graph → Delegated →** `User.Read` and
  `Sites.ReadWrite.All`. Click **Grant admin consent** (a Global/Cloud-App admin
  does this once).

`Sites.ReadWrite.All` lets a signed-in user read/write the lists **as
themselves**, so SharePoint's own list/site permissions still apply — that's how
you enforce "only trainers write to TrainingSignoffs" etc. (break inheritance on
a list, give a Trainers Entra group Contribute, everyone else Read). If you later
want the full capability matrix enforced airtight, put a thin Azure Function in
front with `Sites.Selected` — but start here.

## 3. Look up your IDs (Graph Explorer, ~5 minutes)

Open **Microsoft Graph Explorer** (aka.ms/ge), sign in, and run these GETs.

**Site ID** — replace host and site name with yours:

```
GET https://graph.microsoft.com/v1.0/sites/rich-mix.sharepoint.com:/sites/TechPortal
```

Copy the `id` from the response — it's a triple like
`rich-mix.sharepoint.com,<guid>,<guid>`. That whole string is your `siteId`.

**List IDs** — one GET returns all of them:

```
GET https://graph.microsoft.com/v1.0/sites/{siteId}/lists?$select=id,name
```

Match each `name` (Inventory, Maintenance, Events, ShiftReports, Users,
TrainingSignoffs, Procedures) to its `id` (a GUID).

**Drive ID** (only needed for file upload) — the TechFiles library:

```
GET https://graph.microsoft.com/v1.0/sites/{siteId}/drives?$select=id,name
```

Copy the `id` of the drive whose `name` is *TechFiles*.

## 4. Fill in `js/graph-config.js`

```js
RMTP.graphConfig = {
  clientId: 'xxxxxxxx-....',        // from step 2
  tenantId: 'yyyyyyyy-....',        // from step 2
  siteId:   'rich-mix.sharepoint.com,<guid>,<guid>',
  driveId:  'b!....',               // TechFiles drive (optional, for files)
  scopes: ['User.Read', 'Sites.ReadWrite.All'],
  lists: {
    inventory:   '<Inventory list GUID>',
    maintenance: '<Maintenance list GUID>',
    advancing:   '<Events list GUID>',
    reports:     '<ShiftReports list GUID>',
    users:       '<Users list GUID>',
    signoffs:    '<TrainingSignoffs list GUID>',
    procedures:  '<Procedures list GUID>',
  },
};
```

The moment `clientId` is set (and the MSAL script has loaded), the next reload
boots in **backend mode**: it signs the user in, pulls every list into the local
cache, and pushes changes back. Blank `clientId` = local demo mode, unchanged.

## 5. Sign-in ↔ accounts

On sign-in the app matches the Entra account's email to a row in the **Users**
list and makes them the current user. So each staff member needs a Users row
whose Email matches their work account. The seed import gave you
`alex@richmix.local` etc. — change those to real work emails (or add rows) before
go-live. Someone who signs in without a matching active row is told to ask an
admin (see the boot fallback in `app.js`, which you'll likely replace with a
proper "awaiting approval" screen).

Roles still come from the Users list (Admin/Trainer columns, position-driven as
before). If you'd rather have IT manage them, map them to Entra groups and derive
from `/me/memberOf` later — not required to launch.

## 6. Files

`js/graph.js` includes `uploadFile(path, blob)` which PUTs to the TechFiles
library and returns the file's URL. To switch file storage over, change
`files.persist()` in `js/files.js` to call `RMTP.graph.uploadFile(...)` and store
the returned URL on the record (the list columns `ImageUrl` / `TechSpecUrl`
already expect a URL). Until you do, files still go to localStorage as in the
prototype. This is the one piece left as a deliberate hook rather than auto-wired.

## How the sync works (so you can debug it)

- **Pull** (`sync.pullAll`) runs once at startup: GETs each list with
  `?expand=fields`, maps columns → records (see the mappers in `sync.js`), and
  writes them into the same localStorage cache the views already read. It also
  records each row's SharePoint id against its AppId.
- **Push** (`sync.wire`) wraps `store.upsert`/`store.remove`: after each local
  write it queues a Graph `POST`/`PATCH`/`DELETE`. The queue is persisted, runs
  sequentially, retries on failure, and honours `429 Retry-After` — so a write
  made offline goes up on the next reload. No view code changed.

## Gotchas checklist

- **Choice columns** must match the app's strings exactly (Condition `Good`/`Fair`/…,
  Status `in`/`out`, etc.) or writes 400.
- **Redirect URI** in Entra must match the hosted URL character-for-character.
- **AppId** is the key everything joins on — never renumber the imported rows.
- **Concurrency**: last-write-wins today. If two people edit the same fault, add
  an `If-Match` ETag check in `graph.updateItem` to be safe.
- **Throttling** is handled (429 backoff), but avoid a "sync everything now"
  button that fires hundreds of writes at once.
- This connection layer is a **tested-shape skeleton** — exercise it against your
  tenant and watch the browser console/network tab on first run.
