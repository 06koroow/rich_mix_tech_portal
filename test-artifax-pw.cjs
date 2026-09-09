const https = require('https');

const PASSWORD = "M@dehurst!994";
const API_KEY = "5fd9bd7f5b9748a5efacd8606964d6b1";
const path = `/api/arrangements/event?from=2026-09-09&to=2026-09-19`;

function testAuth(headers, name) {
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
          console.log(`[${name}] Status: ${res.statusCode} | Body: ${rawData.substring(0, 80)}`);
          resolve();
        });
      });
      req.on('error', (e) => { resolve(); });
      req.end();
  });
}

async function run() {
    await testAuth({'X-API-Key': PASSWORD, 'Accept': 'application/json'}, "Password as API Key");
}
run();
