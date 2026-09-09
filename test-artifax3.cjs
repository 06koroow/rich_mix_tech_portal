const https = require('https');

// Another common endpoint: /api/public/v1/event_instances 
const API_KEY = "5fd9bd7f5b9748a5efacd8606964d6b1";
const BASE_URL = "https://richmix.artifaxevent.com/api/public/v1";

async function testArtifax() {
  const url = `${BASE_URL}/event_instances`; 
  console.log("Testing Artifax fetch to: " + url);
  
  try {
    const res = await fetch(url, {
        headers: { "Authorization": `Bearer ${API_KEY}`, "Accept": "application/json" }
    });
    console.log("Status:", res.status);
    if (!res.ok) {
        // Just print first 100 chars to avoid big HTML logs
        const text = await res.text();
        console.error("Artifax HTTP Error:", text.substring(0, 100));
        return;
    }
    const data = await res.json();
    console.log("Success! Received:", typeof data);
  } catch (err) {
      console.error("Fetch failed:", err);
  }
}

testArtifax();
