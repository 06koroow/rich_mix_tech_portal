const fs = require('fs');
let code = fs.readFileSync('js/views/presets.js', 'utf8');

code = code.replace(
  /'<th class="py-2 px-2\.5 w-10 text-center" title="Duplicate Socket \/ Add Repatch">Repatch<\/th>' \+/,
  '\'<th class="py-2 px-2.5 w-20 text-center" title="Add another act to this socket">Changeover</th>\' +'
);

code = code.replace(
  /ui\.icon\('copy', 'w-3 h-3'\) \+ '<span>Duplicate Socket \/ Add Repatch<\/span>' \+/,
  'ui.icon(\'copy\', \'w-3 h-3\') + \'<span>Add Changeover / Repatch</span>\' +'
);

code = code.replace(
  /class="text-accent hover:text-accent-ink p-1 rounded hover:bg-accent\/10 transition-colors" title="Duplicate Socket \/ Add Repatch">/g,
  'class="text-accent hover:text-accent-ink p-1 rounded hover:bg-accent/10 transition-colors" title="Add Artist Changeover (Repatch)">'
);

fs.writeFileSync('js/views/presets.js', code);
console.log("Replaced buttons");
