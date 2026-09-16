const fs = require('fs');
let code = fs.readFileSync('js/views/advancing.js', 'utf8');

const tTechRow = `        rowHtml += '<select data-t-role="' + i + '" class="field w-32 shrink-0">' + rOpts + '</select>' +
            '<button type="button" data-t-remove="' + i + '" class="btn btn-danger !p-2 shrink-0" title="Remove">' + ui.icon('trash', 'w-4 h-4') + '</button>' +
          '</div>';

        const placeholderStart = (m.root.querySelector('#e-start') ? m.root.querySelector('#e-start').value : ev.startTime) || '';
        const placeholderEnd = (m.root.querySelector('#e-finish') ? m.root.querySelector('#e-finish').value : ev.finishTime) || '';
        
        rowHtml += '<div class="flex items-center gap-2 text-xs">' +
            '<span class="text-muted w-12">Times:</span>' +
            '<input type="time" data-t-start="' + i + '" class="field !py-1 !px-2 flex-1" value="' + (t.startTime || '') + '" placeholder="' + placeholderStart + '">' +
            '<span class="text-muted">to</span>' +
            '<input type="time" data-t-end="' + i + '" class="field !py-1 !px-2 flex-1" value="' + (t.finishTime || '') + '" placeholder="' + placeholderEnd + '">' +
          '</div>' +
        '</div>';`;

const rTechRow = `        if (!t.isNoTech) {
          rowHtml += '<select data-t-role="' + i + '" class="field w-32 shrink-0">' + rOpts + '</select>';
        }
        rowHtml += '<button type="button" data-t-remove="' + i + '" class="btn btn-danger !p-2 shrink-0" title="Remove">' + ui.icon('trash', 'w-4 h-4') + '</button>' +
          '</div>';

        if (!t.isNoTech) {
          const placeholderStart = (m.root.querySelector('#e-start') ? m.root.querySelector('#e-start').value : ev.startTime) || '';
          const placeholderEnd = (m.root.querySelector('#e-finish') ? m.root.querySelector('#e-finish').value : ev.finishTime) || '';
          
          rowHtml += '<div class="flex items-center gap-2 text-xs">' +
              '<span class="text-muted w-12">Times:</span>' +
              '<input type="time" data-t-start="' + i + '" class="field !py-1 !px-2 flex-1" value="' + (t.startTime || '') + '" placeholder="' + placeholderStart + '">' +
              '<span class="text-muted">to</span>' +
              '<input type="time" data-t-end="' + i + '" class="field !py-1 !px-2 flex-1" value="' + (t.finishTime || '') + '" placeholder="' + placeholderEnd + '">' +
            '</div>';
        }
        rowHtml += '</div>';`;

code = code.replace(tTechRow, rTechRow);
fs.writeFileSync('js/views/advancing.js', code);
