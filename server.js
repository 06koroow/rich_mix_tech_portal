import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = 3000;

// Serve static assets from root directory
app.use(express.static(__dirname));

// Fallback to index.html for SPA routing

// Artifax Proxy Route
app.get('/api/artifax/sync', async (req, res) => {
  const apiKey = process.env.ARTIFAX_API_KEY;
  const username = process.env.ARTIFAX_USERNAME;
  const password = process.env.ARTIFAX_PASSWORD;
  const baseUrl = (process.env.ARTIFAX_URL || "https://richmix.artifaxevent.com").replace(/\/api\/?$/, '').replace(/\/$/, '');

  if (!apiKey || !username || !password) {
    return res.status(500).json({ error: "Artifax API credentials are not configured on the server." });
  }

  const from = new Date();
  const to = new Date(Date.now() + 120 * 864e5); // 120 days
  
  // The documentation states: "Use the date parameter to enable date/time filtering. Use schedule_output=1 to include schedule data."
  const params = new URLSearchParams({
    date: 'between',
    start_date: from.toISOString().slice(0, 10),
    end_date: to.toISOString().slice(0, 10),
    schedule_output: "1"
  });
  
  const endpoint = `${baseUrl}/api/arrangements/event?${params}`;
  
  try {
    const fetchFn = globalThis.fetch;
    const basicAuth = 'Basic ' + Buffer.from(username + ':' + password).toString('base64');
    
    const response = await fetchFn(endpoint, {
      method: 'GET',
      headers: {
        "X-API-KEY": apiKey,
        "Authorization": basicAuth,
        "Accept": "application/json"
      }
    });
    
    if (!response.ok) {
      const text = await response.text();
      return res.status(response.status).json({ error: `Artifax responded ${response.status}: ${text}` });
    }
    
    const data = await response.json();
    return res.json(data);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server running at http://0.0.0.0:${PORT}`);
});
