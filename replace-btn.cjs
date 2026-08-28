const fs = require('fs');
let code = fs.readFileSync('js/views/presets.js', 'utf8');

const targetStr = `                    '<button type="button" id="btn-save-room-io" class="btn btn-ghost !py-1 !px-2.5 text-xs text-accent font-semibold flex items-center gap-1.5 border border-accent/30 hover:bg-accent/10" title="Save current Home Run & Stageboxes as a Room Preset">' +
                      ui.icon('save', 'w-3.5 h-3.5') + '<span>Save Room I/O Preset</span>' +
                    '</button>'`;

const newStr = `                    '<button type="button" id="btn-save-room-io" class="btn btn-ghost !py-1 !px-2.5 text-xs text-accent font-semibold flex items-center gap-1.5 border border-accent/30 hover:bg-accent/10" title="Pull Home Run & Stageboxes from Venue Settings">' +
                      ui.icon('download', 'w-3.5 h-3.5') + '<span>Pull Venue I/O</span>' +
                    '</button>'`;

if (code.includes(targetStr)) {
  code = code.replace(targetStr, newStr);
  fs.writeFileSync('js/views/presets.js', code);
  console.log("Success");
} else {
  console.log("Target string not found.");
}
