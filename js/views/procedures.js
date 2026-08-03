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
      ? cat.items.map((i) => {
          const done = i.body && i.body.trim();
          return (
            '<a href="#/procedures/' + cat.id + '/' + i.id + '" class="panel p-4 flex items-center gap-3 hover:border-accent transition-colors">' +
              '<span class="w-9 h-9 rounded-lg bg-panel2 border border-line flex items-center justify-center ' +
                (done ? 'text-accent' : 'text-muted') + '">' + ui.icon('book', 'w-4 h-4') + '</span>' +
              '<span class="min-w-0">' +
                '<span class="block font-medium truncate">' + ui.esc(i.title) + '</span>' +
                '<span class="block text-xs text-muted mt-0.5">' +
                  (done ? ('Updated ' + (i.updated ? ui.formatDate(i.updated) : 'recently')) : 'Holding page \u2014 no content yet') +
                '</span>' +
              '</span>' +
              '<span class="ml-auto text-muted">' + ui.icon('chevR', 'w-4 h-4') + '</span>' +
            '</a>'
          );
        }).join('')
      : ui.empty('book', 'No procedures in ' + cat.name + ' yet', 'Add the first one to get started.');
    content = '<div class="grid gap-3">' + list + '</div>';
  }

  const headerAction = item
    ? ''
    : '<button id="add-proc" class="btn btn-ghost no-print">' + ui.icon('plus', 'w-4 h-4') + 'Add procedure</button>';

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
      .replace(/`([^`]+?)`/g, '<code class="px-1 rounded bg-panel2 tabular text-[0.85em]">$1</code>');
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
        out.push('<figure class="my-4"><img src="' + esc(m[2]) + '" alt="' + esc(m[1]) + '" class="rounded-xl border border-line max-w-full mx-auto block" loading="lazy" />' +
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

  function editBody(cat, item) {
    const m = ui.modal({
      title: 'Edit \u2014 ' + item.title,
      size: 'md:max-w-2xl',
      body:
        '<div class="flex items-center justify-between gap-2 mb-2">' +
          '<label class="block text-sm font-medium">Procedure content</label>' +
          '<label class="btn btn-ghost !py-1.5 text-xs cursor-pointer inline-flex" title="Upload an image and insert it at the cursor">' +
            '<input type="file" accept="image/*" id="proc-img" class="sr-only" />' +
            ui.icon('upload', 'w-4 h-4') + 'Insert image</label>' +
        '</div>' +
        '<textarea id="body-input" class="field font-mono text-[13px] leading-relaxed" rows="16">' +
          ui.esc(item.body || '') + '</textarea>' +
        '<p class="text-[11px] text-muted mt-2 leading-relaxed">Formats automatically \u2014 ' +
          '<span class="tabular text-ink">##</span> section, ' +
          '<span class="tabular text-ink">###</span> sub-section, ' +
          '<span class="tabular text-ink">1.</span> steps, ' +
          '<span class="tabular text-ink">-</span> bullets, ' +
          '<span class="tabular text-ink">NOTE:</span> callout, ' +
          '<span class="tabular text-ink">![caption](url)</span> image.</p>',
      footer:
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
    const imgInput = m.root.querySelector('#proc-img');
    imgInput.addEventListener('change', () => {
      const file = imgInput.files && imgInput.files[0];
      imgInput.value = '';
      if (!file) return;
      if (file.size > RMTP.files.MAX) { ui.toast('Image too large (max ' + RMTP.files.humanSize(RMTP.files.MAX) + ')', 'danger'); return; }
      const caption = file.name.replace(/\.[^.]+$/, '');
      ui.toast('Uploading image\u2026', 'info');
      RMTP.files.readAsDataUrl(file)
        .then((p) => { let meta; try { meta = RMTP.files.persist(p); } catch (e) { ui.toast('Couldn\u2019t store image', 'danger'); return null; } return meta ? RMTP.files.toRemote(meta) : null; })
        .then((remote) => {
          if (!remote) return;
          if (!remote.url) { ui.toast('Image upload needs Supabase Storage \u2014 create a public \u201ctechfiles\u201d bucket', 'danger'); return; }
          insertAtCursor('\n\n![' + caption + '](' + remote.url + ')\n');
          ui.toast('Image inserted', 'ok');
        })
        .catch((e) => { console.error('[procedures] image upload failed', e); ui.toast('Image upload failed', 'danger'); });
    });
    m.root.querySelector('[data-cancel]').addEventListener('click', m.close);
    m.root.querySelector('[data-save]').addEventListener('click', () => {
      item.body = ta.value;
      item.updated = new Date().toISOString();
      store.upsert('procedures', cat); // cat is a row in the procedures collection
      m.close(); ui.toast('Procedure saved', 'ok'); RMTP.router.render();
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
};
