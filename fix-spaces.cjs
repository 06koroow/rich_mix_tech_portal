const fs = require('fs');
let code = fs.readFileSync('js/app.js', 'utf8');

const injection = `    // Sync RMTP.SPACES with database venues
    const dbVenues = RMTP.store.all('venues');
    if (dbVenues && dbVenues.length) {
      RMTP.SPACES = dbVenues.map(v => v.name).sort();
      RMTP.LOCATIONS = RMTP.SPACES.concat(RMTP.STORES);
    }
    refreshIdentity();`;

code = code.replace('    refreshIdentity();', injection);

fs.writeFileSync('js/app.js', code);
console.log("Injected RMTP.SPACES sync");
