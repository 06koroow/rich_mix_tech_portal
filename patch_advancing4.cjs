const fs = require('fs');
let code = fs.readFileSync('js/views/advancing.js', 'utf8');

const originalPrintCode = `        liveTimingsSection +
        liveScheduleSection +
        cinemaChecksHtml +
        lightingProductionPrintSection +
        channelListPrintSection +
        linkedMaintSection +
        '<div class="adv-print-section">' +
          '<div class="adv-print-section-title">Crew & Contacts</div>' +
          '<div class="adv-print-grid">' +
            '<div class="adv-print-field" style="grid-column: span 2;">' +
              '<div class="adv-print-label">Responsible for Advancing</div>' +
              '<div class="adv-print-val" style="color:#0284c7;font-weight:700;">' + ui.esc(leadLabel) + '</div>' +
            '</div>' +
            '<div class="adv-print-field" style="grid-column: span 2;">' +
              '<div class="adv-print-label">Assigned Technicians</div>' +
              '<div class="adv-print-val">' + (techs.length ? ui.esc(techs.join(', ')) : 'None assigned') + '</div>' +
            '</div>' +
            '<div class="adv-print-field">' +
              '<div class="adv-print-label">Guest Engineer</div>' +
              '<div class="adv-print-val">' + (ev.guestEngineer ? 'Yes (Visiting Tech)' : 'No') + '</div>' +
            '</div>' +
            '<div class="adv-print-field" style="grid-column: span 3;">' +
              '<div class="adv-print-label">Client / Artist Contact</div>' +
              '<div class="adv-print-val">' + ui.esc(ev.clientContact || 'None listed') + '</div>' +
            '</div>' +
          '</div>' +
        '</div>' +`;

const newPrintCode = `        '<div class="adv-print-section">' +
          '<div class="adv-print-section-title">Crew & Contacts</div>' +
          '<div class="adv-print-grid">' +
            '<div class="adv-print-field" style="grid-column: span 2;">' +
              '<div class="adv-print-label">Responsible for Advancing</div>' +
              '<div class="adv-print-val" style="color:#0284c7;font-weight:700;">' + ui.esc(leadLabel) + '</div>' +
            '</div>' +
            '<div class="adv-print-field" style="grid-column: span 2;">' +
              '<div class="adv-print-label">Assigned Technicians</div>' +
              '<div class="adv-print-val">' + (techs.length ? ui.esc(techs.join(', ')) : 'None assigned') + '</div>' +
            '</div>' +
            '<div class="adv-print-field">' +
              '<div class="adv-print-label">Guest Engineer</div>' +
              '<div class="adv-print-val">' + (ev.guestEngineer ? 'Yes (Visiting Tech)' : 'No') + '</div>' +
            '</div>' +
            '<div class="adv-print-field" style="grid-column: span 3;">' +
              '<div class="adv-print-label">Client / Artist Contact</div>' +
              '<div class="adv-print-val">' + ui.esc(ev.clientContact || 'None listed') + '</div>' +
            '</div>' +
          '</div>' +
        '</div>' +
        liveTimingsSection +
        liveScheduleSection +
        cinemaChecksHtml +
        lightingProductionPrintSection +
        channelListPrintSection +
        linkedMaintSection +`;

const idx = code.indexOf(originalPrintCode);
if (idx > -1) {
  code = code.substring(0, idx) + newPrintCode + code.substring(idx + originalPrintCode.length);
  fs.writeFileSync('js/views/advancing.js', code);
  console.log('Patched print generation');
} else {
  console.log('Did not find original code block to replace');
}
