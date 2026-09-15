const fs = require('fs');
let code = fs.readFileSync('js/views/advancing.js', 'utf8');

const regex = /const effectiveGroupId = e\.groupId \|\| \(e\.artifaxId && e\.name && e\.name !== "Untitled" \? 'implicit-' \+ e\.name\.toLowerCase\(\)\.trim\(\) \+ '-' \+ e\.date : null\);/;

const replacement = `const effectiveGroupId = e.groupId || (e.artifaxId && e.name && e.name !== "Untitled" ? 'implicit-' + e.name.toLowerCase().trim().replace(/[^a-z0-9]/g, '-') + '-' + e.date : null);`;

if (regex.test(code)) {
  code = code.replace(regex, replacement);
  fs.writeFileSync('js/views/advancing.js', code);
  console.log("Patched advancing.js successfully!");
} else {
  console.log("Regex did not match.");
}
