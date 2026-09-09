const https = require('https');

const API_KEY = "5fd9bd7f5b9748a5efacd8606964d6b1";
const ENDPOINT_PATH = "/api/arrangements/event"; 

function testArtifax() {
  const from = new Date().toISOString().slice(0, 10);
  const to = new Date(Date.now() + 10 * 864e5).toISOString().slice(0, 10);
  
  const path = `${ENDPOINT_PATH}?from=${from}&to=${to}`;
  
  const options = {
    hostname: 'richmix.artifaxevent.com',
    port: 443,
    path: path,
    method: 'GET',
    headers: {
      'Authorization': `Bearer ${API_KEY}`,
      'Accept': 'application/json'
    }
  };

  const req = https.request(options, (res) => {
    let rawData = '';
    res.on('data', (chunk) => { rawData += chunk; });
    res.on('end', () => {
      if (res.statusCode !== 200) {
        console.error("❌ Artifax HTTP Error:", res.statusCode, rawData.substring(0, 100));
        return;
      }
      try {
        const data = JSON.parse(rawData);
        console.log("✅ Success! Array length:", Array.isArray(data) ? data.length : "Not an array");
        if (!Array.isArray(data)) console.log("Keys:", Object.keys(data));
        
        const list = Array.isArray(data) ? data : (data.instances ?? data.results ?? data.events ?? []);
        if (list.length > 0) {
            console.log("\nSample Item Structure:");
            console.log(JSON.stringify(list[0], null, 2));
        } else {
            console.log("No events found in this date range.");
        }
      } catch (e) {
        console.error("Error parsing JSON:", e.message);
      }
    });
  });
  req.on('error', (e) => { console.error("Fetch failed:", e.message); });
  req.end();
}

testArtifax();
