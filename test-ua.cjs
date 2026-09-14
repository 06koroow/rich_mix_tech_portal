const https = require('https');
const USERNAME = "oscar.koronka@richmix.org.uk";
const PASSWORD = "M@dehurst!994";
const API_KEY = "5fd9bd7f5b9748a5efacd8606964d6b1";
const basicAuth = 'Basic ' + Buffer.from(USERNAME + ':' + PASSWORD).toString('base64');
const headers = { 
  'X-API-KEY': API_KEY, 
  'Authorization': basicAuth, 
  'Accept': 'application/json',
  'User-Agent': 'curl/7.68.0'
};

function testEndpoint(path) {
  return new Promise((resolve) => {
      https.get({ hostname: 'richmix.artifaxevent.com', path: path, headers: headers }, res => {
          let raw = ''; res.on('data', c => raw += c);
          res.on('end', () => { console.log(`[${path}] ${res.statusCode} ${raw.substring(0, 100)}`); resolve(); });
      });
  });
}
async function run() {
  await testEndpoint('/api/public/v1/events');
  await testEndpoint('/api/arrangements/event');
}
run();
