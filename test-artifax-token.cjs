const https = require('https');

const USERNAME = "oscar.koronka@richmix.org.uk";
const PASSWORD = "M@dehurst!994";
const API_KEY = "5fd9bd7f5b9748a5efacd8606964d6b1";

// Maybe Artifax has a login endpoint that returns a token?
function testTokenEndpoint() {
  const data = JSON.stringify({ username: USERNAME, password: PASSWORD });
  const options = {
    hostname: 'richmix.artifaxevent.com',
    port: 443,
    path: '/api/login',
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Content-Length': data.length
    }
  };
  
  const req = https.request(options, res => {
    let raw = '';
    res.on('data', c => raw += c);
    res.on('end', () => console.log('POST /api/login:', res.statusCode, raw.substring(0, 100)));
  });
  req.write(data);
  req.end();
}
testTokenEndpoint();
