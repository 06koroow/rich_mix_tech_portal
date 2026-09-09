const https = require('https');

// Safely execute a test request to Artifax without touching the DB
const API_KEY = "5fd9bd7f5b9748a5efacd8606964d6b1";
const BASE_URL = "https://richmix.artifaxevent.com/api";

async function testArtifax() {
  const from = new Date().toISOString().slice(0, 10);
  const to = new Date(Date.now() + 10 * 864e5).toISOString().slice(0, 10);
  
  // Note: /api is already in the URL provided by the user. 
  // Let's assume the endpoint for instances is /instances or similar.
  // Many REST APIs might use /api/public/v1/instances or similar. We'll try the generic one first.
  const url = `${BASE_URL}/instances?from=${from}&to=${to}`;
  
  console.log("Testing Artifax fetch to: " + url);
  
  try {
    const res = await fetch(url, {
        headers: { "Authorization": `Bearer ${API_KEY}`, "Accept": "application/json" }
    });
    
    if (!res.ok) {
        console.error("Artifax HTTP Error:", res.status, await res.text());
        return;
    }
    
    const data = await res.json();
    console.log("Success! Received:", typeof data, Array.isArray(data) ? data.length + " items" : "object");
    if (Array.isArray(data)) {
        console.log("First item sample:", data[0]);
    } else {
        console.log("Response sample:", Object.keys(data).reduce((acc, k) => { acc[k] = Array.isArray(data[k]) ? `Array(${data[k].length})` : data[k]; return acc; }, {}));
    }
  } catch (err) {
      console.error("Fetch failed:", err);
  }
}

testArtifax();
