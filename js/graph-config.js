/* ============================================================
   graph-config.js — SharePoint / Microsoft Graph connection (DEPRECATED)
   ------------------------------------------------------------
   NOTE: Azure / Microsoft Graph is no longer in use.
   The portal uses Supabase (see js/supabase-config.js).
   ============================================================ */
/*
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
*/
