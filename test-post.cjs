const https = require('https');
const USERNAME = "oscar.koronka@richmix.org.uk";
const PASSWORD = "M@dehurst!994";
const API_KEY = "5fd9bd7f5b9748a5efacd8606964d6b1";
const basicAuth = 'Basic ' + Buffer.from(USERNAME + ':' + PASSWORD).toString('base64');
const headers = { 'X-API-KEY': API_KEY, 'Authorization': basicAuth, 'Accept': 'application/json', 'Content-Type': 'application/json' };

function testEndpoint(path, method = 'POST') {
  return new Promise((resolve) => {
      const req = https.request({ hostname: 'richmix.artifaxevent.com', path: path, method: method, headers: headers }, res => {
          let raw = ''; res.on('data', c => raw += c);
          res.on('end', () => { console.log(`[${path}] ${method} ${res.statusCode} ${raw.substring(0, 50)}`); resolve(); });
      });
      req.end();
  });
}
async function run() {
  await testEndpoint('/api/public/v1/events');
  await testEndpoint('/api/events');
  await testEndpoint('/api/public/events');
  await testEndpoint('/api/arrangements/events');
}
run();
