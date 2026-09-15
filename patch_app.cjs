const fs = require('fs');
let code = fs.readFileSync('js/app.js', 'utf8');

const regex = /RMTP\.SPACES = dbVenues\.map\(v => v\.name\)\.sort\(\);/;

const replacement = `const spaceOrder = {
        'The Stage': 1, 'The Studio': 2, 'The Mix': 3, 
        'Screen One': 4, 'Screen Two': 5, 'Screen Three': 6
      };
      RMTP.SPACES = dbVenues.map(v => v.name).sort((a, b) => {
        const wa = spaceOrder[a] || 99;
        const wb = spaceOrder[b] || 99;
        return wa !== wb ? wa - wb : a.localeCompare(b);
      });`;

if (regex.test(code)) {
  code = code.replace(regex, replacement);
  fs.writeFileSync('js/app.js', code);
  console.log("Patched app.js successfully!");
} else {
  console.log("Regex did not match app.js.");
}
