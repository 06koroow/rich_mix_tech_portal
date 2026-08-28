const fs = require('fs');
let code = fs.readFileSync('js/views/presets.js', 'utf8');

const targetIf = `            const scheduleActs = schedule.filter((it) => it && (it.type === 'act' || (it.customName && it.customName.trim())));
            if (scheduleActs.length > 0) {
              syncArtistsFromEvent(sheet, linkedEv, true);
              renderActs();
              renderStageboxes();
              ui.toast('Pulled ' + scheduleActs.length + ' artist(s) from ' + linkedEv.name + ' schedule', 'ok');
            }`;

const replacementIf = `            const scheduleActs = schedule.filter((it) => it && (it.type === 'act' || (it.customName && it.customName.trim())));
            const hasMasterChannels = linkedEv.tech_requirements && linkedEv.tech_requirements.channel_list && (linkedEv.tech_requirements.channel_list.inputs || linkedEv.tech_requirements.channel_list.outputs);
            if (scheduleActs.length > 0 || hasMasterChannels) {
              syncArtistsFromEvent(sheet, linkedEv, true);
              renderActs();
              renderStageboxes();
              if (scheduleActs.length > 0) {
                ui.toast('Pulled ' + scheduleActs.length + ' artist(s) and channels from ' + linkedEv.name + ' schedule', 'ok');
              } else {
                ui.toast('Pulled master channel lists from ' + linkedEv.name, 'ok');
              }
            }`;

if (code.includes(targetIf)) {
  code = code.replace(targetIf, replacementIf);
  fs.writeFileSync('js/views/presets.js', code);
  console.log("Patched if scheduleActs in presets.js");
} else {
  console.log("Could not find targetIf in presets.js");
}
