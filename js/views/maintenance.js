/* ============================================================
   views/maintenance.js — fault logging, repair tracking & consumables ordering
   ------------------------------------------------------------
   - Equipment Faults: linked to inventory items (search by equipment name
     or asset tag). Flagged kit is struck through and restricted to Store.
   - Consumables Orders: techs can list items needing ordering (Haze Fluid,
     Tape, Batteries, etc.), tag technicians, and add orders to maintenance
     shifts or tech manager/senior tech dashboards.
   - Maintenance Shifts: schedule shifts and add single or multiple
     maintenance/consumable tickets to existing or new shifts.
   ============================================================ */
RMTP.maintenance = (function () {
  const CATEGORIES = ['Sound', 'Lighting', 'AV', 'Stage', 'Building', 'Consumables', 'Other'];
  const PRIORITIES = ['Low', 'Medium', 'High', 'Urgent'];

  const CONSUMABLE_PRESETS = [
    { name: 'Look Solutions Unique Haze Fluid (5L)', qty: '2 \u00d7 5L', cat: 'Lighting' },
    { name: 'Advance AT200 Black Gaffa Tape (50mm)', qty: '6 rolls', cat: 'Stage' },
    { name: 'Advance AT200 White Gaffa Tape (50mm)', qty: '3 rolls', cat: 'Stage' },
    { name: 'PVC Electrical Insulation Tape (Mixed 10-pack)', qty: '1 pack', cat: 'Sound' },
    { name: 'Procell Constant 9V Batteries (Box of 10)', qty: '1 box', cat: 'Sound' },
    { name: 'Procell AA Industrial Alkaline (Box of 24)', qty: '1 box', cat: 'Sound' },
    { name: 'Procell AAA Industrial Alkaline (Box of 24)', qty: '1 box', cat: 'AV' },
    { name: 'Black Sharpie Fine Point Markers (Pack of 12)', qty: '1 pack', cat: 'Stage' },
    { name: 'Heavy-Duty Reusable Cable Ties / Velcro (30cm)', qty: '1 pack of 50', cat: 'Stage' },
    { name: 'IPA Isopropyl Alcohol 99.9% Cleaning Spray (500ml)', qty: '2 bottles', cat: 'Lighting' },
    { name: 'Lens Cleaning Wipes (Optical Grade)', qty: '1 box of 100', cat: 'AV' },
    { name: 'Disposable Foam Earplugs (Dispenser Box)', qty: '1 box of 200', cat: 'Building' },
  ];

  function mapInventoryCategory(invCat) {
    if (!invCat) return 'Other';
    const c = String(invCat).toLowerCase();
    if (c.includes('sound') || c.includes('micro') || c.includes('speaker') || c.includes('backline') || c.includes('dj')) return 'Sound';
    if (c.includes('light') || c.includes('rigging')) return 'Lighting';
    if (c.includes('av') || c.includes('project') || c.includes('screen') || c.includes('network') || c.includes('video')) return 'AV';
    if (c.includes('stage') || c.includes('floor')) return 'Stage';
    if (c.includes('power') || c.includes('build')) return 'Building';
    return 'Other';
  }

  function openForm(existing, initialKit, onComplete, initialTaskType) {
    const ui = RMTP.ui, store = RMTP.store, qr = RMTP.qr, files = RMTP.files, auth = RMTP.auth;
    const r = existing || {};
    const allUsers = store.all('users');
    const opt = (arr, val) => arr.map((v) => '<option ' + (v === val ? 'selected' : '') + '>' + v + '</option>').join('');

    let currentTaskType = (existing && existing.taskType) ||
      (existing && (existing.category === 'Consumables' || existing.consumableItems) ? 'consumables' : (initialTaskType || 'fault'));

    let consumableItems = (existing && Array.isArray(existing.consumableItems))
      ? JSON.parse(JSON.stringify(existing.consumableItems))
      : (currentTaskType === 'consumables'
          ? [
              { name: 'Look Solutions Unique Haze Fluid (5L)', qty: '2 \u00d7 5L', notes: 'Stage left and right hazers' },
              { name: 'Advance AT200 Black Gaffa Tape (50mm)', qty: '6 rolls', notes: 'Main stage pit box' }
            ]
          : []);

    // Linked-item state for faults
    let linked = r.itemId
      ? { itemId: r.itemId, itemTag: r.itemTag, itemName: r.itemName, splitQty: r.splitQty || null, parentId: r.parentId || null }
      : (initialKit ? { itemId: initialKit.id, itemTag: initialKit.tag, itemName: initialKit.name, splitQty: initialKit.splitQty || null, parentId: initialKit.parentId || null } : null);

    const initialEquip = r.equipment || (initialKit ? initialKit.name + ' \u2014 Fault / Service' : (currentTaskType === 'consumables' ? 'Consumables Order: ' : ''));
    const initialCategory = r.category || (currentTaskType === 'consumables' ? 'Consumables' : (initialKit ? mapInventoryCategory(initialKit.category) : 'Sound'));
    const initialPriority = r.priority || (initialKit && (initialKit.condition === 'Damaged' || initialKit.condition === 'Out of service') ? 'High' : (currentTaskType === 'consumables' ? 'High' : 'Medium'));
    const initialSpace = r.space != null ? r.space : (initialKit ? (RMTP.isSpace(initialKit.location) ? initialKit.location : '') : 'The Stage');
    const initialDesc = r.description || (initialKit ? 'Reported for maintenance / service inspection.' : '');
    let assignedTechId = r.assignedTechId || (r.assignedTech ? r.assignedTech.id : '') || '';

    // Image state (persist only on save)
    const originalImg = r.image || null;
    let imgMeta = originalImg, pendingImg = null, imgCleared = false;

    const userOptionsHtml = (selectedId) =>
      '<option value="">\u2014 Unassigned (Anyone) \u2014</option>' +
      allUsers.map((u) => '<option value="' + u.id + '" ' + (u.id === selectedId ? 'selected' : '') + '>' + ui.esc(auth.displayName(u)) + (u.position ? ' (' + ui.esc(u.position) + ')' : '') + '</option>').join('');

    const modalTitle = existing
      ? (currentTaskType === 'consumables' ? 'Edit Consumables Order' : 'Edit Fault Report')
      : (currentTaskType === 'consumables' ? 'Order Consumables / Restock Request' : (initialKit ? 'Report Fault / Service \u2014 ' + ui.esc(initialKit.name) : 'Report a Fault / Service'));

    const m = ui.modal({
      title: modalTitle,
      size: 'md:max-w-2xl',
      body:
        '<div class="grid gap-4">' +
          /* Segmented Type Toggle */
          (!existing ? (
            '<div class="flex rounded-lg p-1 bg-panel2/80 border border-line">' +
              '<button type="button" id="tab-type-fault" class="flex-1 py-1.5 px-3 rounded-md text-xs font-semibold flex items-center justify-center gap-1.5 transition-all ' + (currentTaskType === 'fault' ? 'bg-panel text-accent shadow-xs' : 'text-muted hover:text-ink') + '">' +
                ui.icon('tool', 'w-3.5 h-3.5') + '<span>Equipment Fault / Repair</span>' +
              '</button>' +
              '<button type="button" id="tab-type-consumables" class="flex-1 py-1.5 px-3 rounded-md text-xs font-semibold flex items-center justify-center gap-1.5 transition-all ' + (currentTaskType === 'consumables' ? 'bg-panel text-accent shadow-xs' : 'text-muted hover:text-ink') + '">' +
                ui.icon('cart', 'w-3.5 h-3.5') + '<span>Consumables Order</span>' +
              '</button>' +
            '</div>'
          ) : '') +

          /* Title / Header field */
          field(currentTaskType === 'consumables' ? 'Order Title / Summary' : 'Equipment / What\u2019s wrong',
            '<input id="f-equipment" class="field" value="' + ui.esc(initialEquip) + '" placeholder="' + (currentTaskType === 'consumables' ? 'e.g. Consumables Order: Haze Fluid, Black Gaffa Tape & 9V Batteries' : 'e.g. FOH desk channel 12 crackling on phantom power') + '" />') +

          /* Consumables Builder (Visible when taskType === consumables) */
          '<div id="f-consumables-section" class="' + (currentTaskType === 'consumables' ? '' : 'hidden') + ' panel p-4 bg-panel2/40 border border-line rounded-xl grid gap-3">' +
            '<div class="flex items-center justify-between gap-2 pb-2 border-b border-line flex-wrap">' +
              '<div class="flex items-center gap-2">' +
                '<span class="p-1 rounded bg-accent/15 text-accent">' + ui.icon('cart', 'w-4 h-4') + '</span>' +
                '<div>' +
                  '<div class="text-xs font-bold text-ink uppercase tracking-wider">Items to Order</div>' +
                  '<div class="text-[11px] text-muted">List consumables needed for shows, shifts, and venue restock</div>' +
                '</div>' +
              '</div>' +
              '<button type="button" id="f-add-consumable-item" class="btn btn-secondary !py-1 !px-2.5 text-xs flex items-center gap-1 text-accent">' +
                ui.icon('plus', 'w-3.5 h-3.5') + '<span>Add Item</span>' +
              '</button>' +
            '</div>' +

            /* Quick Presets */
            '<div>' +
              '<label class="block text-[11px] font-semibold text-muted uppercase tracking-wider mb-1.5">Quick Presets (1-Click Add):</label>' +
              '<div class="flex flex-wrap gap-1.5" id="f-consumable-presets">' +
                CONSUMABLE_PRESETS.map((p, idx) =>
                  '<button type="button" data-preset-idx="' + idx + '" class="px-2 py-1 rounded-md text-[11px] font-medium bg-panel border border-line hover:border-accent hover:text-accent transition-colors flex items-center gap-1">' +
                    ui.icon('plus', 'w-3 h-3 text-muted') + '<span>' + ui.esc(p.name) + '</span>' +
                  '</button>'
                ).join('') +
              '</div>' +
            '</div>' +

            /* Item Rows */
            '<div id="f-consumable-items-list" class="grid gap-2 max-h-60 overflow-y-auto pr-1"></div>' +
          '</div>' +

          /* Linked Kit (Visible when taskType === fault) */
          '<div id="f-fault-kit-section" class="' + (currentTaskType === 'fault' ? '' : 'hidden') + '">' +
            '<label class="block text-sm font-medium mb-2">Linked kit <span class="text-muted font-normal">(search by equipment name or asset tag)</span></label>' +
            '<div id="f-item-area"></div>' +
          '</div>' +

          '<div id="f-qty-split-wrap" class="hidden"></div>' +

          /* Category & Priority */
          '<div class="grid grid-cols-1 sm:grid-cols-2 gap-4">' +
            field('Category', '<select id="f-category" class="field">' + opt(CATEGORIES, initialCategory) + '</select>') +
            field('Priority', '<select id="f-priority" class="field">' + opt(PRIORITIES, initialPriority) + '</select>') +
          '</div>' +

          /* Space & Tagged Technician */
          '<div class="grid grid-cols-1 sm:grid-cols-2 gap-4">' +
            field('Space / Destination', '<select id="f-space" class="field"><option value="" ' + (!initialSpace ? 'selected' : '') + '>\u2014 None / Venue-wide</option>' +
              RMTP.SPACES.map((s) => '<option ' + (s === initialSpace ? 'selected' : '') + '>' + s + '</option>').join('') + '</select>') +
            field('Tag Technician / Assignee', '<select id="f-assigned-tech" class="field">' + userOptionsHtml(assignedTechId) + '</select>') +
          '</div>' +

          /* Reporter and Status */
          '<div class="grid grid-cols-1 sm:grid-cols-2 gap-4">' +
            field('Reported by', '<div class="field !bg-panel2/40 flex items-center text-muted">' + ui.esc(existing ? (r.reportedBy || '\u2014') : (auth.displayName(auth.current()) || 'You')) + '</div>') +
            field('Status', '<select id="f-status" class="field">' +
              ['Open', 'In progress', 'Resolved'].map((st) => {
                const label = currentTaskType === 'consumables'
                  ? (st === 'Open' ? 'Open \u2014 Needs Ordering' : (st === 'In progress' ? 'In progress \u2014 Order Placed' : 'Resolved \u2014 Delivered & Stocked'))
                  : st;
                return '<option value="' + st + '" ' + ((r.status || 'Open') === st ? 'selected' : '') + '>' + label + '</option>';
              }).join('') +
            '</select>') +
          '</div>' +

          field('Description / Notes / Supplier Links', '<textarea id="f-desc" class="field" rows="3" placeholder="' + (currentTaskType === 'consumables' ? 'Supplier details, urgency justification, catalogue links, or delivery instructions\u2026' : 'What happened, symptoms, issues found\u2026') + '">' + ui.esc(initialDesc) + '</textarea>') +

          '<div id="f-photo-wrap" class="' + (currentTaskType === 'fault' ? '' : 'hidden') + '">' +
            '<label class="block text-sm font-medium mb-2">Photo <span class="text-muted font-normal">(optional)</span></label>' +
            '<div id="f-image-area"></div>' +
          '</div>' +
        '</div>',
      footer:
        '<button class="btn btn-ghost" data-cancel>Cancel</button>' +
        '<button class="btn btn-primary" data-save data-primary>' + (existing ? 'Save changes' : (currentTaskType === 'consumables' ? 'Submit Consumables Order' : 'Log Fault / Service')) + '</button>',
    });

    /* --- Type Toggle Handlers --- */
    const tabFault = m.root.querySelector('#tab-type-fault');
    const tabConsumables = m.root.querySelector('#tab-type-consumables');
    const secConsumables = m.root.querySelector('#f-consumables-section');
    const secFaultKit = m.root.querySelector('#f-fault-kit-section');
    const secPhoto = m.root.querySelector('#f-photo-wrap');
    const equipInp = m.root.querySelector('#f-equipment');
    const catSel = m.root.querySelector('#f-category');
    const prioSel = m.root.querySelector('#f-priority');
    const saveBtn = m.root.querySelector('[data-save]');

    function updateTypeUI() {
      if (tabFault) {
        tabFault.className = 'flex-1 py-1.5 px-3 rounded-md text-xs font-semibold flex items-center justify-center gap-1.5 transition-all ' +
          (currentTaskType === 'fault' ? 'bg-panel text-accent shadow-xs' : 'text-muted hover:text-ink');
      }
      if (tabConsumables) {
        tabConsumables.className = 'flex-1 py-1.5 px-3 rounded-md text-xs font-semibold flex items-center justify-center gap-1.5 transition-all ' +
          (currentTaskType === 'consumables' ? 'bg-panel text-accent shadow-xs' : 'text-muted hover:text-ink');
      }
      if (secConsumables) secConsumables.classList.toggle('hidden', currentTaskType !== 'consumables');
      if (secFaultKit) secFaultKit.classList.toggle('hidden', currentTaskType !== 'fault');
      if (secPhoto) secPhoto.classList.toggle('hidden', currentTaskType !== 'fault');

      if (!existing) {
        if (currentTaskType === 'consumables') {
          if (!equipInp.value || equipInp.value.includes('Fault')) equipInp.value = 'Consumables Order: Haze Fluid, Black Gaffa Tape & 9V Batteries';
          if (catSel) catSel.value = 'Consumables';
          if (prioSel && prioSel.value === 'Low') prioSel.value = 'High';
          if (saveBtn) saveBtn.textContent = 'Submit Consumables Order';
        } else {
          if (equipInp.value.startsWith('Consumables Order:')) equipInp.value = '';
          if (catSel && catSel.value === 'Consumables') catSel.value = 'Sound';
          if (saveBtn) saveBtn.textContent = 'Log Fault / Service';
        }
      }
      renderConsumableItemsList();
    }

    if (tabFault) tabFault.addEventListener('click', () => { currentTaskType = 'fault'; updateTypeUI(); });
    if (tabConsumables) tabConsumables.addEventListener('click', () => { currentTaskType = 'consumables'; updateTypeUI(); });

    /* --- Consumables Builder Logic --- */
    const itemsListEl = m.root.querySelector('#f-consumable-items-list');
    function renderConsumableItemsList() {
      if (!itemsListEl) return;
      if (!consumableItems.length) {
        itemsListEl.innerHTML = '<div class="text-xs text-muted italic p-3 text-center bg-panel rounded-lg border border-dashed border-line">No items added yet. Click a quick preset or \u201cAdd Item\u201d above.</div>';
        return;
      }
      itemsListEl.innerHTML = consumableItems.map((item, idx) => (
        '<div class="flex items-center gap-2 p-2.5 rounded-lg bg-panel border border-line text-xs" data-item-row="' + idx + '">' +
          '<div class="min-w-0 flex-1">' +
            '<input type="text" class="field !py-1 text-xs font-semibold text-ink w-full mb-1" data-item-name="' + idx + '" value="' + ui.esc(item.name || '') + '" placeholder="Item name (e.g. Haze Fluid 5L, Black Gaffa)" />' +
            '<div class="grid grid-cols-1 sm:grid-cols-2 gap-2">' +
              '<input type="text" class="field !py-1 text-xs text-muted" data-item-qty="' + idx + '" value="' + ui.esc(item.qty || '') + '" placeholder="Qty (e.g. 2 \u00d7 5L, 6 rolls)" />' +
              '<input type="text" class="field !py-1 text-xs text-muted" data-item-notes="' + idx + '" value="' + ui.esc(item.notes || '') + '" placeholder="Notes / Brand (e.g. Look Solutions)" />' +
            '</div>' +
          '</div>' +
          '<button type="button" data-remove-item="' + idx + '" class="btn btn-danger !p-1.5 shrink-0 self-center" title="Remove item">' +
            ui.icon('trash', 'w-3.5 h-3.5') +
          '</button>' +
        '</div>'
      )).join('');

      itemsListEl.querySelectorAll('[data-item-name]').forEach((inp) => {
        inp.addEventListener('input', (e) => {
          const idx = parseInt(inp.getAttribute('data-item-name'), 10);
          if (consumableItems[idx]) consumableItems[idx].name = e.target.value;
        });
      });
      itemsListEl.querySelectorAll('[data-item-qty]').forEach((inp) => {
        inp.addEventListener('input', (e) => {
          const idx = parseInt(inp.getAttribute('data-item-qty'), 10);
          if (consumableItems[idx]) consumableItems[idx].qty = e.target.value;
        });
      });
      itemsListEl.querySelectorAll('[data-item-notes]').forEach((inp) => {
        inp.addEventListener('input', (e) => {
          const idx = parseInt(inp.getAttribute('data-item-notes'), 10);
          if (consumableItems[idx]) consumableItems[idx].notes = e.target.value;
        });
      });
      itemsListEl.querySelectorAll('[data-remove-item]').forEach((btn) => {
        btn.addEventListener('click', () => {
          const idx = parseInt(btn.getAttribute('data-remove-item'), 10);
          consumableItems.splice(idx, 1);
          renderConsumableItemsList();
        });
      });
    }

    const addItemBtn = m.root.querySelector('#f-add-consumable-item');
    if (addItemBtn) {
      addItemBtn.addEventListener('click', () => {
        consumableItems.push({ name: '', qty: '1', notes: '' });
        renderConsumableItemsList();
        setTimeout(() => {
          const inputs = itemsListEl.querySelectorAll('[data-item-name]');
          if (inputs.length) inputs[inputs.length - 1].focus();
        }, 30);
      });
    }

    const presetsWrap = m.root.querySelector('#f-consumable-presets');
    if (presetsWrap) {
      presetsWrap.querySelectorAll('[data-preset-idx]').forEach((btn) => {
        btn.addEventListener('click', () => {
          const idx = parseInt(btn.getAttribute('data-preset-idx'), 10);
          const p = CONSUMABLE_PRESETS[idx];
          if (p) {
            consumableItems.push({ name: p.name, qty: p.qty, notes: 'Restock (' + p.cat + ')' });
            renderConsumableItemsList();
            ui.toast('Added ' + p.name, 'ok');
          }
        });
      });
    }

    renderConsumableItemsList();

    /* --- Linked-Item Widget with Name & Asset Tag Search --- */
    function itemAreaHtml() {
      if (linked) {
        const itemObj = store.find('inventory', linked.itemId);
        const qtyStr = linked.splitQty ? ' (' + linked.splitQty + ' \u00d7 in service)' : (itemObj && (itemObj.qty || 1) > 1 ? ' (' + (itemObj.qty || 1) + ' available)' : '');
        return '<div class="flex flex-wrap items-center gap-2">' +
          '<span class="inline-flex items-center gap-2 pl-3 pr-1.5 py-1.5 rounded-full text-sm" ' +
            'style="background:color-mix(in srgb,var(--accent) 12%,transparent);border:1px solid color-mix(in srgb,var(--accent) 40%,var(--line))">' +
            '<span class="font-medium">' + ui.esc(linked.itemName) + '</span>' +
            (linked.itemTag ? '<span class="tabular text-xs text-accent font-mono">' + ui.esc(linked.itemTag) + '</span>' : '') +
            '<span class="text-xs text-muted">' + ui.esc(qtyStr) + '</span>' +
            '<button type="button" data-item-clear class="rounded-full hover:bg-panel2 p-1 -my-1" title="Remove">' + ui.icon('x', 'w-3.5 h-3.5') + '</button>' +
          '</span>' +
        '</div>';
      }
      return '<div class="relative w-full">' +
        '<div class="flex gap-2">' +
          '<button type="button" id="f-scan" class="btn btn-ghost shrink-0">' + ui.icon('search', 'w-4 h-4') + 'Scan</button>' +
          '<input id="f-tag" class="field tabular w-full" placeholder="Search equipment name or asset tag (e.g. SM58, Hazer, MIC-058)..." autocomplete="off" />' +
          '<button type="button" id="f-link" class="btn btn-ghost shrink-0">Link</button>' +
        '</div>' +
        '<div id="f-kit-suggestions" class="absolute left-0 right-0 top-full mt-1 bg-panel border border-line rounded-lg shadow-xl z-50 max-h-60 overflow-y-auto hidden"></div>' +
      '</div>';
    }

    function renderSplitQtyField() {
      const wrap = m.root.querySelector('#f-qty-split-wrap');
      if (!wrap) return;
      if (existing || !linked || !linked.itemId || currentTaskType !== 'fault') {
        wrap.className = 'hidden';
        wrap.innerHTML = '';
        return;
      }
      const itemObj = store.find('inventory', linked.itemId);
      const totalQty = itemObj ? Math.max(1, Number(itemObj.qty) || 1) : 1;
      if (totalQty <= 1) {
        wrap.className = 'hidden';
        wrap.innerHTML = '';
        return;
      }
      wrap.className = 'panel p-3 bg-panel2/50 border border-line grid gap-2';
      wrap.innerHTML =
        '<div class="flex items-center justify-between gap-3">' +
          '<div>' +
            '<label class="block text-sm font-semibold">Quantity to Service / Repair</label>' +
            '<p class="text-xs text-muted">This inventory batch has ' + totalQty + ' units in ' + ui.esc(itemObj.location || 'store') + '. Choosing fewer than ' + totalQty + ' will automatically split the faulty units into a dedicated SERVICE entity.</p>' +
          '</div>' +
          '<div class="w-24 shrink-0">' +
            '<input id="f-split-qty" type="number" min="1" max="' + totalQty + '" value="' + (r.splitQty || 1) + '" class="field tabular font-bold text-center !py-1.5" />' +
          '</div>' +
        '</div>';
    }

    function resolveTag(tagRaw) {
      if (!tagRaw) return null;
      const parsed = qr.parse(tagRaw);
      const val = (parsed ? parsed.value : tagRaw).trim().toLowerCase();
      if (!val) return null;
      const all = store.all('inventory');

      // 1. Exact tag
      let it = all.find((item) => String(item.tag || '').trim().toLowerCase() === val);
      if (it) return it;

      // 2. Exact id
      it = all.find((item) => String(item.id || '').trim().toLowerCase() === val);
      if (it) return it;

      // 3. Exact barcode or refNumber
      it = all.find((item) => {
        const bc = String(item.barcode || '').trim().toLowerCase();
        const ref = String(item.refNumber || '').replace(/^#/, '').trim().toLowerCase();
        return bc === val || ref === val;
      });
      if (it) return it;

      // 4. Tag contains or contained
      it = all.find((item) => {
        const t = String(item.tag || '').trim().toLowerCase();
        return t && (t === val || val.includes(t) || t.includes(val));
      });
      if (it) return it;

      // 5. Exact name
      it = all.find((item) => String(item.name || '').trim().toLowerCase() === val);
      if (it) return it;

      // 6. Partial equipment name substring match
      it = all.find((item) => {
        const nm = String(item.name || '').trim().toLowerCase();
        return nm && (nm.includes(val) || val.includes(nm));
      });
      if (it) return it;

      // 7. Multi-word search across equipment name, tag, category
      const words = val.split(/\s+/).filter(Boolean);
      if (words.length > 1) {
        it = all.find((item) => {
          const hay = (String(item.name || '') + ' ' + String(item.tag || '') + ' ' + String(item.category || '')).toLowerCase();
          return words.every((w) => hay.includes(w));
        });
      }
      return it || null;
    }

    function setLinked(it) {
      if (!it) { ui.toast('No equipment found matching that name or asset tag', 'danger'); return; }
      linked = { itemId: it.id, itemTag: it.tag, itemName: it.name, splitQty: null, parentId: it.parentId || null };
      // Prefill category/space from the item if empty
      const equipField = m.root.querySelector('#f-equipment');
      if (equipField && (!equipField.value.trim() || equipField.value.includes('Fault / Service'))) {
        equipField.value = it.name + ' fault / service';
      }
      const catField = m.root.querySelector('#f-category');
      if (catField && it.category) catField.value = mapInventoryCategory(it.category);
      const spaceField = m.root.querySelector('#f-space');
      if (spaceField && RMTP.isSpace(it.location)) spaceField.value = it.location;

      wireItem();
      ui.toast('Linked ' + it.name + (it.tag ? ' (' + it.tag + ')' : ''), 'ok');
    }

    function wireItem() {
      const area = m.root.querySelector('#f-item-area');
      if (!area) return;
      area.innerHTML = itemAreaHtml();
      renderSplitQtyField();

      const clr = area.querySelector('[data-item-clear]');
      if (clr) clr.addEventListener('click', () => { linked = null; wireItem(); });

      const scan = area.querySelector('#f-scan');
      if (scan) scan.addEventListener('click', async () => {
        const decoded = await qr.scan({ title: 'Scan faulty kit' });
        if (decoded) setLinked(resolveTag(decoded));
      });

      const link = area.querySelector('#f-link');
      if (link) link.addEventListener('click', () => setLinked(resolveTag(m.root.querySelector('#f-tag').value)));

      const tagIn = area.querySelector('#f-tag');
      const sugBox = area.querySelector('#f-kit-suggestions');

      if (tagIn && sugBox) {
        tagIn.addEventListener('keydown', (e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            setLinked(resolveTag(tagIn.value));
          } else if (e.key === 'Escape') {
            sugBox.classList.add('hidden');
          }
        });

        tagIn.addEventListener('input', (e) => {
          const val = e.target.value.trim().toLowerCase();
          if (!val || val.length < 2) {
            sugBox.classList.add('hidden');
            sugBox.innerHTML = '';
            return;
          }
          const all = store.all('inventory');
          const words = val.split(/\s+/).filter(Boolean);
          const matches = all.filter((item) => {
            const hay = (String(item.name || '') + ' ' + String(item.tag || '') + ' ' + String(item.category || '') + ' ' + String(item.location || '')).toLowerCase();
            return words.every((w) => hay.includes(w));
          }).slice(0, 8);

          if (!matches.length) {
            sugBox.classList.add('hidden');
            sugBox.innerHTML = '';
            return;
          }

          sugBox.classList.remove('hidden');
          sugBox.innerHTML = matches.map((item) => (
            '<div data-sug-item="' + item.id + '" class="p-2.5 hover:bg-panel2 cursor-pointer border-b border-line last:border-0 flex items-center justify-between gap-2 text-xs transition-colors">' +
              '<div class="min-w-0 flex-1">' +
                '<div class="font-medium text-ink truncate">' + ui.esc(item.name) + '</div>' +
                '<div class="text-[11px] text-muted">' +
                  (item.tag ? '<span class="font-mono text-accent font-semibold">' + ui.esc(item.tag) + '</span> \u00b7 ' : '') +
                  ui.esc(item.category || 'Kit') + ' \u00b7 ' + ui.esc(item.location || 'Store') +
                '</div>' +
              '</div>' +
              '<div class="shrink-0 text-right">' +
                '<span class="px-1.5 py-0.5 rounded text-[10px] font-semibold ' + (item.condition === 'Damaged' || item.condition === 'Poor' ? 'bg-danger/20 text-danger' : 'bg-ok/20 text-ok') + '">' +
                  ui.esc(item.condition || 'In Service') +
                '</span>' +
              '</div>' +
            '</div>'
          )).join('');

          sugBox.querySelectorAll('[data-sug-item]').forEach((row) => {
            row.addEventListener('click', () => {
              const id = row.getAttribute('data-sug-item');
              const item = store.find('inventory', id);
              if (item) setLinked(item);
            });
          });
        });
      }
    }
    wireItem();

    /* --- Image Widget --- */
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
      if (!area) return;
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

    /* --- Save Handler --- */
    m.root.querySelector('[data-cancel]').addEventListener('click', m.close);
    m.root.querySelector('[data-save]').addEventListener('click', () => {
      const equipment = m.root.querySelector('#f-equipment').value.trim();
      if (!equipment) {
        ui.toast(currentTaskType === 'consumables' ? 'Add a title or summary for the consumables order' : 'Add a short description of the fault', 'danger');
        return;
      }

      let finalImg = imgCleared ? null : imgMeta;
      if (pendingImg) {
        try { finalImg = files.persist(pendingImg); } catch (e) { ui.toast('Couldn\u2019t store image — storage may be full', 'danger'); return; }
        if (originalImg) files.remove(originalImg);
      } else if (imgCleared && originalImg) {
        files.remove(originalImg);
      }

      let targetItemId = linked ? linked.itemId : '';
      let targetItemTag = linked ? linked.itemTag : '';
      let targetItemName = linked ? linked.itemName : '';
      let parentId = r.parentId || (linked ? linked.parentId : '') || '';
      let splitQty = r.splitQty || null;

      // Handle item splitting if reporting fault on multi-quantity item
      if (!existing && currentTaskType === 'fault' && linked && linked.itemId) {
        const itemObj = store.find('inventory', linked.itemId);
        if (itemObj) {
          const totalQty = Math.max(1, Number(itemObj.qty) || 1);
          const splitInput = m.root.querySelector('#f-split-qty');
          const chosenQty = splitInput ? Math.max(1, Math.min(parseInt(splitInput.value, 10) || 1, totalQty)) : (linked.splitQty || totalQty);
          const prevLoc = itemObj.location && itemObj.location !== 'SERVICE'
            ? itemObj.location
            : (itemObj.previousLocation || itemObj.originLocation || m.root.querySelector('#f-space').value || 'Store A');

          if (chosenQty < totalQty) {
            splitQty = chosenQty;
            parentId = itemObj.id;
            const at = new Date().toISOString();
            const by = auth.displayName(auth.current()) || 'Tech';
            const updatedParentMovements = (itemObj.movements || []).concat({
              from: itemObj.location || '',
              to: itemObj.location || '',
              at: at,
              by: by,
              note: 'Split ' + chosenQty + ' unit' + (chosenQty > 1 ? 's' : '') + ' to SERVICE for fault report'
            });
            store.upsert('inventory', Object.assign({}, itemObj, {
              qty: totalQty - chosenQty,
              previousLocation: itemObj.previousLocation || prevLoc,
              originLocation: itemObj.originLocation || prevLoc,
              movements: updatedParentMovements
            }));

            const childTag = itemObj.tag ? (itemObj.tag.includes('#') ? itemObj.tag : itemObj.tag + '-SVC') : '';
            const splitItem = {
              id: store.uid('inv'),
              parentId: itemObj.id,
              splitQty: chosenQty,
              tag: childTag,
              name: itemObj.name + ' (Faulty \u00b7 ' + chosenQty + ' \u00d7)',
              category: itemObj.category,
              condition: 'Damaged',
              location: 'SERVICE',
              previousLocation: prevLoc,
              originLocation: itemObj.originLocation || prevLoc,
              qty: chosenQty,
              notes: (itemObj.notes ? itemObj.notes + ' \u00b7 ' : '') + 'Split from ' + itemObj.name + ' for fault: ' + equipment,
              static: false,
              status: 'service',
              heldBy: 'SERVICE',
              outAt: at,
              movements: [{
                from: prevLoc,
                to: 'SERVICE',
                at: at,
                by: by,
                note: 'Split ' + chosenQty + ' units to SERVICE for fault report'
              }]
            };
            store.upsert('inventory', splitItem);
            targetItemId = splitItem.id;
            targetItemTag = splitItem.tag;
            targetItemName = splitItem.name;
          } else {
            splitQty = totalQty;
            const at = new Date().toISOString();
            const by = auth.displayName(auth.current()) || 'Tech';
            store.upsert('inventory', Object.assign({}, itemObj, {
              condition: 'Damaged',
              location: 'SERVICE',
              previousLocation: prevLoc,
              originLocation: itemObj.originLocation || prevLoc,
              status: 'service',
              heldBy: 'SERVICE',
              outAt: at,
              movements: (itemObj.movements || []).concat({
                from: prevLoc,
                to: 'SERVICE',
                at: at,
                by: by,
                note: 'Logged to SERVICE for fault report'
              })
            }));
          }
        }
      }

      const linkedObj = linked && linked.itemId ? store.find('inventory', linked.itemId) : null;
      const originLoc = (linkedObj && linkedObj.location !== 'SERVICE' ? linkedObj.location : '') ||
        (linkedObj ? (linkedObj.previousLocation || linkedObj.originLocation) : '') ||
        m.root.querySelector('#f-space').value || 'Store A';

      const assignedTechSelect = m.root.querySelector('#f-assigned-tech');
      const selectedTechUser = assignedTechSelect && assignedTechSelect.value ? store.find('users', assignedTechSelect.value) : null;

      const record = Object.assign({
        id: r.id || store.uid('fault'),
        status: m.root.querySelector('#f-status') ? m.root.querySelector('#f-status').value : (r.status || 'Open'),
        createdAt: r.createdAt || Date.now(),
      }, {
        taskType: currentTaskType,
        equipment: equipment,
        category: m.root.querySelector('#f-category').value,
        priority: m.root.querySelector('#f-priority').value,
        space: m.root.querySelector('#f-space').value,
        reportedBy: existing ? (r.reportedBy || '') : (auth.displayName(auth.current()) || ''),
        assignedTechId: selectedTechUser ? selectedTechUser.id : '',
        assignedTechName: selectedTechUser ? auth.displayName(selectedTechUser) : '',
        consumableItems: currentTaskType === 'consumables' ? consumableItems.filter((it) => it.name && it.name.trim()) : [],
        description: m.root.querySelector('#f-desc').value.trim(),
        itemId: currentTaskType === 'fault' ? targetItemId : '',
        itemTag: currentTaskType === 'fault' ? targetItemTag : '',
        itemName: currentTaskType === 'fault' ? targetItemName : '',
        parentId: parentId,
        splitQty: splitQty,
        previousLocation: r.previousLocation || originLoc,
        originLocation: r.originLocation || originLoc,
        image: currentTaskType === 'fault' ? finalImg : null,
      });

      if (finalImg && !finalImg.url && RMTP.files && RMTP.files.toRemote) {
        RMTP.files.toRemote(finalImg).then((remote) => {
          if (remote && remote.url) {
            const cur = store.find('maintenance', record.id);
            if (cur) {
              cur.image = remote;
              store.upsert('maintenance', cur);
            }
          }
        }).catch((e) => console.warn('Could not promote fault image to Supabase:', e));
      }

      store.upsert('maintenance', record);
      m.close();
      const msg = existing
        ? (currentTaskType === 'consumables' ? 'Consumables order updated' : 'Fault updated')
        : (currentTaskType === 'consumables' ? 'Consumables order logged \u2014 added to Tech dashboard & maintenance queue' : (splitQty ? 'Fault logged \u00b7 ' + splitQty + ' units split to SERVICE' : 'Fault logged'));
      ui.toast(msg, 'ok');

      if (onComplete) onComplete(record);
      else RMTP.router.render();
    });
  }

  function field(label, control) {
    return '<div><label class="block text-sm font-medium mb-2">' + RMTP.ui.esc(label) + '</label>' + control + '</div>';
  }

  /* Schedule a brand new maintenance shift with tagged tickets */
  function openShiftModal(initialFaultId, onComplete, preselectedIds) {
    const ui = RMTP.ui, store = RMTP.store, auth = RMTP.auth;
    const allUsers = store.all('users');
    const openFaults = store.all('maintenance').filter((f) => f.status !== 'Resolved' || f.id === initialFaultId || (preselectedIds && preselectedIds.includes(f.id)));

    let selectedTicketIds = preselectedIds && preselectedIds.length
      ? preselectedIds.slice()
      : (initialFaultId ? [initialFaultId] : []);

    const today = new Date().toISOString().slice(0, 10);
    const initialFault = initialFaultId ? store.find('maintenance', initialFaultId) : (selectedTicketIds.length ? store.find('maintenance', selectedTicketIds[0]) : null);
    const initialSpace = initialFault ? (initialFault.space || 'The Stage') : 'The Stage';
    const initialTitle = initialFault
      ? ('Maintenance: ' + (initialFault.equipment || initialFault.space || 'Shift'))
      : (selectedTicketIds.length ? 'Maintenance Shift (' + selectedTicketIds.length + ' Tasks)' : 'Maintenance Shift');

    let filterText = '';

    const userOptionsHtml = (selectedId) =>
      '<option value="">Select technician\u2026</option>' +
      allUsers.map((u) => '<option value="' + u.id + '" ' + (u.id === selectedId ? 'selected' : '') + '>' + ui.esc(auth.displayName(u)) + (u.position ? ' (' + ui.esc(u.position) + ')' : '') + '</option>').join('');

    const m = ui.modal({
      title: 'Schedule Maintenance Shift',
      size: 'md:max-w-2xl',
      body:
        '<div class="grid gap-4">' +
          '<div class="panel p-4 bg-panel2/40 border border-line rounded-xl grid gap-3">' +
            '<div class="flex items-center gap-2 pb-2 border-b border-line text-accent font-semibold text-xs uppercase tracking-wider">' +
              ui.icon('clock', 'w-4 h-4') + '<span>Shift Schedule & Details</span>' +
            '</div>' +
            '<div class="grid grid-cols-1 sm:grid-cols-2 gap-3">' +
              field('Shift Title', '<input id="sh-title" class="field" value="' + ui.esc(initialTitle) + '" placeholder="e.g. Weekly Audio Maintenance & Consumables Restock" />') +
              field('Location / Space', '<select id="sh-space" class="field">' + RMTP.SPACES.map((s) => '<option ' + (s === initialSpace ? 'selected' : '') + '>' + s + '</option>').join('') + '</select>') +
            '</div>' +
            '<div class="grid grid-cols-1 sm:grid-cols-3 gap-3">' +
              field('Shift Date', '<input id="sh-date" type="date" class="field font-mono" value="' + today + '" />') +
              field('Start Time', '<input id="sh-start" type="time" class="field font-mono" value="10:00" />') +
              field('Finish Time', '<input id="sh-finish" type="time" class="field font-mono" value="14:00" />') +
            '</div>' +
            '<div class="grid grid-cols-1 sm:grid-cols-2 gap-3">' +
              field('Responsible Lead / Tech', '<select id="sh-lead" class="field">' + userOptionsHtml(auth.current() ? auth.current().id : '') + '</select>') +
              field('Assisting Technician (Optional)', '<select id="sh-assist" class="field">' + userOptionsHtml('') + '</select>') +
            '</div>' +
            field('Shift Notes / Focus', '<textarea id="sh-notes" class="field" rows="2" placeholder="Tasks, safety precautions, test gear, consumables to unpack\u2026"></textarea>') +
          '</div>' +

          /* Multi-Ticket Tagging Picker */
          '<div class="panel p-4 bg-panel border border-warning/40 rounded-xl grid gap-3 shadow-xs">' +
            '<div class="flex items-center justify-between pb-2 border-b border-line flex-wrap gap-2">' +
              '<div class="flex items-center gap-2">' +
                '<span class="p-1 rounded bg-warning/15 text-warning">' + ui.icon('tool', 'w-4 h-4') + '</span>' +
                '<div>' +
                  '<div class="text-xs font-bold text-ink uppercase tracking-wider">Tag Maintenance & Consumable Tickets</div>' +
                  '<div class="text-[11px] text-muted">Select open faults and consumable orders to address during this shift</div>' +
                '</div>' +
              '</div>' +
              '<div class="flex items-center gap-2">' +
                '<span id="sh-ticket-count" class="text-xs font-semibold px-2 py-0.5 rounded bg-warning/15 text-warning font-mono">0 Tagged</span>' +
                '<button type="button" id="sh-select-all" class="text-xs text-accent hover:underline">Select All</button>' +
                '<span class="text-muted text-xs">\u00b7</span>' +
                '<button type="button" id="sh-clear-all" class="text-xs text-muted hover:underline">Clear</button>' +
              '</div>' +
            '</div>' +

            '<div class="flex items-center gap-2">' +
              '<input id="sh-ticket-search" class="field text-xs !py-1.5" placeholder="Filter tickets by equipment name, order details, space, tagged tech..." />' +
            '</div>' +

            '<div id="sh-tickets-list" class="grid gap-2 max-h-56 overflow-y-auto pr-1"></div>' +
          '</div>' +
        '</div>',
      footer:
        '<button class="btn btn-ghost" data-cancel>Cancel</button>' +
        '<button class="btn btn-primary" data-save data-primary>' + ui.icon('check', 'w-4 h-4') + 'Schedule Shift</button>',
    });

    const listEl = m.root.querySelector('#sh-tickets-list');
    const countEl = m.root.querySelector('#sh-ticket-count');
    const searchEl = m.root.querySelector('#sh-ticket-search');

    function renderTickets() {
      if (!listEl) return;
      const q = filterText.toLowerCase().trim();
      const filtered = openFaults.filter((f) => {
        if (!q) return true;
        const eq = (f.equipment || '').toLowerCase();
        const desc = (f.description || '').toLowerCase();
        const sp = (f.space || '').toLowerCase();
        const tech = (f.assignedTechName || '').toLowerCase();
        const itemsStr = Array.isArray(f.consumableItems) ? f.consumableItems.map((ci) => ci.name + ' ' + ci.notes).join(' ').toLowerCase() : '';
        return eq.includes(q) || desc.includes(q) || sp.includes(q) || tech.includes(q) || itemsStr.includes(q);
      });

      if (countEl) countEl.textContent = selectedTicketIds.length + ' Tagged';

      if (!filtered.length) {
        listEl.innerHTML = '<div class="text-xs text-muted italic p-3 rounded bg-panel2/50 text-center">No maintenance tickets matching filter.</div>';
        return;
      }

      listEl.innerHTML = filtered.map((f) => {
        const checked = selectedTicketIds.includes(f.id);
        const prioColour = { 'Urgent': 'var(--danger)', 'High': 'var(--danger)', 'Medium': 'var(--info)', 'Low': 'var(--muted)' };
        const isConsumable = f.taskType === 'consumables' || f.category === 'Consumables';
        return (
          '<label class="flex items-start gap-2.5 p-2.5 rounded-lg border cursor-pointer transition-colors text-xs ' +
            (checked ? 'bg-accent/10 border-accent/40' : 'bg-panel border-line hover:border-line/80') + '">' +
            '<input type="checkbox" data-ticket-id="' + f.id + '" class="w-4 h-4 mt-0.5 rounded accent-[var(--accent)] shrink-0 cursor-pointer" ' + (checked ? 'checked' : '') + ' />' +
            '<div class="min-w-0 flex-1">' +
              '<div class="flex items-center justify-between gap-2">' +
                '<div class="flex items-center gap-1.5 truncate">' +
                  (isConsumable
                    ? '<span class="px-1.5 py-0.2 rounded text-[10px] font-bold bg-purple-500/20 text-purple-300 border border-purple-500/30 flex items-center gap-1 shrink-0">' + ui.icon('cart', 'w-3 h-3') + 'Consumables</span>'
                    : '<span class="px-1.5 py-0.2 rounded text-[10px] font-bold bg-amber-500/20 text-amber-300 border border-amber-500/30 flex items-center gap-1 shrink-0">' + ui.icon('tool', 'w-3 h-3') + 'Fault</span>') +
                  '<span class="font-semibold text-ink truncate">' + ui.esc(f.equipment || 'Task') + '</span>' +
                '</div>' +
                '<div class="flex items-center gap-1.5 shrink-0">' +
                  ui.pill(f.priority, prioColour[f.priority] || 'var(--muted)') +
                  ui.pill(f.status || 'Open', f.status === 'Resolved' ? 'var(--ok)' : (f.status === 'In progress' ? 'var(--info)' : 'var(--warning)')) +
                '</div>' +
              '</div>' +
              '<div class="text-[11px] text-muted mt-0.5">' +
                ui.esc(f.space || f.location || 'Venue') +
                (f.assignedTechName ? ' \u00b7 Tagged: <strong class="text-accent">' + ui.esc(f.assignedTechName) + '</strong>' : '') +
                (f.reportedBy ? ' \u00b7 Reported by ' + ui.esc(f.reportedBy) : '') +
              '</div>' +
              (isConsumable && Array.isArray(f.consumableItems) && f.consumableItems.length ?
                '<div class="text-[11px] text-purple-200 mt-1 font-mono truncate">' +
                  f.consumableItems.map((ci) => ui.esc(ci.qty ? ci.qty + ' ' + ci.name : ci.name)).join(', ') +
                '</div>' : '') +
            '</div>' +
          '</label>'
        );
      }).join('');

      listEl.querySelectorAll('[data-ticket-id]').forEach((cb) => {
        cb.addEventListener('change', (e) => {
          const tid = cb.getAttribute('data-ticket-id');
          if (e.target.checked) {
            if (!selectedTicketIds.includes(tid)) selectedTicketIds.push(tid);
          } else {
            selectedTicketIds = selectedTicketIds.filter((id) => id !== tid);
          }
          renderTickets();
        });
      });
    }

    renderTickets();

    if (searchEl) {
      searchEl.addEventListener('input', (e) => {
        filterText = e.target.value;
        renderTickets();
      });
    }

    const selAllBtn = m.root.querySelector('#sh-select-all');
    if (selAllBtn) {
      selAllBtn.addEventListener('click', () => {
        selectedTicketIds = openFaults.map((f) => f.id);
        renderTickets();
      });
    }
    const clrAllBtn = m.root.querySelector('#sh-clear-all');
    if (clrAllBtn) {
      clrAllBtn.addEventListener('click', () => {
        selectedTicketIds = [];
        renderTickets();
      });
    }

    m.root.querySelector('[data-cancel]').addEventListener('click', m.close);
    m.root.querySelector('[data-save]').addEventListener('click', () => {
      const title = m.root.querySelector('#sh-title').value.trim() || 'Maintenance Shift';
      const space = m.root.querySelector('#sh-space').value;
      const date = m.root.querySelector('#sh-date').value;
      const startTime = m.root.querySelector('#sh-start').value;
      const finishTime = m.root.querySelector('#sh-finish').value;
      const leadId = m.root.querySelector('#sh-lead').value;
      const assistId = m.root.querySelector('#sh-assist').value;
      const notes = m.root.querySelector('#sh-notes').value.trim();

      const techs = [];
      if (leadId) techs.push({ userId: leadId, role: 'Lead', isLead: true });
      if (assistId && assistId !== leadId) techs.push({ userId: assistId, role: 'Support' });

      const shiftEvent = {
        id: store.uid('adv'),
        name: title,
        category: 'Maintenance Shift',
        space: space,
        date: date,
        startTime: startTime,
        finishTime: finishTime,
        status: 'Confirmed',
        technicians: techs,
        responsible_for_advancing: leadId || (auth.current() ? auth.current().id : ''),
        linked_maintenance_ids: selectedTicketIds.slice(),
        linkedMaintenanceIds: selectedTicketIds.slice(),
        techInfo: notes ? ('Maintenance shift notes: ' + notes) : 'Scheduled maintenance shift.',
        createdAt: new Date().toISOString()
      };

      store.upsert('advancing', shiftEvent);
      m.close();
      ui.toast('Maintenance shift scheduled with ' + selectedTicketIds.length + ' tagged ticket' + (selectedTicketIds.length === 1 ? '' : 's'), 'ok');
      if (onComplete) onComplete(shiftEvent);
      else RMTP.router.render();
    });
  }

  /* Add one or more maintenance tickets to an existing single maintenance shift */
  function openAddToShiftModal(ticketIds, onComplete) {
    const ui = RMTP.ui, store = RMTP.store;
    const targetIds = Array.isArray(ticketIds) ? ticketIds : [ticketIds];
    if (!targetIds.length) {
      ui.toast('No maintenance tickets selected', 'danger');
      return;
    }

    const allAdv = store.all('advancing').filter((e) => !e.deleted);
    const existingShifts = allAdv
      .filter((e) => e.category === 'Maintenance Shift' || e.category === 'Maintenance' || String(e.name).toLowerCase().includes('maintenance'))
      .sort((a, b) => (a.date || '9999').localeCompare(b.date || '9999'));

    const ticketRecords = targetIds.map((id) => store.find('maintenance', id)).filter(Boolean);

    let selectedShiftId = existingShifts.length ? existingShifts[0].id : null;

    const shiftCardsHtml = existingShifts.length
      ? existingShifts.map((s, idx) => {
          const leadUser = s.technicians && s.technicians[0] && s.technicians[0].userId ? store.find('users', s.technicians[0].userId) : null;
          const leadName = leadUser ? RMTP.auth.displayName(leadUser) : 'Unassigned';
          const times = [s.startTime, s.finishTime].filter(Boolean).join(' \u2013 ');
          const linkedCount = (Array.isArray(s.linked_maintenance_ids) ? s.linked_maintenance_ids : (Array.isArray(s.linkedMaintenanceIds) ? s.linkedMaintenanceIds : [])).length;
          const isSelected = s.id === selectedShiftId;

          return (
            '<label class="flex items-start gap-3 p-3 rounded-xl border cursor-pointer transition-all ' +
              (isSelected ? 'bg-accent/10 border-accent shadow-xs' : 'bg-panel border-line hover:border-accent/40') + '">' +
              '<input type="radio" name="add-to-shift-radio" value="' + s.id + '" class="w-4 h-4 mt-0.5 accent-[var(--accent)] shrink-0" ' + (isSelected ? 'checked' : '') + ' />' +
              '<div class="min-w-0 flex-1">' +
                '<div class="flex items-center justify-between gap-2 flex-wrap">' +
                  '<span class="font-semibold text-ink text-sm">' + ui.esc(s.name) + '</span>' +
                  '<span class="px-2 py-0.5 rounded text-[10px] font-semibold bg-warning/15 text-warning border border-warning/30">' +
                    linkedCount + ' ticket' + (linkedCount === 1 ? '' : 's') + ' currently' +
                  '</span>' +
                '</div>' +
                '<div class="flex items-center gap-2.5 text-xs text-muted mt-1 flex-wrap">' +
                  '<span class="font-medium text-ink flex items-center gap-1">' +
                    ui.icon('clock', 'w-3 h-3 text-accent') +
                    (s.date ? ui.formatDate(s.date) : 'Date TBC') + (times ? ' (' + times + ')' : '') +
                  '</span>' +
                  '<span>\u00b7 ' + ui.esc(Array.isArray(s.space) ? s.space.join(', ') : (s.space || 'Venue')) + '</span>' +
                  '<span>\u00b7 Lead: <strong class="text-ink">' + ui.esc(leadName) + '</strong></span>' +
                '</div>' +
              '</div>' +
            '</label>'
          );
        }).join('')
      : '<div class="p-4 rounded-xl bg-panel2/50 border border-dashed border-line text-center text-xs text-muted">' +
          'No scheduled maintenance shifts found in Advancing.' +
        '</div>';

    const m = ui.modal({
      title: 'Add to Maintenance Shift',
      size: 'md:max-w-xl',
      body:
        '<div class="grid gap-4">' +
          '<div class="panel p-3 bg-panel2/40 border border-line rounded-xl text-xs">' +
            '<div class="font-semibold text-ink mb-1">Adding ' + targetIds.length + ' Ticket' + (targetIds.length === 1 ? '' : 's') + ' / Order' + (targetIds.length === 1 ? '' : 's') + ':</div>' +
            '<div class="flex flex-wrap gap-1.5">' +
              ticketRecords.map((t) =>
                '<span class="px-2 py-0.5 rounded bg-panel border border-line text-[11px] font-medium text-ink flex items-center gap-1">' +
                  (t.taskType === 'consumables' ? ui.icon('cart', 'w-3 h-3 text-purple-400') : ui.icon('tool', 'w-3 h-3 text-warning')) +
                  ui.esc(t.equipment || 'Task') +
                '</span>'
              ).join('') +
            '</div>' +
          '</div>' +

          '<div>' +
            '<label class="block text-xs font-bold text-ink uppercase tracking-wider mb-2">Select Existing Maintenance Shift</label>' +
            '<div id="add-shift-cards" class="grid gap-2 max-h-64 overflow-y-auto pr-1">' +
              shiftCardsHtml +
            '</div>' +
          '</div>' +

          '<div class="pt-2 border-t border-line flex items-center justify-between gap-2 flex-wrap">' +
            '<span class="text-xs text-muted">Need a new shift instead?</span>' +
            '<button type="button" id="btn-create-new-shift" class="btn btn-secondary !py-1.5 !px-3 text-xs flex items-center gap-1 text-accent">' +
              ui.icon('plus', 'w-3.5 h-3.5') + '<span>Schedule New Shift</span>' +
            '</button>' +
          '</div>' +
        '</div>',
      footer:
        '<button class="btn btn-ghost" data-cancel>Cancel</button>' +
        '<button class="btn btn-primary" data-confirm data-primary ' + (!existingShifts.length ? 'disabled' : '') + '>' +
          ui.icon('check', 'w-4 h-4') + 'Add to Selected Shift' +
        '</button>',
    });

    const shiftCardsWrap = m.root.querySelector('#add-shift-cards');
    if (shiftCardsWrap) {
      shiftCardsWrap.querySelectorAll('input[type="radio"]').forEach((rb) => {
        rb.addEventListener('change', (e) => {
          selectedShiftId = e.target.value;
          shiftCardsWrap.querySelectorAll('label').forEach((lbl) => {
            const hasChecked = lbl.querySelector('input:checked');
            lbl.className = 'flex items-start gap-3 p-3 rounded-xl border cursor-pointer transition-all ' +
              (hasChecked ? 'bg-accent/10 border-accent shadow-xs' : 'bg-panel border-line hover:border-accent/40');
          });
        });
      });
    }

    const createNewBtn = m.root.querySelector('#btn-create-new-shift');
    if (createNewBtn) {
      createNewBtn.addEventListener('click', () => {
        m.close();
        openShiftModal(null, onComplete, targetIds);
      });
    }

    m.root.querySelector('[data-cancel]').addEventListener('click', m.close);
    const confirmBtn = m.root.querySelector('[data-confirm]');
    if (confirmBtn) {
      confirmBtn.addEventListener('click', () => {
        if (!selectedShiftId) {
          ui.toast('Select a maintenance shift to add to', 'danger');
          return;
        }
        const shift = store.find('advancing', selectedShiftId);
        if (!shift) {
          ui.toast('Selected shift could not be found', 'danger');
          return;
        }

        const existingLinked = Array.isArray(shift.linked_maintenance_ids)
          ? shift.linked_maintenance_ids.slice()
          : (Array.isArray(shift.linkedMaintenanceIds) ? shift.linkedMaintenanceIds.slice() : []);

        targetIds.forEach((id) => {
          if (!existingLinked.includes(id)) existingLinked.push(id);
        });

        shift.linked_maintenance_ids = existingLinked;
        shift.linkedMaintenanceIds = existingLinked;
        store.upsert('advancing', shift);

        m.close();
        ui.toast('Added ' + targetIds.length + ' ticket' + (targetIds.length === 1 ? '' : 's') + ' to shift \u201c' + shift.name + '\u201d (' + (shift.date || 'TBC') + ')', 'ok');
        if (onComplete) onComplete(shift);
        else RMTP.router.render();
      });
    }
  }

  return { openForm, openShiftModal, openAddToShiftModal, mapInventoryCategory };
})();

