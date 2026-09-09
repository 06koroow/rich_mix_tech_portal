const fs = require('fs');
let serverCode = fs.readFileSync('server.js', 'utf8');

const proxyCode = `
// Artifax Proxy Route
app.get('/api/artifax/sync', async (req, res) => {
  const apiKey = process.env.ARTIFAX_API_KEY || "5fd9bd7f5b9748a5efacd8606964d6b1";
  const baseUrl = (process.env.ARTIFAX_URL || "https://richmix.artifaxevent.com").replace(/\\/api\\/?$/, '').replace(/\\/$/, '');
  
  const from = new Date();
  const to = new Date(Date.now() + 120 * 864e5); // 120 days
  
  const params = new URLSearchParams({
    from: from.toISOString().slice(0, 10),
    to: to.toISOString().slice(0, 10),
  });
  
  const endpoint = \`\${baseUrl}/api/arrangements/event?\${params}\`;
  
  try {
    const fetch = (await import('node-fetch')).default || globalThis.fetch;
    const response = await fetch(endpoint, {
      headers: {
        "X-API-Key": apiKey,
        "Accept": "application/json"
      }
    });
    
    if (!response.ok) {
      const text = await response.text();
      return res.status(response.status).json({ error: \`Artifax responded \${response.status}: \${text}\` });
    }
    
    const data = await response.json();
    return res.json(data);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});
`;

if (!serverCode.includes('/api/artifax/sync')) {
  serverCode = serverCode.replace('app.get(\'*\', (req, res) => {', proxyCode + '\napp.get(\'*\', (req, res) => {');
  fs.writeFileSync('server.js', serverCode);
  console.log("Patched server.js");
} else {
  console.log("Already patched");
}
