const https = require('https');

const USERNAME = "oscar.koronka@richmix.org.uk";
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
    // Test 1: Basic auth with email and API Key
    const basic1 = 'Basic ' + Buffer.from(USERNAME + ':' + API_KEY).toString('base64');
    await testAuth({'Authorization': basic1, 'Accept': 'application/json'}, "Basic: Email + API_KEY");

    // Test 2: X-API-Key with Email
    await testAuth({'X-API-Key': API_KEY, 'X-API-User': USERNAME, 'Accept': 'application/json'}, "X-API-Key + X-API-User");
    await testAuth({'X-API-Key': API_KEY, 'Email': USERNAME, 'Accept': 'application/json'}, "X-API-Key + Email");

    // Test 3: API Key in query? No, let's stick to headers.
    await testAuth({'ApiKey': API_KEY, 'ApiUser': USERNAME, 'Accept': 'application/json'}, "ApiKey + ApiUser");
}
run();
