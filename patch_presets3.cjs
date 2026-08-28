const fs = require('fs');
let code = fs.readFileSync('js/views/presets.js', 'utf8');

const targetPullBtn = `      const pullBtn = bannerEl.querySelector('#btn-pull-artists-from-event');
      if (pullBtn) {
        pullBtn.addEventListener('click', () => {
          syncArtistsFromEvent(sheet, ev, false);
          renderActs();
          renderStageboxes();
          renderEventSyncBanner();
          ui.toast('Synchronized ' + scheduleActs.length + ' artist(s) from ' + ev.name, 'ok');
        });`;

const replacementPullBtn = `      const pullBtn = bannerEl.querySelector('#btn-pull-artists-from-event');
      if (pullBtn) {
        pullBtn.addEventListener('click', () => {
          syncArtistsFromEvent(sheet, ev, false);
          renderActs();
          renderStageboxes();
          renderEventSyncBanner();
          ui.toast('Synchronized artists and master channels from ' + ev.name, 'ok');
        });`;

if (code.includes(targetPullBtn)) {
  code = code.replace(targetPullBtn, replacementPullBtn);
  fs.writeFileSync('js/views/presets.js', code);
  console.log("Patched pull button in presets.js");
} else {
  console.log("Could not find pullBtn in presets.js");
}
