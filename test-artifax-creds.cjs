const https = require('https');

const USERNAME = "oscar.koronka@richmix.org.uk";
const PASSWORD = "M@dehurst!994";
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
    const basicAuth = 'Basic ' + Buffer.from(USERNAME + ':' + PASSWORD).toString('base64');
    await testAuth({'Authorization': basicAuth, 'Accept': 'application/json'}, "Basic Auth");
    
    // Test if maybe it's just passing API_KEY as username and password empty, wait I already did that.
}
run();
