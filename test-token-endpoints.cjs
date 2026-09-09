const https = require('https');

const USERNAME = "oscar.koronka@richmix.org.uk";
const PASSWORD = "M@dehurst!994";

function testPost(path) {
  return new Promise((resolve) => {
      const data = JSON.stringify({ username: USERNAME, password: PASSWORD });
      const options = {
        hostname: 'richmix.artifaxevent.com',
        port: 443,
        path: path,
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Content-Length': data.length, 'Accept': 'application/json' }
      };
      
      const req = https.request(options, res => {
        let raw = '';
        res.on('data', c => raw += c);
        res.on('end', () => {
          console.log(`POST ${path}: ${res.statusCode} | ${raw.substring(0, 80)}`);
          resolve();
        });
      });
      req.write(data);
      req.end();
  });
}

async function run() {
    await testPost('/api/public/v1/token');
    await testPost('/api/public/v1/auth');
    await testPost('/api/token');
    await testPost('/api/auth');
    await testPost('/api/arrangements/login');
}
run();
