# Moving Artifax Sync to a Supabase Edge Function

Because you are hosting the front-end on GitHub Pages, the Node.js server (`server.js`) will no longer be running. To keep the Artifax API sync working securely (without exposing your API keys to the public browser), you need to move that backend logic into a **Supabase Edge Function**.

I have already updated the app's front-end code (`js/views/advancing.js`) to call a Supabase function named `artifax-sync` instead of the local Node server.

Here is exactly how to create, configure, and deploy that function directly using the **Supabase Web Dashboard** (no terminal or CLI required).

## Step 1: Add Your Artifax Credentials as Secrets
First, securely store your Artifax credentials in your Supabase project so the function can read them without them being visible in the code.

1. Go to the [Supabase Dashboard](https://app.supabase.com/) and open your project.
2. In the left-hand sidebar, click the **Gear icon (Project Settings)**.
3. Click on **Edge Functions** in the settings menu.
4. Under the **Secrets** section, click **Add new secret**.
5. Add the following secrets one by one:
   * Name: `ARTIFAX_API_KEY` | Value: *(Your long API key)*
   * Name: `ARTIFAX_USERNAME` | Value: `oscar.koronka@richmix.org.uk`
   * Name: `ARTIFAX_PASSWORD` | Value: *(Your Artifax password)*
   * Name: `ARTIFAX_URL` | Value: `https://richmix.artifaxevent.com`

## Step 2: Create the Edge Function
1. In the left-hand sidebar of the main dashboard, click on **Edge Functions** (the icon looks like `{ }` or a lightning bolt).
2. Click the **Create a new Edge Function** button.
3. Give it the exact name: `artifax-sync`
4. **Important:** On the right side of the screen (or in the function settings), find the toggle for **Enforce JWT Verification** and turn it **OFF**. (This allows the app to fetch the data seamlessly).

## Step 3: Paste the Code and Deploy
1. You will see an inline code editor on the screen with some default code.
2. **Delete all the default code** in the editor.
3. **Paste the following code** exactly as written below:

```typescript
import { serve } from "https://deno.land/std@0.168.0/http/server.ts"

// CORS headers are required so your GitHub Pages site can talk to the function
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

serve(async (req) => {
  // Handle CORS preflight request from the browser
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    // 1. Get credentials securely from Supabase Secrets
    const apiKey = Deno.env.get("ARTIFAX_API_KEY");
    const username = Deno.env.get("ARTIFAX_USERNAME");
    const password = Deno.env.get("ARTIFAX_PASSWORD");
    const baseUrl = (Deno.env.get("ARTIFAX_URL") || "https://richmix.artifaxevent.com").replace(/\/api\/?$/, '').replace(/\/$/, '');

    if (!apiKey || !username || !password) {
      throw new Error("Missing Artifax credentials in Edge Function secrets");
    }

    // 2. Set up the date window (Next 120 days)
    const from = new Date();
    const to = new Date(Date.now() + 120 * 864e5); 

    const params = new URLSearchParams({
      date: 'between',
      start_date: from.toISOString().slice(0, 10),
      end_date: to.toISOString().slice(0, 10),
      schedule_output: "1"
    });

    const endpoint = `${baseUrl}/api/arrangements/event?${params}`;
    
    // 3. Format the Basic Auth header for Artifax
    const basicAuth = 'Basic ' + btoa(username + ':' + password);

    // 4. Fetch the data from Artifax
    const response = await fetch(endpoint, {
      method: 'GET',
      headers: {
        "X-API-KEY": apiKey,
        "Authorization": basicAuth,
        "Accept": "application/json"
      }
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Artifax responded ${response.status}: ${text}`);
    }

    const data = await response.json();

    // 5. Return the JSON to the app
    return new Response(JSON.stringify(data), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 200,
    });

  } catch (error) {
    return new Response(JSON.stringify({ error: error.message }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 500,
    });
  }
})
```

4. Click the **Deploy** or **Save** button to push the code live.

---

### That's it!
Your Edge Function is now live! 

Your GitHub Pages site will now securely trigger this Supabase Edge Function to fetch the data directly from Artifax, completely bypassing the need for a Node.js server.
