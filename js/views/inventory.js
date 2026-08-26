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
RMTP.views.inventory = function (el, params, query) {
  const ui = RMTP.ui, store = RMTP.store, qr = RMTP.qr, auth = RMTP.auth;

  const canManage = auth.can('inventory.manage');
  const canMove = auth.can('inventory.move');
  const me = auth.current();
  const isAdmin = !!(me && me.admin);

  const CATEGORIES = ['Sound - Console/Stageboxes', 'Sound - PA/Speakers', 'Sound - Microphones', 'Sound - DI/Stands', 'Sound - Playback', 'Sound - Control', 'Backline', 'DJ Equipment', 'Lighting - Control', 'Lighting - Fixtures', 'Lighting - Rigging/Other', 'AV - Projection/Screens', 'Network - Projection/Screens', 'Power', 'Staging/Flooring', 'Other'];
  const condColour = { 'Excellent': 'var(--ok)', 'Good': 'var(--ok)', 'Fair': 'var(--accent)', 'Poor': 'var(--danger)', 'Damaged': 'var(--danger)', 'Out of service': 'var(--danger)' };
  const isStatic = (r) => !!r.static;

  function getHomeLocation(r) {
    if (!r) return '';
    if (r.homeLocation) return r.homeLocation;
    if (r.originLocation) return r.originLocation;
    if (r.previousLocation && r.previousLocation !== 'SERVICE') return r.previousLocation;
    if (r.movements && r.movements.length && r.movements[0].from) return r.movements[0].from;
    return r.location || '';
  }

  function isDisplaced(r) {
    if (!r || isStatic(r)) return false;
    const home = getHomeLocation(r);
    if (!home) return false;
    return r.location && r.location !== home;
  }

  let searchQuery = '';
  let spaceFilter = '';
  let categoryFilter = '';
  let movementFilter = (query && query.filter) || ''; // '', 'moved', 'in-place', 'out', 'service'
  let selectedIds = new Set();
  let selectMode = false;

  // Robust item lookup helper across tags, IDs, barcodes, prefixes, names
  function findItemsByQuery(tagOrId) {
    if (!tagOrId) return [];
    const q = String(tagOrId).trim().toLowerCase();
    const all = store.all('inventory');

    // 1. Exact match on tag (case-insensitive)
    let found = all.filter((r) => String(r.tag || '').trim().toLowerCase() === q);
    if (found.length) return found;

    // 2. Exact match on id (case-insensitive)
    found = all.filter((r) => String(r.id || '').trim().toLowerCase() === q);
    if (found.length) return found;

    // 3. Match barcode if present
    found = all.filter((r) => String(r.barcode || '').trim().toLowerCase() === q);
    if (found.length) return found;

    // 4. Match tag prefix or contained tag
    found = all.filter((r) => {
      const tg = String(r.tag || '').trim().toLowerCase();
      return tg && (tg === q || q.includes(tg) || tg.includes(q));
    });
    if (found.length) return found;

    // 5. Match name (case-insensitive)
    found = all.filter((r) => String(r.name || '').trim().toLowerCase() === q);
    if (found.length) return found;

    return [];
  }

  // Which items have an unresolved fault (recomputed each render).
  let faultItemIds = new Set();
  function refreshFaults() {
    faultItemIds = new Set(store.all('maintenance').filter((f) => f.status !== 'Resolved' && f.itemId).map((f) => f.itemId));
  }
  function isFlagged(r) { return RMTP.isPoorCondition(r.condition) || faultItemIds.has(r.id); }
  const inService = (r) => r.location === 'SERVICE';
  function flagReason(r) {
    const out = [];
    if (RMTP.isPoorCondition(r.condition)) out.push(r.condition);
    if (faultItemIds.has(r.id)) out.push('open fault');
    return out.join(' \u00b7 ');
  }

  function getHeaderActions() {
    return (canMove ? '<button id="toggle-select-mode" class="btn ' + (selectMode ? 'btn-primary' : 'btn-ghost') + '">' + ui.icon('check', 'w-4 h-4') + (selectMode ? 'Done' : 'Select Multiple') + '</button>' : '') +
      (canMove ? '<button id="scan-item" class="btn btn-primary">' + ui.icon('qr', 'w-4 h-4') + 'Scan QR</button>' : '') +
      (canManage ? '<button id="print-labels" class="btn btn-ghost">' + ui.icon('print', 'w-4 h-4') + 'Labels</button>' : '') +
      (canManage ? '<button id="add-item" class="btn btn-ghost">' + ui.icon('plus', 'w-4 h-4') + 'Add</button>' : '');
  }

  el.innerHTML =
    '<div class="view-enter">' +
      '<div id="inv-header-wrap"></div>' +
      '<div class="flex flex-col sm:flex-row gap-3 mb-4 items-stretch sm:items-center">' +
        '<div class="relative flex-1 max-w-md">' +
          '<span class="absolute left-3 top-1/2 -translate-y-1/2 text-muted">' + ui.icon('search', 'w-4 h-4') + '</span>' +
          '<input id="inv-search" class="field !pl-10 w-full" placeholder="Search name, tag, location, holder\u2026" />' +
        '</div>' +
        '<div class="w-full sm:w-auto flex flex-col sm:flex-row gap-2">' +
          '<select id="inv-category-filter" class="field text-sm !py-2 sm:min-w-[190px]" title="Filter by category"></select>' +
          '<select id="inv-movement-filter" class="field text-sm !py-2 sm:min-w-[170px]" title="Filter by movement status"></select>' +
        '</div>' +
      '</div>' +
      '<div id="inv-filters" class="flex flex-wrap gap-2 mb-4"></div>' +
      '<div id="inv-bulk-bar" class="mb-4 hidden"></div>' +
      '<div id="inv-moved-panel" class="mb-6"></div>' +
      '<div id="inv-list"></div>' +
      '<div id="inv-moves" class="mt-8"></div>' +
    '</div>';

  function renderHeader() {
    const hw = el.querySelector('#inv-header-wrap');
    if (!hw) return;
    hw.innerHTML = ui.pageHeader('Inventory', 'Equipment', getHeaderActions());
    const addBtn = hw.querySelector('#add-item');
    if (addBtn) addBtn.addEventListener('click', () => openForm());
    const scanBtn = hw.querySelector('#scan-item');
    if (scanBtn) scanBtn.addEventListener('click', handleScan);
    const labelsBtn = hw.querySelector('#print-labels');
    if (labelsBtn) labelsBtn.addEventListener('click', () => qr.labelPreview(store.all('inventory')));
    const toggleSelectBtn = hw.querySelector('#toggle-select-mode');
    if (toggleSelectBtn) toggleSelectBtn.addEventListener('click', () => {
      selectMode = !selectMode;
      if (!selectMode) selectedIds.clear();
      render();
    });
  }

  el.querySelector('#inv-search').addEventListener('input', (e) => { searchQuery = e.target.value.toLowerCase().trim(); render(); });
  
  const catSel = el.querySelector('#inv-category-filter');
  if (catSel) {
    catSel.addEventListener('change', (e) => {
      categoryFilter = e.target.value;
      render();
    });
  }

  const movSel = el.querySelector('#inv-movement-filter');
  if (movSel) {
    movSel.addEventListener('change', (e) => {
      movementFilter = e.target.value;
      render();
    });
  }

  render();

  // Check direct navigation via route parameter or query
  const directTarget = (params && params[0]) || (query && (query.item || query.tag || query.id));
  if (directTarget) {
    setTimeout(() => {
      const lines = findItemsByQuery(directTarget);
      if (lines.length === 1) {
        openDetail(lines[0]);
      } else if (lines.length > 1) {
        pickLine(lines, (it) => openDetail(it));
      } else {
        ui.toast('No inventory item found for \u201c' + directTarget + '\u201d', 'danger');
      }
    }, 80);
  } else if (query && (query.action === 'scan' || query.scan === '1')) {
    setTimeout(() => {
      handleScan();
    }, 80);
  }

  function inSpaceFilter(r) {
    if (!spaceFilter) return true;
    if (spaceFilter === 'store') return !RMTP.isSpace(r.location);
    return r.location === spaceFilter;
  }
  function inCategoryFilter(r) {
    if (!categoryFilter) return true;
    return r.category === categoryFilter;
  }
  function inMovementFilter(r) {
    if (!movementFilter) return true;
    if (movementFilter === 'moved') return isDisplaced(r);
    if (movementFilter === 'in-place') return !isDisplaced(r);
    if (movementFilter === 'out') return r.status === 'out';
    if (movementFilter === 'service') return r.location === 'SERVICE' || r.status === 'service';
    return true;
  }
  function matches(r) {
    const hay = (r.name + ' ' + (r.tag || '') + ' ' + (r.location || '') + ' ' + (getHomeLocation(r) || '') + ' ' + (r.category || '') + ' ' + (r.heldBy || '')).toLowerCase();
    return (!searchQuery || hay.includes(searchQuery)) && inSpaceFilter(r) && inCategoryFilter(r) && inMovementFilter(r);
  }

  function render() {
    refreshFaults();
    renderHeader();
    renderCategoryFilter();
    renderMovementFilter();
    renderFilters();
    renderBulkBar();
    renderMovedPanel();
    renderList();
    renderMoves();
  }

  function renderCategoryFilter() {
    const sel = el.querySelector('#inv-category-filter');
    if (!sel) return;
    const all = store.all('inventory');
    const distinct = Array.from(new Set(CATEGORIES.concat(all.map((r) => r.category).filter(Boolean))));
    const countFor = (cat) => all.filter((r) => r.category === cat).length;
    const opts = ['<option value="">All Categories (' + all.length + ')</option>'].concat(
      distinct.map((c) => {
        const n = countFor(c);
        return '<option value="' + ui.esc(c) + '"' + (categoryFilter === c ? ' selected' : '') + '>' +
          ui.esc(c) + ' (' + n + ')' +
        '</option>';
      })
    );
    sel.innerHTML = opts.join('');
  }

  function renderMovementFilter() {
    const sel = el.querySelector('#inv-movement-filter');
    if (!sel) return;
    const all = store.all('inventory');
    const displacedCount = all.filter(isDisplaced).length;
    const inPlaceCount = all.filter((r) => !isDisplaced(r)).length;
    const outCount = all.filter((r) => r.status === 'out').length;
    const serviceCount = all.filter((r) => r.location === 'SERVICE' || r.status === 'service').length;

    const opts = [
      '<option value="" ' + (!movementFilter ? 'selected' : '') + '>All Movement (' + all.length + ')</option>',
      '<option value="moved" ' + (movementFilter === 'moved' ? 'selected' : '') + '>Moved Kit (' + displacedCount + ')</option>',
      '<option value="in-place" ' + (movementFilter === 'in-place' ? 'selected' : '') + '>In Base Location (' + inPlaceCount + ')</option>',
      '<option value="out" ' + (movementFilter === 'out' ? 'selected' : '') + '>Signed Out (' + outCount + ')</option>',
      '<option value="service" ' + (movementFilter === 'service' ? 'selected' : '') + '>In Service (' + serviceCount + ')</option>',
    ];
    sel.innerHTML = opts.join('');
  }

  function renderBulkBar() {
    const bar = el.querySelector('#inv-bulk-bar');
    if (!bar) return;
    const count = selectedIds.size;
    if (!selectMode || !count) {
      bar.classList.add('hidden');
      bar.innerHTML = '';
      return;
    }
    bar.classList.remove('hidden');
    bar.innerHTML =
      '<div class="panel p-3 bg-panel2 border-accent flex flex-wrap items-center justify-between gap-3 shadow-md">' +
        '<div class="flex items-center gap-2">' +
          '<span class="w-2.5 h-2.5 rounded-full bg-accent animate-pulse"></span>' +
          '<span class="font-semibold text-sm">' + count + ' item' + (count > 1 ? 's' : '') + ' selected</span>' +
        '</div>' +
        '<div class="flex flex-wrap items-center gap-2">' +
          '<button id="bulk-sign-out" class="btn btn-primary !py-1.5 !px-3 text-xs">' + ui.icon('arrowR', 'w-3.5 h-3.5') + 'Sign Out (' + count + ')</button>' +
          '<button id="bulk-sign-in" class="btn btn-ghost !py-1.5 !px-3 text-xs">' + ui.icon('check', 'w-3.5 h-3.5') + 'Sign In (' + count + ')</button>' +
          '<button id="bulk-move" class="btn btn-ghost !py-1.5 !px-3 text-xs">' + ui.icon('pin', 'w-3.5 h-3.5') + 'Move (' + count + ')</button>' +
          '<button id="bulk-clear" class="btn btn-ghost !py-1.5 !px-2.5 text-xs text-muted">Clear</button>' +
        '</div>' +
      '</div>';

    const bSo = bar.querySelector('#bulk-sign-out');
    if (bSo) bSo.addEventListener('click', bulkSignOut);
    const bSi = bar.querySelector('#bulk-sign-in');
    if (bSi) bSi.addEventListener('click', bulkSignIn);
    const bMv = bar.querySelector('#bulk-move');
    if (bMv) bMv.addEventListener('click', bulkMove);
    const bClr = bar.querySelector('#bulk-clear');
    if (bClr) bClr.addEventListener('click', () => { selectedIds.clear(); render(); });
  }

  function renderMovedPanel() {
    const wrap = el.querySelector('#inv-moved-panel');
    if (!wrap) return;
    const all = store.all('inventory');
    const displacedAll = all.filter(isDisplaced);
    
    // Filter matching displaced items
    const displacedMatching = displacedAll.filter((r) => {
      const hay = (r.name + ' ' + (r.tag || '') + ' ' + (r.location || '') + ' ' + (getHomeLocation(r) || '') + ' ' + (r.category || '')).toLowerCase();
      const matchesSearch = !searchQuery || hay.includes(searchQuery);
      const matchesCategory = !categoryFilter || r.category === categoryFilter;
      const matchesSpace = !spaceFilter || r.location === spaceFilter || getHomeLocation(r) === spaceFilter;
      return matchesSearch && matchesCategory && matchesSpace;
    });

    if (!displacedAll.length && movementFilter !== 'moved') {
      wrap.innerHTML = '';
      return;
    }

    const grouped = groupInventoryItems(displacedMatching);

    wrap.innerHTML =
      '<div class="panel p-4 bg-gradient-to-br from-panel2/90 via-panel2/50 to-panel2/30 border border-accent/30 shadow-sm">' +
        '<div class="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-3">' +
          '<div class="flex items-center gap-2.5 flex-wrap">' +
            '<div class="w-7 h-7 rounded-lg bg-accent/15 border border-accent/30 flex items-center justify-center text-accent shrink-0">' +
              ui.icon('pin', 'w-4 h-4') +
            '</div>' +
            '<div>' +
              '<div class="flex items-center gap-2">' +
                '<h2 class="font-semibold text-sm text-ink">Moved Kit &amp; Displacements</h2>' +
                '<span class="px-2 py-0.5 rounded-full text-[11px] font-semibold bg-accent/20 text-accent border border-accent/40 tabular">' +
                  displacedAll.length + ' relocated' +
                '</span>' +
              '</div>' +
              '<p class="text-xs text-muted">Equipment currently in use outside its registered home space.</p>' +
            '</div>' +
          '</div>' +
          '<div class="flex items-center gap-2 shrink-0">' +
            '<button id="btn-toggle-moved-filter" class="btn ' + (movementFilter === 'moved' ? 'btn-primary' : 'btn-ghost') + ' !py-1 !px-2.5 text-xs flex items-center gap-1.5">' +
              ui.icon('filter', 'w-3.5 h-3.5') +
              '<span>' + (movementFilter === 'moved' ? 'Filter: Showing Moved' : 'Show Only Moved') + '</span>' +
            '</button>' +
          '</div>' +
        '</div>' +
        (grouped.length ? (
          '<div class="grid gap-2 sm:grid-cols-2 lg:grid-cols-3 mt-3">' +
            grouped.map((grp) => {
              const homeLoc = getHomeLocation(grp.primaryItem || grp.items[0]);
              const tagChipsHtml = grp.tags.length
                ? grp.tags.map((t) => '<span class="tabular text-xs text-accent font-mono inline-flex items-center px-1.5 py-0.5 rounded bg-accent/10 border border-accent/20 font-medium">#' + ui.esc(t) + '</span>').join(' ')
                : '';
              const isOut = grp.status === 'out';
              return (
                '<div class="p-3 rounded-xl bg-panel/80 border border-line flex flex-col justify-between gap-2.5 hover:border-accent/40 transition-colors shadow-sm">' +
                  '<div>' +
                    '<div class="flex items-center justify-between gap-2 mb-1.5">' +
                      '<span class="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md text-xs font-semibold bg-accent/15 text-accent border border-accent/25">' +
                        '<span class="opacity-75">' + ui.esc(homeLoc) + '</span>' +
                        '<span class="text-accent font-bold">\u2794</span>' +
                        '<span>' + ui.esc(grp.location) + '</span>' +
                      '</span>' +
                      '<span class="tabular text-xs font-semibold px-2 py-0.5 rounded bg-panel2 text-ink border border-line">' + grp.qty + ' \u00d7</span>' +
                    '</div>' +
                    '<div class="font-medium text-sm text-ink truncate mb-1">' + ui.esc(grp.name) + '</div>' +
                    (tagChipsHtml ? '<div class="flex flex-wrap gap-1 mb-1.5">' + tagChipsHtml + '</div>' : '') +
                    '<div class="flex items-center gap-2 text-xs text-muted flex-wrap">' +
                      ui.pill(grp.condition, condColour[grp.condition] || 'var(--muted)') +
                      (isOut ? ui.pill('Out' + (grp.heldBy ? ' \u00b7 ' + grp.heldBy : ''), 'var(--info)') : '') +
                      '<span class="truncate">' + ui.esc(grp.category) + '</span>' +
                    '</div>' +
                  '</div>' +
                  '<div class="flex items-center justify-between gap-1.5 pt-2 border-t border-line/60">' +
                    '<button data-moved-return="' + grp.id + '" class="btn btn-primary !py-1 !px-2.5 text-xs flex items-center gap-1 shrink-0" title="Return directly to home location">' +
                      ui.icon('arrowL', 'w-3.5 h-3.5') + '<span>Return</span>' +
                    '</button>' +
                    '<div class="flex items-center gap-1 shrink-0">' +
                      '<button data-moved-qr="' + grp.id + '" class="btn btn-ghost !py-1 !px-2 text-xs" title="View individual tracker QR codes">' + ui.icon('qr', 'w-3.5 h-3.5') + '</button>' +
                      '<button data-moved-detail="' + grp.id + '" class="btn btn-ghost !py-1 !px-2 text-xs">Details</button>' +
                    '</div>' +
                  '</div>' +
                '</div>'
              );
            }).join('') +
          '</div>'
        ) : (
          '<p class="text-xs text-muted mt-2">No displaced items match the current search or filters.</p>'
        )) +
      '</div>';

    const toggleFilterBtn = wrap.querySelector('#btn-toggle-moved-filter');
    if (toggleFilterBtn) {
      toggleFilterBtn.addEventListener('click', () => {
        movementFilter = movementFilter === 'moved' ? '' : 'moved';
        render();
      });
    }

    grouped.forEach((grp) => {
      const btnReturn = wrap.querySelector('[data-moved-return="' + grp.id + '"]');
      if (btnReturn) btnReturn.addEventListener('click', () => returnToHomeGroup(grp.items, () => render()));
      const btnQr = wrap.querySelector('[data-moved-qr="' + grp.id + '"]');
      if (btnQr) btnQr.addEventListener('click', () => {
        if (RMTP.qr && RMTP.qr.showItemQRs) {
          RMTP.qr.showItemQRs(grp.items);
        } else {
          qr.labelPreview(grp.items);
        }
      });
      const btnDetail = wrap.querySelector('[data-moved-detail="' + grp.id + '"]');
      if (btnDetail) btnDetail.addEventListener('click', () => openDetail(grp));
    });
  }

  async function returnToHomeGroup(items, after) {
    if (!items || !items.length) return;
    const first = items[0];
    const homeLoc = getHomeLocation(first);
    if (!homeLoc) {
      ui.toast('No registered home location found', 'danger');
      if (after) after();
      return;
    }
    const totalQty = items.reduce((acc, it) => acc + (Math.max(1, Number(it.qty) || 1)), 0);
    const ok = await ui.confirm(
      'Return ' + (totalQty > 1 ? totalQty + ' \u00d7 ' : '') + '\u201c' + first.name + '\u201d from ' +
      (first.location || 'current location') + ' back to ' + homeLoc + ' and mark as In Circulation?',
      { title: 'Return Kit to Home Location', confirmLabel: 'Return to ' + homeLoc }
    );
    if (!ok) { if (after) after(); return; }

    const at = new Date().toISOString();
    const by = actor();

    items.forEach((item) => {
      const fresh = store.find('inventory', item.id);
      if (!fresh) return;
      const target = findMergeTarget(fresh.tag, homeLoc, fresh.condition, fresh.id);
      if (target) {
        store.upsert('inventory', Object.assign({}, target, {
          qty: qtyOf(target) + qtyOf(fresh),
          movements: (target.movements || []).concat({
            from: fresh.location || '',
            to: homeLoc,
            at: at,
            by: by,
            note: 'Returned to home location (' + homeLoc + ') and merged'
          })
        }));
        store.remove('inventory', fresh.id);
      } else {
        const updatedMovements = (fresh.movements || []).concat({
          from: fresh.location || '',
          to: homeLoc,
          at: at,
          by: by,
          note: 'Returned to home location (' + homeLoc + ')'
        });
        store.upsert('inventory', Object.assign({}, fresh, {
          location: homeLoc,
          status: 'in',
          heldBy: '',
          outAt: '',
          movements: updatedMovements
        }));
      }
    });

    ui.toast(first.name + ' returned to ' + homeLoc, 'ok');
    render();
    if (after) after();
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

  // Group inventory items by: Name + Location + Condition + Status + (if out: heldBy)
  function groupInventoryItems(items) {
    const groups = new Map();
    items.forEach((r) => {
      const nameKey = (r.name || '').trim().toLowerCase();
      const locKey = (r.location || '').trim().toLowerCase();
      const condKey = (r.condition || 'Good').trim().toLowerCase();
      const statKey = (r.status || 'in').trim().toLowerCase();
      const heldKey = statKey === 'out' ? (r.heldBy || '').trim().toLowerCase() : '';
      const key = [nameKey, locKey, condKey, statKey, heldKey].join(':::');

      if (!groups.has(key)) {
        groups.set(key, {
          id: r.id, // primary id
          key: key,
          name: r.name,
          category: r.category,
          location: r.location,
          condition: r.condition || 'Good',
          status: r.status || 'in',
          heldBy: r.heldBy || '',
          outAt: r.outAt || '',
          static: !!r.static,
          notes: r.notes || '',
          qty: 0,
          tags: [],
          itemIds: [],
          items: [],
          movements: [],
          primaryItem: r,
        });
      }

      const grp = groups.get(key);
      const q = Math.max(1, Number(r.qty) || 1);
      grp.qty += q;
      grp.items.push(r);
      grp.itemIds.push(r.id);
      if (r.tag && r.tag.trim()) {
        const rawTags = r.tag.split(',').map((t) => t.trim()).filter(Boolean);
        rawTags.forEach((t) => {
          if (!grp.tags.includes(t)) grp.tags.push(t);
        });
      }
      if (r.static) grp.static = true;
      if (r.movements && r.movements.length) {
        grp.movements = grp.movements.concat(r.movements);
      }
    });

    return Array.from(groups.values());
  }

  function findGroupedItems(itemOrGroup) {
    if (!itemOrGroup) return [];
    const all = store.all('inventory');
    if (itemOrGroup.itemIds && itemOrGroup.itemIds.length) {
      const items = itemOrGroup.itemIds.map((id) => store.find('inventory', id)).filter(Boolean);
      if (items.length) return items;
    }
    const item = itemOrGroup.items && itemOrGroup.items.length ? itemOrGroup.items[0] : (store.find('inventory', itemOrGroup.id) || itemOrGroup);
    if (!item) return [];
    const nameKey = (item.name || '').trim().toLowerCase();
    const locKey = (item.location || '').trim().toLowerCase();
    const condKey = (item.condition || 'Good').trim().toLowerCase();
    const statKey = (item.status || 'in').trim().toLowerCase();
    const heldKey = statKey === 'out' ? (item.heldBy || '').trim().toLowerCase() : '';

    return all.filter((r) => {
      const rName = (r.name || '').trim().toLowerCase();
      const rLoc = (r.location || '').trim().toLowerCase();
      const rCond = (r.condition || 'Good').trim().toLowerCase();
      const rStat = (r.status || 'in').trim().toLowerCase();
      const rHeld = rStat === 'out' ? (r.heldBy || '').trim().toLowerCase() : '';
      return rName === nameKey && rLoc === locKey && rCond === condKey && rStat === statKey && rHeld === heldKey;
    });
  }

  function renderList() {
    const all = store.all('inventory');
    const filtered = all.filter(matches);
    const grouped = groupInventoryItems(filtered).sort((a, b) =>
      (a.status === 'out' ? 0 : 1) - (b.status === 'out' ? 0 : 1) ||
      a.category.localeCompare(b.category) || a.name.localeCompare(b.name));
    const outCount = all.filter((r) => r.status === 'out').length;
    const totalUnitsVisible = grouped.reduce((sum, g) => sum + g.qty, 0);

    const list = el.querySelector('#inv-list');
    if (!grouped.length) {
      list.innerHTML = ui.empty('box', (searchQuery || spaceFilter || categoryFilter) ? 'No matches' : 'No equipment yet',
        (searchQuery || spaceFilter || categoryFilter) ? 'Try a different search or filter.' : 'Add your first asset with \u201cAdd\u201d.');
      return;
    }

    const allChecked = grouped.length > 0 && grouped.every((g) => g.itemIds.every((id) => selectedIds.has(id)));

    list.innerHTML =
      (selectMode || outCount ? (
        '<div class="flex items-center justify-between gap-3 mb-3">' +
          '<div class="flex items-center gap-2">' +
            (canMove && selectMode ? '<label class="flex items-center gap-2 text-xs text-muted cursor-pointer hover:text-ink select-none"><input type="checkbox" id="select-all-inv" class="w-4 h-4 rounded border-line accent-[var(--accent)]" ' + (allChecked ? 'checked' : '') + ' /> Select visible (' + grouped.length + ' entries \u00b7 ' + totalUnitsVisible + ' units)</label>' : '') +
          '</div>' +
          (outCount ? '<p class="text-xs text-muted">' + ui.pill(outCount + ' signed out', 'var(--info)') + '</p>' : '') +
        '</div>'
      ) : '') +
      '<div class="panel divide-y divide-line overflow-hidden">' +
        grouped.map((grp) => {
          const isOut = grp.status === 'out';
          const flagged = grp.items.some(isFlagged);
          const stat = grp.static;
          const svc = grp.location === 'SERVICE' || grp.status === 'service' || grp.items.some(inService);
          const isSelected = grp.itemIds.some((id) => selectedIds.has(id));
          const locPill = RMTP.isSpace(grp.location) ? ui.pill(grp.location, 'var(--accent)') : '';
          const tagChipsHtml = grp.tags.length
            ? grp.tags.map((t) => '<span class="tabular text-xs text-accent font-mono inline-flex items-center px-1.5 py-0.5 rounded bg-accent/10 border border-accent/20 font-medium">' + ui.esc(t) + '</span>').join(' ')
            : '';

          return '<div class="flex items-center gap-3 px-4 py-3 ' + (isSelected ? 'bg-panel2/60' : '') + '">' +
            (canMove && selectMode ? '<input type="checkbox" data-check-grp="' + grp.id + '" class="w-4 h-4 rounded border-line accent-[var(--accent)] shrink-0 cursor-pointer" ' + (isSelected ? 'checked' : '') + ' />' : '') +
            '<button data-open-grp="' + grp.id + '" class="min-w-0 flex-1 text-left group">' +
              '<span class="flex flex-wrap items-center gap-1.5">' +
                '<span class="font-medium group-hover:text-accent transition-colors ' + (svc ? 'line-through text-muted' : '') + '">' + ui.esc(grp.name) + '</span>' +
                tagChipsHtml +
                (svc ? ui.pill('In service', 'var(--danger)') : '') +
                (flagged ? ui.pill('Flagged', 'var(--danger)') : '') +
                (stat ? ui.pill('Fixed', 'var(--muted)') : '') +
              '</span>' +
              '<span class="block text-xs text-muted mt-0.5 truncate">' + ui.esc(grp.category) + ' \u00b7 ' + ui.esc(grp.location || '\u2014') +
                (flagged ? ' \u00b7 <span style="color:var(--danger)">' + ui.esc(flagReason(grp.primaryItem || grp.items[0])) + '</span>' : '') +
                (isOut && grp.heldBy ? ' \u00b7 <span class="text-info">held by ' + ui.esc(grp.heldBy) + '</span>' : '') + '</span>' +
            '</button>' +
            '<div class="shrink-0 hidden md:flex items-center gap-1.5">' + locPill +
              (isOut ? ui.pill('Out', 'var(--info)') : ui.pill(grp.condition, condColour[grp.condition] || 'var(--muted)')) + '</div>' +
            '<div class="w-12 text-right shrink-0 hidden sm:block"><span class="tabular font-semibold">' + grp.qty + '</span></div>' +
            '<div class="flex gap-1 shrink-0">' +
              (canMove && !stat
                ? (isOut
                    ? '<button data-in-grp="' + grp.id + '" class="btn btn-ghost !px-2.5 !py-1.5 text-xs" title="Sign back in">' + ui.icon('check', 'w-4 h-4') + 'In</button>'
                    : '<button data-out-grp="' + grp.id + '" class="btn btn-ghost !px-2.5 !py-1.5 text-xs" title="Sign out">' + ui.icon('arrowR', 'w-4 h-4') + 'Out</button>')
                : '') +
              (canManage ? '<button data-edit-grp="' + grp.id + '" class="btn btn-ghost !p-2 hidden sm:inline-flex" title="Edit">' + ui.icon('pen', 'w-4 h-4') + '</button>' : '') +
            '</div>' +
          '</div>';
        }).join('') +
      '</div>' +
      '<p class="text-xs text-muted mt-3 tabular">' + grouped.length + ' grouped entries (' + totalUnitsVisible + ' units) \u00b7 ' + all.length + ' total asset records</p>';

    const selectAllBox = list.querySelector('#select-all-inv');
    if (selectAllBox) {
      selectAllBox.addEventListener('change', (e) => {
        if (e.target.checked) {
          grouped.forEach((g) => g.itemIds.forEach((id) => selectedIds.add(id)));
        } else {
          grouped.forEach((g) => g.itemIds.forEach((id) => selectedIds.delete(id)));
        }
        render();
      });
    }

    grouped.forEach((grp) => {
      const q = (sel) => list.querySelector(sel);
      const chk = q('[data-check-grp="' + grp.id + '"]');
      if (chk) {
        chk.addEventListener('change', (e) => {
          if (e.target.checked) {
            grp.itemIds.forEach((id) => selectedIds.add(id));
          } else {
            grp.itemIds.forEach((id) => selectedIds.delete(id));
          }
          render();
        });
      }
      const eOpen = q('[data-open-grp="' + grp.id + '"]'); if (eOpen) eOpen.addEventListener('click', () => openDetail(grp));
      const eOut = q('[data-out-grp="' + grp.id + '"]'); if (eOut) eOut.addEventListener('click', () => signOutGroup(grp.items, () => render()));
      const eIn = q('[data-in-grp="' + grp.id + '"]'); if (eIn) eIn.addEventListener('click', () => signInGroup(grp.items, () => render()));
      const eEdit = q('[data-edit-grp="' + grp.id + '"]'); if (eEdit) eEdit.addEventListener('click', () => openForm(grp.primaryItem || grp.items[0]));
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
  function openDetail(itemOrGroup) {
    const matchingItems = findGroupedItems(itemOrGroup);
    if (!matchingItems.length) {
      const fallback = store.find('inventory', itemOrGroup.id) || itemOrGroup;
      if (fallback) matchingItems.push(fallback);
    }
    const fresh = matchingItems[0] || itemOrGroup;
    const totalQty = matchingItems.reduce((acc, it) => acc + (Math.max(1, Number(it.qty) || 1)), 0);
    const isOut = fresh.status === 'out';
    const flagged = matchingItems.some(isFlagged);
    const stat = matchingItems.some(isStatic);
    const svc = inService(fresh) || matchingItems.some(inService);

    // Collect all unique tags
    const uniqueTags = [];
    matchingItems.forEach((it) => {
      if (it.tag && it.tag.trim()) {
        it.tag.split(',').map((t) => t.trim()).filter(Boolean).forEach((t) => {
          if (!uniqueTags.includes(t)) uniqueTags.push(t);
        });
      }
    });

    const openFaults = store.all('maintenance').filter((f) => matchingItems.some((it) => it.id === f.itemId) && f.status !== 'Resolved');

    // Combine movements across all matching units
    const moves = matchingItems.flatMap((it) => it.movements || [])
      .slice()
      .sort((a, b) => (new Date(b.at || 0) - new Date(a.at || 0)));

    const homeLoc = getHomeLocation(fresh);
    const displaced = isDisplaced(fresh);

    const tagDisplayHtml = uniqueTags.length
      ? '<div class="flex flex-wrap gap-1.5 mt-0.5">' + uniqueTags.map((t) => '<span class="tabular text-xs text-accent font-mono inline-flex items-center px-2 py-0.5 rounded bg-accent/10 border border-accent/20 font-medium">#' + ui.esc(t) + '</span>').join('') + '</div>'
      : '<span class="text-sm font-medium">\u2014</span>';

    const info = [
      ['Tracker Tag' + (uniqueTags.length > 1 ? 's (' + uniqueTags.length + ')' : ''), tagDisplayHtml, true],
      ['Category', ui.esc(fresh.category)],
      ['Current Location', ui.esc(fresh.location || '\u2014')],
      ['Home / Base Space', ui.esc(homeLoc || '\u2014')],
      ['Condition', ui.esc(fresh.condition)],
      ['Total Quantity', String(totalQty) + (totalQty > 1 ? ' units' : ' unit')],
      ['Custody', isOut ? ('Out' + (fresh.heldBy ? ' \u00b7 ' + ui.esc(fresh.heldBy) : '')) : (svc ? 'In Service' : 'In')],
    ].map(([k, v, isRaw]) => '<div><dt class="eyebrow">' + ui.esc(k) + '</dt><dd class="text-sm mt-0.5 font-medium">' + (isRaw ? v : v) + '</dd></div>').join('');

    const displacementBanner = displaced
      ? '<div class="panel p-3 mb-4 bg-accent/10 border border-accent/30 flex items-center justify-between gap-3 text-xs">' +
          '<div class="flex items-center gap-2 min-w-0">' +
            ui.icon('pin', 'w-4 h-4 text-accent shrink-0') +
            '<span class="truncate">Relocated from <strong>' + ui.esc(homeLoc) + '</strong> \u2794 currently in <strong>' + ui.esc(fresh.location) + '</strong></span>' +
          '</div>' +
          '<button data-return-home class="btn btn-primary !py-1 !px-2.5 text-xs shrink-0 flex items-center gap-1">' +
            ui.icon('arrowL', 'w-3.5 h-3.5') + '<span>Return to ' + ui.esc(homeLoc) + '</span>' +
          '</button>' +
        '</div>'
      : '';

    const faultsBlock = openFaults.length
      ? '<div class="panel p-3 mb-4 text-xs flex items-center justify-between gap-3" style="background:color-mix(in srgb,var(--danger) 10%,transparent);border-color:color-mix(in srgb,var(--danger) 40%,var(--line));color:var(--danger)">' +
          '<div>' + ui.icon('alert', 'w-4 h-4 inline mr-1.5') + '<strong>' + openFaults.length + ' active fault' + (openFaults.length > 1 ? 's' : '') + ' logged:</strong> ' + ui.esc(openFaults[0].equipment) + '</div>' +
          '<a href="#/maintenance" class="btn btn-ghost !py-1 !px-2 text-xs shrink-0">View fault</a>' +
        '</div>'
      : '';

    const unitsListBlock = matchingItems.length > 1
      ? '<div class="mb-4">' +
          '<p class="eyebrow mb-2">Tracked units in this group (' + matchingItems.length + ' entities \u00b7 ' + totalQty + ' total)</p>' +
          '<div class="panel divide-y divide-line overflow-hidden max-h-40 overflow-y-auto">' +
            matchingItems.map((it) =>
              '<div class="px-3 py-2 text-xs flex items-center justify-between gap-2">' +
                '<div class="flex items-center gap-2 min-w-0">' +
                  '<span class="tabular text-accent font-mono font-medium px-1.5 py-0.5 rounded bg-accent/10 border border-accent/20">#' + ui.esc(it.tag || 'No tag') + '</span>' +
                  '<span class="truncate font-medium">' + ui.esc(it.name) + '</span>' +
                '</div>' +
                '<div class="flex items-center gap-2 shrink-0">' +
                  '<span class="tabular text-muted font-semibold">' + (it.qty || 1) + ' \u00d7</span>' +
                  ui.pill(it.condition, condColour[it.condition] || 'var(--muted)') +
                  (canManage ? '<button data-sub-edit="' + it.id + '" class="btn btn-ghost !p-1 text-[11px]" title="Edit this unit">' + ui.icon('pen', 'w-3.5 h-3.5') + '</button>' : '') +
                '</div>' +
              '</div>'
            ).join('') +
          '</div>' +
        '</div>'
      : '';

    const history = moves.length
      ? '<div class="panel divide-y divide-line overflow-hidden max-h-48 overflow-y-auto">' + moves.map((mv) =>
          '<div class="px-3 py-2 text-sm flex items-center justify-between gap-3">' +
            '<span>' + ui.esc(mv.from || '\u2014') + ' <span class="text-muted">\u2192</span> <span class="font-medium">' + ui.esc(mv.to) + '</span>' +
              (mv.note ? ' <span class="text-muted">\u00b7 ' + ui.esc(mv.note) + '</span>' : '') + '</span>' +
            '<span class="text-[11px] text-muted shrink-0">' + (mv.at ? ui.timeAgo(new Date(mv.at).getTime()) : '') + (mv.by ? ' \u00b7 ' + ui.esc(mv.by) : '') + '</span>' +
          '</div>').join('') + '</div>'
      : '<p class="text-sm text-muted">No movements logged yet.</p>';

    const m = ui.modal({
      title: fresh.name + (totalQty > 1 ? ' (' + totalQty + ' \u00d7)' : ''),
      size: 'md:max-w-lg',
      body:
        (stat ? '<div class="panel p-3 mb-4 text-sm" style="border-color:color-mix(in srgb,var(--muted) 40%,var(--line))">' +
          ui.icon('pin', 'w-4 h-4 inline mr-1') + 'Fixed installation \u2014 part of the room, can\u2019t be signed out or moved.</div>' : '') +
        (svc ? '<div class="panel p-3 mb-4 text-sm" style="background:color-mix(in srgb,var(--danger) 10%,transparent);border-color:color-mix(in srgb,var(--danger) 40%,var(--line));color:var(--danger)">' +
          ui.icon('alert', 'w-4 h-4 inline mr-1') + 'Currently in SERVICE / maintenance.</div>' : '') +
        (flagged && !svc && !openFaults.length ? '<div class="panel p-3 mb-4 text-sm" style="border-color:color-mix(in srgb,var(--danger) 40%,var(--line));color:var(--danger)">' +
          ui.icon('alert', 'w-4 h-4 inline mr-1') + 'Flagged (' + ui.esc(flagReason(fresh)) + ').' + (stat ? '' : ' Can only be moved to a Store.') + '</div>' : '') +
        displacementBanner +
        faultsBlock +
        '<dl class="grid grid-cols-2 sm:grid-cols-3 gap-x-4 gap-y-3 mb-5">' + info + '</dl>' +
        unitsListBlock +
        (fresh.notes ? '<p class="text-sm text-ink/80 mb-5 panel p-3 bg-panel2/40">' + ui.esc(fresh.notes) + '</p>' : '') +
        '<p class="eyebrow mb-2">Movement history</p>' + history,
      footer:
        (canMove && !stat ? '<button data-move class="btn btn-ghost mr-auto">' + ui.icon('pin', 'w-4 h-4') + 'Move</button>' : '') +
        '<button data-qr-view class="btn btn-ghost" title="View individual tracker QR codes">' + ui.icon('qr', 'w-4 h-4') + 'QR Codes</button>' +
        (canMove && !stat ? '<button data-sign class="btn ' + (isOut ? 'btn-ghost' : 'btn-primary') + '">' + ui.icon(isOut ? 'check' : 'arrowR', 'w-4 h-4') + (isOut ? 'Sign in' : 'Sign out') + '</button>' : '') +
        '<button data-fault class="btn btn-ghost" title="Report fault for this kit">' + ui.icon('wrench', 'w-4 h-4') + 'Fault / Service</button>' +
        (canManage ? '<button data-edit class="btn btn-ghost">' + ui.icon('pen', 'w-4 h-4') + 'Edit</button>' : '') +
        (canManage ? '<button data-del class="btn btn-danger">' + ui.icon('trash', 'w-4 h-4') + 'Delete</button>' : ''),
    });
    const back = () => {
      const refreshed = findGroupedItems(fresh);
      if (refreshed.length) openDetail(refreshed[0]);
    };
    const retHome = m.root.querySelector('[data-return-home]');
    if (retHome) retHome.addEventListener('click', () => { m.close(); returnToHomeGroup(matchingItems, () => render()); });
    const qrBtn = m.root.querySelector('[data-qr-view]');
    if (qrBtn) qrBtn.addEventListener('click', () => {
      if (RMTP.qr && RMTP.qr.showItemQRs) {
        RMTP.qr.showItemQRs(matchingItems);
      } else {
        qr.labelPreview(matchingItems);
      }
    });
    const mv = m.root.querySelector('[data-move]'); if (mv) mv.addEventListener('click', () => { m.close(); moveGroup(matchingItems, back); });
    const sg = m.root.querySelector('[data-sign]'); if (sg) sg.addEventListener('click', () => { m.close(); (isOut ? signInGroup : signOutGroup)(matchingItems, back); });
    const ft = m.root.querySelector('[data-fault]');
    if (ft) ft.addEventListener('click', () => {
      m.close();
      if (RMTP.maintenance && RMTP.maintenance.openForm) {
        RMTP.maintenance.openForm(null, Object.assign({}, fresh, { qty: totalQty }), () => {
          render();
          back();
        });
      }
    });
    const ed = m.root.querySelector('[data-edit]'); if (ed) ed.addEventListener('click', () => { m.close(); openForm(fresh); });
    const dl = m.root.querySelector('[data-del]'); if (dl) dl.addEventListener('click', () => { m.close(); delGroup(matchingItems); });

    m.root.querySelectorAll('[data-sub-edit]').forEach((b) => {
      b.addEventListener('click', (e) => {
        e.stopPropagation();
        const id = b.getAttribute('data-sub-edit');
        const sub = store.find('inventory', id);
        if (sub) {
          m.close();
          openForm(sub);
        }
      });
    });
  }

  function actor() { return auth.displayName(auth.current()) || 'Unknown'; }
  function qtyOf(x) { return Number(x.qty) || 0; }
  // An "in" line at the same place with the same tag/condition to merge into.
  function findMergeTarget(tag, location, condition, excludeId) {
    return store.all('inventory').find((x) => x.id !== excludeId && x.status === 'in' && x.tag === tag && x.location === location && x.condition === condition);
  }

  /* ---- Move Group (quantity-aware; splits across lines if needed; flagged=Store only) ---- */
  function moveGroup(items, after) {
    if (!items || !items.length) return;
    const first = items[0];
    if (isStatic(first)) { ui.toast('Fixed installation \u2014 can\u2019t be moved', 'danger'); if (after) after(); return; }
    const totalQty = items.reduce((acc, it) => acc + (Math.max(1, Number(it.qty) || 1)), 0);
    const flagged = items.some(isFlagged);

    const m = ui.modal({
      title: 'Move ' + first.name,
      size: 'md:max-w-sm',
      body:
        '<p class="text-sm mb-4">' + totalQty + ' in <span class="font-medium">' + ui.esc(first.location || '\u2014') + '</span></p>' +
        (flagged ? '<p class="text-xs mb-3" style="color:var(--danger)">Flagged kit \u2014 can only move to a Store.</p>' : '') +
        (totalQty > 1 ? '<label class="block text-sm font-medium mb-2">Quantity to move</label>' +
          '<input id="mv-qty" type="number" min="1" max="' + totalQty + '" value="' + totalQty + '" class="field tabular mb-4" />' : '') +
        '<label class="block text-sm font-medium mb-2">Move to</label>' + locationSelect('mv-loc', first.location, { storeOnly: flagged }),
      footer:
        '<button class="btn btn-ghost" data-cancel>Cancel</button>' +
        '<button class="btn btn-primary" data-ok data-primary>' + ui.icon('pin', 'w-4 h-4') + 'Move</button>',
    });
    m.root.querySelector('[data-cancel]').addEventListener('click', () => { m.close(); if (after) after(); });
    m.root.querySelector('[data-ok]').addEventListener('click', () => {
      const to = m.root.querySelector('#mv-loc').value;
      const qtyEl = m.root.querySelector('#mv-qty');
      const qty = qtyEl ? Math.max(1, Math.min(parseInt(qtyEl.value, 10) || 1, totalQty)) : totalQty;
      if (to === first.location) { ui.toast('Already there', 'info'); return; }
      if (flagged && RMTP.isSpace(to)) { ui.toast('Flagged kit can only go to a Store', 'danger'); return; }

      let remaining = qty;
      for (const it of items) {
        if (remaining <= 0) break;
        const fresh = store.find('inventory', it.id);
        if (!fresh) continue;
        const currentQty = Math.max(1, Number(fresh.qty) || 1);
        const toMove = Math.min(remaining, currentQty);
        moveQty(fresh, toMove, to);
        remaining -= toMove;
      }

      m.close();
      ui.toast((qty < totalQty ? qty + ' \u00d7 ' : '') + first.name + ' moved to ' + to, 'ok');
      render();
      if (after) after();
    });
  }

  function moveItem(item, after) {
    moveGroup(findGroupedItems(item), after);
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

  /* ---- Scan → resolve item(s) → open the kit piece detail view ---- */
  async function handleScan() {
    const decoded = await qr.scan({ title: 'Scan kit QR' });
    if (!decoded) return;
    const parsed = qr.parse(decoded);
    if (!parsed || !parsed.value) {
      ui.toast('Unrecognised QR code format', 'danger');
      return;
    }
    const lines = findItemsByQuery(parsed.value);
    if (!lines.length) {
      ui.toast('No item with tag or ID \u201c' + parsed.value + '\u201d', 'danger');
      return;
    }
    if (lines.length === 1) {
      openDetail(lines[0]);
      return;
    }
    pickLine(lines, (it) => openDetail(it));
  }

  function pickLine(lines, cb) {
    const m = ui.modal({
      title: 'Select matching item',
      size: 'md:max-w-sm',
      body:
        '<p class="text-sm text-muted mb-3">Multiple inventory items match this code \u2014 choose one:</p>' +
        '<div class="grid gap-2">' + lines.map((l) =>
          '<button data-pick="' + l.id + '" class="panel p-3 text-left hover:border-accent transition-colors flex items-center justify-between gap-3">' +
            '<span class="min-w-0"><span class="font-medium">' + ui.esc(l.name) + '</span> ' +
              '<span class="text-xs text-muted block">' + ui.esc(l.location || '\u2014') + ' \u00b7 <span class="text-accent font-mono">' + ui.esc(l.tag || l.id) + '</span></span></span>' +
            '<span class="text-xs shrink-0">' + (l.status === 'out' ? ui.pill('Out', 'var(--info)') : 'qty ' + qtyOf(l)) + '</span>' +
          '</button>').join('') + '</div>',
      footer: '<button class="btn btn-ghost" data-cancel>Cancel</button>',
    });
    m.root.querySelector('[data-cancel]').addEventListener('click', m.close);
    lines.forEach((l) => { const b = m.root.querySelector('[data-pick="' + l.id + '"]'); if (b) b.addEventListener('click', () => { m.close(); cb(store.find('inventory', l.id) || l); }); });
  }

  /* ---- Sign out: who + quantity + destination space ---- */
  function signOutGroup(items, after) {
    if (!items || !items.length) return;
    const first = items[0];
    if (isStatic(first)) { ui.toast('Fixed installation \u2014 can\u2019t be signed out', 'danger'); if (after) after(); return; }
    const totalQty = items.reduce((acc, it) => acc + (Math.max(1, Number(it.qty) || 1)), 0);
    const prefs = store.read('prefs', {}) || {};
    const defaultHolder = prefs.lastHolder || auth.displayName(auth.current());
    const flagged = items.some(isFlagged);

    const m = ui.modal({
      title: 'Sign out',
      size: 'md:max-w-sm',
      body:
        '<p class="text-sm mb-4"><span class="font-medium">' + ui.esc(first.name) + '</span> ' +
          (first.tag ? '<span class="tabular text-xs text-accent font-mono">' + ui.esc(first.tag) + '</span> \u00b7 ' : '') + totalQty + ' available</p>' +
        '<label class="block text-sm font-medium mb-2">Who\u2019s taking it?</label>' +
        '<input id="so-holder" class="field mb-4" value="' + ui.esc(defaultHolder || '') + '" placeholder="Name" autocomplete="off" />' +
        (totalQty > 1 ? '<label class="block text-sm font-medium mb-2">Quantity</label>' +
          '<input id="so-qty" type="number" min="1" max="' + totalQty + '" value="' + totalQty + '" class="field tabular mb-4" />' : '') +
        '<label class="block text-sm font-medium mb-2">Going to</label>' +
        (flagged ? '<p class="text-xs mb-2" style="color:var(--danger)">Flagged kit \u2014 Store only.</p>' : '') +
        locationSelect('so-space', '', { blank: '\u2014 Keep in ' + (first.location || 'place'), storeOnly: flagged }),
      footer:
        '<button class="btn btn-ghost" data-cancel>Cancel</button>' +
        '<button class="btn btn-primary" data-ok data-primary>' + ui.icon('arrowR', 'w-4 h-4') + 'Sign out</button>',
    });

    m.root.querySelector('[data-cancel]').addEventListener('click', () => { m.close(); if (after) after(); });
    m.root.querySelector('[data-ok]').addEventListener('click', () => {
      const holder = m.root.querySelector('#so-holder').value.trim();
      if (!holder) { ui.toast('Enter a name', 'danger'); return; }
      const qtyEl = m.root.querySelector('#so-qty');
      const qty = qtyEl ? Math.max(1, Math.min(parseInt(qtyEl.value, 10) || 1, totalQty)) : totalQty;
      const dest = m.root.querySelector('#so-space').value;
      if (dest && dest !== first.location && flagged && RMTP.isSpace(dest)) { ui.toast('Flagged kit can only go to a Store', 'danger'); return; }

      let remaining = qty;
      let targetItem = null;
      for (const it of items) {
        if (remaining <= 0) break;
        const fresh = store.find('inventory', it.id);
        if (!fresh) continue;
        const currentQty = Math.max(1, Number(fresh.qty) || 1);
        const toTake = Math.min(remaining, currentQty);
        targetItem = signOutQty(fresh, toTake, holder, dest);
        remaining -= toTake;
      }

      store.write('prefs', Object.assign({}, prefs, { lastHolder: holder }));
      m.close();
      ui.toast((qty < totalQty ? qty + ' \u00d7 ' : '') + first.name + ' signed out to ' + holder + (dest && dest !== first.location ? ' \u00b7 ' + dest : ''), 'ok');
      render();
      if (dest === 'SERVICE' || dest.toUpperCase() === 'SERVICE') {
        setTimeout(() => {
          if (RMTP.maintenance && RMTP.maintenance.openForm) {
            RMTP.maintenance.openForm(null, targetItem || first, () => {
              render();
              if (after) after();
            });
          } else {
            if (after) after();
          }
        }, 120);
      } else {
        if (after) after();
      }
    });
  }

  function signOut(item, after) {
    signOutGroup(findGroupedItems(item), after);
  }

  function signOutQty(item, qty, holder, dest) {
    const at = new Date().toISOString(), by = actor();
    const moving = dest && dest !== item.location;
    const loc = moving ? dest : item.location;
    const note = 'Signed out ' + qty + ' to ' + holder;
    const prevLoc = item.location && item.location !== 'SERVICE' ? item.location : (item.previousLocation || item.originLocation || 'Store A');
    if (qty >= qtyOf(item)) {
      const updated = Object.assign({}, item, {
        previousLocation: loc === 'SERVICE' ? prevLoc : (item.previousLocation || item.location || 'Store A'),
        originLocation: item.originLocation || prevLoc,
        status: loc === 'SERVICE' ? 'service' : 'out',
        heldBy: holder,
        outAt: at,
        location: loc,
        movements: moving ? (item.movements || []).concat({ from: item.location || '', to: dest, at, by, note }) : (item.movements || []),
      });
      store.upsert('inventory', updated);
      return updated;
    } else {
      // source stays in at its location; a new out line carries the moved qty
      store.upsert('inventory', Object.assign({}, item, { qty: qtyOf(item) - qty }));
      const childItem = Object.assign({}, item, {
        id: store.uid('inv'),
        parentId: item.id,
        splitQty: qty,
        qty: qty,
        previousLocation: loc === 'SERVICE' ? prevLoc : (item.previousLocation || item.location || 'Store A'),
        originLocation: item.originLocation || prevLoc,
        status: loc === 'SERVICE' ? 'service' : 'out',
        heldBy: holder,
        outAt: at,
        location: loc,
        movements: [{ from: item.location || '', to: loc, at, by, note }],
      });
      store.upsert('inventory', childItem);
      return childItem;
    }
  }

  async function signInGroup(items, after) {
    if (!items || !items.length) return;
    const first = items[0];
    const totalQty = items.reduce((acc, it) => acc + (Math.max(1, Number(it.qty) || 1)), 0);
    if (items.some(isFlagged) && !isAdmin) {
      ui.toast('Only an admin can return reported kit to use \u2014 resolve it in Maintenance', 'danger');
      if (after) after();
      return;
    }
    const ok = await ui.confirm('Sign ' + (totalQty > 1 ? totalQty + ' \u00d7 ' : '') + '\u201c' + first.name + '\u201d back in' + (first.heldBy ? ' from ' + first.heldBy : '') + '?',
      { title: 'Sign back in', confirmLabel: 'Sign in' });
    if (!ok) { if (after) after(); return; }

    items.forEach((item) => {
      const fresh = store.find('inventory', item.id);
      if (!fresh) return;
      const target = findMergeTarget(fresh.tag, fresh.location, fresh.condition, fresh.id);
      if (target) {
        store.upsert('inventory', Object.assign({}, target, {
          qty: qtyOf(target) + qtyOf(fresh),
          movements: (target.movements || []).concat({
            from: fresh.location || '',
            to: fresh.location || '',
            at: new Date().toISOString(),
            by: actor(),
            note: 'Signed in ' + qtyOf(fresh)
          })
        }));
        store.remove('inventory', fresh.id);
      } else {
        store.upsert('inventory', Object.assign({}, fresh, { status: 'in', heldBy: '', outAt: '' }));
      }
    });

    ui.toast(first.name + ' back in', 'ok');
    render();
    if (after) after();
  }

  async function signIn(item, after) {
    await signInGroup(findGroupedItems(item), after);
  }

  async function delGroup(items) {
    if (!items || !items.length) return;
    const first = items[0];
    const totalQty = items.reduce((acc, it) => acc + (Math.max(1, Number(it.qty) || 1)), 0);
    const ok = await ui.confirm('Remove ' + (totalQty > 1 ? totalQty + ' \u00d7 ' : '') + '\u201c' + first.name + '\u201d from inventory?',
      { title: 'Delete item', confirmLabel: 'Delete', danger: true });
    if (ok) {
      items.forEach((it) => store.remove('inventory', it.id));
      ui.toast('Item removed', 'ok');
      render();
    }
  }

  async function del(r) {
    await delGroup(findGroupedItems(r));
  }

  function locationSelect(id, val, opts) {
    opts = opts || {};
    const grp = (label, arr) => arr.length ? '<optgroup label="' + label + '">' +
      arr.map((v) => '<option ' + (v === val ? 'selected' : '') + '>' + ui.esc(v) + '</option>').join('') + '</optgroup>' : '';
    let html = '<select id="' + id + '" class="field">';
    if (opts.blank) html += '<option value="" ' + (!val ? 'selected' : '') + '>' + ui.esc(opts.blank) + '</option>';
    if (!opts.storeOnly) html += grp('Spaces', RMTP.SPACES);
    html += grp('Stores', RMTP.STORES);
    html += grp('Service', ['SERVICE']);
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
            fld('Current Location', locationSelect('i-location', r.location || 'Store', {})) +
            fld('Home / Base Space', locationSelect('i-home-location', r.homeLocation || r.location || 'Store', {})) +
          '</div>' +
          '<div class="grid grid-cols-2 gap-4">' +
            fld('Quantity', '<input id="i-qty" type="number" min="0" class="field tabular" value="' + (r.qty != null ? r.qty : 1) + '" />') +
            fld('Notes', '<input id="i-notes" class="field" value="' + ui.esc(r.notes || '') + '" placeholder="Optional" />') +
          '</div>' +
          '<label class="flex items-center gap-3 panel p-3 cursor-pointer">' +
            '<input type="checkbox" id="i-static" class="w-4 h-4 accent-[var(--accent)]" ' + (r.static ? 'checked' : '') + ' />' +
            '<span class="text-sm">Fixed installation <span class="text-muted">\u2014 part of the room; can\u2019t be signed out or moved between spaces</span></span></label>' +
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
        homeLocation: m.root.querySelector('#i-home-location').value || newLocation,
        qty: Number(m.root.querySelector('#i-qty').value) || 0,
        notes: m.root.querySelector('#i-notes').value.trim(),
        static: m.root.querySelector('#i-static').checked,
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

  /* ---- Bulk operations ---- */
  function getSelectedItems() {
    return Array.from(selectedIds)
      .map((id) => store.find('inventory', id))
      .filter(Boolean);
  }

  function bulkSignOut() {
    const items = getSelectedItems().filter((it) => !isStatic(it));
    if (!items.length) { ui.toast('No movable items selected', 'danger'); return; }
    const prefs = store.read('prefs', {}) || {};
    const defaultHolder = prefs.lastHolder || auth.displayName(auth.current());
    const anyFlagged = items.some((it) => isFlagged(it));

    const m = ui.modal({
      title: 'Bulk Sign Out (' + items.length + ' items)',
      size: 'md:max-w-md',
      body:
        '<p class="text-sm text-muted mb-4">Signing out <span class="font-medium text-ink">' + items.length + ' selected item' + (items.length > 1 ? 's' : '') + '</span>:</p>' +
        '<div class="max-h-36 overflow-y-auto panel p-2 mb-4 text-xs divide-y divide-line">' +
          items.map((it) => '<div class="py-1 flex justify-between"><span>' + ui.esc(it.name) + '</span><span class="tabular text-accent font-mono">' + ui.esc(it.tag) + '</span></div>').join('') +
        '</div>' +
        '<label class="block text-sm font-medium mb-2">Who\u2019s taking them?</label>' +
        '<input id="bulk-so-holder" class="field mb-4" value="' + ui.esc(defaultHolder || '') + '" placeholder="Name" autocomplete="off" />' +
        '<label class="block text-sm font-medium mb-2">Destination Space / Location</label>' +
        (anyFlagged ? '<p class="text-xs mb-2" style="color:var(--danger)">Some selected items are flagged \u2014 Store only.</p>' : '') +
        locationSelect('bulk-so-space', '', { blank: '\u2014 Keep in current place', storeOnly: anyFlagged }),
      footer:
        '<button class="btn btn-ghost" data-cancel>Cancel</button>' +
        '<button class="btn btn-primary" data-ok data-primary>' + ui.icon('arrowR', 'w-4 h-4') + 'Sign Out All (' + items.length + ')</button>',
    });

    m.root.querySelector('[data-cancel]').addEventListener('click', m.close);
    m.root.querySelector('[data-ok]').addEventListener('click', () => {
      const holder = m.root.querySelector('#bulk-so-holder').value.trim();
      if (!holder) { ui.toast('Enter a name', 'danger'); return; }
      const dest = m.root.querySelector('#bulk-so-space').value;
      if (dest && anyFlagged && RMTP.isSpace(dest)) { ui.toast('Flagged kit can only go to a Store', 'danger'); return; }

      items.forEach((it) => {
        const qty = qtyOf(it) || 1;
        signOutQty(it, qty, holder, dest);
      });

      store.write('prefs', Object.assign({}, prefs, { lastHolder: holder }));
      selectedIds.clear();
      m.close();
      ui.toast(items.length + ' items signed out to ' + holder, 'ok');
      render();
      if (dest === 'SERVICE' || dest.toUpperCase() === 'SERVICE') {
        setTimeout(() => {
          if (RMTP.maintenance && RMTP.maintenance.openForm) {
            RMTP.maintenance.openForm(null, items[0], () => {
              render();
            });
          }
        }, 120);
      }
    });
  }

  async function bulkSignIn() {
    const items = getSelectedItems();
    if (!items.length) { ui.toast('No items selected', 'danger'); return; }
    const ok = await ui.confirm('Sign ' + items.length + ' item' + (items.length > 1 ? 's' : '') + ' back in?',
      { title: 'Bulk sign in', confirmLabel: 'Sign in (' + items.length + ')' });
    if (!ok) return;

    items.forEach((item) => {
      const target = findMergeTarget(item.tag, item.location, item.condition, item.id);
      if (target) {
        store.upsert('inventory', Object.assign({}, target, { qty: qtyOf(target) + qtyOf(item), movements: (target.movements || []).concat({ from: item.location || '', to: item.location || '', at: new Date().toISOString(), by: actor(), note: 'Signed in ' + qtyOf(item) }) }));
        store.remove('inventory', item.id);
      } else {
        store.upsert('inventory', Object.assign({}, item, { status: 'in', heldBy: '', outAt: '' }));
      }
    });

    selectedIds.clear();
    ui.toast(items.length + ' items signed in', 'ok');
    render();
  }

  function bulkMove() {
    const items = getSelectedItems().filter((it) => !isStatic(it));
    if (!items.length) { ui.toast('No movable items selected', 'danger'); return; }
    const anyFlagged = items.some((it) => isFlagged(it));

    const m = ui.modal({
      title: 'Bulk Move (' + items.length + ' items)',
      size: 'md:max-w-md',
      body:
        '<p class="text-sm text-muted mb-4">Moving <span class="font-medium text-ink">' + items.length + ' selected item' + (items.length > 1 ? 's' : '') + '</span> to a new location:</p>' +
        (anyFlagged ? '<p class="text-xs mb-2" style="color:var(--danger)">Some selected items are flagged \u2014 Store only.</p>' : '') +
        '<label class="block text-sm font-medium mb-2">Destination Location</label>' +
        locationSelect('bulk-mv-loc', 'Store', { storeOnly: anyFlagged }),
      footer:
        '<button class="btn btn-ghost" data-cancel>Cancel</button>' +
        '<button class="btn btn-primary" data-ok data-primary>' + ui.icon('pin', 'w-4 h-4') + 'Move All (' + items.length + ')</button>',
    });

    m.root.querySelector('[data-cancel]').addEventListener('click', m.close);
    m.root.querySelector('[data-ok]').addEventListener('click', () => {
      const to = m.root.querySelector('#bulk-mv-loc').value;
      if (anyFlagged && RMTP.isSpace(to)) { ui.toast('Flagged kit can only go to a Store', 'danger'); return; }

      items.forEach((item) => {
        const qty = qtyOf(item) || 1;
        moveQty(item, qty, to);
      });

      selectedIds.clear();
      m.close();
      ui.toast(items.length + ' items moved to ' + to, 'ok');
      render();
    });
  }

  function inner(label, control) { return '<label class="block text-sm font-medium mb-2">' + ui.esc(label) + '</label>' + control; }
  function fld(label, control) { return '<div>' + inner(label, control) + '</div>'; }

  // Expose inventory controller methods for global shortcuts and scanner routing
  RMTP.inventory = {
    openDetail: (itemOrId) => {
      const it = typeof itemOrId === 'string' ? (store.find('inventory', itemOrId) || findItemsByQuery(itemOrId)[0]) : itemOrId;
      if (it) openDetail(it);
    },
    scanAndOpen: handleScan,
    findItems: findItemsByQuery,
    signOut,
    signIn,
    moveItem,
    openForm
  };
};
