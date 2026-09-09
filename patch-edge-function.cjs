const fs = require('fs');
let content = fs.readFileSync('supabase/functions/artifax-sync/index.ts', 'utf8');

// The Edge Function currently does this:
// const res = await fetch(`${ARTIFAX_URL}/api/instances?${params}`, { ...

// Update the Edge function to handle the URL correctly whether they included /api at the end or not.
const replacement = `  // Ensure base URL doesn't have a trailing slash or trailing /api since we append it
  const baseUrl = ARTIFAX_URL.replace(/\\/api\\/?$/, '').replace(/\\/$/, '');
  
  // Note: Artifax API routes can vary by version. Usually it's /api/public/v1/event_instances or /api/instances.
  // We'll use /api/instances as a default but log it for easy debugging.
  const endpoint = \`\${baseUrl}/api/instances?\${params}\`;
  
  const res = await fetch(endpoint, {
    headers: { "Authorization": \`Bearer \${ARTIFAX_API_KEY}\`, "Accept": "application/json" },
  });`;

content = content.replace(/const res = await fetch\(`\$\{ARTIFAX_URL\}\/api\/instances\?\$\{params\}`, \{\n\s*headers: \{ "Authorization": `Bearer \$\{ARTIFAX_API_KEY\}`.*\n\s*\}\);\n/g, replacement + '\n');

fs.writeFileSync('supabase/functions/artifax-sync/index.ts', content);
