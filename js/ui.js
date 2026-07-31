/* ============================================================
   ui.js — shared UI helpers
   ------------------------------------------------------------
   Icons, escaping, toasts, modals, confirm dialogs and a few
   formatters. Views build markup with template strings and use
   RMTP.ui.esc() around any user-supplied text.
   ============================================================ */
RMTP.ui = (function () {

  /* --- HTML escape (use around ALL user data in templates) --- */
  function esc(v) {
    return String(v == null ? '' : v)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  /* --- Icon set (Lucide-style). Returns an <svg> string. --- */
  const ICONS = {
    grid:   '<path d="M3 3h7v7H3zM14 3h7v7h-7zM14 14h7v7h-7zM3 14h7v7H3z"/>',
    book:   '<path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/>',
    wrench: '<path d="M14.7 6.3a4 4 0 0 0 5 5l-8.4 8.4a2.1 2.1 0 0 1-3-3l8.4-8.4a4 4 0 0 0-2-2z"/>',
    box:    '<path d="M21 8l-9-5-9 5 9 5 9-5z"/><path d="M3 8v8l9 5 9-5V8"/><path d="M12 13v8"/>',
    clip:   '<rect x="8" y="3" width="8" height="4" rx="1"/><path d="M8 5H6a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-2"/><path d="M9 12h6M9 16h4"/>',
    power:  '<path d="M12 2v10"/><path d="M18.4 6.6a9 9 0 1 1-12.8 0"/>',
    wave:   '<path d="M2 12h3l2-7 4 16 3-11 2 5h6"/>',
    bulb:   '<path d="M9 18h6"/><path d="M10 22h4"/><path d="M12 2a7 7 0 0 0-4 12.7c.6.5 1 1.3 1 2.1V18h6v-1.2c0-.8.4-1.6 1-2.1A7 7 0 0 0 12 2z"/>',
    screen: '<rect x="2" y="3" width="20" height="14" rx="2"/><path d="M8 21h8M12 17v4"/>',
    shield: '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>',
    plus:   '<path d="M12 5v14M5 12h14"/>',
    search: '<circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/>',
    x:      '<path d="M18 6 6 18M6 6l12 12"/>',
    chevR:  '<path d="m9 18 6-6-6-6"/>',
    chevL:  '<path d="m15 18-6-6 6-6"/>',
    check:  '<path d="M20 6 9 17l-5-5"/>',
    pen:    '<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/>',
    trash:  '<path d="M3 6h18M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2m3 0v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/>',
    print:  '<path d="M6 9V2h12v7"/><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><rect x="6" y="14" width="12" height="8"/>',
    alert:  '<path d="M12 9v4M12 17h.01"/><path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/>',
    calendar:'<rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/>',
    arrowR: '<path d="M5 12h14M13 6l6 6-6 6"/>',
    reset:  '<path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5"/>',
    award:  '<circle cx="12" cy="8" r="6"/><path d="M15.5 13.5 17 22l-5-3-5 3 1.5-8.5"/>',
    users:  '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>',
    pin:    '<path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0z"/><circle cx="12" cy="10" r="3"/>',
    clock:  '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
    file:   '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/>',
    upload: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="M17 8l-5-5-5 5"/><path d="M12 3v12"/>',
  };
  function icon(name, cls) {
    const path = ICONS[name] || ICONS.box;
    return '<svg class="' + (cls || 'w-5 h-5') + '" viewBox="0 0 24 24" fill="none" stroke="currentColor" ' +
      'stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + path + '</svg>';
  }

  /* --- Toast --- */
  function toast(message, type) {
    const layer = document.getElementById('toast-layer');
    const colours = { ok: 'var(--ok)', danger: 'var(--danger)', info: 'var(--info)' };
    const c = colours[type] || 'var(--accent)';
    const el = document.createElement('div');
    el.className = 'panel modal-in pointer-events-auto px-4 py-2.5 text-sm font-medium flex items-center gap-2 shadow-lg';
    el.style.borderColor = 'color-mix(in srgb, ' + c + ' 45%, var(--line))';
    el.innerHTML = '<span class="w-2 h-2 rounded-full" style="background:' + c + '"></span>' + esc(message);
    layer.appendChild(el);
    setTimeout(() => {
      el.style.transition = 'opacity .3s, transform .3s';
      el.style.opacity = '0'; el.style.transform = 'translateY(6px)';
      setTimeout(() => el.remove(), 300);
    }, 2600);
  }

  /* --- Modal ---
     opts: { title, body (html string), footer (html string), size } 
     Returns { root, close }. Caller queries root for its own fields/buttons. */
  function modal(opts) {
    const layer = document.getElementById('modal-layer');
    const root = document.createElement('div');
    root.className = 'fixed inset-0 z-40 flex items-end md:items-center justify-center';
    root.innerHTML =
      '<div class="absolute inset-0 bg-black/60" data-backdrop></div>' +
      '<div class="modal-in panel relative w-full ' + (opts.size || 'md:max-w-lg') +
        ' md:rounded-2xl rounded-t-2xl rounded-b-none max-h-[92vh] flex flex-col shadow-2xl">' +
        '<div class="flex items-center justify-between px-5 py-4 border-b border-line">' +
          '<h3 class="font-display text-lg font-semibold">' + esc(opts.title || '') + '</h3>' +
          (opts.locked ? '' : '<button data-close class="text-muted hover:text-ink p-1 -mr-1" aria-label="Close">' + icon('x') + '</button>') +
        '</div>' +
        '<div class="px-5 py-4 overflow-y-auto">' + (opts.body || '') + '</div>' +
        (opts.footer ? '<div class="px-5 py-4 border-t border-line flex justify-end gap-2">' + opts.footer + '</div>' : '') +
      '</div>';
    layer.appendChild(root);

    function close() {
      root.style.opacity = '0';
      setTimeout(() => root.remove(), 150);
      document.removeEventListener('keydown', onKey);
    }
    function onKey(e) { if (e.key === 'Escape') close(); }

    if (!opts.locked) {
      root.querySelector('[data-backdrop]').addEventListener('click', close);
      document.addEventListener('keydown', onKey);
    }
    root.querySelectorAll('[data-close]').forEach((b) => b.addEventListener('click', close));
    const firstField = root.querySelector('.field, button[data-primary]');
    if (firstField) setTimeout(() => firstField.focus(), 30);

    return { root, close };
  }

  /* --- Confirm dialog (Promise<boolean>) --- */
  function confirm(message, opts) {
    opts = opts || {};
    return new Promise((resolve) => {
      const m = modal({
        title: opts.title || 'Are you sure?',
        body: '<p class="text-sm text-muted">' + esc(message) + '</p>',
        footer:
          '<button class="btn btn-ghost" data-cancel>Cancel</button>' +
          '<button class="btn ' + (opts.danger ? 'btn-danger' : 'btn-primary') + '" data-ok data-primary>' +
            esc(opts.confirmLabel || 'Confirm') + '</button>',
      });
      m.root.querySelector('[data-cancel]').addEventListener('click', () => { m.close(); resolve(false); });
      m.root.querySelector('[data-ok]').addEventListener('click', () => { m.close(); resolve(true); });
    });
  }

  /* --- Status pill --- */
  function pill(label, colourVar) {
    return '<span class="pill" style="border-color:color-mix(in srgb,' + colourVar + ' 40%,var(--line));color:' + colourVar + '">' +
      '<span class="dot" style="background:' + colourVar + '"></span>' + esc(label) + '</span>';
  }

  /* --- Empty state --- */
  function empty(iconName, title, hint) {
    return '<div class="text-center py-16 px-6">' +
      '<div class="mx-auto w-12 h-12 rounded-2xl bg-panel2 border border-line flex items-center justify-center text-muted mb-4">' +
        icon(iconName, 'w-6 h-6') + '</div>' +
      '<p class="font-display font-semibold">' + esc(title) + '</p>' +
      (hint ? '<p class="text-sm text-muted mt-1 max-w-sm mx-auto">' + esc(hint) + '</p>' : '') +
    '</div>';
  }

  /* --- Page header used by every view --- */
  function pageHeader(eyebrow, title, actionsHtml) {
    return '<div class="flex items-start justify-between gap-4 mb-6">' +
      '<div>' +
        '<p class="eyebrow mb-1">' + esc(eyebrow) + '</p>' +
        '<h1 class="font-display text-2xl md:text-3xl font-bold tracking-tight">' + esc(title) + '</h1>' +
      '</div>' +
      (actionsHtml ? '<div class="flex items-center gap-2 shrink-0">' + actionsHtml + '</div>' : '') +
    '</div>';
  }

  function formatDate(iso) {
    if (!iso) return '';
    const d = new Date(iso);
    if (isNaN(d)) return esc(iso);
    return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
  }
  function timeAgo(ts) {
    const s = Math.floor((Date.now() - ts) / 1000);
    if (s < 60) return 'just now';
    const m = Math.floor(s / 60); if (m < 60) return m + 'm ago';
    const h = Math.floor(m / 60); if (h < 24) return h + 'h ago';
    return Math.floor(h / 24) + 'd ago';
  }

  return { esc, icon, toast, modal, confirm, pill, empty, pageHeader, formatDate, timeAgo };
})();
