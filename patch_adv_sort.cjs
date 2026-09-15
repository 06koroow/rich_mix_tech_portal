const fs = require('fs');
let code = fs.readFileSync('js/views/advancing.js', 'utf8');

const regex = /item\.events\.sort\(\(a, b\) => \(a\.space \|\| ''\)\.localeCompare\(b\.space \|\| ''\)\);/;

const replacement = `const spaceOrder = {
        'The Stage': 1, 'The Studio': 2, 'The Mix': 3, 
        'Screen One': 4, 'Screen Two': 5, 'Screen Three': 6
      };
      item.events.sort((a, b) => {
        const sa = a.space || '';
        const sb = b.space || '';
        const wa = spaceOrder[sa] || 99;
        const wb = spaceOrder[sb] || 99;
        return wa !== wb ? wa - wb : sa.localeCompare(sb);
      });`;

if (regex.test(code)) {
  code = code.replace(regex, replacement);
  fs.writeFileSync('js/views/advancing.js', code);
  console.log("Patched advancing.js successfully!");
} else {
  console.log("Regex did not match advancing.js.");
}
