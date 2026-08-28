const fs = require('fs');
let code = fs.readFileSync('js/views/presets.js', 'utf8');

const regex = /\/\/ Outputs Table View\n\s*'<div class="mt-4">' \+\n\s*'<div class="text-\[11px\] font-bold text-muted uppercase tracking-wider mb-2">Outputs \(Returns \/ Sends\)<\/div>' \+\n\s*'<div class="overflow-x-auto rounded-lg border border-line bg-panel2\/30">' \+[\s\S]*?'<\/table>' \+\n\s*'<\/div>' \+\n\s*'<\/div>' \+\n\s*'<\/div>'/;

const replacement = `            // Outputs Table View
            '<div class="mt-4 border-t border-line/60 pt-4">' +
              '<div class="text-[11px] font-bold text-muted uppercase tracking-wider mb-3">Outputs (Returns / Sends)</div>' +
              
              // Mobile Outputs
              '<div class="md:hidden grid gap-2.5">' +
                (!(box.outputs && box.outputs.length) ? (
                  '<div class="text-center py-4 text-muted italic bg-panel2/30 rounded-lg border border-line p-3">No outputs in this stagebox.</div>'
                ) : (
                  box.outputs.map((out, outIdx) => {
                    return (
                      '<div class="p-3 rounded-lg bg-panel border border-line shadow-2xs grid gap-2 relative">' +
                        '<div class="flex items-center gap-2">' +
                          '<span class="font-mono font-bold text-xs px-2 py-0.5 rounded border border-line bg-panel2">' + (box.letter || '') + (out.socket) + '</span>' +
                          '<input data-out-dest="' + sbIdx + '-' + outIdx + '" class="field !py-1 !px-2 text-xs bg-panel flex-1" value="' + ui.esc(out.destination || '') + '" placeholder="e.g. Wedge 1, IEM L" />' +
                        '</div>' +
                        '<div>' +
                          '<label class="block text-[10px] uppercase font-bold text-muted mb-0.5">Home Run Target</label>' +
                          '<select data-out-hr="' + sbIdx + '-' + outIdx + '" class="bg-panel font-mono text-xs font-bold rounded border ' + (out.homeRunCh ? 'border-accent text-accent' : 'border-line text-muted') + ' py-1 px-1.5 w-full">' +
                            '<option value="">(Unassigned / Drop)</option>' +
                            Array.from({ length: Math.max(1, parseInt(hr.outputChannels, 10) || 16) }, (_, i) => {
                              const num = i + 1;
                              const pad = num < 10 ? '0' + num : '' + num;
                              return '<option value="' + num + '" ' + (parseInt(out.homeRunCh, 10) === num ? 'selected' : '') + '>' + hrPrefix + ' Out ' + pad + '</option>';
                            }).join('') +
                          '</select>' +
                        '</div>' +
                      '</div>'
                    );
                  }).join('')
                )) +
              '</div>' +

              // Desktop Outputs
              '<div class="hidden md:block overflow-x-auto rounded-lg border border-line bg-panel2/30">' +
                '<table class="w-full text-left text-xs border-collapse">' +
                  '<thead>' +
                    '<tr class="border-b border-line bg-panel2/80 text-[10px] font-bold text-muted uppercase tracking-wider">' +
                      '<th class="py-2 px-2.5 w-14 text-center">Out</th>' +
                      '<th class="py-2 px-2.5">Destination / Monitor</th>' +
                      '<th class="py-2 px-2.5 min-w-[140px]">Home Run Target</th>' +
                    '</tr>' +
                  '</thead>' +
                  '<tbody class="divide-y divide-line/40">' +
                    (!(box.outputs && box.outputs.length) ? (
                      '<tr><td colspan="3" class="text-center py-4 text-muted italic">No outputs in this stagebox.</td></tr>'
                    ) : (
                      box.outputs.map((out, outIdx) => {
                        return (
                          '<tr class="hover:bg-panel transition-colors">' +
                            '<td class="py-2 px-2.5 text-center font-mono font-bold text-xs"><span class="px-2 py-0.5 rounded border border-line bg-panel2">' + (box.letter || '') + (out.socket) + '</span></td>' +
                            '<td class="py-2 px-2.5">' +
                              '<input data-out-dest="' + sbIdx + '-' + outIdx + '" class="field !py-1 !px-2 text-xs bg-panel w-full" value="' + ui.esc(out.destination || '') + '" placeholder="e.g. Wedge 1, IEM L" />' +
                            '</td>' +
                            '<td class="py-2 px-2.5">' +
                              '<select data-out-hr="' + sbIdx + '-' + outIdx + '" class="bg-panel font-mono text-[11px] font-bold rounded border ' + (out.homeRunCh ? 'border-accent text-accent' : 'border-line text-muted') + ' py-1 px-1.5 w-full">' +
                                '<option value="">(Unassigned / Drop)</option>' +
                                Array.from({ length: Math.max(1, parseInt(hr.outputChannels, 10) || 16) }, (_, i) => {
                                  const num = i + 1;
                                  const pad = num < 10 ? '0' + num : '' + num;
                                  return '<option value="' + num + '" ' + (parseInt(out.homeRunCh, 10) === num ? 'selected' : '') + '>' + hrPrefix + ' Out ' + pad + '</option>';
                                }).join('') +
                              '</select>' +
                            '</td>' +
                          '</tr>'
                        );
                      }).join('')
                    )) +
                  '</tbody>' +
                '</table>' +
              '</div>' +
            '</div>' +
          '</div>'`;

if (code.match(regex)) {
  code = code.replace(regex, replacement);
  fs.writeFileSync('js/views/presets.js', code);
  console.log("Updated mobile outputs view");
} else {
  console.log("Could not match outputs table regex.");
}
