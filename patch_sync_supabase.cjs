const fs = require('fs');
let code = fs.readFileSync('js/sync-supabase.js', 'utf8');

const target1 = `        r.dmx_fixtures = Array.isArray(r.dmx_fixtures) ? r.dmx_fixtures : (Array.isArray(r.dmxFixtures) ? r.dmxFixtures : (Array.isArray(prev.dmx_fixtures) ? prev.dmx_fixtures : []));
        r.lighting_notes = r.lighting_notes || r.lightingNotes || prev.lighting_notes || prev.lightingNotes || '';
        r.floor_package = r.floor_package || r.floorPackage || prev.floor_package || prev.floorPackage || '';
        r.floor_tags = Array.isArray(r.floor_tags) ? r.floor_tags : (Array.isArray(r.floorTags) ? r.floorTags : (Array.isArray(prev.floor_tags) ? prev.floor_tags : []));
        r.specials = r.specials || prev.specials || {};
        r.special_notes = r.special_notes || r.specialNotes || prev.special_notes || prev.specialNotes || '';
        r.production_package = r.production_package || prev.production_package || {
          lighting_notes: r.lighting_notes,
          floor_package: r.floor_package,
          floor_tags: r.floor_tags,
          specials: r.specials,
          special_notes: r.special_notes,
        };`;

const replacement1 = `        r.production_package = r.production_package || prev.production_package || {};`;

if (code.includes(target1)) {
  code = code.replace(target1, replacement1);
  console.log("Patched target1");
}

const target2 = `        dmx_fixtures: Array.isArray(r.dmx_fixtures) ? r.dmx_fixtures : (Array.isArray(r.dmxFixtures) ? r.dmxFixtures : []),
        lighting_notes: r.lighting_notes || r.lightingNotes || '',
        floor_package: r.floor_package || r.floorPackage || '',
        floor_tags: Array.isArray(r.floor_tags) ? r.floor_tags : (Array.isArray(r.floorTags) ? r.floorTags : []),
        specials: r.specials || {},
        special_notes: r.special_notes || r.specialNotes || '',
        production_package: r.production_package || {
          lighting_notes: r.lighting_notes || r.lightingNotes || '',
          floor_package: r.floor_package || r.floorPackage || '',
          floor_tags: Array.isArray(r.floor_tags) ? r.floor_tags : (Array.isArray(r.floorTags) ? r.floorTags : []),
          specials: r.specials || {},
          special_notes: r.special_notes || r.specialNotes || '',
        },`;

const replacement2 = `        production_package: r.production_package || {},`;

if (code.includes(target2)) {
  code = code.replace(target2, replacement2);
  console.log("Patched target2");
}

const target3 = `        r.crew = r.crew || prev.crew || '';`;
const replacement3 = ``;
if (code.includes(target3)) {
  code = code.replace(target3, replacement3);
  console.log("Patched target3");
}

const target4 = `        r.clientContact = r.clientContact || r.clientcontact || prev.clientContact || '';`;
const replacement4 = `        r.technicians = Array.isArray(r.technicians) ? r.technicians : (Array.isArray(prev.technicians) ? prev.technicians : []);\n        r.clientContact = r.clientContact || r.clientcontact || prev.clientContact || '';`;
if (code.includes(target4)) {
  code = code.replace(target4, replacement4);
  console.log("Patched target4");
}

fs.writeFileSync('js/sync-supabase.js', code);
