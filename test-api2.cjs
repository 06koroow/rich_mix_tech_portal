const https = require('https');
const USERNAME = "oscar.koronka@richmix.org.uk";
const PASSWORD = "M0dehurst!994";
const API_KEY = "5fd9bd7f5b9748a5efacd8606964d6b1";
const basicAuth = 'Basic ' + Buffer.from(USERNAME + ':' + PASSWORD).toString('base64');
const headers = { 'X-API-KEY': API_KEY, 'Authorization': basicAuth, 'Accept': 'application/json' };

function testEndpoint(path) {
  return new Promise((resolve) => {
      https.get({ hostname: 'richmix.artifaxevent.com', path: path, headers: headers }, res => {
          let raw = ''; res.on('data', c => raw += c);
          res.on('end', () => { console.log(`[${path}] ${res.statusCode} ${raw.substring(0, 50)}`); resolve(); });
      });
  });
}
async function run() {
  await testEndpoint('/api/public/v1/events');
  await testEndpoint('/api/public/v1/events/');
  await testEndpoint('/api/public/v1/events?schedule_output=1');
  await testEndpoint('/api/public/v1/events?date=2026-09-10');
}
run();
