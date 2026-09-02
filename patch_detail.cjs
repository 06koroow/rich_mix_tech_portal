const fs = require('fs');
let code = fs.readFileSync('js/views/inventory.js', 'utf8');

const detailTarget = `    const unitsListBlock = matchingItems.length > 1
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
      : '';`;

const detailReplacement = `    const unitsListBlock = matchingItems.length > 0
      ? '<div class="mb-5">' +
          '<p class="eyebrow mb-3 flex items-center justify-between"><span>Tracked Units (' + matchingItems.length + ')</span></p>' +
          '<div class="grid grid-cols-1 sm:grid-cols-2 gap-3 max-h-[40vh] overflow-y-auto pr-1">' +
            matchingItems.map((it) => {
              const qrPayload = RMTP.qr && RMTP.qr.encodeItem ? RMTP.qr.encodeItem(it.tag || it.id) : (it.tag || it.id);
              const qrSvg = RMTP.qr && RMTP.qr.svg ? RMTP.qr.svg(qrPayload, { margin: 1 }) : '';
              return '<div class="panel bg-panel p-3 flex gap-3 items-center">' +
                '<div class="w-16 h-16 shrink-0 bg-white p-1 rounded border border-line flex items-center justify-center">' + qrSvg + '</div>' +
                '<div class="min-w-0 flex-1">' +
                  '<div class="flex items-center justify-between gap-2">' +
                    '<span class="tabular text-xs text-accent font-mono inline-flex items-center px-1.5 py-0.5 rounded bg-accent/10 border border-accent/20 font-semibold">' + ui.esc(it.tag || 'No tag') + '</span>' +
                    (canManage ? '<button data-sub-edit="' + it.id + '" class="btn btn-ghost !p-1 text-[11px]" title="Edit this unit">' + ui.icon('pen', 'w-3.5 h-3.5') + '</button>' : '') +
                  '</div>' +
                  '<div class="text-[11px] font-medium text-ink truncate mt-1">' + ui.esc(it.name) + '</div>' +
                  '<div class="flex items-center gap-1.5 mt-1.5">' +
                    ui.pill(it.status === 'out' ? 'Out' : 'In', it.status === 'out' ? 'var(--info)' : 'var(--accent)') +
                    ui.pill(it.condition, condColour[it.condition] || 'var(--muted)') +
                  '</div>' +
                '</div>' +
              '</div>';
            }).join('') +
          '</div>' +
        '</div>'
      : '';`;

if (code.includes(detailTarget)) {
  code = code.replace(detailTarget, detailReplacement);
  fs.writeFileSync('js/views/inventory.js', code);
  console.log("Patched openDetail");
} else {
  console.log("Could not find detailTarget in openDetail");
}
