const https = require('https');
const USERNAME = "oscar.koronka@richmix.org.uk";
const PASSWORD = "M@dehurst!994";
const API_KEY = "5fd9bd7f5b9748a5efacd8606964d6b1";
const basicAuth = 'Basic ' + Buffer.from(USERNAME + ':' + PASSWORD).toString('base64');
const headers = { 'X-API-KEY': API_KEY, 'Authorization': basicAuth, 'Accept': 'application/json' };

function testEndpoint(path) {
  return new Promise((resolve) => {
      https.get({ hostname: 'richmix.artifaxevent.com', path: path, headers: headers }, res => {
          let raw = ''; res.on('data', c => raw += c);
          res.on('end', () => { console.log(`[${path}] ${res.statusCode}`); resolve(); });
      });
  });
}
async function run() {
  await testEndpoint('/api/events/get');
  await testEndpoint('/api/arrangements/get');
  await testEndpoint('/api/arrangements/event/get');
  await testEndpoint('/api/event_instances');
}
run();
