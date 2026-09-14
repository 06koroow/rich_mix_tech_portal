const https = require('https');

function testEndpoint(path) {
  return new Promise((resolve) => {
      https.get({ hostname: 'richmix.artifaxevent.com', path: path, headers: { 'X-API-KEY': '123' } }, res => {
          console.log(`[${path}] ${res.statusCode}`);
          res.resume();
          resolve();
      });
  });
}
async function run() {
  await testEndpoint('/api/events');
  await testEndpoint('/api/event');
  await testEndpoint('/api/arrangements');
  await testEndpoint('/api/activities');
  await testEndpoint('/api/public');
  await testEndpoint('/api/v1');
  await testEndpoint('/api/configuration');
}
run();
