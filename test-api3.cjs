const https = require('https');
const API_KEY = "5fd9bd7f5b9748a5efacd8606964d6b1";

function testEndpoint(path, headers) {
  return new Promise((resolve) => {
      https.get({ hostname: 'richmix.artifaxevent.com', path: path, headers: headers }, res => {
          let raw = ''; res.on('data', c => raw += c);
          res.on('end', () => { console.log(`[${path}] ${res.statusCode} ${raw}`); resolve(); });
      });
  });
}
async function run() {
  await testEndpoint('/api/arrangements/event', { 'X-API-KEY': API_KEY, 'Accept': 'application/json' });
}
run();
