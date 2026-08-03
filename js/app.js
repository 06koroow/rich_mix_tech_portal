/* ============================================================
   app.js — bootstrap
   ------------------------------------------------------------
   Builds the persistent shell (desktop sidebar, mobile app bar,
   mobile bottom tab bar), seeds first-run data, establishes the
   signed-in identity, then starts the router.
   ============================================================ */
(function () {
  const ui = RMTP.ui, auth = RMTP.auth;

  function brand(compact) {
    return (
      '<a href="#/' + RMTP.HOME + '" class="flex items-center gap-2.5 group">' +
        '<span class="w-9 h-9 rounded-xl bg-white overflow-hidden flex items-center justify-center shrink-0 ring-1 ring-line">' +
          '<img src="assets/rm-logo.jpg" alt="Rich Mix" class="w-full h-full object-contain" />' +
        '</span>' +
        (compact ? '' :
          '<span class="leading-tight">' +
            '<span class="block font-display font-semibold text-sm">' + RMTP.meta.name + '</span>' +
            '<span class="block eyebrow !text-[10px]">' + RMTP.meta.product + '</span>' +
          '</span>') +
      '</a>'
    );
  }

  const sideNav = RMTP.nav.map((n) =>
    '<a href="#/' + n.id + '" data-nav="' + n.id + '" ' +
      'class="nav-item flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium text-muted hover:text-ink">' +
      ui.icon(n.icon, 'w-5 h-5') + '<span>' + n.label + '</span></a>'
  ).join('');

  const tabNav = RMTP.nav.map((n) =>
    '<a href="#/' + n.id + '" data-nav="' + n.id + '" ' +
      'class="tab-item relative flex flex-col items-center justify-center gap-1 flex-1 py-2 text-muted">' +
      '<span class="tab-dot absolute top-0 w-6 h-0.5 rounded-full bg-accent opacity-0 scale-50 transition-all"></span>' +
      ui.icon(n.icon, 'w-5 h-5') +
      '<span class="text-[10px] font-medium">' + n.label + '</span></a>'
  ).join('');

  document.getElementById('app').innerHTML =
    '<div class="min-h-screen md:flex">' +

      // ---- Desktop sidebar ----
      '<aside class="hidden md:flex flex-col w-[var(--sidebar-w)] shrink-0 border-r border-line bg-panel/40 sticky top-0 h-screen">' +
        '<div class="px-4 h-16 flex items-center border-b border-line">' + brand(false) + '</div>' +
        '<nav class="flex-1 p-3 space-y-1 overflow-y-auto">' + sideNav + '</nav>' +
        '<div id="sidebar-identity" class="p-3 border-t border-line"></div>' +
      '</aside>' +

      // ---- Main column ----
      '<div class="flex-1 min-w-0 flex flex-col min-h-screen">' +
        '<header class="app-topbar md:hidden sticky top-0 z-30 h-14 px-4 flex items-center justify-between border-b border-line bg-bg/90 backdrop-blur">' +
          brand(true) +
          '<div class="flex items-center gap-3">' +
            '<span id="section-title" class="font-display font-semibold text-sm"></span>' +
            '<div id="mobile-identity"></div>' +
          '</div>' +
        '</header>' +

        '<main id="content" class="flex-1 w-full max-w-6xl mx-auto px-4 md:px-8 py-6 md:py-8 pb-28 md:pb-10"></main>' +
      '</div>' +

      // ---- Mobile bottom tab bar ----
      '<nav class="app-tabbar md:hidden fixed bottom-0 inset-x-0 z-30 flex border-t border-line bg-panel/95 backdrop-blur pb-[env(safe-area-inset-bottom)]">' +
        tabNav +
      '</nav>' +
    '</div>';

  /* ---- Identity chips (live outside #content, refreshed on change) ---- */
  function sidebarChip() {
    const u = auth.current();
    if (!u) return '<p class="text-xs text-muted">Not signed in</p>';
    return '<div class="flex items-center gap-2.5">' +
        '<span class="w-8 h-8 rounded-full bg-panel2 border border-line flex items-center justify-center text-xs font-display font-semibold shrink-0">' + ui.esc(auth.initials(u)) + '</span>' +
        '<span class="min-w-0 flex-1">' +
          '<span class="block text-sm font-medium truncate">' + ui.esc(auth.displayName(u)) + '</span>' +
          '<span class="block text-[11px] text-muted truncate">' + ui.esc(u.position) + (u.admin ? ' \u00b7 Admin' : u.trainer ? ' \u00b7 Trainer' : '') + '</span>' +
        '</span>' +
        '<button id="switch-user" class="text-muted hover:text-ink p-1 shrink-0" title="Sign out" aria-label="Sign out">' + ui.icon('power', 'w-4 h-4') + '</button>' +
      '</div>' +
      '<p class="text-[10px] text-muted mt-2 tabular">v' + RMTP.meta.version + '</p>';
  }
  function mobileChip() {
    const u = auth.current();
    return '<button id="switch-user-m" class="w-8 h-8 rounded-full bg-panel2 border border-line flex items-center justify-center text-[11px] font-display font-semibold" title="Sign out" aria-label="Sign out">' +
      ui.esc(u ? auth.initials(u) : '?') + '</button>';
  }
  function refreshIdentity() {
    const s = document.getElementById('sidebar-identity');
    const mm = document.getElementById('mobile-identity');
    if (s) {
      s.innerHTML = sidebarChip();
      const sw = s.querySelector('#switch-user');
      if (sw) sw.addEventListener('click', () => auth.signOut());
    }
    if (mm) {
      mm.innerHTML = mobileChip();
      const swm = mm.querySelector('#switch-user-m');
      if (swm) swm.addEventListener('click', () => auth.signOut());
    }
  }
  RMTP.shell = { refreshIdentity };

  // Seed first-run data, establish identity, draw chips, then route.
  (async function boot() {
    const sbOn = RMTP.supabase && RMTP.supabase.isConfigured();
    const spOn = !sbOn && RMTP.graph && RMTP.graph.isConfigured();

    if (sbOn) {
      try {
        RMTP.supabase.init();
        const email = await RMTP.supabase.restoreSession();   // existing session?
        await RMTP.syncSb.pullAll();                          // hydrate cache from Supabase
        RMTP.syncSb.wire();                                   // push local changes back
        if (!(email && RMTP.auth.signInEmail(email))) {
          RMTP.auth.showLogin();                              // locked login (Supabase Auth)
        }
      } catch (e) {
        console.error('[boot] Supabase backend failed — running in local mode', e);
        RMTP.store.init();
        RMTP.auth.ensureSession();
      }
    } else if (spOn) {
      try {
        await RMTP.graph.init();
        await RMTP.graph.ensureSignedIn();      // Entra SSO
        await RMTP.sync.pullAll();              // hydrate the cache from SharePoint
        RMTP.sync.wire();                       // push local changes back
        if (!RMTP.auth.signInGraphAccount(RMTP.graph.currentAccount())) {
          RMTP.ui.toast('No Tech Portal account for your sign-in — ask an admin to add you', 'danger');
          RMTP.auth.ensureSession();
        }
      } catch (e) {
        console.error('[boot] SharePoint backend failed — running in local mode', e);
        RMTP.store.init();
        RMTP.auth.ensureSession();
      }
    } else {
      RMTP.store.init();
      RMTP.auth.ensureSession();                // locked login if nobody is signed in
    }
    refreshIdentity();
    RMTP.router.start();
  })();
})();
