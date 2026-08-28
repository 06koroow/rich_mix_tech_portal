const fs = require('fs');
let code = fs.readFileSync('js/views/presets.js', 'utf8');

code = code.replace(/const bgClass = isMuted \? 'opacity-30 grayscale' : 'hover:bg-accent\/10 cursor-pointer';/, "const bgClass = isMuted ? 'opacity-30 grayscale hover:opacity-100 cursor-pointer' : 'hover:bg-accent/10 cursor-pointer';");

fs.writeFileSync('js/views/presets.js', code);
console.log("Fixed mute cursor");
