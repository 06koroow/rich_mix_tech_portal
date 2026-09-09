const https = require('https');

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
    await testAuth({'Authorization': `Bearer ${API_KEY}`, 'Accept': 'application/json'}, "Bearer Auth");
    await testAuth({'Authorization': `ApiKey ${API_KEY}`, 'Accept': 'application/json'}, "ApiKey Auth");
    await testAuth({'Authorization': `Basic ${Buffer.from(API_KEY + ':').toString('base64')}`, 'Accept': 'application/json'}, "Basic Auth");
    await testAuth({'X-API-Key': API_KEY, 'Accept': 'application/json'}, "X-API-Key Header");
    await testAuth({'apikey': API_KEY, 'Accept': 'application/json'}, "apikey Header");
}
run();
