/* ============================================================
   views/procedures.js — process documentation / SOPs
   ------------------------------------------------------------
   Routes:
     #/procedures                -> first category
     #/procedures/:cat           -> category's procedures
     #/procedures/:cat/:item     -> a single procedure (holding page)
   Procedures ship blank on purpose: the structure is here, you
   drop the real step-by-step into each one.
   ============================================================ */
RMTP.views.procedures = function (el, params) {
  const ui = RMTP.ui, store = RMTP.store;
  const cats = store.all('procedures');
  if (!cats.length) { el.innerHTML = ui.empty('book', 'No procedure areas yet'); return; }

  const activeCatId = params[0] || cats[0].id;
  const cat = cats.find((c) => c.id === activeCatId) || cats[0];
  const itemId = params[1];
  const item = itemId ? cat.items.find((i) => i.id === itemId) : null;

  const me = RMTP.auth.current();
  const isAdmin = !!(me && me.admin);

  /* --- Left: category sub-nav (vertical on desktop, chips on mobile) --- */
  const catNav = cats.map((c) =>
    '<a href="#/procedures/' + c.id + '" ' +
      'class="nav-item shrink-0 flex items-center gap-2.5 px-3 py-2.5 rounded-lg text-sm font-medium text-muted hover:text-ink" ' +
      (c.id === cat.id ? 'aria-current="page"' : '') + '>' +
      '<span class="text-accent">' + ui.icon(c.icon, 'w-4 h-4') + '</span>' +
      '<span class="whitespace-nowrap">' + ui.esc(c.name) + '</span>' +
      '<span class="tabular text-xs text-muted ml-auto hidden md:inline">' + c.items.length + '</span>' +
    '</a>'
  ).join('');

  /* --- Right: either an item detail or the category's item list --- */
  let content;
  if (item) {
    content = renderItem(cat, item);
  } else {
    const list = cat.items.length
      ? cat.items.map((i, idx) => {
          const done = i.body && i.body.trim();
          return (
            '<div class="panel p-3.5 sm:p-4 flex items-center gap-3 hover:border-accent transition-colors group">' +
              '<a href="#/procedures/' + cat.id + '/' + i.id + '" class="flex items-center gap-3 min-w-0 flex-1">' +
                '<span class="w-9 h-9 rounded-lg bg-panel2 border border-line flex items-center justify-center shrink-0 ' +
                  (done ? 'text-accent' : 'text-muted') + '">' + ui.icon('book', 'w-4 h-4') + '</span>' +
                '<span class="min-w-0">' +
                  '<span class="block font-medium truncate group-hover:text-accent transition-colors">' + ui.esc(i.title) + '</span>' +
                  '<span class="block text-xs text-muted mt-0.5">' +
                    (done ? ('Updated ' + (i.updated ? ui.formatDate(i.updated) : 'recently')) : 'Holding page \u2014 no content yet') +
                  '</span>' +
                '</span>' +
              '</a>' +
              (isAdmin ? (
                '<div class="flex items-center gap-1 shrink-0 opacity-80 group-hover:opacity-100">' +
                  '<button type="button" data-proc-up="' + idx + '" class="btn btn-ghost !p-1.5" title="Move Up" ' + (idx === 0 ? 'disabled' : '') + '>' + ui.icon('arrowU', 'w-3.5 h-3.5') + '</button>' +
                  '<button type="button" data-proc-down="' + idx + '" class="btn btn-ghost !p-1.5" title="Move Down" ' + (idx === cat.items.length - 1 ? 'disabled' : '') + '>' + ui.icon('arrowD', 'w-3.5 h-3.5') + '</button>' +
                '</div>'
              ) : '') +
              '<a href="#/procedures/' + cat.id + '/' + i.id + '" class="text-muted group-hover:text-ink pl-1 shrink-0">' + ui.icon('chevR', 'w-4 h-4') + '</a>' +
            '</div>'
          );
        }).join('')
      : ui.empty('book', 'No procedures in ' + cat.name + ' yet', 'Add the first one to get started.');
    content = '<div class="grid gap-3">' + list + '</div>';
  }

  const headerAction = item
    ? ''
    : '<div class="flex items-center gap-2">' +
        (isAdmin ? '<button id="edit-tab-btn" class="btn btn-ghost no-print">' + ui.icon('pen', 'w-4 h-4') + 'Edit Tab / Reorder</button>' : '') +
        '<button id="add-proc" class="btn btn-ghost no-print">' + ui.icon('plus', 'w-4 h-4') + 'Add procedure</button>' +
      '</div>';

  el.innerHTML =
    '<div class="view-enter">' +
      ui.pageHeader('Operating procedures', item ? cat.name : 'Procedures', headerAction) +
      '<div class="grid md:grid-cols-[248px_1fr] gap-5 items-start">' +
        '<nav class="panel p-2 flex md:flex-col gap-1 overflow-x-auto">' + catNav + '</nav>' +
        '<div class="min-w-0">' + content + '</div>' +
      '</div>' +
    '</div>';

  /* --- wiring --- */
  const addBtn = el.querySelector('#add-proc');
  if (addBtn) addBtn.addEventListener('click', () => addProcedure(cat));

  const editTabBtn = el.querySelector('#edit-tab-btn');
  if (editTabBtn) editTabBtn.addEventListener('click', () => editTabModal(cat));

  if (!item && isAdmin) {
    el.querySelectorAll('[data-proc-up]').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        const idx = +btn.getAttribute('data-proc-up');
        if (idx > 0) {
          const temp = cat.items[idx];
          cat.items[idx] = cat.items[idx - 1];
          cat.items[idx - 1] = temp;
          store.upsert('procedures', cat);
          ui.toast('Reordered', 'ok');
          RMTP.views.procedures(el, params);
        }
      });
    });
    el.querySelectorAll('[data-proc-down]').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        const idx = +btn.getAttribute('data-proc-down');
        if (idx < cat.items.length - 1) {
          const temp = cat.items[idx];
          cat.items[idx] = cat.items[idx + 1];
          cat.items[idx + 1] = temp;
          store.upsert('procedures', cat);
          ui.toast('Reordered', 'ok');
          RMTP.views.procedures(el, params);
        }
      });
    });
  }

  if (item) {
    el.querySelector('#edit-body').addEventListener('click', () => editBody(cat, item));
    el.querySelector('#print-proc').addEventListener('click', () => window.print());
  }

  /* ---------- renderers ---------- */
  function renderItem(cat, item) {
    const hasBody = item.body && item.body.trim();
    return (
      '<div class="panel overflow-hidden">' +
        '<div class="px-5 py-4 border-b border-line flex items-center gap-3">' +
          '<a href="#/procedures/' + cat.id + '" class="text-muted hover:text-ink no-print" aria-label="Back">' + ui.icon('chevL') + '</a>' +
          '<div class="min-w-0">' +
            '<p class="eyebrow">' + ui.esc(cat.name) + (item.updated ? ' \u00b7 updated ' + ui.formatDate(item.updated) : '') + '</p>' +
            '<h2 class="font-display text-xl font-semibold truncate">' + ui.esc(item.title) + '</h2>' +
          '</div>' +
          '<div class="ml-auto flex items-center gap-2 no-print">' +
            '<button id="print-proc" class="btn btn-ghost" title="Print">' + ui.icon('print', 'w-4 h-4') + '</button>' +
            '<button id="edit-body" class="btn btn-primary">' + ui.icon('pen', 'w-4 h-4') + 'Edit</button>' +
          '</div>' +
        '</div>' +
        '<div class="px-5 py-5">' +
          (hasBody
            ? renderBody(item.body)
            : ui.empty('pen', 'This is a holding page',
                'No content yet. Hit Edit to write the step-by-step for \u201c' + item.title + '\u201d.')) +
        '</div>' +
      '</div>'
    );
  }

  /* Render a procedure body into structured HTML. Understands a light
     markup — and also infers structure from the plain-text conventions the
     imported docs already use, so nothing had to be re-authored:
       ## / ###            headings (chapters / sub-sections)
       "1 — Title"          numbered chapter heading
       "2.1 Title"          numbered sub-section heading
       ALL-CAPS LINE        heading
       "1. text"            numbered step (rendered with a number badge)
       "- text"             bullet
       NOTE:/PLACEHOLDER:/PRINCIPLE:/IMPORTANT:/REMEMBER:/WARNING:/TIP:  callout
       ![caption](url)      image
       **bold**  `code`     inline
  */
  function renderBody(src) {
    const esc = ui.esc;
    const inline = (t) => esc(t)
      .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
      .replace(/`([^`]+?)`/g, '<code class="px-1 rounded bg-panel2 tabular text-[0.85em]">$1</code>')
      .replace(/(^|[^!])\[([^\]]+)\]\(([^)\s]+)\)/g, '$1<a href="$3" target="_blank" rel="noopener" class="text-accent underline hover:no-underline">$2</a>');
    const CALLOUT = /^(PLACEHOLDER|NOTE|PRINCIPLE|WORKED EXAMPLE|REMEMBER|IMPORTANT|TIP|WARNING)\b[:\u2014\-]?\s*(.*)$/;
    const out = [];
    let steps = null, bullets = null, para = null;

    function pushHeading(text, level) {
      if (level <= 2) out.push('<h3 class="font-display text-base font-semibold mt-6 mb-2 pb-1.5 border-b border-line" style="color:var(--accent)">' + inline(text) + '</h3>');
      else out.push('<h4 class="font-semibold text-sm mt-4 mb-1.5 text-ink">' + inline(text) + '</h4>');
    }
    function flushPara() { if (para != null) { out.push('<p class="mb-3 text-ink/90">' + inline(para) + '</p>'); para = null; } }
    function flushSteps() {
      if (steps) {
        out.push('<ol class="my-3 space-y-2">' + steps.map((s, i) =>
          '<li class="flex gap-3"><span class="shrink-0 w-6 h-6 rounded-full text-xs font-semibold flex items-center justify-center" style="background:var(--accent);color:#fff">' + (i + 1) + '</span>' +
          '<span class="pt-0.5 text-ink/90">' + inline(s) + '</span></li>').join('') + '</ol>');
        steps = null;
      }
    }
    function flushBullets() {
      if (bullets) {
        out.push('<ul class="my-3 space-y-1.5 list-disc pl-5 marker:text-accent">' +
          bullets.map((b) => '<li class="text-ink/90 pl-1">' + inline(b) + '</li>').join('') + '</ul>');
        bullets = null;
      }
    }
    function flushAll() { flushPara(); flushSteps(); flushBullets(); }
    function isAllCaps(t) {
      const letters = t.replace(/[^A-Za-z]/g, '');
      if (letters.length < 2) return false;
      return (t.replace(/[^A-Z]/g, '').length / letters.length) >= 0.85 && t.length <= 66 && !/[.:]$/.test(t);
    }

    String(src || '').replace(/\r/g, '').split('\n').forEach((raw) => {
      const t = raw.trim();
      let m;
      if (!t) { flushAll(); return; }
      if ((m = t.match(/^!\[(.*?)\]\((.+?)\)\s*$/))) {
        flushAll();
        out.push('<figure class="my-4 max-w-md mx-auto"><img src="' + esc(m[2]) + '" alt="' + esc(m[1]) + '" class="rounded-xl border border-line w-full mx-auto block" loading="lazy" />' +
          (m[1] ? '<figcaption class="text-xs text-muted text-center mt-2">' + esc(m[1]) + '</figcaption>' : '') + '</figure>');
        return;
      }
      if ((m = t.match(/^(#{1,3})\s+(.+)$/))) { flushAll(); pushHeading(m[2], m[1].length); return; }
      if (/^\d+\s+[\u2014\u2013-]\s+.+$/.test(t)) { flushAll(); pushHeading(t, 2); return; }   // "1 — Title"
      if (/^\d+\.\d+\s+.+$/.test(t)) { flushAll(); pushHeading(t, 3); return; }                 // "2.1 Title"
      if ((m = t.match(/^\d+\.\s+(.+)$/))) { flushPara(); flushBullets(); (steps = steps || []).push(m[1]); return; }
      if ((m = t.match(/^[-\u2022*]\s+(.+)$/))) { flushPara(); flushSteps(); (bullets = bullets || []).push(m[1]); return; }
      if ((m = t.match(CALLOUT))) {
        flushAll();
        out.push('<div class="my-3 panel p-3 text-sm" style="border-color:color-mix(in srgb,var(--accent) 35%,var(--line))">' +
          '<span class="eyebrow text-accent">' + esc(m[1]) + '</span> <span class="text-ink/90">' + inline(m[2]) + '</span></div>');
        return;
      }
      if (isAllCaps(t)) { flushAll(); pushHeading(t, 2); return; }
      flushSteps(); flushBullets();
      para = para != null ? para + ' ' + t : t;
    });
    flushAll();
    return '<div class="proc-body leading-relaxed">' + out.join('') + '</div>';
  }

  function iconFor(name) {
    const n = String(name).toLowerCase();
    if (/cinema|film|screen|project/.test(n)) return 'screen';
    if (/sound|audio|\bpa\b|mic/.test(n)) return 'wave';
    if (/light|\blx\b/.test(n)) return 'bulb';
    if (/stage|rig|flying/.test(n)) return 'box';
    if (/safe|health|fire|emergency|risk/.test(n)) return 'shield';
    if (/open|clos|power|start/.test(n)) return 'power';
    return 'book';
  }
  // Find a category by name (case-insensitive), or create + persist a new one.
  function resolveCategory(name) {
    const found = store.all('procedures').find((c) => c.name.trim().toLowerCase() === name.trim().toLowerCase());
    if (found) return found;
    let base = RMTP.slug(name) || 'cat', id = base, n = 2;
    const ids = store.all('procedures').map((c) => c.id);
    while (ids.indexOf(id) > -1) { id = base + '-' + n; n += 1; }
    const cat = { id: id, name: name, icon: iconFor(name), items: [] };
    store.upsert('procedures', cat);
    return cat;
  }

  function editBody(cat, item) {
    const isAdmin = !!(RMTP.auth.current() && RMTP.auth.current().admin);
    const catNames = store.all('procedures').map((c) => c.name);
    const m = ui.modal({
      title: 'Edit \u2014 ' + item.title,
      size: 'md:max-w-2xl',
      body:
        '<div class="grid gap-4">' +
          '<div><label class="block text-sm font-medium mb-1.5">Title</label>' +
            '<input id="p-title" class="field" value="' + ui.esc(item.title) + '" /></div>' +
          '<div><label class="block text-sm font-medium mb-1.5">Category (tab)</label>' +
            '<input id="p-cat" class="field" list="p-cat-list" value="' + ui.esc(cat.name) + '" placeholder="Pick one, or type a new tab name" autocomplete="off" />' +
            '<datalist id="p-cat-list">' + catNames.map((nm) => '<option value="' + ui.esc(nm) + '"></option>').join('') + '</datalist>' +
            '<p class="text-[11px] text-muted mt-1">Type a name that doesn\u2019t exist yet to create a new tab.</p></div>' +
          '<div>' +
            '<div class="flex items-center justify-between gap-2 mb-1.5">' +
              '<label class="block text-sm font-medium">Content</label>' +
              '<div class="flex gap-1">' +
                '<button type="button" id="proc-link" class="btn btn-ghost !py-1.5 text-xs" title="Insert a hyperlink">' + ui.icon('link', 'w-4 h-4') + 'Link</button>' +
                '<label class="btn btn-ghost !py-1.5 text-xs cursor-pointer inline-flex" title="Attach a file (PDF, doc) and link to it">' +
                  '<input type="file" accept=".pdf,.doc,.docx,.xls,.xlsx,.txt,image/*" id="proc-file" class="sr-only" />' +
                  ui.icon('upload', 'w-4 h-4') + 'File</label>' +
                '<label class="btn btn-ghost !py-1.5 text-xs cursor-pointer inline-flex" title="Upload an image and insert it at the cursor">' +
                  '<input type="file" accept="image/*" id="proc-img" class="sr-only" />' +
                  ui.icon('image', 'w-4 h-4') + 'Image</label>' +
              '</div>' +
            '</div>' +
            '<textarea id="body-input" class="field font-mono text-[13px] leading-relaxed" rows="14">' + ui.esc(item.body || '') + '</textarea>' +
            '<p class="text-[11px] text-muted mt-2 leading-relaxed">Formats automatically \u2014 ' +
              '<span class="tabular text-ink">##</span> section, ' +
              '<span class="tabular text-ink">###</span> sub-section, ' +
              '<span class="tabular text-ink">1.</span> steps, ' +
              '<span class="tabular text-ink">-</span> bullets, ' +
              '<span class="tabular text-ink">NOTE:</span> callout, ' +
              '<span class="tabular text-ink">[text](url)</span> link, ' +
              '<span class="tabular text-ink">![caption](url)</span> image.</p>' +
          '</div>' +
        '</div>',
      footer:
        (isAdmin ? '<button class="btn btn-danger mr-auto" data-del>' + ui.icon('trash', 'w-4 h-4') + 'Delete page</button>' : '') +
        '<button class="btn btn-ghost" data-cancel>Cancel</button>' +
        '<button class="btn btn-primary" data-save data-primary>Save changes</button>',
    });
    const ta = m.root.querySelector('#body-input');
    function insertAtCursor(text) {
      const s = ta.selectionStart != null ? ta.selectionStart : ta.value.length;
      const e = ta.selectionEnd != null ? ta.selectionEnd : s;
      ta.value = ta.value.slice(0, s) + text + ta.value.slice(e);
      ta.focus(); ta.selectionStart = ta.selectionEnd = s + text.length;
    }
    // Upload a file (image or document) → Storage → insert markdown.
    function uploadAndInsert(file, asImage) {
      if (!file) return;
      if (file.size > RMTP.files.MAX) { ui.toast('File too large (max ' + RMTP.files.humanSize(RMTP.files.MAX) + ')', 'danger'); return; }
      const label = file.name.replace(/\.[^.]+$/, '');
      ui.toast('Uploading\u2026', 'info');
      RMTP.files.readAsDataUrl(file)
        .then((p) => { let meta; try { meta = RMTP.files.persist(p); } catch (e) { ui.toast('Couldn\u2019t store file', 'danger'); return null; } return meta ? RMTP.files.toRemote(meta) : null; })
        .then((remote) => {
          if (!remote) return;
          if (!remote.url) { ui.toast('File upload needs Supabase Storage \u2014 create a public \u201ctechfiles\u201d bucket', 'danger'); return; }
          insertAtCursor(asImage ? ('\n\n![' + label + '](' + remote.url + ')\n') : ('[' + file.name + '](' + remote.url + ')'));
          ui.toast(asImage ? 'Image inserted' : 'File linked', 'ok');
        })
        .catch((e) => { console.error('[procedures] upload failed', e); ui.toast('Upload failed', 'danger'); });
    }
    m.root.querySelector('#proc-img').addEventListener('change', (ev) => { uploadAndInsert(ev.target.files && ev.target.files[0], true); ev.target.value = ''; });
    m.root.querySelector('#proc-file').addEventListener('change', (ev) => { uploadAndInsert(ev.target.files && ev.target.files[0], false); ev.target.value = ''; });
    m.root.querySelector('#proc-link').addEventListener('click', () => insertAtCursor('[link text](https://)'));
    m.root.querySelector('[data-cancel]').addEventListener('click', m.close);

    m.root.querySelector('[data-save]').addEventListener('click', () => {
      const title = m.root.querySelector('#p-title').value.trim() || item.title;
      const catName = m.root.querySelector('#p-cat').value.trim() || cat.name;
      item.title = title;
      item.body = ta.value;
      item.updated = new Date().toISOString();
      const target = resolveCategory(catName);
      if (target.id !== cat.id) {
        cat.items = cat.items.filter((x) => x.id !== item.id);   // move across tabs
        target.items.push(item);
        store.upsert('procedures', target);
        if (cat.items.length) store.upsert('procedures', cat); else store.remove('procedures', cat.id);
      } else {
        store.upsert('procedures', cat);
      }
      m.close(); ui.toast('Saved', 'ok');
      location.hash = '#/procedures/' + target.id + '/' + item.id;
      RMTP.router.render();
    });

    const delBtn = m.root.querySelector('[data-del]');
    if (delBtn) delBtn.addEventListener('click', async () => {
      const ok = await ui.confirm('Delete \u201c' + item.title + '\u201d? This removes the page for everyone.',
        { title: 'Delete procedure', confirmLabel: 'Delete', danger: true });
      if (!ok) return;
      cat.items = cat.items.filter((x) => x.id !== item.id);
      if (RMTP.supabase && RMTP.supabase.isConfigured() && RMTP.syncSb.deleteProcedureRow) RMTP.syncSb.deleteProcedureRow(item.id);
      if (cat.items.length) store.upsert('procedures', cat); else store.remove('procedures', cat.id);
      m.close(); ui.toast('Page deleted', 'ok');
      location.hash = '#/procedures';
      RMTP.router.render();
    });
  }

  function addProcedure(cat) {
    const m = ui.modal({
      title: 'New procedure in ' + cat.name,
      body:
        '<label class="block text-sm font-medium mb-2">Title</label>' +
        '<input id="proc-title" class="field" placeholder="e.g. Wireless mic ring-out" />',
      footer:
        '<button class="btn btn-ghost" data-cancel>Cancel</button>' +
        '<button class="btn btn-primary" data-add data-primary>Add procedure</button>',
    });
    m.root.querySelector('[data-cancel]').addEventListener('click', m.close);
    m.root.querySelector('[data-add]').addEventListener('click', () => {
      const title = m.root.querySelector('#proc-title').value.trim();
      if (!title) { ui.toast('Give it a title first', 'danger'); return; }
      const id = store.uid('proc');
      cat.items.push({ id, title, updated: '', body: '' });
      store.upsert('procedures', cat);
      m.close(); ui.toast('Procedure added', 'ok');
      location.hash = '#/procedures/' + cat.id + '/' + id;
    });
  }

  function editTabModal(cat) {
    let itemsCopy = cat.items.slice();

    function renderTabItems() {
      const container = m.root.querySelector('#tab-proc-list');
      if (!container) return;
      if (!itemsCopy.length) {
        container.innerHTML = '<p class="text-xs text-muted py-2">No procedures in this tab.</p>';
        return;
      }
      container.innerHTML = itemsCopy.map((item, idx) => {
        return (
          '<div class="p-2.5 rounded-lg bg-panel2 border border-line flex items-center justify-between gap-2">' +
            '<span class="text-xs font-semibold text-muted font-mono w-6">#' + (idx + 1) + '</span>' +
            '<span class="text-sm font-medium text-ink truncate flex-1">' + ui.esc(item.title) + '</span>' +
            '<div class="flex items-center gap-1 shrink-0">' +
              '<button type="button" data-m-up="' + idx + '" class="btn btn-ghost !p-1 text-xs" title="Move Up" ' + (idx === 0 ? 'disabled' : '') + '>' + ui.icon('arrowU', 'w-3.5 h-3.5') + '</button>' +
              '<button type="button" data-m-down="' + idx + '" class="btn btn-ghost !p-1 text-xs" title="Move Down" ' + (idx === itemsCopy.length - 1 ? 'disabled' : '') + '>' + ui.icon('arrowD', 'w-3.5 h-3.5') + '</button>' +
            '</div>' +
          '</div>'
        );
      }).join('');

      container.querySelectorAll('[data-m-up]').forEach((btn) => {
        btn.addEventListener('click', () => {
          const idx = +btn.getAttribute('data-m-up');
          if (idx > 0) {
            const temp = itemsCopy[idx];
            itemsCopy[idx] = itemsCopy[idx - 1];
            itemsCopy[idx - 1] = temp;
            renderTabItems();
          }
        });
      });

      container.querySelectorAll('[data-m-down]').forEach((btn) => {
        btn.addEventListener('click', () => {
          const idx = +btn.getAttribute('data-m-down');
          if (idx < itemsCopy.length - 1) {
            const temp = itemsCopy[idx];
            itemsCopy[idx] = itemsCopy[idx + 1];
            itemsCopy[idx + 1] = temp;
            renderTabItems();
          }
        });
      });
    }

    const m = ui.modal({
      title: 'Edit Tab & Reorder Procedures',
      size: 'md:max-w-lg',
      body:
        '<div class="grid gap-4">' +
          '<div>' +
            '<label class="block text-sm font-medium mb-1.5">Tab / Category Name</label>' +
            '<input id="tab-name" class="field" value="' + ui.esc(cat.name) + '" />' +
          '</div>' +
          '<div>' +
            '<div class="flex items-center justify-between mb-2">' +
              '<label class="block text-sm font-medium">Reorder Procedures</label>' +
              '<span class="text-xs text-muted font-mono">' + itemsCopy.length + ' documents</span>' +
            '</div>' +
            '<div id="tab-proc-list" class="grid gap-2 max-h-72 overflow-y-auto pr-1"></div>' +
          '</div>' +
        '</div>',
      footer:
        '<button class="btn btn-ghost" data-cancel>Cancel</button>' +
        '<button class="btn btn-primary" data-save data-primary>Save Order</button>',
    });

    renderTabItems();

    m.root.querySelector('[data-cancel]').addEventListener('click', m.close);
    m.root.querySelector('[data-save]').addEventListener('click', () => {
      const newName = m.root.querySelector('#tab-name').value.trim() || cat.name;
      cat.name = newName;
      cat.items = itemsCopy;
      store.upsert('procedures', cat);
      m.close();
      ui.toast('Tab and procedure order saved', 'ok');
      RMTP.views.procedures(el, params);
    });
  }
};
