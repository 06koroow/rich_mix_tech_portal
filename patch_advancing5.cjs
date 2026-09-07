const fs = require('fs');
let code = fs.readFileSync('js/views/advancing.js', 'utf8');

const regex = /(liveTimingsSection \+\s+liveScheduleSection \+\s+cinemaChecksHtml \+\s+lightingProductionPrintSection \+\s+channelListPrintSection \+\s+linkedMaintSection \+\s+)('<div class="adv-print-section">' \+\s+'<div class="adv-print-section-title">Crew & Contacts<\/div>' \+\s+'<div class="adv-print-grid">' \+\s+'<div class="adv-print-field" style="grid-column: span 2;">' \+\s+'<div class="adv-print-label">Responsible for Advancing<\/div>' \+\s+'<div class="adv-print-val" style="color:#0284c7;font-weight:700;">' \+ ui\.esc\(leadLabel\) \+ '<\/div>' \+\s+'<\/div>' \+\s+'<div class="adv-print-field" style="grid-column: span 2;">' \+\s+'<div class="adv-print-label">Assigned Technicians<\/div>' \+\s+'<div class="adv-print-val">' \+ \(techs\.length \? ui\.esc\(techs\.join\(', '\)\) : 'None assigned'\) \+ '<\/div>' \+\s+'<\/div>' \+\s+'<div class="adv-print-field">' \+\s+'<div class="adv-print-label">Guest Engineer<\/div>' \+\s+'<div class="adv-print-val">' \+ \(ev\.guestEngineer \? 'Yes \\(Visiting Tech\\)' : 'No'\) \+ '<\/div>' \+\s+'<\/div>' \+\s+'<div class="adv-print-field" style="grid-column: span 3;">' \+\s+'<div class="adv-print-label">Client \/ Artist Contact<\/div>' \+\s+'<div class="adv-print-val">' \+ ui\.esc\(ev\.clientContact \|\| 'None listed'\) \+ '<\/div>' \+\s+'<\/div>' \+\s+'<\/div>' \+\s+'<\/div>' \+\s+)/m;

const match = code.match(regex);
if (match) {
  code = code.replace(regex, match[2] + match[1]);
  fs.writeFileSync('js/views/advancing.js', code);
  console.log('Patched print generation');
} else {
  console.log('Regex did not match');
}
