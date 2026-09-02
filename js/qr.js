/* ============================================================
   qr.js — QR generation, scanning & label printing
   ------------------------------------------------------------
   Wraps two vendored, no-build libraries:
     - qrcode-generator  (window.qrcode)      -> make QR SVGs
     - html5-qrcode      (window.Html5Qrcode) -> camera scanning

   IMPORTANT — camera scanning needs a *secure context*.
   Browsers only expose the camera on https:// or http://localhost,
   NOT on file://. So double-clicking index.html gives you the app
   but the scanner falls back to manual tag entry. To scan for real:
     • locally:  `npx serve` or `python3 -m http.server`, open localhost
     • on phone: drop the folder on Netlify / GitHub Pages for HTTPS
   This is static hosting only — still no backend. See README.

   Payloads are namespaced so the scanner ignores unrelated QR codes:
       RMTP-INV:<asset-tag>
   ============================================================ */
RMTP.qr = (function () {

  /* ---- Payload helpers ---- */
  const INV_PREFIX = 'RMTP-INV:';

  /* Payload for a whole line (tag) or a specific unit (tag#unit). */
  function encodeItem(tag, unit) {
    const base = INV_PREFIX + String(tag || '').trim();
    return (unit != null && unit !== '') ? base + '#' + unit : base;
  }

  /* Returns { kind:'inventory', value:<tag>, unit:<n|null> } or null for
     foreign QRs. Tolerates a bare tag typed manually, a "#unit" suffix
     from a per-unit label, JSON objects, URLs with query/hash routes, etc. */
  function parse(text) {
    const t = String(text || '').trim();
    if (!t) return null;
    let raw = t;

    // Check if it's a JSON payload
    if (raw.startsWith('{') && raw.endsWith('}')) {
      try {
        const obj = JSON.parse(raw);
        const val = obj.tag || obj.itemTag || obj.id || obj.itemId || obj.value;
        if (val) {
          return {
            kind: 'inventory',
            value: String(val).trim(),
            unit: obj.unit != null ? parseInt(obj.unit, 10) : null
          };
        }
      } catch (e) {}
    }

    // Handle QR codes containing URLs with parameters or hash routes
    if (raw.includes('RMTP-INV:')) {
      const idx = raw.indexOf('RMTP-INV:');
      raw = raw.slice(idx);
    } else if (raw.includes('tag=')) {
      const match = raw.match(/tag=([^&#\s]+)/i);
      if (match) raw = decodeURIComponent(match[1]);
    } else if (raw.includes('item=')) {
      const match = raw.match(/item=([^&#\s]+)/i);
      if (match) raw = decodeURIComponent(match[1]);
    } else if (raw.includes('id=')) {
      const match = raw.match(/id=([^&#\s]+)/i);
      if (match) raw = decodeURIComponent(match[1]);
    } else if (raw.includes('/inventory/')) {
      const match = raw.match(/\/inventory\/([^?&#\s]+)/i);
      if (match) raw = decodeURIComponent(match[1]);
    }

    if (raw.toUpperCase().indexOf(INV_PREFIX) === 0) raw = raw.slice(INV_PREFIX.length).trim();
    let unit = null, value = raw;
    const hash = raw.lastIndexOf('#');
    if (hash > 0) {
      const u = raw.slice(hash + 1);
      if (/^\d+$/.test(u)) { unit = parseInt(u, 10); value = raw.slice(0, hash); }
    }
    return { kind: 'inventory', value: value.trim(), unit: unit };
  }

  /* Generate unique reference numbers, QR code payloads, and unit trackers */
  function generateTrackers(item) {
    if (!item) return { refNumber: '', qrCode: '', unitTrackers: [], unitTags: [] };
    const tag = (item.tag || item.id || '').trim();
    const qty = Math.max(1, Number(item.qty) || 1);
    const refNumber = item.refNumber || ('#' + tag);
    const qrCode = item.qrCode || encodeItem(tag, null);

    const unitTrackers = [];
    const unitTags = [];
    for (let u = 1; u <= qty; u++) {
      const unitRef = qty > 1 ? '#' + tag + '/' + u : '#' + tag;
      const unitTag = qty > 1 ? tag + '/' + u : tag;
      const unitQr = encodeItem(tag, qty > 1 ? u : null);
      unitTrackers.push({
        unit: u,
        total: qty,
        ref: unitRef,
        tag: unitTag,
        qr: unitQr,
        name: item.name || '',
        id: item.id || tag
      });
      unitTags.push(unitRef);
    }
    return { refNumber, qrCode, unitTrackers, unitTags };
  }

  function ensureItemTrackers(item) {
    if (!item) return item;
    const { refNumber, qrCode, unitTrackers, unitTags } = generateTrackers(item);
    item.refNumber = item.refNumber || refNumber;
    item.qrCode = item.qrCode || qrCode;
    const currentQty = Math.max(1, Number(item.qty) || 1);
    if (!Array.isArray(item.unitTrackers) || item.unitTrackers.length !== currentQty) {
      item.unitTrackers = unitTrackers;
      item.unitTags = unitTags;
    }
    return item;
  }

  /* Expand inventory lines into one entry per physical unit. A line with
     qty 8 yields 8 units (1..8); qty 1 yields a single unit. */
  function expandUnits(items) {
    const out = [];
    (items || []).forEach((it) => {
      if (!it || !(it.tag || it.id)) return;
      if (Array.isArray(it.unitTrackers) && it.unitTrackers.length) {
        it.unitTrackers.forEach((ut) => {
          out.push({
            id: it.id,
            name: ut.name || it.name,
            tag: it.tag || it.id,
            unit: ut.total > 1 ? ut.unit : null,
            total: ut.total || it.qty || 1,
            ref: ut.ref,
            qr: ut.qr
          });
        });
        return;
      }
      const total = Math.max(1, Number(it.qty) || 1);
      for (let u = 1; u <= total; u++) {
        out.push({
          id: it.id,
          name: it.name,
          tag: it.tag || it.id,
          unit: total > 1 ? u : null,
          total: total,
          ref: '#' + (it.tag || it.id) + (total > 1 ? '/' + u : ''),
          qr: encodeItem(it.tag || it.id, total > 1 ? u : null)
        });
      }
    });
    return out;
  }

  /* ---- QR image (SVG string) for printable labels ---- */
  function svg(text, opts) {
    opts = opts || {};
    if (typeof window.qrcode !== 'function') {
      return '<span class="text-xs text-danger">QR lib not loaded</span>';
    }
    const qr = window.qrcode(0, opts.ecl || 'M'); // 0 = auto-size
    qr.addData(String(text));
    qr.make();
    // cellSize in px, margin in cells. scalable="true" lets CSS size it.
    let out = qr.createSvgTag({ cellSize: opts.cellSize || 4, margin: opts.margin != null ? opts.margin : 2, scalable: true });
    // Force it to fill its container regardless of intrinsic size.
    out = out.replace('<svg', '<svg style="width:100%;height:auto;display:block" preserveAspectRatio="xMidYMid meet"');
    return out;
  }

  /* ---- Capability check ---- */
  function cameraAvailable() {
    return !!(window.Html5Qrcode &&
              window.isSecureContext &&
              navigator.mediaDevices &&
              typeof navigator.mediaDevices.getUserMedia === 'function');
  }

  /* ---- Scan ----
     Opens a modal. Resolves with the decoded string (or manually typed
     value), or null if cancelled. Always offers manual entry so the
     workflow is testable without a camera (e.g. on file:// or desktop). */
  function scan(opts) {
    opts = opts || {};
    const ui = RMTP.ui;
    const canScan = cameraAvailable();

    return new Promise((resolve) => {
      let settled = false;
      let scanner = null;

      const readerId = 'rm-reader-' + Date.now().toString(36);
      const cameraBlock = canScan
        ? '<div id="' + readerId + '" class="rounded-xl overflow-hidden bg-black border border-line aspect-square max-w-xs mx-auto"></div>' +
          '<p class="text-xs text-muted text-center mt-2">Point the camera at a kit label.</p>'
        : '<div class="panel bg-panel2 p-4 text-center">' +
            ui.icon('alert', 'w-6 h-6') + '<p class="text-sm mt-2">Camera unavailable here.</p>' +
            '<p class="text-xs text-muted mt-1">Serve over https/localhost to scan, or enter the tag by hand below.</p>' +
          '</div>';

      const m = ui.modal({
        title: opts.title || 'Scan kit',
        size: 'md:max-w-md',
        body:
          cameraBlock +
          '<div class="mt-4 pt-4 border-t border-line">' +
            '<label class="block text-sm font-medium mb-2">Or enter asset tag</label>' +
            '<div class="flex gap-2">' +
              '<input id="rm-manual-tag" class="field tabular" placeholder="MIC-058" autocomplete="off" />' +
              '<button id="rm-manual-go" class="btn btn-primary shrink-0">Go</button>' +
            '</div>' +
          '</div>',
        footer: '<button class="btn btn-ghost" data-cancel>Cancel</button>',
      });

      function cleanup() {
        if (scanner) {
          try {
            scanner.stop().then(() => { try { scanner.clear(); } catch (e) {} }).catch(() => {});
          } catch (e) {}
          scanner = null;
        }
      }
      function finish(value) {
        if (settled) return;
        settled = true;
        cleanup();
        m.close();
        resolve(value);
      }

      m.root.querySelector('[data-cancel]').addEventListener('click', () => finish(null));
      // Backdrop / Esc close also resolves null — patch modal's close.
      const origClose = m.close;
      m.close = function () { if (!settled) { settled = true; cleanup(); } origClose(); resolve(null); };

      const manualInput = m.root.querySelector('#rm-manual-tag');
      const manualGo = m.root.querySelector('#rm-manual-go');
      function submitManual() {
        const v = manualInput.value.trim();
        if (!v) { ui.toast('Type an asset tag', 'danger'); return; }
        finish(encodeItem(v)); // normalise to a namespaced payload
      }
      manualGo.addEventListener('click', submitManual);
      manualInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') submitManual(); });
      if (!canScan) setTimeout(() => manualInput.focus(), 60);

      if (canScan) {
        try {
          scanner = new window.Html5Qrcode(readerId, /* verbose */ false);
          scanner.start(
            { facingMode: 'environment' },
            { fps: 10, qrbox: { width: 220, height: 220 } },
            (decodedText) => finish(decodedText),
            () => {} // per-frame decode miss — ignore
          ).catch((err) => {
            console.warn('[qr] camera start failed', err);
            ui.toast('Could not start camera — enter tag manually', 'danger');
          });
        } catch (err) {
          console.warn('[qr] scanner init failed', err);
        }
      }
    });
  }

  /* ---- Print labels ----
     Renders a print-only sheet of QR labels into #print-root and calls
     window.print(). Cleans up afterwards. Each label = name, tag, QR. */
  function labelCard(u) {
    return '<div class="qr-label">' +
      '<div class="qr-label__code">' + svg(encodeItem(u.tag || u.id, u.unit), { margin: 1 }) + '</div>' +
      '<div class="qr-label__meta">' +
        '<div class="qr-label__name">' + RMTP.ui.esc(u.name || '') + '</div>' +
        '<div class="qr-label__tag">' + RMTP.ui.esc(u.tag || '') + (u.unit ? ' \u00b7 ' + u.unit + '/' + u.total : '') + '</div>' +
      '</div>' +
    '</div>';
  }

  function printLabels(items) {
    const units = expandUnits((items || []).filter((i) => i && (i.tag || i.id)));
    if (!units.length) { RMTP.ui.toast('Nothing to print', 'danger'); return; }
    const root = document.getElementById('print-root');
    if (!root) { RMTP.ui.toast('Print area missing', 'danger'); return; }
    root.innerHTML =
      '<div class="qr-sheet-head">' +
        '<strong>' + RMTP.meta.name + ' — Kit labels</strong>' +
        '<span>' + units.length + ' labels · ' + RMTP.ui.formatDate(new Date().toISOString()) + '</span>' +
      '</div>' +
      '<div class="qr-sheet">' + units.map(labelCard).join('') + '</div>';
    document.body.classList.add('is-printing');
    function done() {
      document.body.classList.remove('is-printing');
      root.innerHTML = '';
      window.removeEventListener('afterprint', done);
    }
    window.addEventListener('afterprint', done);
    // Fallback cleanup in case afterprint never fires.
    setTimeout(() => { if (document.body.classList.contains('is-printing')) done(); }, 60000);
    window.print();
  }

  /* Preview modal before printing. Expands to one label per physical unit
     and excludes fixed installations (which can't be signed out). */
  function labelPreview(items) {
    const ui = RMTP.ui;
    const portable = (items || []).filter((i) => i && !i.static && (i.tag || i.id));
    const units = expandUnits(portable);
    if (!units.length) { ui.toast('No portable kit to label', 'danger'); return; }
    const sample = units.slice(0, 6);
    const staticCount = (items || []).filter((i) => i && i.static).length;
    const m = ui.modal({
      title: 'Print QR labels',
      size: 'md:max-w-lg',
      body:
        '<p class="text-sm text-muted mb-4">One label per <span class="text-ink">individual unit</span> \u2014 a line of 8 gets 8 codes, each encoding ' +
          '<span class="tabular text-ink">RMTP-INV:&lt;tag&gt;#&lt;unit&gt;</span>. ' +
          '<span class="text-ink">' + units.length + '</span> labels across ' + portable.length + ' portable lines.' +
          (staticCount ? ' Fixed installations (' + staticCount + ') are excluded.' : '') + '</p>' +
        '<div class="grid grid-cols-3 gap-3">' +
          sample.map((u) =>
            '<div class="panel bg-white p-2 text-center">' +
              '<div class="w-full aspect-square">' + svg(encodeItem(u.tag || u.id, u.unit), { margin: 1 }) + '</div>' +
              '<div class="text-[11px] text-black font-semibold truncate mt-1">' + ui.esc(u.name) + '</div>' +
              '<div class="text-[10px] text-black/60 tabular">' + ui.esc(u.tag) + (u.unit ? ' \u00b7 ' + u.unit + '/' + u.total : '') + '</div>' +
            '</div>'
          ).join('') +
        '</div>' +
        (units.length > sample.length ? '<p class="text-xs text-muted mt-3 text-center">Showing the first ' + sample.length + ' of ' + units.length + ' labels.</p>' : ''),
      footer:
        '<button class="btn btn-ghost" data-cancel>Cancel</button>' +
        '<button class="btn btn-primary" data-print data-primary>' + ui.icon('print', 'w-4 h-4') + 'Print ' + units.length + ' labels</button>',
    });
    m.root.querySelector('[data-cancel]').addEventListener('click', m.close);
    m.root.querySelector('[data-print]').addEventListener('click', () => { m.close(); printLabels(portable); });
  }

  /* Dedicated QR code & tracker tag inspector modal for a single item or grouped units */
  function showItemQRs(items) {
    const list = Array.isArray(items) ? items : [items];
    const ui = RMTP.ui;
    const units = expandUnits(list.filter(Boolean));
    if (!units.length) { ui.toast('No units available for QR generation', 'danger'); return; }

    const firstItem = list[0] || {};
    const titleName = firstItem.name || 'Kit Piece';

    const m = ui.modal({
      title: 'QR Codes & Unit Trackers \u2014 ' + ui.esc(titleName),
      size: 'md:max-w-2xl',
      body:
        '<div class="mb-4 flex items-center justify-between gap-3 bg-panel2 p-3.5 rounded-xl border border-line">' +
          '<div>' +
            '<p class="text-sm font-medium text-ink">' + ui.esc(titleName) + ' \u00b7 ' + units.length + ' physical unit' + (units.length === 1 ? '' : 's') + '</p>' +
            '<p class="text-xs text-muted mt-0.5">Each unit generates a unique scannable payload (<span class="tabular font-mono text-accent">RMTP-INV:&lt;tag&gt;#&lt;unit&gt;</span>) and sequential reference number.</p>' +
          '</div>' +
          '<button class="btn btn-secondary text-xs !py-1.5 !px-3 shrink-0" data-print-all>' + ui.icon('print', 'w-3.5 h-3.5') + 'Print labels (' + units.length + ')</button>' +
        '</div>' +
        '<div class="grid grid-cols-1 sm:grid-cols-2 gap-3.5 max-h-[60vh] overflow-y-auto pr-1">' +
          units.map((u) => {
            const unitTagRef = '#' + (u.tag || u.id) + (u.unit ? '/' + u.unit : '');
            const payload = encodeItem(u.tag || u.id, u.unit);
            return '<div class="panel bg-panel p-3.5 border border-line flex gap-3.5 items-center">' +
              '<div class="w-24 h-24 shrink-0 bg-white p-1.5 rounded-lg border border-line/40 shadow-xs flex items-center justify-center">' +
                svg(payload, { margin: 1 }) +
              '</div>' +
              '<div class="min-w-0 flex-1">' +
                '<div class="flex items-center gap-1.5 flex-wrap">' +
                  '<span class="tabular text-xs text-accent font-mono inline-flex items-center px-1.5 py-0.5 rounded bg-accent/10 border border-accent/20 font-semibold">' + ui.esc(unitTagRef) + '</span>' +
                  (u.unit ? '<span class="text-[11px] text-muted bg-panel2 px-1.5 py-0.5 rounded font-medium">Unit ' + u.unit + ' of ' + u.total + '</span>' : '<span class="text-[11px] text-muted bg-panel2 px-1.5 py-0.5 rounded font-medium">Single Unit</span>') +
                '</div>' +
                '<div class="font-medium text-xs text-ink truncate mt-1.5">' + ui.esc(u.name) + '</div>' +
                '<div class="text-[11px] text-muted truncate font-mono mt-0.5">' + ui.esc(payload) + '</div>' +
                '<div class="mt-2.5 flex items-center gap-2">' +
                  '<button class="btn btn-ghost text-[11px] !py-1 !px-2.5" data-print-one="' + ui.esc(u.tag || u.id) + '" data-unit="' + (u.unit || '') + '">' + ui.icon('print', 'w-3 h-3') + 'Print</button>' +
                  '<button class="btn btn-ghost text-[11px] !py-1 !px-2.5" data-copy-payload="' + ui.esc(payload) + '">' + ui.icon('copy', 'w-3 h-3') + 'Copy Tag</button>' +
                '</div>' +
              '</div>' +
            '</div>';
          }).join('') +
        '</div>',
      footer: '<button class="btn btn-ghost" data-cancel>Close</button>',
    });

    m.root.querySelector('[data-cancel]').addEventListener('click', m.close);
    const printAllBtn = m.root.querySelector('[data-print-all]');
    if (printAllBtn) {
      printAllBtn.addEventListener('click', () => {
        m.close();
        printLabels(list);
      });
    }

    m.root.querySelectorAll('[data-copy-payload]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const txt = btn.getAttribute('data-copy-payload');
        if (navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText(txt).then(() => ui.toast('Tag copied: ' + txt, 'success')).catch(() => {});
        } else {
          ui.toast('Tag: ' + txt, 'info');
        }
      });
    });

    m.root.querySelectorAll('[data-print-one]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const t = btn.getAttribute('data-print-one');
        const un = parseInt(btn.getAttribute('data-unit'), 10) || null;
        m.close();
        printLabels([{ id: t, tag: t, name: titleName, qty: 1 }]);
      });
    });
  }

  return { encodeItem, parse, svg, expandUnits, cameraAvailable, scan, printLabels, labelPreview, showItemQRs, generateTrackers, ensureItemTrackers };
})();
