const fs = require('fs');
let code = fs.readFileSync('js/views/presets.js', 'utf8');

// fix savePreset
code = code.replace(
  /    if \(idx > -1\) \{\n\s*list\[idx\] = updated;\n\s*\} else \{\n\s*list\.push\(updated\);\n\s*\}\n\s*store\.write\('patch_presets', list\);/,
  "    if (store && store.upsert) {\n      store.upsert('patch_presets', updated);\n    } else {\n      if (idx > -1) { list[idx] = updated; } else { list.push(updated); }\n      store.write('patch_presets', list);\n    }"
);

// fix removePreset
code = code.replace(
  /  function removePreset\(id\) \{\n\s*const list = getAllPresets\(\)\.filter\(\(p\) => p\.id !== id\);\n\s*store\.write\('patch_presets', list\);\n\s*\}/,
  "  function removePreset(id) {\n    if (store && store.remove) {\n      store.remove('patch_presets', id);\n    } else {\n      const list = getAllPresets().filter((p) => p.id !== id);\n      store.write('patch_presets', list);\n    }\n  }"
);

// fix savePatchSheet
code = code.replace(
  /    if \(idx > -1\) \{\n\s*list\[idx\] = updated;\n\s*\} else \{\n\s*list\.push\(updated\);\n\s*\}\n\s*store\.write\('patch_sheets', list\);/,
  "    if (store && store.upsert) {\n      store.upsert('patch_sheets', updated);\n    } else {\n      if (idx > -1) { list[idx] = updated; } else { list.push(updated); }\n      store.write('patch_sheets', list);\n    }"
);

// fix removePatchSheet
code = code.replace(
  /  function removePatchSheet\(id\) \{\n\s*const list = getAllPatchSheets\(\)\.filter\(\(ps\) => ps\.id !== id\);\n\s*store\.write\('patch_sheets', list\);\n\s*\}/,
  "  function removePatchSheet(id) {\n    if (store && store.remove) {\n      store.remove('patch_sheets', id);\n    } else {\n      const list = getAllPatchSheets().filter((ps) => ps.id !== id);\n      store.write('patch_sheets', list);\n    }\n  }"
);

fs.writeFileSync('js/views/presets.js', code);
console.log("Replaced store.write with store.upsert/store.remove in presets.js");
