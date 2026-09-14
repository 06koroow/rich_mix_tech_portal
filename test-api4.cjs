const https = require('https');
const API_KEY = "5fd9bd7f5b9748a5efacd8606964d6b1";

function testEndpoint(path, headers) {
  return new Promise((resolve) => {
      https.get({ hostname: 'richmix.artifaxevent.com', path: path, headers: headers }, res => {
          let raw = ''; res.on('data', c => raw += c);
          res.on('end', () => { console.log(`[${path}] ${res.statusCode} ${raw}`); resolve(); });
      });
  });
}
async function run() {
  const basic1 = 'Basic ' + Buffer.from("oscar.koronka" + ':' + "M0dehurst!994").toString('base64');
  await testEndpoint('/api/arrangements/event', { 'X-API-KEY': API_KEY, 'Authorization': basic1, 'Accept': 'application/json' });
  
  const basic2 = 'Basic ' + Buffer.from("oscar.koronka" + ':' + "M@dehurst!994").toString('base64');
  await testEndpoint('/api/arrangements/event', { 'X-API-KEY': API_KEY, 'Authorization': basic2, 'Accept': 'application/json' });
}
run();
