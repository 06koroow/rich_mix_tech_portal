const https = require('https');

const API_KEY = "5fd9bd7f5b9748a5efacd8606964d6b1";
const path = `/api/arrangements/event?from=2026-09-09&to=2026-09-19&apikey=${API_KEY}`;
const path2 = `/api/arrangements/event?from=2026-09-09&to=2026-09-19&api_key=${API_KEY}`;

function testAuth(testPath, name) {
  return new Promise((resolve) => {
      const options = {
        hostname: 'richmix.artifaxevent.com',
        port: 443,
        path: testPath,
        method: 'GET',
        headers: { 'Accept': 'application/json' }
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
    await testAuth(path, "apikey in URL");
    await testAuth(path2, "api_key in URL");
}
run();
