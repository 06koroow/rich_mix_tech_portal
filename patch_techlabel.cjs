const fs = require('fs');
let code = fs.readFileSync('js/views/advancing.js', 'utf8');

code = code.replace(
  /function techLabel\(t\) \{\n    const name = userName\(t\.userId\);\n    if \(\!name\) return null;\n    return t\.role \? name \+ ' \(' \+ t\.role \+ '\)' : name;\n  \}/g,
  `function techLabel(t) {
    let name;
    if (t.isFreelancer) {
      name = (t.freelancerName || 'Freelancer').trim();
    } else {
      name = userName(t.userId);
    }
    if (!name) return null;
    let label = name;
    if (t.role) label += ' (' + t.role + ')';
    if (t.startTime || t.finishTime) {
      label += ' [' + (t.startTime || 'TBD') + '-' + (t.finishTime || 'TBD') + ']';
    }
    return label;
  }`
);

fs.writeFileSync('js/views/advancing.js', code);
console.log('Patched techLabel');
