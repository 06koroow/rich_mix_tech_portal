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

  function encodeItem(tag) { return INV_PREFIX + String(tag || '').trim(); }

  /* Returns { kind:'inventory', value:<tag> } or null for foreign QRs.
     Also tolerates a bare tag typed manually (no prefix). */
  function parse(text) {
    const t = String(text || '').trim();
    if (!t) return null;
    if (t.toUpperCase().indexOf(INV_PREFIX) === 0) {
      return { kind: 'inventory', value: t.slice(INV_PREFIX.length).trim() };
    }
    // Bare input from manual entry — treat as an inventory tag.
    return { kind: 'inventory', value: t };
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
  function labelCard(item) {
    return '<div class="qr-label">' +
      '<div class="qr-label__code">' + svg(encodeItem(item.tag || item.id), { margin: 1 }) + '</div>' +
      '<div class="qr-label__meta">' +
        '<div class="qr-label__name">' + RMTP.ui.esc(item.name || '') + '</div>' +
        '<div class="qr-label__tag">' + RMTP.ui.esc(item.tag || '') + '</div>' +
      '</div>' +
    '</div>';
  }

  function printLabels(items) {
    const list = (items || []).filter((i) => i && (i.tag || i.id));
    if (!list.length) { RMTP.ui.toast('Nothing to print', 'danger'); return; }
    const root = document.getElementById('print-root');
    if (!root) { RMTP.ui.toast('Print area missing', 'danger'); return; }
    root.innerHTML =
      '<div class="qr-sheet-head">' +
        '<strong>' + RMTP.meta.name + ' — Kit labels</strong>' +
        '<span>' + list.length + ' items · ' + RMTP.ui.formatDate(new Date().toISOString()) + '</span>' +
      '</div>' +
      '<div class="qr-sheet">' + list.map(labelCard).join('') + '</div>';
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

  /* Preview modal before printing (shows a few labels + Print all). */
  function labelPreview(items) {
    const ui = RMTP.ui;
    const list = (items || []).filter((i) => i && (i.tag || i.id));
    if (!list.length) { ui.toast('No items to label', 'danger'); return; }
    const sample = list.slice(0, 6);
    const m = ui.modal({
      title: 'Print QR labels',
      size: 'md:max-w-lg',
      body:
        '<p class="text-sm text-muted mb-4">One label per item, encoding <span class="tabular text-ink">RMTP-INV:&lt;tag&gt;</span>. ' +
          'Preview' + (list.length > sample.length ? ' (first ' + sample.length + ' of ' + list.length + ')' : '') + ':</p>' +
        '<div class="grid grid-cols-3 gap-3">' +
          sample.map((i) =>
            '<div class="panel bg-white p-2 text-center">' +
              '<div class="w-full aspect-square">' + svg(encodeItem(i.tag || i.id), { margin: 1 }) + '</div>' +
              '<div class="text-[11px] text-black font-semibold truncate mt-1">' + ui.esc(i.name) + '</div>' +
              '<div class="text-[10px] text-black/60 tabular">' + ui.esc(i.tag) + '</div>' +
            '</div>'
          ).join('') +
        '</div>',
      footer:
        '<button class="btn btn-ghost" data-cancel>Cancel</button>' +
        '<button class="btn btn-primary" data-print data-primary>' + ui.icon('print', 'w-4 h-4') + 'Print ' + list.length + ' labels</button>',
    });
    m.root.querySelector('[data-cancel]').addEventListener('click', m.close);
    m.root.querySelector('[data-print]').addEventListener('click', () => { m.close(); printLabels(list); });
  }

  return { encodeItem, parse, svg, cameraAvailable, scan, printLabels, labelPreview };
})();
