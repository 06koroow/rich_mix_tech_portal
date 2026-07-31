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
            ? '<div class="text-sm leading-relaxed whitespace-pre-wrap text-ink/90">' + ui.esc(item.body) + '</div>'
            : ui.empty('pen', 'This is a holding page',
                'No content yet. Hit Edit to write the step-by-step for \u201c' + item.title + '\u201d.')) +
        '</div>' +
      '</div>'
    );
  }

  function editBody(cat, item) {
    const m = ui.modal({
      title: 'Edit \u2014 ' + item.title,
      size: 'md:max-w-2xl',
      body:
        '<label class="block text-sm font-medium mb-2">Procedure content</label>' +
        '<textarea id="body-input" class="field font-mono text-[13px] leading-relaxed" rows="14" ' +
          'placeholder="Write the step-by-step here. Plain text for now \u2014 you can add rich formatting later.">' +
          ui.esc(item.body || '') + '</textarea>',
      footer:
        '<button class="btn btn-ghost" data-cancel>Cancel</button>' +
        '<button class="btn btn-primary" data-save data-primary>Save changes</button>',
    });
    m.root.querySelector('[data-cancel]').addEventListener('click', m.close);
    m.root.querySelector('[data-save]').addEventListener('click', () => {
      item.body = m.root.querySelector('#body-input').value;
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
