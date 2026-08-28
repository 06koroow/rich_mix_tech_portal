const fs = require('fs');
let code = fs.readFileSync('js/views/advancing.js', 'utf8');

const target = `    ) : '';

        liveTimingsSection +`;

const replacement = `    ) : '';

    const reportsHtml = reports.length ? (
      '<div class="adv-print-section">' +
        '<div class="adv-print-section-title">Shift Reports & Handover Notes</div>' +
        '<div style="display:flex;flex-direction:column;gap:6px;">' +
          reports.map((r) => (
            '<div style="background:#f8fafc;padding:8px;border:1px solid #cbd5e1;border-radius:4px;font-size:11px;">' +
              '<div style="font-weight:700;margin-bottom:4px;color:#0f172a;">' + ui.esc(r.user_name || r.userName || 'Tech') + ' (' + ui.esc(r.shift_role || r.shiftRole || 'Report') + ')</div>' +
              '<div style="white-space:pre-wrap;color:#334155;">' + ui.esc(r.notes || '') + '</div>' +
            '</div>'
          )).join('') +
        '</div>' +
      '</div>'
    ) : '';

    root.innerHTML =
      '<div class="adv-print-sheet">' +
        '<div class="adv-print-header">' +
          '<div>' +
            '<div class="adv-print-brand">Rich Mix</div>' +
            '<div class="adv-print-sub">Tech Portal / ' + ui.esc(ev.category || 'Event Advance') + '</div>' +
          '</div>' +
          '<div><span class="adv-print-badge">' + ui.esc(ev.status || 'Draft') + '</span></div>' +
        '</div>' +
        '<div class="adv-print-title">' + ui.esc(ev.name) + '</div>' +
        '<div style="font-size:13px;font-weight:600;color:#334155;margin-bottom:16px;">' +
          ui.esc(ev.date ? ui.formatDate(ev.date) : 'TBC') + (times ? ' \u2022 ' + ui.esc(times) : '') + ' \u2014 ' + ui.esc(ev.space || 'No Space') +
        '</div>' +
        liveTimingsSection +`;

if(code.indexOf(target) !== -1) {
  code = code.replace(target, replacement);
  fs.writeFileSync('js/views/advancing.js', code);
  console.log("Patched printAdvance in advancing.js");
} else {
  console.log("Could not find target block in advancing.js");
}
