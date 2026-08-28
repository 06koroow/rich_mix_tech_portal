const fs = require('fs');
let code = fs.readFileSync('js/views/presets.js', 'utf8');

// 1. Initial default sheet
code = code.replace(
  /capacity: 8,\n\s*channels: Array\.from\(\{\s*length: 8\s*\}, \(_, i\) => \(\{\n\s*socket: i \+ 1,\n\s*actId: 'act-house',\n\s*instrument: '',\n\s*mic: '',\n\s*phantom: false,\n\s*repatch: false,\n\s*repatchTo: '',\n\s*homeRunCh: i \+ 1\n\s*\}\)\)/,
  `capacity: 8,
          outCapacity: 4,
          channels: Array.from({ length: 8 }, (_, i) => ({
            socket: i + 1,
            actId: 'act-house',
            instrument: '',
            mic: '',
            phantom: false,
            repatch: false,
            repatchTo: '',
            homeRunCh: i + 1
          })),
          outputs: Array.from({ length: 4 }, (_, i) => ({
            socket: i + 1,
            destination: ''
          }))`
);

// 2. applyVenueRoomIO
code = code.replace(
  /capacity: cap,\n\s*channels: Array\.from\(\{ length: cap \}, \(_, i\) => \(\{\n\s*socket: i \+ 1,\n\s*actId: 'act-house',\n\s*instrument: '',\n\s*mic: '',\n\s*phantom: false,\n\s*repatch: false,\n\s*repatchTo: '',\n\s*homeRunCh: i \+ 1\n\s*\}\)\)/g,
  `capacity: cap,
              outCapacity: parseInt(sb.analogOut || 0, 10),
              channels: Array.from({ length: cap }, (_, i) => ({
                socket: i + 1,
                actId: 'act-house',
                instrument: '',
                mic: '',
                phantom: false,
                repatch: false,
                repatchTo: '',
                homeRunCh: i + 1
              })),
              outputs: Array.from({ length: parseInt(sb.analogOut || 0, 10) }, (_, i) => ({
                socket: i + 1,
                destination: ''
              }))`
);

// 3. Quick Add Preset
code = code.replace(
  /capacity: count,\n\s*channels: Array\.from\(\{ length: count \}, \(_, i\) => \(\{\n\s*socket: i \+ 1,\n\s*actId: sheet\.acts\[0\] \? sheet\.acts\[0\]\.id : 'act-house',\n\s*instrument: '',\n\s*mic: '',\n\s*phantom: false,\n\s*repatch: false,\n\s*repatchTo: '',\n\s*homeRunCh: null\n\s*\}\)\)/g,
  `capacity: count,
          outCapacity: count === 16 ? 8 : count === 8 ? 4 : 4,
          channels: Array.from({ length: count }, (_, i) => ({
            socket: i + 1,
            actId: sheet.acts[0] ? sheet.acts[0].id : 'act-house',
            instrument: '',
            mic: '',
            phantom: false,
            repatch: false,
            repatchTo: '',
            homeRunCh: null
          })),
          outputs: Array.from({ length: count === 16 ? 8 : count === 8 ? 4 : 4 }, (_, i) => ({
            socket: i + 1,
            destination: ''
          }))`
);

// 4. Custom Box
code = code.replace(
  /capacity: 12,\n\s*channels: Array\.from\(\{ length: 12 \}, \(_, i\) => \(\{\n\s*socket: i \+ 1,\n\s*actId: sheet\.acts\[0\] \? sheet\.acts\[0\]\.id : 'act-house',\n\s*instrument: '',\n\s*mic: '',\n\s*phantom: false,\n\s*repatch: false,\n\s*repatchTo: '',\n\s*homeRunCh: null\n\s*\}\)\)/g,
  `capacity: 12,
          outCapacity: 4,
          channels: Array.from({ length: 12 }, (_, i) => ({
            socket: i + 1,
            actId: sheet.acts[0] ? sheet.acts[0].id : 'act-house',
            instrument: '',
            mic: '',
            phantom: false,
            repatch: false,
            repatchTo: '',
            homeRunCh: null
          })),
          outputs: Array.from({ length: 4 }, (_, i) => ({
            socket: i + 1,
            destination: ''
          }))`
);

fs.writeFileSync('js/views/presets.js', code);
console.log("Updated object structures.");
