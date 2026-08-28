const fs = require('fs');
let code = fs.readFileSync('js/views/advancing.js', 'utf8');

const targetSave = `        // Lighting & Production Package
        lighting_notes: lightingNotes,
        floor_package: floorPackage,
        floor_tags: floorTags,
        specials: specialsObj,
        special_notes: specialNotes,
        dmx_patch: ev.dmx_patch || ev.dmxPatch || [],
        production_package: {
          lighting_notes: lightingNotes,
          floor_package: floorPackage,
          floor_tags: floorTags,
          specials: specialsObj,
          special_notes: specialNotes,
        },`;

const replacementSave = `        // Lighting & Production Package
        production_package: {
          lighting_notes: lightingNotes,
          floor_package: floorPackage,
          floor_tags: floorTags,
          specials: specialsObj,
          special_notes: specialNotes,
        },`;

if (code.includes(targetSave)) {
  code = code.replace(targetSave, replacementSave);
  fs.writeFileSync('js/views/advancing.js', code);
  console.log("Patched save in advancing.js");
} else {
  console.log("Could not find targetSave in advancing.js");
}
