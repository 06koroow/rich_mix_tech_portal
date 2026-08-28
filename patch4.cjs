const fs = require('fs');
let code = fs.readFileSync('js/views/advancing.js', 'utf8');

const targetEvents = `      // Input row fields wiring
      container.querySelectorAll('[data-act-ch-inst]').forEach((inp) => {`;
const replacementEvents = `      // Act channel auto patch
      container.querySelectorAll('[data-act-autopatch]').forEach((btn) => {
        btn.addEventListener('click', () => {
          const sIdx = +btn.getAttribute('data-act-autopatch');
          const it = scheduleItems[sIdx];
          if (it && it.channelInputs) {
            let pIdx = 0;
            it.channelInputs.forEach(ch => {
              if (!ch.patch && pIdx < patchOptions.length) {
                ch.patch = patchOptions[pIdx++];
              }
            });
            renderScheduleBuilder();
            ui.toast('Auto-allocated to house patch', 'ok');
          }
        });
      });

      // Input row fields wiring
      container.querySelectorAll('[data-act-ch-patch]').forEach((inp) => {
        inp.addEventListener('input', () => {
          const [sIdx, cIdx] = inp.getAttribute('data-act-ch-patch').split('-').map(Number);
          if (scheduleItems[sIdx] && scheduleItems[sIdx].channelInputs[cIdx]) {
            scheduleItems[sIdx].channelInputs[cIdx].patch = inp.value;
          }
        });
      });
      container.querySelectorAll('[data-act-ch-inst]').forEach((inp) => {`;

code = code.replace(targetEvents, replacementEvents);
fs.writeFileSync('js/views/advancing.js', code);
console.log("Patched schedule act event wiring");
