const fs = require('fs');
let code = fs.readFileSync('js/views/presets.js', 'utf8');

code = code.replace(
  /'<div class="flex items-center justify-center"><div class="w-3 h-\[2px\] bg-warning\/50"><\/div><\/div>' :/,
  '\'<div class="flex items-center justify-center text-accent/60" title="Same socket \'+(box.letter||\'\')+grp.socket+\'">\' + ui.icon(\'corner-down-right\', \'w-4 h-4\') + \'</div>\' :'
);

code = code.replace(
  /'<div class="absolute -left-\[14px\] top-4 w-3 h-\[2px\] bg-warning\/50"><\/div>' :/,
  '\'<div class="absolute -left-[18px] top-[18px] text-accent/60">\' + ui.icon(\'corner-down-right\', \'w-4 h-4\') + \'</div>\' :'
);

fs.writeFileSync('js/views/presets.js', code);
console.log("Updated icons");
