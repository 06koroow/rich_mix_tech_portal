/* ============================================================
   views/maintenance.js — fault logging & repair tracking
   ------------------------------------------------------------
   A fault can be linked to a specific inventory item (scan its QR
   or type the asset tag). Linked kit — and any item rated below
   Fair — is treated as "flagged": struck through in Inventory,
   movable only to a Store, and listed here. Faults can carry a
   photo. Reporting/editing needs maintenance.report (any user).
   ============================================================ */
RMTP.views.maintenance = function (el, params) {
  const ui = RMTP.ui, store = RMTP.store, qr = RMTP.qr, files = RMTP.files, auth = RMTP.auth;
  const me = auth.current();
  const isAdmin = !!(me && me.admin);

  const CATEGORIES = ['Sound', 'Lighting', 'AV', 'Stage', 'Building', 'Other'];
  const PRIORITIES = ['Low', 'Medium', 'High', 'Urgent'];
  const STATUSES   = ['Open', 'In progress', 'Resolved'];
  const SELECTABLE = ['Open', 'In progress'];   // resolving is a separate admin step
  const statusColour = { 'Open': 'var(--danger)', 'In progress': 'var(--info)', 'Resolved': 'var(--ok)' };
  const prioColour   = { 'Urgent': 'var(--danger)', 'High': 'var(--danger)', 'Medium': 'var(--info)', 'Low': 'var(--muted)' };

  const filter = params[0] || 'all';
  const rows = store.all('maintenance').sort((a, b) => b.createdAt - a.createdAt);
  const match = { all: null, 'open': 'Open', 'in-progress': 'In progress', 'resolved': 'Resolved' }[filter];
  const shown = match ? rows.filter((r) => r.status === match) : rows;

  const counts = {
    all: rows.length,
    'open': rows.filter((r) => r.status === 'Open').length,
    'in-progress': rows.filter((r) => r.status === 'In progress').length,
    'resolved': rows.filter((r) => r.status === 'Resolved').length,
  };
  const filters = [
    { id: 'all', label: 'All' }, { id: 'open', label: 'Open' },
    { id: 'in-progress', label: 'In progress' }, { id: 'resolved', label: 'Resolved' },
  ];
  const filterBar = filters.map((f) =>
    '<a href="#/maintenance/' + f.id + '" class="px-3 py-1.5 rounded-lg text-sm font-medium border ' +
      (filter === f.id ? 'bg-panel2 border-accent text-ink' : 'border-line text-muted hover:text-ink') + '">' +
      ui.esc(f.label) + ' <span class="tabular text-xs opacity-70">' + counts[f.id] + '</span></a>'
  ).join('');

  const list = shown.length
    ? shown.map(renderRow).join('')
    : ui.empty('wrench', filter === 'all' ? 'No faults logged' : 'Nothing here',
        filter === 'all' ? 'Log the first one with \u201cReport a fault\u201d.' : 'Try a different filter.');

  el.innerHTML =
    '<div class="view-enter">' +
      ui.pageHeader('Maintenance', 'Fault log',
        '<button id="new-fault" class="btn btn-primary">' + ui.icon('plus', 'w-4 h-4') + 'Report a fault</button>') +
      flaggedPanel() +
      '<div class="flex flex-wrap gap-2 mb-5">' + filterBar + '</div>' +
      '<div class="grid gap-3">' + list + '</div>' +
    '</div>';

  el.querySelector('#new-fault').addEventListener('click', () => openForm());
  shown.forEach((r) => {
    const q = (sel) => el.querySelector(sel);
    const e = q('[data-edit="' + r.id + '"]'); if (e) e.addEventListener('click', () => openForm(r));
    const d = q('[data-del="' + r.id + '"]'); if (d) d.addEventListener('click', () => del(r));
    const st = q('[data-status="' + r.id + '"]'); if (st) st.addEventListener('change', (ev) => setStatus(r, ev.target.value));
    const rv = q('[data-resolve="' + r.id + '"]'); if (rv) rv.addEventListener('click', () => resolveFault(r));
    const ro = q('[data-reopen="' + r.id + '"]'); if (ro) ro.addEventListener('click', () => reopenFault(r));
    const img = q('[data-img="' + r.id + '"]'); if (img) img.addEventListener('click', () => files.open(r.image));
  });

  /* ---- Flagged kit (poor condition OR unresolved fault) ---- */
  function flaggedList() {
    const items = store.all('inventory');
    const openFaultIds = new Set(store.all('maintenance').filter((f) => f.status !== 'Resolved' && f.itemId).map((f) => f.itemId));
    return items.map((it) => {
      const reasons = [];
      if (RMTP.isPoorCondition(it.condition)) reasons.push('Condition: ' + it.condition);
      if (openFaultIds.has(it.id)) reasons.push('Open fault');
      return reasons.length ? { item: it, reasons: reasons } : null;
    }).filter(Boolean);
  }
  function flaggedPanel() {
    const flagged = flaggedList();
    if (!flagged.length) return '';
    return '<div class="panel p-4 mb-5" style="border-color:color-mix(in srgb,var(--danger) 40%,var(--line))">' +
      '<div class="flex items-center gap-2 mb-3">' + ui.icon('alert', 'w-4 h-4') +
        '<p class="eyebrow" style="color:var(--danger)">Flagged kit \u00b7 ' + flagged.length + '</p></div>' +
      '<div class="grid gap-2">' + flagged.map((f) =>
        '<div class="flex items-center justify-between gap-3 text-sm">' +
          '<span class="min-w-0"><span class="line-through">' + ui.esc(f.item.name) + '</span> ' +
            '<span class="tabular text-xs text-accent">' + ui.esc(f.item.tag) + '</span> ' +
            '<span class="text-muted">\u00b7 ' + ui.esc(f.item.location || '\u2014') + '</span></span>' +
          '<span class="text-xs text-muted shrink-0">' + f.reasons.map((r) => ui.esc(r)).join(' \u00b7 ') + '</span>' +
        '</div>').join('') +
      '</div>' +
      '<p class="text-[11px] text-muted mt-3">Flagged kit is struck through in Inventory and can only be moved to a Store.</p>' +
    '</div>';
  }

  function renderRow(r) {
    const img = r.image ? files.dataUrl(r.image) : null;
    return (
      '<div class="panel p-4">' +
        '<div class="flex items-start gap-3">' +
          (img ? '<button data-img="' + r.id + '" class="w-14 h-14 rounded-lg overflow-hidden border border-line shrink-0" title="View photo">' +
            '<img src="' + img + '" class="w-full h-full object-cover" alt="Fault photo" /></button>' : '') +
          '<div class="min-w-0 flex-1">' +
            '<div class="flex items-center gap-2 flex-wrap">' +
              '<h3 class="font-semibold truncate">' + ui.esc(r.equipment) + '</h3>' +
              ui.pill(r.priority, prioColour[r.priority] || 'var(--muted)') +
            '</div>' +
            '<p class="text-xs text-muted mt-1">' +
              ui.esc(r.category) + ' \u00b7 ' + ui.esc(r.space || r.location || 'No space') +
              ' \u00b7 ' + ui.timeAgo(r.createdAt) + (r.reportedBy ? ' \u00b7 ' + ui.esc(r.reportedBy) : '') +
            '</p>' +
            (r.itemName ? '<p class="text-xs mt-1"><span class="text-muted">Kit:</span> ' + ui.esc(r.itemName) +
              (r.itemTag ? ' <span class="tabular text-accent">' + ui.esc(r.itemTag) + '</span>' : '') + '</p>' : '') +
            (r.description ? '<p class="text-sm text-ink/85 mt-2 whitespace-pre-wrap">' + ui.esc(r.description) + '</p>' : '') +
            (isAdmin && r.status === 'Resolved' && r.resolution ?
              '<div class="mt-2 panel bg-panel2/40 p-2.5">' +
                '<p class="eyebrow" style="color:var(--ok)">How it was fixed</p>' +
                '<p class="text-sm mt-0.5 whitespace-pre-wrap">' + ui.esc(r.resolution) + '</p>' +
                '<p class="text-[11px] text-muted mt-1">' + ui.esc(r.resolvedBy || '') + (r.resolvedAt ? ' \u00b7 ' + ui.timeAgo(new Date(r.resolvedAt).getTime()) : '') + '</p>' +
              '</div>' : '') +
          '</div>' +
          '<div class="flex flex-col items-end gap-2 shrink-0">' +
            (r.status === 'Resolved'
              ? ui.pill('Resolved', 'var(--ok)') + (isAdmin ? '<button data-reopen="' + r.id + '" class="btn btn-ghost !py-1 !px-2 text-xs">Reopen</button>' : '')
              : '<select data-status="' + r.id + '" class="field !py-1.5 !px-2 text-xs !w-auto" ' +
                  'style="border-color:color-mix(in srgb,' + statusColour[r.status] + ' 45%,var(--line))">' +
                  SELECTABLE.map((s) => '<option ' + (s === r.status ? 'selected' : '') + '>' + s + '</option>').join('') +
                '</select>' +
                (isAdmin ? '<button data-resolve="' + r.id + '" class="btn btn-primary !py-1.5 !px-2.5 text-xs">' + ui.icon('check', 'w-4 h-4') + 'Resolve</button>' : '')) +
            '<div class="flex gap-1">' +
              '<button data-edit="' + r.id + '" class="btn btn-ghost !p-2" title="Edit">' + ui.icon('pen', 'w-4 h-4') + '</button>' +
              '<button data-del="' + r.id + '" class="btn btn-danger !p-2" title="Delete">' + ui.icon('trash', 'w-4 h-4') + '</button>' +
            '</div>' +
          '</div>' +
        '</div>' +
      '</div>'
    );
  }

  function openForm(existing) {
    const r = existing || {};
    const opt = (arr, val) => arr.map((v) => '<option ' + (v === val ? 'selected' : '') + '>' + v + '</option>').join('');

    // Linked-item state
    let linked = r.itemId ? { itemId: r.itemId, itemTag: r.itemTag, itemName: r.itemName } : null;
    // Image state (persist only on save)
    const originalImg = r.image || null;
    let imgMeta = originalImg, pendingImg = null, imgCleared = false;

    const m = ui.modal({
      title: existing ? 'Edit fault' : 'Report a fault',
      size: 'md:max-w-xl',
      body:
        '<div class="grid gap-4">' +
          field('Equipment / what\u2019s wrong', '<input id="f-equipment" class="field" value="' + ui.esc(r.equipment || '') + '" placeholder="e.g. FOH desk channel 12 crackling" />') +
          '<div><label class="block text-sm font-medium mb-2">Linked kit <span class="text-muted font-normal">(optional)</span></label><div id="f-item-area"></div></div>' +
          '<div class="grid grid-cols-2 gap-4">' +
            field('Category', '<select id="f-category" class="field">' + opt(CATEGORIES, r.category) + '</select>') +
            field('Priority', '<select id="f-priority" class="field">' + opt(PRIORITIES, r.priority || 'Medium') + '</select>') +
          '</div>' +
          '<div class="grid grid-cols-2 gap-4">' +
            field('Space', '<select id="f-space" class="field"><option value="" ' + (!r.space ? 'selected' : '') + '>\u2014 None</option>' +
              RMTP.SPACES.map((s) => '<option ' + (s === r.space ? 'selected' : '') + '>' + s + '</option>').join('') + '</select>') +
            field('Reported by', '<div class="field !bg-panel2/40 flex items-center text-muted">' + ui.esc(existing ? (r.reportedBy || '\u2014') : (auth.displayName(auth.current()) || 'You')) + '</div>') +
          '</div>' +
          field('Description', '<textarea id="f-desc" class="field" rows="3" placeholder="What happened, when, anything you\u2019ve already tried\u2026">' + ui.esc(r.description || '') + '</textarea>') +
          '<div><label class="block text-sm font-medium mb-2">Photo <span class="text-muted font-normal">(optional)</span></label><div id="f-image-area"></div></div>' +
        '</div>',
      footer:
        '<button class="btn btn-ghost" data-cancel>Cancel</button>' +
        '<button class="btn btn-primary" data-save data-primary>' + (existing ? 'Save changes' : 'Log fault') + '</button>',
    });

    /* --- linked-item widget --- */
    function itemAreaHtml() {
      if (linked) {
        return '<div class="flex flex-wrap items-center gap-2">' +
          '<span class="inline-flex items-center gap-2 pl-3 pr-1.5 py-1.5 rounded-full text-sm" ' +
            'style="background:color-mix(in srgb,var(--accent) 12%,transparent);border:1px solid color-mix(in srgb,var(--accent) 40%,var(--line))">' +
            '<span class="font-medium">' + ui.esc(linked.itemName) + '</span>' +
            (linked.itemTag ? '<span class="tabular text-xs text-accent">' + ui.esc(linked.itemTag) + '</span>' : '') +
            '<button type="button" data-item-clear class="rounded-full hover:bg-panel2 p-1 -my-1" title="Remove">' + ui.icon('x', 'w-3.5 h-3.5') + '</button>' +
          '</span>' +
        '</div>';
      }
      return '<div class="flex gap-2">' +
        '<button type="button" id="f-scan" class="btn btn-ghost shrink-0">' + ui.icon('search', 'w-4 h-4') + 'Scan</button>' +
        '<input id="f-tag" class="field tabular" placeholder="or type asset tag (e.g. MIC-058)" />' +
        '<button type="button" id="f-link" class="btn btn-ghost shrink-0">Link</button>' +
      '</div>';
    }
    function resolveTag(tagRaw) {
      const parsed = qr.parse(tagRaw);
      const tag = (parsed ? parsed.value : tagRaw).trim().toLowerCase();
      if (!tag) return null;
      return store.all('inventory').find((it) => String(it.tag || '').toLowerCase() === tag) || null;
    }
    function setLinked(it) {
      if (!it) { ui.toast('No item with that tag', 'danger'); return; }
      linked = { itemId: it.id, itemTag: it.tag, itemName: it.name };
      // Prefill category/space from the item if empty
      if (!m.root.querySelector('#f-equipment').value.trim()) m.root.querySelector('#f-equipment').value = it.name + ' fault';
      wireItem();
      ui.toast('Linked ' + it.name, 'ok');
    }
    function wireItem() {
      const area = m.root.querySelector('#f-item-area');
      area.innerHTML = itemAreaHtml();
      const clr = area.querySelector('[data-item-clear]'); if (clr) clr.addEventListener('click', () => { linked = null; wireItem(); });
      const scan = area.querySelector('#f-scan'); if (scan) scan.addEventListener('click', async () => {
        const decoded = await qr.scan({ title: 'Scan faulty kit' });
        if (decoded) setLinked(resolveTag(decoded));
      });
      const link = area.querySelector('#f-link'); if (link) link.addEventListener('click', () => setLinked(resolveTag(m.root.querySelector('#f-tag').value)));
      const tagIn = area.querySelector('#f-tag'); if (tagIn) tagIn.addEventListener('keydown', (e) => { if (e.key === 'Enter') setLinked(resolveTag(tagIn.value)); });
    }
    wireItem();

    /* --- image widget --- */
    function imageAreaHtml() {
      const shown = pendingImg || (imgCleared ? null : imgMeta);
      const src = pendingImg ? pendingImg.dataUrl : (shown ? files.dataUrl(shown) : null);
      if (shown && src) {
        return '<div class="flex items-center gap-3">' +
          '<img src="' + src + '" class="w-16 h-16 rounded-lg object-cover border border-line" alt="preview" />' +
          '<span class="text-xs text-muted min-w-0 truncate">' + ui.esc(shown.name) + (pendingImg ? ' \u00b7 unsaved' : '') + '</span>' +
          '<button type="button" data-img-remove class="btn btn-danger !p-2 shrink-0" title="Remove">' + ui.icon('trash', 'w-4 h-4') + '</button>' +
        '</div>';
      }
      return '<label class="btn btn-ghost cursor-pointer inline-flex"><input type="file" accept="image/*" id="f-img-input" class="sr-only" />' +
        ui.icon('upload', 'w-4 h-4') + 'Upload photo</label>' +
        '<p class="text-[11px] text-muted mt-2">Image up to ' + files.humanSize(files.MAX) + '. Stored locally in this prototype.</p>';
    }
    function wireImage() {
      const area = m.root.querySelector('#f-image-area');
      area.innerHTML = imageAreaHtml();
      const input = area.querySelector('#f-img-input');
      if (input) input.addEventListener('change', (e) => {
        const file = e.target.files && e.target.files[0];
        if (!file) return;
        if (file.type && file.type.indexOf('image') === -1) { ui.toast('Images only', 'danger'); return; }
        files.readAsDataUrl(file).then((p) => { pendingImg = p; imgCleared = false; wireImage(); })
          .catch((err) => ui.toast(err && err.message === 'too-large' ? 'File too large (max ' + files.humanSize(files.MAX) + ')' : 'Could not read image', 'danger'));
      });
      const rem = area.querySelector('[data-img-remove]');
      if (rem) rem.addEventListener('click', () => { if (pendingImg) { pendingImg = null; } else { imgCleared = true; } wireImage(); });
    }
    wireImage();

    m.root.querySelector('[data-cancel]').addEventListener('click', m.close);
    m.root.querySelector('[data-save]').addEventListener('click', () => {
      const equipment = m.root.querySelector('#f-equipment').value.trim();
      if (!equipment) { ui.toast('Add a short description of the fault', 'danger'); return; }

      let finalImg = imgCleared ? null : imgMeta;
      if (pendingImg) {
        try { finalImg = files.persist(pendingImg); } catch (e) { ui.toast('Couldn\u2019t store image — storage may be full', 'danger'); return; }
        if (originalImg) files.remove(originalImg);
      } else if (imgCleared && originalImg) {
        files.remove(originalImg);
      }

      const record = Object.assign({
        id: r.id || store.uid('fault'),
        status: r.status || 'Open',
        createdAt: r.createdAt || Date.now(),
      }, {
        equipment: equipment,
        category: m.root.querySelector('#f-category').value,
        priority: m.root.querySelector('#f-priority').value,
        space: m.root.querySelector('#f-space').value,
        reportedBy: existing ? (r.reportedBy || '') : (auth.displayName(auth.current()) || ''),
        description: m.root.querySelector('#f-desc').value.trim(),
        itemId: linked ? linked.itemId : '',
        itemTag: linked ? linked.itemTag : '',
        itemName: linked ? linked.itemName : '',
        image: finalImg,
      });
      store.upsert('maintenance', record);
      m.close(); ui.toast(existing ? 'Fault updated' : 'Fault logged', 'ok'); RMTP.router.render();
    });
  }

  function setStatus(r, status) {
    store.upsert('maintenance', Object.assign({}, r, { status }));
    ui.toast('Marked ' + status.toLowerCase(), 'ok'); RMTP.router.render();
  }

  /* Admin-only: record how the fault was fixed and return the linked
     kit to circulation (clears the flag in Inventory). */
  function resolveFault(r) {
    if (!isAdmin) { ui.toast('Only admins can resolve faults', 'danger'); return; }
    const item = r.itemId ? store.find('inventory', r.itemId) : null;
    const condOpts = ['Good', 'Fair'];
    const m = ui.modal({
      title: 'Resolve fault',
      size: 'md:max-w-md',
      body:
        '<p class="text-sm text-muted mb-4">' + ui.esc(r.equipment) + '</p>' +
        '<label class="block text-sm font-medium mb-2">How was it fixed?</label>' +
        '<textarea id="res-notes" class="field mb-4" rows="3" placeholder="What was done to fix it\u2026"></textarea>' +
        (item
          ? '<label class="block text-sm font-medium mb-2">Return ' + ui.esc(item.name) + ' to circulation as</label>' +
            '<select id="res-cond" class="field">' + condOpts.map((c) => '<option>' + c + '</option>').join('') + '</select>' +
            '<p class="text-[11px] text-muted mt-2">This clears the flag on the linked kit in Inventory.</p>'
          : '<p class="text-xs text-muted">No kit is linked to this fault.</p>'),
      footer:
        '<button class="btn btn-ghost" data-cancel>Cancel</button>' +
        '<button class="btn btn-primary" data-ok data-primary>' + ui.icon('check', 'w-4 h-4') + 'Resolve &amp; return to use</button>',
    });
    m.root.querySelector('[data-cancel]').addEventListener('click', m.close);
    m.root.querySelector('[data-ok]').addEventListener('click', () => {
      const notes = m.root.querySelector('#res-notes').value.trim();
      if (!notes) { ui.toast('Add a note on how it was fixed', 'danger'); return; }
      const now = new Date().toISOString();
      store.upsert('maintenance', Object.assign({}, r, { status: 'Resolved', resolution: notes, resolvedBy: auth.displayName(me) || 'Admin', resolvedAt: now }));
      if (item) {
        const fresh = store.find('inventory', item.id) || item;
        store.upsert('inventory', Object.assign({}, fresh, { condition: m.root.querySelector('#res-cond').value }));
      }
      m.close(); ui.toast('Fault resolved \u2014 kit back in circulation', 'ok'); RMTP.router.render();
    });
  }

  function reopenFault(r) {
    if (!isAdmin) return;
    store.upsert('maintenance', Object.assign({}, r, { status: 'Open' }));
    ui.toast('Fault reopened', 'ok'); RMTP.router.render();
  }

  async function del(r) {
    const ok = await ui.confirm('Delete this fault report? This can\u2019t be undone.',
      { title: 'Delete fault', confirmLabel: 'Delete', danger: true });
    if (ok) { if (r.image) files.remove(r.image); store.remove('maintenance', r.id); ui.toast('Fault deleted', 'ok'); RMTP.router.render(); }
  }

  function field(label, control) {
    return '<div><label class="block text-sm font-medium mb-2">' + ui.esc(label) + '</label>' + control + '</div>';
  }
};
