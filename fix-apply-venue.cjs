const fs = require('fs');
let code = fs.readFileSync('js/views/presets.js', 'utf8');

const oldFuncRegex = /    function applyVenueRoomIO\(spaceName, updateDOM = false\) \{[\s\S]*?if \(typeof renderMasterSchedule === 'function'\) renderMasterSchedule\(\);\n        \}\n      \}\n    \}/;

const newFunc = `    function applyVenueRoomIO(spaceName, updateDOM = false) {
      let v = store.find('venues', spaceName);
      if (!v) {
        v = {
          name: spaceName,
          audio: {
            inputChannels: 48,
            outputChannels: 24,
            prefix: 'HR',
            mixingDeskProtocol: 'Dante',
            stageboxes: [
              { letter: 'A', name: 'SL Rack', location: 'Stage Left', sockets: 16 }
            ]
          }
        };
      }
      if (v && v.audio) {
        sheet.homeRun = {
          name: v.name + ' Main I/O',
          type: 'Digital Stage Rack (' + (v.audio.mixingDeskProtocol || 'Dante') + ')',
          location: 'Venue I/O',
          inputChannels: parseInt(v.audio.inputChannels, 10) || 32,
          outputChannels: parseInt(v.audio.outputChannels, 10) || 16,
          prefix: v.audio.prefix || 'HR',
          notes: 'Inherited from ' + v.name + ' setup'
        };
        if (Array.isArray(v.audio.stageboxes) && v.audio.stageboxes.length > 0) {
          sheet.stageboxes = v.audio.stageboxes.map((sb, sbIdx) => {
            const cap = parseInt(sb.analogIn || sb.sockets || 16, 10);
            return {
              id: store.uid ? store.uid('sb') : 'sb-' + Math.random().toString(36).substr(2, 6),
              letter: sb.letter || String.fromCharCode(65 + sbIdx),
              name: sb.name || 'Stagebox',
              location: sb.location || 'Stage',
              capacity: cap,
              channels: Array.from({ length: cap }, (_, i) => ({
                socket: i + 1,
                actId: 'act-house',
                instrument: '',
                mic: '',
                phantom: false,
                repatch: false,
                repatchTo: '',
                homeRunCh: i + 1
              }))
            };
          });
        }
        if (updateDOM && m && m.root) {
          const els = {
            '#ps-hr-name': sheet.homeRun.name,
            '#ps-hr-type': sheet.homeRun.type,
            '#ps-hr-inputs': sheet.homeRun.inputChannels,
            '#ps-hr-outputs': sheet.homeRun.outputChannels,
            '#ps-hr-prefix': sheet.homeRun.prefix,
            '#ps-hr-location': sheet.homeRun.location
          };
          for (const k in els) {
            const el = m.root.querySelector(k);
            if (el) el.value = els[k];
          }
          if (typeof renderStageboxes === 'function') renderStageboxes();
          if (typeof renderSignalFlow === 'function') renderSignalFlow();
          if (typeof renderRepatches === 'function') renderRepatches();
          if (typeof renderMasterSchedule === 'function') renderMasterSchedule();
        }
      }
    }`;

code = code.replace(oldFuncRegex, newFunc);
fs.writeFileSync('js/views/presets.js', code);
console.log("Func updated.");
