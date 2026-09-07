const fs = require('fs');
let content = fs.readFileSync('js/views/presets.js', 'utf8');

const replacement = `      addCustomBtn.addEventListener('click', () => {
        const pm = ui.modal({
          title: 'Custom Stagebox',
          body: '<div class="grid gap-3">' +
                '<div><label class="block text-xs font-bold uppercase text-muted mb-1">Inputs</label><input type="number" id="cus-ins" class="field" value="12" min="0" max="128" /></div>' +
                '<div><label class="block text-xs font-bold uppercase text-muted mb-1">Outputs</label><input type="number" id="cus-outs" class="field" value="4" min="0" max="128" /></div>' +
                '</div>',
          footer: '<button type="button" class="btn btn-primary mr-auto" data-cus-create>Create Box</button>' +
                  '<button type="button" class="btn btn-ghost" data-cus-cancel>Cancel</button>'
        });
        pm.root.querySelector('[data-cus-cancel]').addEventListener('click', pm.close);
        pm.root.querySelector('[data-cus-create]').addEventListener('click', () => {
          const ins = parseInt(pm.root.querySelector('#cus-ins').value, 10) || 0;
          const outs = parseInt(pm.root.querySelector('#cus-outs').value, 10) || 0;
          pm.close();
          const letter = nextLetter();
          sheet.stageboxes.push({
            id: store.uid('sb'),
            letter: letter,
            name: 'Custom Box ' + letter,
            location: 'Centre Stage',
            capacity: ins,
            outCapacity: outs,
            channels: Array.from({ length: ins }, (_, i) => ({
              socket: i + 1,
              actId: sheet.acts[0] ? sheet.acts[0].id : 'act-house',
              instrument: '',
              mic: '',
              phantom: false,
              repatch: false,
              repatchTo: '',
              homeRunCh: null
            })),
            outputs: Array.from({ length: outs }, (_, i) => ({
              socket: i + 1,
              destination: ''
            }))
          });
          renderStageboxes();
        });
      });`;

const regex = /addCustomBtn\.addEventListener\('click', \(\) => \{[\s\S]*?renderStageboxes\(\);\n\s*\}\);/;
content = content.replace(regex, replacement);

fs.writeFileSync('js/views/presets.js', content);
