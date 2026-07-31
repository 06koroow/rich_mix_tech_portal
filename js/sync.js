/* ============================================================
   sync.js — keeps the local cache and SharePoint in step
   ------------------------------------------------------------
   Strategy (the "shape B" from docs/BACKEND.md): localStorage
   stays the thing the views read (so they stay synchronous and
   the app works offline), and this module (a) pulls every list
   into the cache on startup, and (b) pushes local writes back to
   SharePoint via a retrying queue. It wires itself by wrapping
   store.upsert / store.remove, so NO view changes are needed.

   Each record carries your AppId; SharePoint's numeric item id is
   held in a side-map so updates/deletes know which row to hit.

   Column names below MUST match the SharePoint lists exactly
   (they line up with the import workbook). Skeleton — test
   against your tenant before relying on it.
   ============================================================ */
RMTP.sync = (function () {
  const store = RMTP.store, graph = RMTP.graph;
  const lists = () => (RMTP.graphConfig || {}).lists || {};

  // ---- AppId -> SharePoint item id, per collection (persisted) ----
  let idmap = {};
  function loadIdmap() { try { idmap = JSON.parse(store.readRaw('spidmap', '{}')); } catch (e) { idmap = {}; } }
  function saveIdmap() { store.writeRaw('spidmap', JSON.stringify(idmap)); }
  function setSp(coll, appId, spId) { (idmap[coll] = idmap[coll] || {})[appId] = spId; saveIdmap(); }
  function getSp(coll, appId) { return (idmap[coll] || {})[appId]; }

  const J = (v) => JSON.stringify(v || []);
  const P = (s) => { try { return JSON.parse(s || '[]'); } catch (e) { return []; } };
  const bool = (v) => v === true || v === 'true' || v === 'Yes' || v === 1;
  const dOnly = (v) => (v ? String(v).slice(0, 10) : '');

  // ---- record <-> SharePoint fields, per collection ----
  const mappers = {
    inventory: {
      toFields: (r) => ({ Title: r.name || '', AppId: r.id, Tag: r.tag || '', Category: r.category || '', Location: r.location || '', Quantity: Number(r.qty) || 0, Condition: r.condition || '', Status: r.status || 'in', HeldBy: r.heldBy || '', Notes: r.notes || '', MovementsJson: J(r.movements) }),
      fromItem: (f) => ({ id: f.AppId, name: f.Title, tag: f.Tag, category: f.Category, location: f.Location, qty: Number(f.Quantity) || 0, condition: f.Condition, status: f.Status || 'in', heldBy: f.HeldBy || '', outAt: '', notes: f.Notes || '', movements: P(f.MovementsJson) }),
    },
    maintenance: {
      toFields: (r) => ({ Title: r.equipment || '', AppId: r.id, Category: r.category || '', Priority: r.priority || '', Status: r.status || 'Open', Space: r.space || '', Description: r.description || '', ItemAppId: r.itemId || '', ItemTag: r.itemTag || '', ItemName: r.itemName || '', ImageUrl: (r.image && r.image.url) || '', ReportedBy: r.reportedBy || '', Resolution: r.resolution || '', ResolvedBy: r.resolvedBy || '', ResolvedAt: r.resolvedAt || '' }),
      fromItem: (f) => ({ id: f.AppId, equipment: f.Title, category: f.Category, priority: f.Priority, status: f.Status, space: f.Space || '', description: f.Description || '', itemId: f.ItemAppId || '', itemTag: f.ItemTag || '', itemName: f.ItemName || '', image: f.ImageUrl ? { url: f.ImageUrl, name: 'photo' } : null, reportedBy: f.ReportedBy || '', resolution: f.Resolution || '', resolvedBy: f.ResolvedBy || '', resolvedAt: f.ResolvedAt || '', createdAt: f.Created ? Date.parse(f.Created) : Date.now() }),
    },
    advancing: {
      toFields: (r) => ({ Title: r.name || '', AppId: r.id, Category: r.category || '', Space: r.space || '', Date: r.date || '', Status: r.status || '', StartTime: r.startTime || '', FinishTime: r.finishTime || '', Soundcheck: r.soundcheck || '', Doors: r.doors || '', Curfew: r.curfew || '', TechUserAppId: r.techUserId || '', ClientContact: r.clientContact || '', GuestEngineer: !!r.guestEngineer, TechInfo: r.techInfo || '', TechSpecUrl: (r.techSpec && r.techSpec.url) || '', TechSpecName: (r.techSpec && r.techSpec.name) || '' }),
      fromItem: (f) => ({ id: f.AppId, name: f.Title, category: f.Category, space: f.Space, date: dOnly(f.Date), status: f.Status, startTime: f.StartTime || '', finishTime: f.FinishTime || '', soundcheck: f.Soundcheck || '', doors: f.Doors || '', curfew: f.Curfew || '', techUserId: f.TechUserAppId || '', clientContact: f.ClientContact || '', guestEngineer: bool(f.GuestEngineer), techInfo: f.TechInfo || '', techSpec: f.TechSpecUrl ? { url: f.TechSpecUrl, name: f.TechSpecName || 'Tech spec', size: 0 } : null, checklist: {} }),
    },
    reports: {
      toFields: (r) => ({ Title: r.crew || 'Report', AppId: r.id, EventAppId: r.eventId || '', ShiftDate: r.shiftDate || '', Summary: r.summary || '', Issues: r.issues || '', FollowUp: r.followUp || '', Author: r.author || '' }),
      fromItem: (f) => ({ id: f.AppId, crew: f.Title, eventId: f.EventAppId || '', shiftDate: dOnly(f.ShiftDate), summary: f.Summary || '', issues: f.Issues || '', followUp: f.FollowUp || '', author: f.Author || '', authorId: '', submittedAt: f.Created || '' }),
    },
    users: {
      toFields: (r) => ({ Title: ((r.firstName || '') + ' ' + (r.lastName || '')).trim(), AppId: r.id, FirstName: r.firstName || '', LastName: r.lastName || '', Email: r.email || '', Position: r.position || '', Discipline: r.discipline || '', Status: r.status || 'active', Admin: !!r.admin, Trainer: !!r.trainer }),
      fromItem: (f) => ({ id: f.AppId, firstName: f.FirstName || '', lastName: f.LastName || '', email: f.Email || '', position: f.Position || '', discipline: f.Discipline || '', status: f.Status || 'active', admin: bool(f.Admin), trainer: bool(f.Trainer) }),
    },
    signoffs: {
      toFields: (r) => ({ Title: r.compLabel || r.compId || '', AppId: r.id, UserAppId: r.userId || '', CompId: r.compId || '', CompLabel: r.compLabel || '', SignedBy: r.signedBy || '' }),
      fromItem: (f) => ({ id: f.AppId, userId: f.UserAppId || '', compId: f.CompId || '', compLabel: f.CompLabel || '', signedBy: f.SignedBy || '', date: f.Created || '' }),
    },
    // procedures handled specially (grouped in-app, one row per SOP in SharePoint)
  };

  // ---- pull ----
  async function pullCollection(coll) {
    const items = await graph.listItems(lists()[coll]);
    if (coll === 'procedures') return pullProcedures(items);
    const m = mappers[coll]; const records = [];
    items.forEach((it) => { const f = it.fields || {}; if (!f.AppId) return; setSp(coll, f.AppId, it.id); records.push(m.fromItem(f)); });
    store.write(coll, records);
  }
  function pullProcedures(items) {
    const groups = {};
    items.forEach((it) => {
      const f = it.fields || {}; if (!f.AppId) return; setSp('procedures', f.AppId, it.id);
      const key = f.Category || 'Other';
      const g = groups[key] || (groups[key] = { id: RMTP.slug(key), name: key, icon: f.Icon || 'book', items: [] });
      g.items.push({ id: f.AppId, title: f.Title, body: f.Body || '', updated: '' });
    });
    store.write('procedures', Object.keys(groups).map((k) => groups[k]));
  }
  async function pullAll() {
    loadIdmap();
    const order = ['users', 'inventory', 'maintenance', 'advancing', 'reports', 'signoffs', 'procedures'];
    for (let i = 0; i < order.length; i++) { if (lists()[order[i]]) await pullCollection(order[i]); }
  }

  // ---- push queue (persisted, retrying, 429-aware) ----
  let queue = [], draining = false;
  function loadQueue() { try { queue = JSON.parse(store.readRaw('spqueue', '[]')); } catch (e) { queue = []; } }
  function saveQueue() { store.writeRaw('spqueue', JSON.stringify(queue)); }
  function enqueue(op) { queue.push(op); saveQueue(); drain(); }
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  async function run(op) {
    const listId = lists()[op.coll]; if (!listId) return;
    if (op.type === 'delete') { const sp = getSp(op.coll, op.appId); if (sp) await graph.deleteItem(listId, sp); return; }
    const sp = getSp(op.coll, op.appId);
    if (sp) { await graph.updateItem(listId, sp, op.fields); }
    else { const made = await graph.createItem(listId, op.fields); if (made && made.id) setSp(op.coll, op.appId, made.id); }
  }
  async function drain() {
    if (draining || !queue.length) return;
    draining = true;
    while (queue.length) {
      try { await run(queue[0]); queue.shift(); saveQueue(); }
      catch (e) {
        if (e && e.retryAfter) { await sleep(e.retryAfter * 1000); continue; }
        console.error('[sync] push failed — will retry on next change/reload', e); break;
      }
    }
    draining = false;
  }

  // procedures: on any change, upsert each SOP row by AppId
  function pushProcedures() {
    store.all('procedures').forEach((g) => (g.items || []).forEach((item) =>
      enqueue({ coll: 'procedures', appId: item.id, fields: { Title: item.title || '', AppId: item.id, Category: g.name || '', Body: item.body || '', Icon: g.icon || '' } })));
  }

  // ---- wire: intercept writes so views push transparently ----
  function wire() {
    loadIdmap(); loadQueue(); if (queue.length) drain();
    const origUpsert = store.upsert, origRemove = store.remove;
    store.upsert = function (name, record) {
      const res = origUpsert(name, record);
      if (name === 'procedures') { pushProcedures(); return res; }
      const m = mappers[name];
      if (m) enqueue({ coll: name, appId: record.id, fields: m.toFields(record) });
      return res;
    };
    store.remove = function (name, id) {
      const res = origRemove(name, id);
      if (mappers[name] || name === 'procedures') enqueue({ coll: name, appId: id, type: 'delete' });
      return res;
    };
  }

  return { pullAll, wire, pullCollection };
})();
