const fs = require('fs');
let code = fs.readFileSync('js/views/inventory.js', 'utf8');

const target = `    if (lines.length === 1) {
      openDetail(lines[0]);
      return;
    }
    pickLine(lines, (it) => openDetail(it));
  }`;

const replacement = `    if (parsed.unit) {
      const exactMatch = lines.find(r => Array.isArray(r.unitTrackers) && r.unitTrackers.some(ut => ut.unit === parsed.unit));
      if (exactMatch) {
        openDetail(exactMatch);
        return;
      }
    }
    
    if (lines.length === 1) {
      openDetail(lines[0]);
      return;
    }
    pickLine(lines, (it) => openDetail(it));
  }`;

if (code.includes(target)) {
  code = code.replace(target, replacement);
  fs.writeFileSync('js/views/inventory.js', code);
  console.log("Patched handleScan in inventory.js");
} else {
  console.log("Could not find target in inventory.js");
}
