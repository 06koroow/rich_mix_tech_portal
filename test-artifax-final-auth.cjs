const https = require('https');

const USERNAME = "oscar.koronka@richmix.org.uk";
const PASSWORD = "M@dehurst!994";
const API_KEY = "5fd9bd7f5b9748a5efacd8606964d6b1";

const basicAuth = 'Basic ' + Buffer.from(USERNAME + ':' + PASSWORD).toString('base64');
const headers = {
  'X-API-KEY': API_KEY,
  'Authorization': basicAuth,
  'Accept': 'application/json'
};

function testEndpoint(path) {
  return new Promise((resolve) => {
      const options = {
        hostname: 'richmix.artifaxevent.com',
        port: 443,
        path: path,
        method: 'GET',
        headers: headers
      };
    
      const req = https.request(options, (res) => {
        let rawData = '';
        res.on('data', (chunk) => { rawData += chunk; });
        res.on('end', () => {
          console.log(`[${path}] Status: ${res.statusCode} | Body: ${rawData.substring(0, 80)}`);
          resolve();
        });
      });
      req.on('error', (e) => { resolve(); });
      req.end();
  });
}

async function run() {
    const from = new Date().toISOString().slice(0, 10);
    // Let's try some common paths for Artifax Open API v1
    await testEndpoint(`/api/public/v1/events?date=${from}`);
    await testEndpoint(`/api/public/v1/event_instances?date=${from}`);
    await testEndpoint(`/api/public/v1/arrangements?date=${from}`);
    await testEndpoint(`/api/events?date=${from}`);
    await testEndpoint(`/api/arrangements/event?date=${from}`);
}
run();
