/* ============================================================
   views/inventory.js — equipment tracking + QR + spaces + flags
   ------------------------------------------------------------
   Location is a Space or a Store; filtering + movement history
   track it. Custody (status in/out, heldBy) is a separate axis,
   and sign-out can record the destination space. "Flagged" kit
   (condition below Fair, or linked to an unresolved fault) is
   struck through and may only be moved to a Store. Manage actions
   are admin-gated; move/sign are open to any signed-in user.
   ============================================================ */
RMTP.views.inventory = function (el) {
  const ui = RMTP.ui, store = RMTP.store, qr = RMTP.qr, auth = RMTP.auth;

  const canManage = auth.can('inventory.manage');
  const canMove = auth.can('inventory.move');
  const me = auth.current();
  const isAdmin = !!(me && me.admin);

  const CATEGORIES = ['Microphones', 'DI Boxes', 'Cables', 'Speakers', 'IEM', 'Stands', 'Lighting', 'AV', 'Other'];
  const condColour = { 'Good': 'var(--ok)', 'Fair': 'var(--accent)', 'Damaged': 'var(--danger)', 'Out of service': 'var(--danger)' };

  let query = '';
  let spaceFilter = '';

  // Which items have an unresolved fault (recomputed each render).
  let faultItemIds = new Set();
  function refreshFaults() {
    faultItemIds = new Set(store.all('maintenance').filter((f) => f.status !== 'Resolved' && f.itemId).map((f) => f.itemId));
  }
  function isFlagged(r) { return RMTP.isPoorCondition(r.condition) || faultItemIds.has(r.id); }
  function flagReason(r) {
    const out = [];
    if (RMTP.isPoorCondition(r.condition)) out.push(r.condition);
    if (faultItemIds.has(r.id)) out.push('open fault');
    return out.join(' \u00b7 ');
  }

  el.innerHTML =
    '<div class="view-enter">' +
      ui.pageHeader('Inventory', 'Equipment',
        (canMove ? '<button id="scan-item" class="btn btn-primary">' + ui.icon('search', 'w-4 h-4') + 'Scan</button>' : '') +
        (canManage ? '<button id="print-labels" class="btn btn-ghost">' + ui.icon('print', 'w-4 h-4') + 'Labels</button>' : '') +
        (canManage ? '<button id="add-item" class="btn btn-ghost">' + ui.icon('plus', 'w-4 h-4') + 'Add</button>' : '')) +
      '<div class="relative mb-4 max-w-md">' +
        '<span class="absolute left-3 top-1/2 -translate-y-1/2 text-muted">' + ui.icon('search', 'w-4 h-4') + '</span>' +
        '<input id="inv-search" class="field !pl-10" placeholder="Search name, tag, location, holder\u2026" />' +
      '</div>' +
      '<div id="inv-filters" class="flex flex-wrap gap-2 mb-5"></div>' +
      '<div id="inv-list"></div>' +
      '<div id="inv-moves" class="mt-8"></div>' +
    '</div>';

  const addBtn = el.querySelector('#add-item');
  if (addBtn) addBtn.addEventListener('click', () => openForm());
  const scanBtn = el.querySelector('#scan-item');
  if (scanBtn) scanBtn.addEventListener('click', handleScan);
  const labelsBtn = el.querySelector('#print-labels');
  if (labelsBtn) labelsBtn.addEventListener('click', () => qr.labelPreview(store.all('inventory')));
  el.querySelector('#inv-search').addEventListener('input', (e) => { query = e.target.value.toLowerCase().trim(); render(); });

  render();

  function inSpaceFilter(r) {
    if (!spaceFilter) return true;
    if (spaceFilter === 'store') return !RMTP.isSpace(r.location);
    return r.location === spaceFilter;
  }
  function matches(r) {
    const hay = (r.name + ' ' + r.tag + ' ' + r.location + ' ' + r.category + ' ' + (r.heldBy || '')).toLowerCase();
    return (!query || hay.includes(query)) && inSpaceFilter(r);
  }

  function render() {
    refreshFaults();
    renderFilters();
    renderList();
    renderMoves();
  }

  function renderFilters() {
    const all = store.all('inventory');
    const count = (pred) => all.filter(pred).length;
    const chips = [{ id: '', label: 'All', n: all.length }]
      .concat(RMTP.SPACES.map((s) => ({ id: s, label: s, n: count((r) => r.location === s) })))
      .concat([{ id: 'store', label: 'In store', n: count((r) => !RMTP.isSpace(r.location)) }]);
    el.querySelector('#inv-filters').innerHTML = chips.map((c) =>
      '<button data-filter="' + ui.esc(c.id) + '" class="px-3 py-1.5 rounded-lg text-sm font-medium border ' +
        (spaceFilter === c.id ? 'bg-panel2 border-accent text-ink' : 'border-line text-muted hover:text-ink') + '">' +
        ui.esc(c.label) + ' <span class="tabular text-xs opacity-70">' + c.n + '</span></button>'
    ).join('');
    el.querySelectorAll('#inv-filters [data-filter]').forEach((b) => {
      b.addEventListener('click', () => { spaceFilter = b.getAttribute('data-filter'); render(); });
    });
  }

  function renderList() {
    const all = store.all('inventory');
    const rows = all.filter(matches).sort((a, b) =>
      (a.status === 'out' ? 0 : 1) - (b.status === 'out' ? 0 : 1) ||
      a.category.localeCompare(b.category) || a.name.localeCompare(b.name));
    const outCount = all.filter((r) => r.status === 'out').length;

    const list = el.querySelector('#inv-list');
    if (!rows.length) {
      list.innerHTML = ui.empty('box', (query || spaceFilter) ? 'No matches' : 'No equipment yet',
        (query || spaceFilter) ? 'Try a different search or filter.' : 'Add your first asset with \u201cAdd\u201d.');
      return;
    }
    list.innerHTML =
      (outCount ? '<p class="text-xs text-muted mb-3">' + ui.pill(outCount + ' signed out', 'var(--info)') + '</p>' : '') +
      '<div class="panel divide-y divide-line overflow-hidden">' +
        rows.map((r) => {
          const isOut = r.status === 'out';
          const flagged = isFlagged(r);
          const locPill = RMTP.isSpace(r.location) ? ui.pill(r.location, 'var(--accent)') : '';
          return '<div class="flex items-center gap-3 px-4 py-3">' +
            '<button data-open="' + r.id + '" class="min-w-0 flex-1 text-left group">' +
              '<span class="flex items-center gap-2">' +
                '<span class="tabular text-xs text-accent hidden sm:inline">' + ui.esc(r.tag) + '</span>' +
                '<span class="font-medium truncate group-hover:text-accent transition-colors ' + (flagged ? 'line-through text-muted' : '') + '">' + ui.esc(r.name) + '</span>' +
                (flagged ? ui.pill('Flagged', 'var(--danger)') : '') +
              '</span>' +
              '<span class="block text-xs text-muted mt-0.5 truncate">' + ui.esc(r.category) + ' \u00b7 ' + ui.esc(r.location || '\u2014') +
                (flagged ? ' \u00b7 <span style="color:var(--danger)">' + ui.esc(flagReason(r)) + '</span>' : '') +
                (isOut && r.heldBy ? ' \u00b7 <span class="text-info">held by ' + ui.esc(r.heldBy) + '</span>' : '') + '</span>' +
            '</button>' +
            '<div class="shrink-0 hidden md:flex items-center gap-1.5">' + locPill +
              (isOut ? ui.pill('Out', 'var(--info)') : ui.pill(r.condition, condColour[r.condition] || 'var(--muted)')) + '</div>' +
            '<div class="w-10 text-right shrink-0 hidden sm:block"><span class="tabular font-semibold">' + Number(r.qty || 0) + '</span></div>' +
            '<div class="flex gap-1 shrink-0">' +
              (canMove
                ? (isOut
                    ? '<button data-in="' + r.id + '" class="btn btn-ghost !px-2.5 !py-1.5 text-xs" title="Sign back in">' + ui.icon('check', 'w-4 h-4') + 'In</button>'
                    : '<button data-out="' + r.id + '" class="btn btn-ghost !px-2.5 !py-1.5 text-xs" title="Sign out">' + ui.icon('arrowR', 'w-4 h-4') + 'Out</button>')
                : '') +
              (canManage ? '<button data-edit="' + r.id + '" class="btn btn-ghost !p-2 hidden sm:inline-flex" title="Edit">' + ui.icon('pen', 'w-4 h-4') + '</button>' : '') +
            '</div>' +
          '</div>';
        }).join('') +
      '</div>' +
      '<p class="text-xs text-muted mt-3 tabular">' + rows.length + ' of ' + all.length + ' items</p>';

    rows.forEach((r) => {
      const q = (sel) => list.querySelector(sel);
      const eOpen = q('[data-open="' + r.id + '"]'); if (eOpen) eOpen.addEventListener('click', () => openDetail(r));
      const eOut = q('[data-out="' + r.id + '"]'); if (eOut) eOut.addEventListener('click', () => signOut(r));
      const eIn = q('[data-in="' + r.id + '"]'); if (eIn) eIn.addEventListener('click', () => signIn(r));
      const eEdit = q('[data-edit="' + r.id + '"]'); if (eEdit) eEdit.addEventListener('click', () => openForm(r));
    });
  }

  function renderMoves() {
    const moves = RMTP.recentMovements(8);
    const box = el.querySelector('#inv-moves');
    if (!moves.length) { box.innerHTML = ''; return; }
    box.innerHTML =
      '<p class="eyebrow mb-2">Recent movements</p>' +
      '<div class="panel divide-y divide-line overflow-hidden">' +
        moves.map((mv) =>
          '<div class="px-4 py-2.5 text-sm flex items-center justify-between gap-3">' +
            '<span class="min-w-0 truncate"><span class="font-medium">' + ui.esc(mv.name) + '</span> ' +
              '<span class="text-muted">' + ui.esc(mv.from || '\u2014') + ' \u2192 ' + ui.esc(mv.to) + '</span></span>' +
            '<span class="text-[11px] text-muted shrink-0">' + (mv.at ? ui.timeAgo(new Date(mv.at).getTime()) : '') + (mv.by ? ' \u00b7 ' + ui.esc(mv.by) : '') + '</span>' +
          '</div>').join('') +
      '</div>';
  }

  /* ---- Item detail ---- */
  function openDetail(item) {
    const fresh = store.find('inventory', item.id) || item;
    const isOut = fresh.status === 'out';
    const flagged = isFlagged(fresh);
    const moves = (fresh.movements || []).slice().reverse();
    const info = [
      ['Tag', fresh.tag], ['Category', fresh.category], ['Location', fresh.location || '\u2014'],
      ['Condition', fresh.condition], ['Quantity', String(fresh.qty != null ? fresh.qty : '')],
      ['Custody', isOut ? ('Out' + (fresh.heldBy ? ' \u00b7 ' + fresh.heldBy : '')) : 'In'],
    ].map(([k, v]) => '<div><dt class="eyebrow">' + ui.esc(k) + '</dt><dd class="text-sm mt-0.5">' + ui.esc(v) + '</dd></div>').join('');

    const history = moves.length
      ? '<div class="panel divide-y divide-line overflow-hidden">' + moves.map((mv) =>
          '<div class="px-3 py-2 text-sm flex items-center justify-between gap-3">' +
            '<span>' + ui.esc(mv.from || '\u2014') + ' <span class="text-muted">\u2192</span> <span class="font-medium">' + ui.esc(mv.to) + '</span>' +
              (mv.note ? ' <span class="text-muted">\u00b7 ' + ui.esc(mv.note) + '</span>' : '') + '</span>' +
            '<span class="text-[11px] text-muted shrink-0">' + (mv.at ? ui.timeAgo(new Date(mv.at).getTime()) : '') + (mv.by ? ' \u00b7 ' + ui.esc(mv.by) : '') + '</span>' +
          '</div>').join('') + '</div>'
      : '<p class="text-sm text-muted">No movements logged yet.</p>';

    const m = ui.modal({
      title: fresh.name,
      size: 'md:max-w-lg',
      body:
        (flagged ? '<div class="panel p-3 mb-4 text-sm" style="border-color:color-mix(in srgb,var(--danger) 40%,var(--line));color:var(--danger)">' +
          ui.icon('alert', 'w-4 h-4 inline mr-1') + 'Flagged (' + ui.esc(flagReason(fresh)) + '). Can only be moved to a Store.</div>' : '') +
        '<dl class="grid grid-cols-2 sm:grid-cols-3 gap-x-4 gap-y-3 mb-5">' + info + '</dl>' +
        (fresh.notes ? '<p class="text-sm text-ink/80 mb-5">' + ui.esc(fresh.notes) + '</p>' : '') +
        '<p class="eyebrow mb-2">Movement history</p>' + history,
      footer:
        (canMove ? '<button data-move class="btn btn-ghost mr-auto">' + ui.icon('pin', 'w-4 h-4') + 'Move</button>' : '') +
        (canMove ? '<button data-sign class="btn btn-ghost">' + ui.icon(isOut ? 'check' : 'arrowR', 'w-4 h-4') + (isOut ? 'Sign in' : 'Sign out') + '</button>' : '') +
        (canManage ? '<button data-edit class="btn btn-ghost">' + ui.icon('pen', 'w-4 h-4') + 'Edit</button>' : '') +
        (canManage ? '<button data-del class="btn btn-danger">' + ui.icon('trash', 'w-4 h-4') + 'Delete</button>' : ''),
    });
    const back = () => { const f = store.find('inventory', item.id); if (f) openDetail(f); };
    const mv = m.root.querySelector('[data-move]'); if (mv) mv.addEventListener('click', () => { m.close(); moveItem(fresh, back); });
    const sg = m.root.querySelector('[data-sign]'); if (sg) sg.addEventListener('click', () => { m.close(); (isOut ? signIn : signOut)(fresh, back); });
    const ed = m.root.querySelector('[data-edit]'); if (ed) ed.addEventListener('click', () => { m.close(); openForm(fresh); });
    const dl = m.root.querySelector('[data-del]'); if (dl) dl.addEventListener('click', () => { m.close(); del(fresh); });
  }

  function actor() { return auth.displayName(auth.current()) || 'Unknown'; }
  function qtyOf(x) { return Number(x.qty) || 0; }
  // An "in" line at the same place with the same tag/condition to merge into.
  function findMergeTarget(tag, location, condition, excludeId) {
    return store.all('inventory').find((x) => x.id !== excludeId && x.status === 'in' && x.tag === tag && x.location === location && x.condition === condition);
  }

  /* ---- Move (quantity-aware; splits a line if moving fewer than all;
     merges into an existing line at the destination; flagged=Store only) ---- */
  function moveItem(item, after) {
    const flagged = isFlagged(item);
    const maxQty = qtyOf(item) || 1;
    const m = ui.modal({
      title: 'Move ' + item.name,
      size: 'md:max-w-sm',
      body:
        '<p class="text-sm mb-4">' + maxQty + ' in <span class="font-medium">' + ui.esc(item.location || '\u2014') + '</span></p>' +
        (flagged ? '<p class="text-xs mb-3" style="color:var(--danger)">Flagged kit \u2014 can only move to a Store.</p>' : '') +
        (maxQty > 1 ? '<label class="block text-sm font-medium mb-2">Quantity to move</label>' +
          '<input id="mv-qty" type="number" min="1" max="' + maxQty + '" value="1" class="field tabular mb-4" />' : '') +
        '<label class="block text-sm font-medium mb-2">Move to</label>' + locationSelect('mv-loc', item.location, { storeOnly: flagged }),
      footer:
        '<button class="btn btn-ghost" data-cancel>Cancel</button>' +
        '<button class="btn btn-primary" data-ok data-primary>' + ui.icon('pin', 'w-4 h-4') + 'Move</button>',
    });
    m.root.querySelector('[data-cancel]').addEventListener('click', () => { m.close(); if (after) after(); });
    m.root.querySelector('[data-ok]').addEventListener('click', () => {
      const to = m.root.querySelector('#mv-loc').value;
      const qtyEl = m.root.querySelector('#mv-qty');
      const qty = qtyEl ? Math.max(1, Math.min(parseInt(qtyEl.value, 10) || 1, maxQty)) : maxQty;
      if (to === item.location) { ui.toast('Already there', 'info'); return; }
      if (flagged && RMTP.isSpace(to)) { ui.toast('Flagged kit can only go to a Store', 'danger'); return; }
      moveQty(item, qty, to);
      m.close(); ui.toast((qty < maxQty ? qty + ' \u00d7 ' : '') + item.name + ' moved to ' + to, 'ok'); render(); if (after) after();
    });
  }

  function moveQty(item, qty, toLocation) {
    qty = Math.max(1, Math.min(qty, qtyOf(item) || 1));
    const at = new Date().toISOString(), by = actor();
    const target = findMergeTarget(item.tag, toLocation, item.condition, item.id);
    if (qty >= qtyOf(item)) {
      // whole line moves — merge into destination if one exists, else relocate
      if (target) {
        store.upsert('inventory', Object.assign({}, target, { qty: qtyOf(target) + qtyOf(item), movements: (target.movements || []).concat({ from: item.location || '', to: toLocation, at, by, note: 'Merged ' + qtyOf(item) }) }));
        store.remove('inventory', item.id);
      } else {
        store.upsert('inventory', Object.assign({}, item, { location: toLocation, movements: (item.movements || []).concat({ from: item.location || '', to: toLocation, at, by, note: '' }) }));
      }
    } else {
      // split: reduce source, add to (or create) destination line
      store.upsert('inventory', Object.assign({}, item, { qty: qtyOf(item) - qty, movements: (item.movements || []).concat({ from: item.location || '', to: toLocation, at, by, note: 'Moved ' + qty + ' to ' + toLocation }) }));
      if (target) {
        store.upsert('inventory', Object.assign({}, target, { qty: qtyOf(target) + qty, movements: (target.movements || []).concat({ from: item.location || '', to: toLocation, at, by, note: '+' + qty }) }));
      } else {
        store.upsert('inventory', Object.assign({}, item, { id: store.uid('inv'), qty: qty, location: toLocation, status: 'in', heldBy: '', outAt: '', movements: [{ from: item.location || '', to: toLocation, at, by, note: 'Split ' + qty + ' from ' + (item.location || '\u2014') }] }));
      }
    }
  }

  /* ---- Scan → resolve item(s) → toggle custody ---- */
  async function handleScan() {
    const decoded = await qr.scan({ title: 'Scan kit' });
    if (!decoded) return;
    const parsed = qr.parse(decoded);
    if (!parsed || parsed.kind !== 'inventory') { ui.toast('Unrecognised code', 'danger'); return; }
    const tag = parsed.value.toLowerCase();
    const lines = store.all('inventory').filter((r) => String(r.tag || '').toLowerCase() === tag);
    if (!lines.length) { ui.toast('No item with tag \u201c' + parsed.value + '\u201d', 'danger'); return; }
    if (lines.length === 1) { const it = lines[0]; if (it.status === 'out') signIn(it); else signOut(it); return; }
    pickLine(lines, (it) => { if (it.status === 'out') signIn(it); else signOut(it); });
  }

  function pickLine(lines, cb) {
    const m = ui.modal({
      title: 'Which one?',
      size: 'md:max-w-sm',
      body:
        '<p class="text-sm text-muted mb-3">That tag has several lines \u2014 pick one:</p>' +
        '<div class="grid gap-2">' + lines.map((l) =>
          '<button data-pick="' + l.id + '" class="panel p-3 text-left hover:border-accent transition-colors flex items-center justify-between gap-3">' +
            '<span class="min-w-0"><span class="font-medium">' + ui.esc(l.name) + '</span> ' +
              '<span class="text-xs text-muted">' + ui.esc(l.location || '\u2014') + '</span></span>' +
            '<span class="text-xs shrink-0">' + (l.status === 'out' ? ui.pill('Out', 'var(--info)') : 'qty ' + qtyOf(l)) + '</span>' +
          '</button>').join('') + '</div>',
      footer: '<button class="btn btn-ghost" data-cancel>Cancel</button>',
    });
    m.root.querySelector('[data-cancel]').addEventListener('click', m.close);
    lines.forEach((l) => { const b = m.root.querySelector('[data-pick="' + l.id + '"]'); if (b) b.addEventListener('click', () => { m.close(); cb(store.find('inventory', l.id) || l); }); });
  }

  /* ---- Sign out: who + quantity + destination space ---- */
  function signOut(item, after) {
    const prefs = store.read('prefs', {}) || {};
    const defaultHolder = prefs.lastHolder || auth.displayName(auth.current());
    const flagged = isFlagged(item);
    const maxQty = qtyOf(item) || 1;
    const m = ui.modal({
      title: 'Sign out',
      size: 'md:max-w-sm',
      body:
        '<p class="text-sm mb-4"><span class="font-medium">' + ui.esc(item.name) + '</span> ' +
          '<span class="tabular text-xs text-accent">' + ui.esc(item.tag) + '</span> \u00b7 ' + maxQty + ' available</p>' +
        '<label class="block text-sm font-medium mb-2">Who\u2019s taking it?</label>' +
        '<input id="so-holder" class="field mb-4" value="' + ui.esc(defaultHolder || '') + '" placeholder="Name" autocomplete="off" />' +
        (maxQty > 1 ? '<label class="block text-sm font-medium mb-2">Quantity</label>' +
          '<input id="so-qty" type="number" min="1" max="' + maxQty + '" value="1" class="field tabular mb-4" />' : '') +
        '<label class="block text-sm font-medium mb-2">Going to</label>' +
        (flagged ? '<p class="text-xs mb-2" style="color:var(--danger)">Flagged kit \u2014 Store only.</p>' : '') +
        locationSelect('so-space', '', { blank: '\u2014 Keep in ' + (item.location || 'place'), storeOnly: flagged }),
      footer:
        '<button class="btn btn-ghost" data-cancel>Cancel</button>' +
        '<button class="btn btn-primary" data-ok data-primary>' + ui.icon('arrowR', 'w-4 h-4') + 'Sign out</button>',
    });
    m.root.querySelector('[data-cancel]').addEventListener('click', () => { m.close(); if (after) after(); });
    m.root.querySelector('[data-ok]').addEventListener('click', () => {
      const holder = m.root.querySelector('#so-holder').value.trim();
      if (!holder) { ui.toast('Enter a name', 'danger'); return; }
      const qtyEl = m.root.querySelector('#so-qty');
      const qty = qtyEl ? Math.max(1, Math.min(parseInt(qtyEl.value, 10) || 1, maxQty)) : maxQty;
      const dest = m.root.querySelector('#so-space').value;
      if (dest && dest !== item.location && flagged && RMTP.isSpace(dest)) { ui.toast('Flagged kit can only go to a Store', 'danger'); return; }
      signOutQty(item, qty, holder, dest);
      store.write('prefs', Object.assign({}, prefs, { lastHolder: holder }));
      m.close();
      ui.toast((qty < maxQty ? qty + ' \u00d7 ' : '') + item.name + ' signed out to ' + holder + (dest && dest !== item.location ? ' \u00b7 ' + dest : ''), 'ok');
      render(); if (after) after();
    });
  }

  function signOutQty(item, qty, holder, dest) {
    const at = new Date().toISOString(), by = actor();
    const moving = dest && dest !== item.location;
    const loc = moving ? dest : item.location;
    const note = 'Signed out ' + qty + ' to ' + holder;
    if (qty >= qtyOf(item)) {
      store.upsert('inventory', Object.assign({}, item, {
        status: 'out', heldBy: holder, outAt: at, location: loc,
        movements: moving ? (item.movements || []).concat({ from: item.location || '', to: dest, at, by, note }) : (item.movements || []),
      }));
    } else {
      // source stays in at its location; a new out line carries the moved qty
      store.upsert('inventory', Object.assign({}, item, { qty: qtyOf(item) - qty }));
      store.upsert('inventory', Object.assign({}, item, {
        id: store.uid('inv'), qty: qty, status: 'out', heldBy: holder, outAt: at, location: loc,
        movements: [{ from: item.location || '', to: loc, at, by, note }],
      }));
    }
  }

  async function signIn(item, after) {
    if (isFlagged(item) && !isAdmin) { ui.toast('Only an admin can return reported kit to use \u2014 resolve it in Maintenance', 'danger'); if (after) after(); return; }
    const ok = await ui.confirm('Sign \u201c' + item.name + '\u201d back in' + (item.heldBy ? ' from ' + item.heldBy : '') + '?',
      { title: 'Sign back in', confirmLabel: 'Sign in' });
    if (!ok) { if (after) after(); return; }
    // Merge back into an in-line at the same place if there is one, else flip in.
    const target = findMergeTarget(item.tag, item.location, item.condition, item.id);
    if (target) {
      store.upsert('inventory', Object.assign({}, target, { qty: qtyOf(target) + qtyOf(item), movements: (target.movements || []).concat({ from: item.location || '', to: item.location || '', at: new Date().toISOString(), by: actor(), note: 'Signed in ' + qtyOf(item) }) }));
      store.remove('inventory', item.id);
    } else {
      store.upsert('inventory', Object.assign({}, item, { status: 'in', heldBy: '', outAt: '' }));
    }
    ui.toast(item.name + ' back in', 'ok'); render(); if (after) after();
  }

  function locationSelect(id, val, opts) {
    opts = opts || {};
    const grp = (label, arr) => arr.length ? '<optgroup label="' + label + '">' +
      arr.map((v) => '<option ' + (v === val ? 'selected' : '') + '>' + ui.esc(v) + '</option>').join('') + '</optgroup>' : '';
    let html = '<select id="' + id + '" class="field">';
    if (opts.blank) html += '<option value="" ' + (!val ? 'selected' : '') + '>' + ui.esc(opts.blank) + '</option>';
    if (!opts.storeOnly) html += grp('Spaces', RMTP.SPACES);
    html += grp('Stores', RMTP.STORES);
    return html + '</select>';
  }

  function openForm(existing) {
    const r = existing || {};
    const opt = (arr, val) => arr.map((v) => '<option ' + (v === val ? 'selected' : '') + '>' + v + '</option>').join('');
    const m = ui.modal({
      title: existing ? 'Edit item' : 'Add item',
      size: 'md:max-w-xl',
      body:
        '<div class="grid gap-4">' +
          '<div class="grid grid-cols-3 gap-4">' +
            fld('Asset tag', '<input id="i-tag" class="field tabular" value="' + ui.esc(r.tag || '') + '" placeholder="MIC-058" />') +
            '<div class="col-span-2">' + inner('Name', '<input id="i-name" class="field" value="' + ui.esc(r.name || '') + '" placeholder="Shure SM58" />') + '</div>' +
          '</div>' +
          '<div class="grid grid-cols-2 gap-4">' +
            fld('Category', '<select id="i-category" class="field">' + opt(CATEGORIES, r.category) + '</select>') +
            fld('Condition', '<select id="i-condition" class="field">' + opt(RMTP.CONDITIONS, r.condition || 'Good') + '</select>') +
          '</div>' +
          '<div class="grid grid-cols-2 gap-4">' +
            fld('Location', locationSelect('i-location', r.location || 'Store', {})) +
            fld('Quantity', '<input id="i-qty" type="number" min="0" class="field tabular" value="' + (r.qty != null ? r.qty : 1) + '" />') +
          '</div>' +
          fld('Notes', '<input id="i-notes" class="field" value="' + ui.esc(r.notes || '') + '" placeholder="Optional" />') +
        '</div>',
      footer:
        '<button class="btn btn-ghost" data-cancel>Cancel</button>' +
        '<button class="btn btn-primary" data-save data-primary>' + (existing ? 'Save changes' : 'Add item') + '</button>',
    });
    m.root.querySelector('[data-cancel]').addEventListener('click', m.close);
    m.root.querySelector('[data-save]').addEventListener('click', () => {
      const name = m.root.querySelector('#i-name').value.trim();
      if (!name) { ui.toast('Give the item a name', 'danger'); return; }
      const newLocation = m.root.querySelector('#i-location').value;
      const movements = (r.movements || []).slice();
      if (existing && r.location && newLocation !== r.location) {
        movements.push({ from: r.location, to: newLocation, at: new Date().toISOString(), by: auth.displayName(auth.current()) || 'Unknown', note: 'Edited' });
      }
      const record = Object.assign({}, r, {
        id: r.id || store.uid('inv'),
        tag: m.root.querySelector('#i-tag').value.trim(),
        name: name,
        category: m.root.querySelector('#i-category').value,
        condition: m.root.querySelector('#i-condition').value,
        location: newLocation,
        qty: Number(m.root.querySelector('#i-qty').value) || 0,
        notes: m.root.querySelector('#i-notes').value.trim(),
        status: r.status || 'in',
        movements: movements,
      });
      store.upsert('inventory', record);
      m.close(); ui.toast(existing ? 'Item updated' : 'Item added', 'ok'); render();
    });
  }

  async function del(r) {
    const ok = await ui.confirm('Remove \u201c' + r.name + '\u201d from inventory?',
      { title: 'Delete item', confirmLabel: 'Delete', danger: true });
    if (ok) { store.remove('inventory', r.id); ui.toast('Item removed', 'ok'); render(); }
  }

  function inner(label, control) { return '<label class="block text-sm font-medium mb-2">' + ui.esc(label) + '</label>' + control; }
  function fld(label, control) { return '<div>' + inner(label, control) + '</div>'; }
};