RMTP.views.maintenance = function (el, params, query) {
  const ui = RMTP.ui, store = RMTP.store, files = RMTP.files, auth = RMTP.auth;
  const me = auth.current();
  const isAdmin = !!(me && me.admin);

  let currentTab = (params && params[0]) || (query && query.status) || 'open';
  let searchQuery = '';
  let selectedTicketIds = new Set();

  function renderView() {
    const allRows = store.all('maintenance').sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));

    // Filter matching
    const filteredByTab = allRows.filter((r) => {
      if (currentTab === 'all') return true;
      if (currentTab === 'open') return r.status === 'Open';
      if (currentTab === 'in-progress') return r.status === 'In progress';
      if (currentTab === 'resolved') return r.status === 'Resolved';
      if (currentTab === 'consumables') return r.taskType === 'consumables' || r.category === 'Consumables';
      if (currentTab === 'faults') return r.taskType !== 'consumables' && r.category !== 'Consumables';
      return true;
    });

    const q = searchQuery.toLowerCase().trim();
    const finalShown = filteredByTab.filter((r) => {
      if (!q) return true;
      const eq = String(r.equipment || '').toLowerCase();
      const desc = String(r.description || '').toLowerCase();
      const tag = String(r.itemTag || '').toLowerCase();
      const kitName = String(r.itemName || '').toLowerCase();
      const sp = String(r.space || r.location || '').toLowerCase();
      const rep = String(r.reportedBy || '').toLowerCase();
      const tech = String(r.assignedTechName || '').toLowerCase();
      const itemsStr = Array.isArray(r.consumableItems) ? r.consumableItems.map((ci) => ci.name + ' ' + ci.notes).join(' ').toLowerCase() : '';
      return eq.includes(q) || desc.includes(q) || tag.includes(q) || kitName.includes(q) || sp.includes(q) || rep.includes(q) || tech.includes(q) || itemsStr.includes(q);
    });

    const counts = {
      all: allRows.length,
      open: allRows.filter((r) => r.status === 'Open').length,
      consumables: allRows.filter((r) => r.taskType === 'consumables' || r.category === 'Consumables').length,
      faults: allRows.filter((r) => r.taskType !== 'consumables' && r.category !== 'Consumables').length,
      'in-progress': allRows.filter((r) => r.status === 'In progress').length,
      resolved: allRows.filter((r) => r.status === 'Resolved').length,
    };

    const filters = [
      { id: 'open', label: 'Open' },
      { id: 'consumables', label: 'Consumables Orders', icon: 'cart' },
      { id: 'faults', label: 'Equipment Faults', icon: 'tool' },
      { id: 'in-progress', label: 'In progress' },
      { id: 'resolved', label: 'Resolved' },
      { id: 'all', label: 'All' },
    ];

    const filterBar = filters.map((f) =>
      '<button type="button" data-filter-tab="' + f.id + '" class="px-3 py-1.5 rounded-lg text-sm font-medium border flex items-center gap-1.5 transition-colors ' +
        (currentTab === f.id ? 'bg-panel2 border-accent text-ink font-semibold shadow-xs' : 'border-line text-muted hover:text-ink') + '">' +
        (f.icon ? ui.icon(f.icon, 'w-3.5 h-3.5') : '') +
        '<span>' + ui.esc(f.label) + '</span>' +
        '<span class="tabular text-xs opacity-75 font-mono">(' + counts[f.id] + ')</span>' +
      '</button>'
    ).join('');

    const multiBarHtml = selectedTicketIds.size > 0 ? (
      '<div class="p-3 rounded-xl bg-accent/10 border border-accent/40 flex items-center justify-between gap-3 mb-4 animate-in fade-in duration-150 flex-wrap">' +
        '<div class="flex items-center gap-2">' +
          '<span class="w-6 h-6 rounded-full bg-accent text-panel flex items-center justify-center font-bold text-xs">' + selectedTicketIds.size + '</span>' +
          '<span class="text-sm font-semibold text-ink">Ticket' + (selectedTicketIds.size === 1 ? '' : 's') + ' Selected</span>' +
        '</div>' +
        '<div class="flex items-center gap-2">' +
          '<button type="button" id="btn-batch-add-shift" class="btn btn-primary !py-1.5 !px-3 text-xs flex items-center gap-1.5">' +
            ui.icon('clock', 'w-3.5 h-3.5') + '<span>Add to Maintenance Shift</span>' +
          '</button>' +
          '<button type="button" id="btn-batch-clear" class="btn btn-ghost !py-1.5 !px-2.5 text-xs text-muted">Clear</button>' +
        '</div>' +
      '</div>'
    ) : '';

    const listHtml = finalShown.length
      ? finalShown.map(renderRow).join('')
      : ui.empty('wrench', currentTab === 'all' ? 'No faults or orders logged' : 'No tickets matching filter',
          currentTab === 'all' ? 'Log the first one with \u201cReport a fault\u201d or \u201cOrder Consumables\u201d.' : 'Try a different search or filter.');

    el.innerHTML =
      '<div class="view-enter">' +
        ui.pageHeader('Maintenance', 'Fault Log & Consumables Ordering',
          '<div class="flex items-center gap-2 flex-wrap">' +
            '<button id="new-consumables" class="btn btn-secondary text-xs sm:text-sm !py-1.5 !px-2.5 sm:!px-3 flex items-center gap-1.5 text-accent"><span class="text-accent">' + ui.icon('cart', 'w-3.5 h-3.5') + '</span><span>Order Consumables</span></button>' +
            '<button id="schedule-shift-btn" class="btn btn-secondary text-xs sm:text-sm !py-1.5 !px-2.5 sm:!px-3 flex items-center gap-1.5"><span class="text-accent">' + ui.icon('clock', 'w-3.5 h-3.5') + '</span><span>Schedule Shift</span></button>' +
            '<button id="new-fault" class="btn btn-primary text-xs sm:text-sm !py-1.5 !px-2.5 sm:!px-3 flex items-center gap-1.5">' + ui.icon('plus', 'w-3.5 h-3.5') + '<span>Report a fault</span></button>' +
          '</div>') +
        flaggedPanel() +
        '<div class="relative mb-3.5">' +
          '<span class="absolute left-3 top-2.5 text-muted pointer-events-none">' + ui.icon('search', 'w-4 h-4') + '</span>' +
          '<input id="maint-search" class="field !pl-9 w-full" value="' + ui.esc(searchQuery) + '" placeholder="Search faults & consumables by equipment name, asset tag, space, reporter, tagged tech..." />' +
        '</div>' +
        '<div class="flex flex-wrap gap-2 mb-4">' + filterBar + '</div>' +
        multiBarHtml +
        '<div class="grid gap-3">' + listHtml + '</div>' +
      '</div>';

    wireEvents(finalShown);
  }

  function wireEvents(finalShown) {
    el.querySelector('#new-fault').addEventListener('click', () => RMTP.maintenance.openForm());
    const consBtn = el.querySelector('#new-consumables');
    if (consBtn) consBtn.addEventListener('click', () => RMTP.maintenance.openForm(null, null, null, 'consumables'));
    const schedBtn = el.querySelector('#schedule-shift-btn');
    if (schedBtn) schedBtn.addEventListener('click', () => RMTP.maintenance.openShiftModal());

    const searchInp = el.querySelector('#maint-search');
    if (searchInp) {
      searchInp.addEventListener('input', (e) => {
        searchQuery = e.target.value;
        renderView();
        const freshInp = el.querySelector('#maint-search');
        if (freshInp) {
          freshInp.focus();
          freshInp.setSelectionRange(freshInp.value.length, freshInp.value.length);
        }
      });
    }

    el.querySelectorAll('[data-filter-tab]').forEach((tab) => {
      tab.addEventListener('click', () => {
        currentTab = tab.getAttribute('data-filter-tab');
        renderView();
      });
    });

    const batchAddBtn = el.querySelector('#btn-batch-add-shift');
    if (batchAddBtn) {
      batchAddBtn.addEventListener('click', () => {
        RMTP.maintenance.openAddToShiftModal(Array.from(selectedTicketIds), () => {
          selectedTicketIds.clear();
          renderView();
        });
      });
    }

    const batchClearBtn = el.querySelector('#btn-batch-clear');
    if (batchClearBtn) {
      batchClearBtn.addEventListener('click', () => {
        selectedTicketIds.clear();
        renderView();
      });
    }

    finalShown.forEach((r) => {
      const qSel = (sel) => el.querySelector(sel);
      const eBtn = qSel('[data-edit="' + r.id + '"]');
      if (eBtn) eBtn.addEventListener('click', () => RMTP.maintenance.openForm(r));

      const dBtn = qSel('[data-del="' + r.id + '"]');
      if (dBtn) dBtn.addEventListener('click', () => del(r));

      const stSel = qSel('[data-status="' + r.id + '"]');
      if (stSel) stSel.addEventListener('change', (ev) => setStatus(r, ev.target.value));

      const rvBtn = qSel('[data-resolve="' + r.id + '"]');
      if (rvBtn) rvBtn.addEventListener('click', () => resolveFault(r));

      const roBtn = qSel('[data-reopen="' + r.id + '"]');
      if (roBtn) roBtn.addEventListener('click', () => reopenFault(r));

      const addShiftBtn = qSel('[data-add-shift="' + r.id + '"]');
      if (addShiftBtn) addShiftBtn.addEventListener('click', () => RMTP.maintenance.openAddToShiftModal([r.id]));

      const quickOrderBtn = qSel('[data-quick-order="' + r.id + '"]');
      if (quickOrderBtn) quickOrderBtn.addEventListener('click', () => setStatus(r, 'In progress'));

      const quickRecBtn = qSel('[data-quick-receive="' + r.id + '"]');
      if (quickRecBtn) quickRecBtn.addEventListener('click', () => setStatus(r, 'Resolved'));

      const imgBtn = qSel('[data-img="' + r.id + '"]');
      if (imgBtn) imgBtn.addEventListener('click', () => files.open(r.image));

      const checkInp = qSel('[data-ticket-check="' + r.id + '"]');
      if (checkInp) {
        checkInp.addEventListener('change', (ev) => {
          if (ev.target.checked) selectedTicketIds.add(r.id);
          else selectedTicketIds.delete(r.id);
          renderView();
        });
      }

      const inlineTechSel = qSel('[data-inline-assign-tech="' + r.id + '"]');
      if (inlineTechSel) {
        inlineTechSel.addEventListener('change', (ev) => {
          const uId = ev.target.value;
          const uObj = uId ? store.find('users', uId) : null;
          store.upsert('maintenance', Object.assign({}, r, {
            assignedTechId: uObj ? uObj.id : '',
            assignedTechName: uObj ? auth.displayName(uObj) : ''
          }));
          ui.toast(uObj ? 'Tagged ' + auth.displayName(uObj) : 'Removed technician tag', 'ok');
          renderView();
        });
      }
    });
  }

  function renderRow(r) {
    const prioColour = { 'Urgent': 'var(--danger)', 'High': 'var(--danger)', 'Medium': 'var(--info)', 'Low': 'var(--muted)' };
    const statusColour = { 'Open': 'var(--danger)', 'In progress': 'var(--info)', 'Resolved': 'var(--ok)' };
    const SELECTABLE = ['Open', 'In progress'];
    const img = r.image ? files.dataUrl(r.image) : null;
    const isConsumables = r.taskType === 'consumables' || r.category === 'Consumables';
    const allUsers = store.all('users');

    // Find linked scheduled shifts
    const allAdv = store.all('advancing').filter((e) => !e.deleted);
    const linkedShifts = allAdv.filter((e) => {
      const ids = Array.isArray(e.linked_maintenance_ids) ? e.linked_maintenance_ids : (Array.isArray(e.linkedMaintenanceIds) ? e.linkedMaintenanceIds : []);
      return ids.includes(r.id);
    });

    const shiftBadgesHtml = linkedShifts.length ? (
      '<div class="mt-2.5 pt-2 border-t border-line/50 flex flex-wrap gap-2 items-center">' +
        linkedShifts.map((s) => {
          const leadUser = s.technicians && s.technicians[0] && s.technicians[0].userId ? store.find('users', s.technicians[0].userId) : null;
          const techName = leadUser ? (RMTP.auth.displayName(leadUser) || leadUser.name) : 'Tech assigned';
          const shiftTimes = [s.startTime, s.finishTime].filter(Boolean).join(' \u2013 ');
          const shiftSpace = Array.isArray(s.space) ? s.space.join(', ') : (s.space || 'Venue');
          return (
            '<a href="#/advancing?openEvent=' + encodeURIComponent(s.id) + '" class="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium bg-accent/15 text-accent border border-accent/30 hover:bg-accent/25 transition-colors cursor-pointer" title="View scheduled shift in Advancing">' +
              ui.icon('clock', 'w-3.5 h-3.5 text-accent') +
              '<span>Shift: <strong>' + (s.date ? ui.formatDate(s.date) : 'TBC') + '</strong>' +
                (shiftTimes ? ' \u00b7 ' + ui.esc(shiftTimes) : '') +
                ' \u00b7 ' + ui.esc(shiftSpace) +
                ' \u00b7 Tech: ' + ui.esc(techName) +
                ' \u00b7 <span class="uppercase text-[10px] tracking-wider font-bold">' + ui.esc(s.status || 'Confirmed') + '</span></span>' +
            '</a>'
          );
        }).join('') +
        '<button type="button" data-add-shift="' + r.id + '" class="text-[11px] text-accent hover:underline flex items-center gap-1 ml-1" title="Add to another shift">' +
          ui.icon('plus', 'w-3 h-3') + '<span>Add to another shift</span>' +
        '</button>' +
      '</div>'
    ) : (
      '<div class="mt-2 pt-2 border-t border-line/40 flex items-center gap-2">' +
        '<button type="button" data-add-shift="' + r.id + '" class="btn btn-secondary !py-1 !px-2.5 text-xs flex items-center gap-1.5 text-accent hover:bg-accent/10">' +
          ui.icon('clock', 'w-3.5 h-3.5 text-accent') + '<span>Add to Maintenance Shift</span>' +
        '</button>' +
      '</div>'
    );

    const consumableChecklistHtml = (isConsumables && Array.isArray(r.consumableItems) && r.consumableItems.length) ? (
      '<div class="mt-2.5 p-2.5 rounded-lg bg-purple-500/10 border border-purple-500/25 grid gap-1.5 text-xs">' +
        '<div class="font-bold text-purple-300 text-[11px] uppercase tracking-wider flex items-center gap-1.5">' +
          ui.icon('cart', 'w-3.5 h-3.5') + '<span>Consumables Checklist (' + r.consumableItems.length + ' item' + (r.consumableItems.length === 1 ? '' : 's') + '):</span>' +
        '</div>' +
        '<div class="grid grid-cols-1 sm:grid-cols-2 gap-1.5">' +
          r.consumableItems.map((ci) =>
            '<div class="flex items-center gap-2 bg-panel/70 p-1.5 rounded border border-purple-500/20">' +
              '<span class="w-1.5 h-1.5 rounded-full bg-purple-400 shrink-0"></span>' +
              '<div class="min-w-0 flex-1 truncate">' +
                '<strong class="text-ink">' + ui.esc(ci.name) + '</strong>' +
                (ci.qty ? ' <span class="tabular font-mono text-purple-300 font-semibold">(' + ui.esc(ci.qty) + ')</span>' : '') +
                (ci.notes ? ' \u2014 <span class="text-muted text-[11px]">' + ui.esc(ci.notes) + '</span>' : '') +
              '</div>' +
            '</div>'
          ).join('') +
        '</div>' +
      '</div>'
    ) : '';

    const isChecked = selectedTicketIds.has(r.id);

    return (
      '<div class="panel p-4 ' + (isChecked ? 'border-accent bg-accent/5' : '') + '">' +
        '<div class="flex flex-col sm:flex-row items-start gap-3">' +
          '<div class="flex items-center gap-2 self-start shrink-0">' +
            '<input type="checkbox" data-ticket-check="' + r.id + '" class="w-4 h-4 mt-1 rounded accent-[var(--accent)] cursor-pointer" ' + (isChecked ? 'checked' : '') + ' title="Select for shift allocation" />' +
            (img ? '<button data-img="' + r.id + '" class="w-14 h-14 rounded-lg overflow-hidden border border-line shrink-0" title="View photo">' +
              '<img src="' + img + '" class="w-full h-full object-cover" alt="Fault photo" /></button>' : '') +
          '</div>' +

          '<div class="min-w-0 flex-1 w-full">' +
            '<div class="flex items-center gap-2 flex-wrap">' +
              (isConsumables
                ? '<span class="px-2 py-0.5 rounded text-xs font-bold bg-purple-500/20 text-purple-300 border border-purple-500/35 flex items-center gap-1.5">' + ui.icon('cart', 'w-3.5 h-3.5') + 'Consumables Order</span>'
                : '<span class="px-2 py-0.5 rounded text-xs font-bold bg-amber-500/20 text-amber-300 border border-amber-500/35 flex items-center gap-1.5">' + ui.icon('tool', 'w-3.5 h-3.5') + 'Fault Report</span>') +
              '<h3 class="font-semibold text-base truncate text-ink">' + ui.esc(r.equipment) + '</h3>' +
              ui.pill(r.priority, prioColour[r.priority] || 'var(--muted)') +
              (r.status === 'Resolved'
                ? ui.pill('Resolved', 'var(--ok)')
                : (isConsumables
                    ? (r.status === 'In progress' ? '<span class="px-2 py-0.5 rounded text-[10px] font-bold bg-info/20 text-info border border-info/30">Order Placed</span>' : '<span class="px-2 py-0.5 rounded text-[10px] font-bold bg-warning/20 text-warning border border-warning/30">Needs Ordering</span>')
                    : ui.pill(r.status || 'Open', statusColour[r.status] || 'var(--warning)'))) +
            '</div>' +

            '<div class="flex items-center gap-2 text-xs text-muted mt-1.5 flex-wrap">' +
              '<span>' + ui.esc(r.category) + '</span>' +
              '<span>\u00b7 ' + ui.esc(r.space || r.location || 'No space specified') + '</span>' +
              '<span>\u00b7 ' + ui.timeAgo(r.createdAt) + '</span>' +
              (r.reportedBy ? '<span>\u00b7 Reported by <strong class="text-ink">' + ui.esc(r.reportedBy) + '</strong></span>' : '') +
              /* Tagged Tech pill & inline changer */
              '<span class="inline-flex items-center gap-1.5 px-2 py-0.5 rounded text-xs font-medium bg-panel2 border border-line">' +
                ui.icon('user', 'w-3 h-3 text-accent') +
                '<span>Tech:</span>' +
                '<select data-inline-assign-tech="' + r.id + '" class="bg-transparent border-0 text-xs font-semibold text-accent p-0 cursor-pointer focus:ring-0">' +
                  '<option value="">Unassigned</option>' +
                  allUsers.map((u) => '<option value="' + u.id + '" ' + (r.assignedTechId === u.id || r.assignedTechName === auth.displayName(u) ? 'selected' : '') + '>' + ui.esc(auth.displayName(u)) + '</option>').join('') +
                '</select>' +
              '</span>' +
            '</div>' +

            (r.itemName ? '<p class="text-xs mt-1.5"><span class="text-muted">Linked Kit:</span> <strong class="text-ink">' + ui.esc(r.itemName) + '</strong>' +
              (r.itemTag ? ' <span class="tabular font-mono text-accent font-semibold">(' + ui.esc(r.itemTag) + ')</span>' : '') + '</p>' : '') +

            consumableChecklistHtml +

            (r.description ? '<p class="text-sm text-ink/85 mt-2 whitespace-pre-wrap">' + ui.esc(r.description) + '</p>' : '') +

            (isAdmin && r.status === 'Resolved' && r.resolution ?
              '<div class="mt-2.5 panel bg-panel2/40 p-2.5 rounded-lg border border-line">' +
                '<p class="eyebrow" style="color:var(--ok)">' + (isConsumables ? 'Order & Delivery Record' : 'How it was fixed') + '</p>' +
                '<p class="text-sm mt-0.5 whitespace-pre-wrap">' + ui.esc(r.resolution) + '</p>' +
                '<p class="text-[11px] text-muted mt-1">' + ui.esc(r.resolvedBy || '') + (r.resolvedAt ? ' \u00b7 ' + ui.timeAgo(new Date(r.resolvedAt).getTime()) : '') + '</p>' +
              '</div>' : '') +

            shiftBadgesHtml +
          '</div>' +

          /* Card Action Controls */
          '<div class="flex flex-row sm:flex-col items-center sm:items-end justify-between sm:justify-start gap-2 shrink-0 w-full sm:w-auto pt-2 sm:pt-0 border-t sm:border-t-0 border-line/50">' +
            (r.status === 'Resolved'
              ? (isAdmin ? '<button data-reopen="' + r.id + '" class="btn btn-ghost !py-1 !px-2.5 text-xs">Reopen</button>' : '')
              : (isConsumables
                  ? (r.status === 'Open'
                      ? '<button data-quick-order="' + r.id + '" class="btn btn-secondary !py-1 !px-2.5 text-xs flex items-center gap-1 text-info hover:bg-info/10" title="Mark order as placed">' + ui.icon('cart', 'w-3.5 h-3.5') + '<span>Mark Ordered</span></button>'
                      : '<button data-quick-receive="' + r.id + '" class="btn btn-primary !py-1 !px-2.5 text-xs flex items-center gap-1" title="Mark consumables delivered & in stock">' + ui.icon('check', 'w-3.5 h-3.5') + '<span>Mark Received</span></button>')
                  : '<select data-status="' + r.id + '" class="field !py-1.5 !px-2 text-xs !w-auto" ' +
                      'style="border-color:color-mix(in srgb,' + statusColour[r.status] + ' 45%,var(--line))">' +
                      SELECTABLE.map((s) => '<option ' + (s === r.status ? 'selected' : '') + '>' + s + '</option>').join('') +
                    '</select>' +
                    (isAdmin ? '<button data-resolve="' + r.id + '" class="btn btn-primary !py-1.5 !px-2.5 text-xs flex items-center gap-1">' + ui.icon('check', 'w-4 h-4') + '<span>Resolve</span></button>' : ''))) +

            '<div class="flex gap-1">' +
              '<button data-edit="' + r.id + '" class="btn btn-ghost !p-2" title="Edit ticket">' + ui.icon('pen', 'w-4 h-4') + '</button>' +
              '<button data-del="' + r.id + '" class="btn btn-danger !p-2" title="Delete ticket">' + ui.icon('trash', 'w-4 h-4') + '</button>' +
            '</div>' +
          '</div>' +
        '</div>' +
      '</div>'
    );
  }

  function setStatus(r, status) {
    store.upsert('maintenance', Object.assign({}, r, { status }));
    ui.toast('Marked ' + status.toLowerCase(), 'ok');
    renderView();
  }

  /* Admin-only: resolve fault and return kit to circulation */
  function resolveFault(r) {
    if (!isAdmin) { ui.toast('Only admins can resolve faults', 'danger'); return; }
    const item = r.itemId ? store.find('inventory', r.itemId) : null;
    const parentItem = item && (item.parentId || r.parentId) ? store.find('inventory', item.parentId || r.parentId) : null;
    const condOpts = ['Good', 'Fair'];

    const defaultReturnLocation = r.originLocation || r.previousLocation ||
      (item ? (item.previousLocation || item.originLocation || (item.location !== 'SERVICE' ? item.location : '')) : '') ||
      (parentItem ? (parentItem.location && parentItem.location !== 'SERVICE' ? parentItem.location : (parentItem.previousLocation || parentItem.originLocation || '')) : '') ||
      r.space || 'Store A';

    const locationOptionsHtml = () => {
      const spaces = RMTP.SPACES || [];
      const stores = RMTP.STORES || [];
      const optGroup = (label, arr) => arr.length ? '<optgroup label="' + label + '">' +
        arr.map((v) => '<option value="' + ui.esc(v) + '"' + (v === defaultReturnLocation ? ' selected' : '') + '>' + ui.esc(v) + '</option>').join('') + '</optgroup>' : '';
      return optGroup('Spaces', spaces) + optGroup('Stores', stores);
    };

    const isConsumable = r.taskType === 'consumables' || r.category === 'Consumables';

    const m = ui.modal({
      title: isConsumable ? 'Mark Consumables Order Resolved' : 'Resolve fault',
      size: 'md:max-w-md',
      body:
        '<p class="text-sm text-muted mb-4">' + ui.esc(r.equipment) + '</p>' +
        '<label class="block text-sm font-medium mb-2">' + (isConsumable ? 'Delivery & Stocking Notes' : 'How was it fixed?') + '</label>' +
        '<textarea id="res-notes" class="field mb-4" rows="3" placeholder="' + (isConsumable ? 'Items delivered, stored in backstage cupboard/pit box, invoice filed\u2026' : 'What was done to fix it\u2026') + '"></textarea>' +
        (!isConsumable && item
          ? '<div class="grid gap-3.5 mb-2">' +
              '<div class="grid grid-cols-1 sm:grid-cols-2 gap-3">' +
                '<div>' +
                  '<label class="block text-sm font-medium mb-1">Return condition</label>' +
                  '<select id="res-cond" class="field">' + condOpts.map((c) => '<option>' + c + '</option>').join('') + '</select>' +
                '</div>' +
                '<div>' +
                  '<label class="block text-sm font-medium mb-1">Return location</label>' +
                  '<select id="res-destination" class="field">' + locationOptionsHtml() + '</select>' +
                '</div>' +
              '</div>' +
              (parentItem
                ? '<div class="panel p-3 bg-panel2/40 border border-line">' +
                    '<label class="flex items-center gap-2 cursor-pointer">' +
                      '<input type="checkbox" id="res-merge-parent" checked class="w-4 h-4 rounded text-accent" />' +
                      '<span class="text-sm font-medium">Merge back into parent batch</span>' +
                    '</label>' +
                    '<p class="text-xs text-muted mt-1 ml-6">Recombines ' + (item.qty || 1) + ' \u00d7 with <span class="font-medium">' + ui.esc(parentItem.name) + '</span> in <span class="font-semibold text-accent" id="res-target-label">' + ui.esc(defaultReturnLocation) + '</span>.</p>' +
                  '</div>'
                : '') +
              '<div class="panel p-2.5 bg-emerald-500/10 border border-emerald-500/20 text-xs text-emerald-300 flex items-center gap-2">' +
                ui.icon('check', 'w-4 h-4 shrink-0 text-emerald-400') +
                '<span>This kit will be returned to <span id="res-dest-text" class="font-semibold underline">' + ui.esc(defaultReturnLocation) + '</span> and marked <strong>In Circulation</strong>.</span>' +
              '</div>' +
            '</div>'
          : (!isConsumable ? '<p class="text-xs text-muted">No kit is linked to this fault.</p>' : '')),
      footer:
        '<button class="btn btn-ghost" data-cancel>Cancel</button>' +
        '<button class="btn btn-primary" data-ok data-primary>' + ui.icon('check', 'w-4 h-4') + (isConsumable ? 'Confirm Delivered & Stocked' : 'Resolve &amp; return to use') + '</button>',
    });

    const destSelect = m.root.querySelector('#res-destination');
    const destText = m.root.querySelector('#res-dest-text');
    const targetLabel = m.root.querySelector('#res-target-label');
    if (destSelect) {
      destSelect.addEventListener('change', () => {
        const val = destSelect.value;
        if (destText) destText.textContent = val;
        if (targetLabel) targetLabel.textContent = val;
      });
    }

    m.root.querySelector('[data-cancel]').addEventListener('click', m.close);
    m.root.querySelector('[data-ok]').addEventListener('click', () => {
      const notes = m.root.querySelector('#res-notes').value.trim();
      if (!notes) { ui.toast('Add a note before resolving', 'danger'); return; }
      const now = new Date().toISOString();
      const resolvedCondition = m.root.querySelector('#res-cond') ? m.root.querySelector('#res-cond').value : 'Good';
      const targetDestination = destSelect ? destSelect.value : defaultReturnLocation;
      const mergeCheckbox = m.root.querySelector('#res-merge-parent');
      const shouldMerge = mergeCheckbox && mergeCheckbox.checked && parentItem;
      const by = auth.displayName(me) || 'Admin';

      store.upsert('maintenance', Object.assign({}, r, {
        status: 'Resolved',
        resolution: notes,
        resolvedBy: by,
        resolvedAt: now,
        returnedTo: targetDestination,
      }));

      if (item && !isConsumable) {
        const fresh = store.find('inventory', item.id) || item;
        if (shouldMerge) {
          const freshParent = store.find('inventory', parentItem.id) || parentItem;
          const mergedQty = (Number(freshParent.qty) || 0) + (Number(fresh.qty) || 1);
          const parentLoc = targetDestination || freshParent.location || defaultReturnLocation;
          const updatedMovements = (freshParent.movements || []).concat({
            from: 'SERVICE',
            to: parentLoc,
            at: now,
            by: by,
            note: 'Fault resolved: returned to ' + parentLoc + ' in ' + resolvedCondition + ' condition and merged ' + (fresh.qty || 1) + ' \u00d7 units back from SERVICE: ' + notes
          });
          store.upsert('inventory', Object.assign({}, freshParent, {
            qty: mergedQty,
            location: parentLoc,
            condition: resolvedCondition,
            status: 'in',
            heldBy: '',
            outAt: '',
            movements: updatedMovements
          }));
          store.remove('inventory', fresh.id);
        } else {
          const cleanName = fresh.name.replace(/\s*\(Faulty.*?\)\s*/gi, '').trim();
          store.upsert('inventory', Object.assign({}, fresh, {
            name: cleanName || fresh.name,
            condition: resolvedCondition,
            location: targetDestination,
            previousLocation: targetDestination,
            status: 'in',
            heldBy: '',
            outAt: '',
            movements: (fresh.movements || []).concat({
              from: 'SERVICE',
              to: targetDestination,
              at: now,
              by: by,
              note: 'Fault resolved: returned to ' + targetDestination + ' in ' + resolvedCondition + ' condition: ' + notes
            })
          }));
        }
      }

      m.close();
      ui.toast(isConsumable ? 'Consumables marked as delivered and in stock' : 'Fault resolved \u2014 kit returned to ' + targetDestination + ' in circulation', 'ok');
      renderView();
    });
  }

  function reopenFault(r) {
    if (!isAdmin) return;
    store.upsert('maintenance', Object.assign({}, r, { status: 'Open' }));
    ui.toast('Ticket reopened', 'ok');
    renderView();
  }

  async function del(r) {
    const ok = await ui.confirm('Delete this maintenance record? This can\u2019t be undone.',
      { title: 'Delete ticket', confirmLabel: 'Delete', danger: true });
    if (ok) {
      if (r.image) files.remove(r.image);
      store.remove('maintenance', r.id);
      ui.toast('Ticket deleted', 'ok');
      renderView();
    }
  }

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
    return '<div class="panel p-4 mb-4" style="border-color:color-mix(in srgb,var(--danger) 40%,var(--line))">' +
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

  // Initial render
  renderView();

  // Check query params if fault form or shift modal should auto open
  if (query && (query.action === 'new' || query.itemId)) {
    const linkedKit = query.itemId ? store.find('inventory', query.itemId) : null;
    setTimeout(() => RMTP.maintenance.openForm(null, linkedKit, null, query.taskType || 'fault'), 50);
  }
  if (query && (query.action === 'schedule-shift' || query.action === 'schedule-maintenance')) {
    setTimeout(() => RMTP.maintenance.openShiftModal(query.faultId), 50);
  }
  if (query && query.action === 'order-consumables') {
    setTimeout(() => RMTP.maintenance.openForm(null, null, null, 'consumables'), 50);
  }
};
