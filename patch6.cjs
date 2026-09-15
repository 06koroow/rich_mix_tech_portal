const fs = require('fs');
let code = fs.readFileSync('js/views/advancing.js', 'utf8');

const regex = /const groupedShown = \[\];\s+const groupMap = \{\};\s+for \(const e of shown\) \{\s+if \(e\.groupId\) \{\s+const key = e\.groupId \+ '\|' \+ \(e\.date \|\| 'TBC'\);\s+if \(\!groupMap\[key\]\) \{\s+groupMap\[key\] = \{ isGroup: true, groupId: e\.groupId, date: e\.date, name: e\.name, events: \[\] \};\s+groupedShown\.push\(groupMap\[key\]\);\s+\}\s+groupMap\[key\]\.events\.push\(e\);\s+\} else \{\s+groupedShown\.push\(e\);\s+\}\s+\}/;

const replacement = `const groupedShown = [];
  const groupMap = {};
  
  for (const e of shown) {
    // Smart Fallback: if no explicit groupId exists, but it's an Artifax event, implicitly group by Name + Date
    const effectiveGroupId = e.groupId || (e.artifaxId && e.name && e.name !== "Untitled" ? 'implicit-' + e.name.toLowerCase().trim() + '-' + e.date : null);
    
    if (effectiveGroupId) {
      const key = effectiveGroupId + '|' + (e.date || 'TBC');
      if (!groupMap[key]) {
        groupMap[key] = { isGroup: true, groupId: effectiveGroupId, date: e.date, name: e.name, events: [] };
        groupedShown.push(groupMap[key]);
      }
      groupMap[key].events.push(e);
    } else {
      groupedShown.push(e);
    }
  }`;

if (regex.test(code)) {
  code = code.replace(regex, replacement);
  fs.writeFileSync('js/views/advancing.js', code);
  console.log("Patched successfully.");
} else {
  console.log("Regex did not match.");
}
