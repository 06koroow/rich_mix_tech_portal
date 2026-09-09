const https = require('https');

// Let's try the common endpoint for Artifax v4 API which is usually /api/public/v1/...
const API_KEY = "5fd9bd7f5b9748a5efacd8606964d6b1";
const BASE_URL = "https://richmix.artifaxevent.com/api/public/v1";

async function testArtifax() {
  const from = new Date().toISOString().slice(0, 10);
  const to = new Date(Date.now() + 10 * 864e5).toISOString().slice(0, 10);
  
  const url = `${BASE_URL}/arrangements`; // Just testing if we get auth error vs 404
  console.log("Testing Artifax fetch to: " + url);
  
  try {
    const res = await fetch(url, {
        headers: { "Authorization": `Bearer ${API_KEY}`, "Accept": "application/json" }
    });
    console.log("Status:", res.status);
    if (!res.ok) {
        console.error("Artifax HTTP Error:", await res.text());
        return;
    }
    const data = await res.json();
    console.log("Success! Received:", typeof data);
  } catch (err) {
      console.error("Fetch failed:", err);
  }
}

testArtifax();
