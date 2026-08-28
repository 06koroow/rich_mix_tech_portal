const fs = require('fs');
let code = fs.readFileSync('js/views/presets.js', 'utf8');

const targetDmxSync = `          // If linked to an event, also update advancing event dmx_fixtures
          if (dmxPatch.eventId && store) {
            const ev = store.find('advancing', dmxPatch.eventId);
            if (ev) {
              const updatedEv = Object.assign({}, ev, {
                dmx_fixtures: dmxPatch.fixtures || [],
                updatedAt: Date.now()
              });
              store.upsert('advancing', updatedEv);
            }
          }`;

const replacementDmxSync = `          // The dmx_patches collection handles persistence independently
          // No need to duplicate this data into the advancing table.`;

if (code.includes(targetDmxSync)) {
  code = code.replace(targetDmxSync, replacementDmxSync);
  fs.writeFileSync('js/views/presets.js', code);
  console.log("Patched dmx sync in presets.js");
} else {
  console.log("Could not find dmx sync block in presets.js");
}
