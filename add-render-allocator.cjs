const fs = require('fs');
let code = fs.readFileSync('js/views/presets.js', 'utf8');

const injection = `
      // Render Custom Channel Allocator
      const allocatorEl = m.root.querySelector('#ps-custom-channels-allocator');
      if (allocatorEl) {
        let actsWithChannels = (sheet.acts || []).filter(a => a.channelInputs && a.channelInputs.length > 0 && a.id !== 'act-house');
        if (actsWithChannels.length > 0) {
          allocatorEl.innerHTML = '<div class="p-3 mb-4 rounded-xl border border-accent/40 bg-accent/5 shadow-2xs">' +
            '<div class="flex items-center gap-2 mb-2">' +
              '<span class="text-accent">' + ui.icon('download', 'w-4 h-4') + '</span>' +
              '<span class="font-bold text-accent uppercase tracking-wider text-[11px]">Event Channel Lists Available to Allocate</span>' +
            '</div>' +
            '<div class="grid sm:grid-cols-2 md:grid-cols-3 gap-3">' +
              actsWithChannels.map(act => {
                const count = act.channelInputs.length;
                return '<div class="p-2.5 rounded-lg border border-accent/20 bg-panel flex items-center justify-between">' +
                  '<div>' +
                    '<div class="font-bold text-xs text-ink">' + ui.esc(act.name) + '</div>' +
                    '<div class="text-[10px] text-muted">' + count + ' Custom Channel' + (count !== 1 ? 's' : '') + '</div>' +
                  '</div>' +
                  '<button type="button" data-allocate-act="' + act.id + '" class="btn btn-ghost border border-line !py-1 !px-2 text-[10px] font-bold text-accent hover:bg-accent/10">Allocate as Stagebox &rarr;</button>' +
                '</div>';
              }).join('') +
            '</div>' +
          '</div>';

          allocatorEl.querySelectorAll('[data-allocate-act]').forEach(btn => {
            btn.addEventListener('click', () => {
              const actId = btn.getAttribute('data-allocate-act');
              const act = sheet.acts.find(a => a.id === actId);
              if (!act || !act.channelInputs) return;

              const letter = nextLetter();
              const inCap = Math.max(4, Math.ceil(act.channelInputs.length / 4) * 4); // round up to nearest 4
              const outCap = 4; // default out capacity

              const newBox = {
                id: store.uid('sb'),
                letter: letter,
                name: act.name + ' Channels',
                location: 'Stage Drop',
                capacity: inCap,
                outCapacity: outCap,
                channels: act.channelInputs.map((c, i) => ({
                  socket: i + 1,
                  actId: act.id,
                  instrument: c.instrument || '',
                  mic: c.mic || '',
                  phantom: !!c.phantom,
                  repatch: false,
                  repatchTo: '',
                  homeRunCh: null
                })),
                outputs: Array.from({ length: outCap }, (_, i) => ({
                  socket: i + 1,
                  destination: ''
                }))
              };

              // pad with empty sockets if needed
              for (let i = act.channelInputs.length; i < inCap; i++) {
                newBox.channels.push({
                  socket: i + 1,
                  actId: act.id,
                  instrument: '',
                  mic: '',
                  phantom: false,
                  repatch: false,
                  repatchTo: '',
                  homeRunCh: null
                });
              }

              sheet.stageboxes.push(newBox);
              
              // Clear the channels from the act so they don't show up in the allocator anymore
              // Or keep them but mark them as allocated? Let's just remove them from the act to show they've been consumed
              act.channelInputs = [];
              
              ui.toast('Allocated ' + act.name + ' channels to Stagebox ' + letter, 'ok');
              renderStageboxes();
            });
          });
        } else {
          allocatorEl.innerHTML = '';
        }
      }
`;

code = code.replace(
  /    function renderStageboxes\(\) \{/,
  "    function renderStageboxes() {" + injection
);

fs.writeFileSync('js/views/presets.js', code);
console.log("Injected render allocator logic");
