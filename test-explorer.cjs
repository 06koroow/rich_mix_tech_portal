const https = require('https');

function testEndpoint(path) {
  return new Promise((resolve) => {
      https.get({ hostname: 'richmix.artifaxevent.com', path: path }, res => {
          let raw = ''; res.on('data', c => raw += c);
          res.on('end', () => { console.log(`[${path}] ${res.statusCode} ${raw.substring(0, 100)}`); resolve(); });
      });
  });
}
async function run() {
  await testEndpoint('/api');
  await testEndpoint('/api/');
  await testEndpoint('/api/docs');
  await testEndpoint('/api/explorer');
}
run();
