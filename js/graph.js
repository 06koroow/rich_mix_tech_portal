/* ============================================================
   graph.js — Entra sign-in (MSAL) + Microsoft Graph REST client
   ------------------------------------------------------------
   Thin wrapper over @azure/msal-browser (loaded from Microsoft's
   CDN in index.html) and the Graph v1.0 endpoints for SharePoint
   lists + drives. Nothing here touches the network at load time;
   it only acts when the app boots in backend mode (config set).

   NOTE: this is a working-shaped skeleton. It needs your tenant
   values in graph-config.js and testing against your real site —
   it can't be exercised offline. See docs/SHAREPOINT-SETUP.md.
   ============================================================ */
RMTP.graph = (function () {
  const BASE = 'https://graph.microsoft.com/v1.0';
  let app = null, account = null;
  const cfg = () => RMTP.graphConfig || {};

  // Backend mode is on only when a clientId is set AND MSAL loaded.
  function isConfigured() { return !!cfg().clientId && typeof msal !== 'undefined'; }

  async function init() {
    if (app) return;
    app = new msal.PublicClientApplication({
      auth: {
        clientId: cfg().clientId,
        authority: 'https://login.microsoftonline.com/' + (cfg().tenantId || 'common'),
        redirectUri: window.location.origin + window.location.pathname,
      },
      cache: { cacheLocation: 'localStorage' },
    });
    await app.initialize();
    const resp = await app.handleRedirectPromise();
    if (resp && resp.account) account = resp.account;
    if (!account) { const accs = app.getAllAccounts(); if (accs.length) account = accs[0]; }
    if (account) app.setActiveAccount(account);
  }

  async function ensureSignedIn() {
    if (account) return account;
    const resp = await app.loginPopup({ scopes: cfg().scopes });   // or loginRedirect
    account = resp.account; app.setActiveAccount(account);
    return account;
  }
  function currentAccount() { return account; }
  function accountEmail() {
    if (!account) return '';
    return account.username || (account.idTokenClaims && account.idTokenClaims.preferred_username) || '';
  }
  function accountName() {
    return (account && account.name) || '';
  }

  async function token() {
    const req = { scopes: cfg().scopes, account: account };
    try { return (await app.acquireTokenSilent(req)).accessToken; }
    catch (e) { return (await app.acquireTokenPopup(req)).accessToken; }
  }

  // Core fetch. Accepts a relative path ("/sites/...") or an absolute
  // @odata.nextLink URL. Surfaces 429 with retryAfter for the sync queue.
  async function api(pathOrUrl, opts) {
    opts = opts || {};
    const t = await token();
    const url = pathOrUrl.indexOf('http') === 0 ? pathOrUrl : BASE + pathOrUrl;
    const res = await fetch(url, Object.assign({}, opts, {
      headers: Object.assign({ Authorization: 'Bearer ' + t, 'Content-Type': 'application/json' }, opts.headers || {}),
    }));
    if (res.status === 429) { const e = new Error('throttled'); e.retryAfter = parseInt(res.headers.get('Retry-After') || '5', 10); throw e; }
    if (!res.ok) throw new Error('Graph ' + res.status + ' ' + url + ' — ' + (await res.text()).slice(0, 300));
    if (res.status === 204) return null;
    return res.json();
  }

  // ---- SharePoint list items ----
  async function listItems(listId) {
    let url = '/sites/' + cfg().siteId + '/lists/' + listId + '/items?expand=fields&$top=500';
    const out = [];
    while (url) { const page = await api(url); (page.value || []).forEach((v) => out.push(v)); url = page['@odata.nextLink'] || ''; }
    return out;
  }
  function createItem(listId, fields) {
    return api('/sites/' + cfg().siteId + '/lists/' + listId + '/items', { method: 'POST', body: JSON.stringify({ fields: fields }) });
  }
  function updateItem(listId, spId, fields) {
    return api('/sites/' + cfg().siteId + '/lists/' + listId + '/items/' + spId + '/fields', { method: 'PATCH', body: JSON.stringify(fields) });
  }
  function deleteItem(listId, spId) {
    return api('/sites/' + cfg().siteId + '/lists/' + listId + '/items/' + spId, { method: 'DELETE' });
  }

  // ---- Files → TechFiles document library. Returns the file's webUrl. ----
  async function uploadFile(path, blob) {
    const t = await token();
    const url = BASE + '/sites/' + cfg().siteId + '/drives/' + cfg().driveId + '/root:/' + encodeURI(path) + ':/content';
    const res = await fetch(url, { method: 'PUT', headers: { Authorization: 'Bearer ' + t }, body: blob });
    if (!res.ok) throw new Error('Upload ' + res.status);
    return (await res.json()).webUrl;
  }

  return { isConfigured, init, ensureSignedIn, currentAccount, accountEmail, accountName, token, api, listItems, createItem, updateItem, deleteItem, uploadFile };
})();
