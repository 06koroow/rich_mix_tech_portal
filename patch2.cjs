const fs = require('fs');
let code = fs.readFileSync('js/views/advancing.js', 'utf8');

const targetOverviewTh = `'<th class="p-2">Ch</th><th class="p-2">Instrument</th><th class="p-2">Mic / DI</th><th class="p-2">Stand</th><th class="p-2">Position</th><th class="p-2">+48V</th>' +`;
const replacementOverviewTh = `'<th class="p-2">Ch</th><th class="p-2">Patch</th><th class="p-2">Instrument</th><th class="p-2">Mic / DI</th><th class="p-2">Stand</th><th class="p-2">Position</th><th class="p-2">+48V</th>' +`;
code = code.replace(targetOverviewTh, replacementOverviewTh);

const targetOverviewTd = `'<td class="p-2 font-mono font-semibold text-accent">Ch ' + (ch.channel || (i + 1)) + '</td>' +
                      '<td class="p-2 font-medium text-ink">' + ui.esc(ch.instrument || '—') + '</td>' +`;
const replacementOverviewTd = `'<td class="p-2 font-mono font-semibold text-accent">Ch ' + (ch.channel || (i + 1)) + '</td>' +
                      '<td class="p-2 font-mono text-muted text-[10px]">' + ui.esc(ch.patch || '—') + '</td>' +
                      '<td class="p-2 font-medium text-ink">' + ui.esc(ch.instrument || '—') + '</td>' +`;
code = code.replace(targetOverviewTd, replacementOverviewTd);

const targetPrintTh = `'<thead><tr style="border-bottom:1px solid #cbd5e1;text-align:left;color:#475569;"><th style="padding:3px 6px;">Ch</th><th style="padding:3px 6px;">Instrument</th><th style="padding:3px 6px;">Mic / DI</th><th style="padding:3px 6px;">Stand</th><th style="padding:3px 6px;">Pos</th><th style="padding:3px 6px;">+48V</th></tr></thead>' +`;
const replacementPrintTh = `'<thead><tr style="border-bottom:1px solid #cbd5e1;text-align:left;color:#475569;"><th style="padding:3px 6px;">Ch</th><th style="padding:3px 6px;">Patch</th><th style="padding:3px 6px;">Instrument</th><th style="padding:3px 6px;">Mic / DI</th><th style="padding:3px 6px;">Stand</th><th style="padding:3px 6px;">Pos</th><th style="padding:3px 6px;">+48V</th></tr></thead>' +`;
code = code.replace(targetPrintTh, replacementPrintTh);

const targetPrintTd = `'<td style="padding:3px 6px;font-weight:600;font-family:monospace;">Ch ' + (ch.channel || (i + 1)) + '</td>' +
                    '<td style="padding:3px 6px;font-weight:500;">' + ui.esc(ch.instrument || '—') + '</td>' +`;
const replacementPrintTd = `'<td style="padding:3px 6px;font-weight:600;font-family:monospace;">Ch ' + (ch.channel || (i + 1)) + '</td>' +
                    '<td style="padding:3px 6px;font-family:monospace;color:#64748b;font-size:10px;">' + ui.esc(ch.patch || '—') + '</td>' +
                    '<td style="padding:3px 6px;font-weight:500;">' + ui.esc(ch.instrument || '—') + '</td>' +`;
code = code.replace(targetPrintTd, replacementPrintTd);

fs.writeFileSync('js/views/advancing.js', code);
console.log("Patched views");
