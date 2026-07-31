/* ============================================================
   graph-config.js — SharePoint / Microsoft Graph connection
   ------------------------------------------------------------
   Fill these in AFTER you've (1) hosted the app, (2) registered
   the SPA in Entra, and (3) looked up your site + list IDs.
   See docs/SHAREPOINT-SETUP.md for exactly how to get each value.

   Leave clientId BLANK to keep the app in local (localStorage)
   mode — nothing here runs until it's set. The moment clientId
   is filled and the MSAL script has loaded, the app switches to
   the SharePoint backend on next load.
   ============================================================ */
RMTP.graphConfig = {
  clientId: '',   // Entra app registration → Application (client) ID
  tenantId: '',   // Entra → Directory (tenant) ID  (or 'common')
  siteId:   '',   // GET /sites/{host}:/sites/{name}  → the "id" (host,guid,guid)
  driveId:  '',   // GET /sites/{siteId}/drives  → the TechFiles library id (only needed for file upload)

  // Delegated Graph scopes. Sites.ReadWrite.All lets the signed-in
  // user read/write the lists; User.Read reads their profile.
  scopes: ['User.Read', 'Sites.ReadWrite.All'],

  // App collection  →  SharePoint list GUID.
  // Get these from: GET /sites/{siteId}/lists?$select=id,name
  lists: {
    inventory:   '',   // "Inventory" list
    maintenance: '',   // "Maintenance" list
    advancing:   '',   // "Events" list
    reports:     '',   // "ShiftReports" list
    users:       '',   // "Users" list
    signoffs:    '',   // "TrainingSignoffs" list
    procedures:  '',   // "Procedures" list
  },
};
