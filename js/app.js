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

  function getVisibleNav() {
    const isTMOrAdmin = auth.isTechManagerOrAdmin ? auth.isTechManagerOrAdmin() : (auth.isTechManager() || auth.isAdmin());
    const isFreelancer = auth.isFreelancer ? auth.isFreelancer() : (auth.current() && auth.current().position === 'Freelancer');
    return RMTP.nav.filter((n) => {
      if (n.id === 'presets' || n.id === 'venues') {
        return isTMOrAdmin;
      }
      if (n.id === 'dcp') {
        return !isFreelancer;
      }
      return true;
    });
  }

  function renderNavigation() {
    const items = getVisibleNav();
    const currentView = RMTP._currentView || (RMTP.router && RMTP.router.parse ? RMTP.router.parse().view : RMTP.HOME);

    const navHtml = items.map((n) =>
      '<a href="#/' + n.id + '" data-nav="' + n.id + '" ' +
        (n.id === currentView ? 'aria-current="page" ' : '') +
        'class="nav-item flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium text-muted hover:text-ink">' +
        ui.icon(n.icon, 'w-5 h-5') + '<span>' + n.label + '</span></a>'
    ).join('');

    const desktopNav = document.getElementById('desktop-side-nav');
    if (desktopNav) desktopNav.innerHTML = navHtml;

    const drawerNav = document.getElementById('mobile-drawer-nav');
    if (drawerNav) {
      drawerNav.innerHTML = navHtml;
      drawerNav.querySelectorAll('a').forEach((link) => {
        link.addEventListener('click', () => {
          const drawer = document.getElementById('mobile-nav-drawer');
          if (drawer) drawer.classList.add('hidden');
        });
      });
    }
  }

  document.getElementById('app').innerHTML =
    '<div class="min-h-screen md:flex">' +

      // ---- Desktop sidebar ----
      '<aside class="hidden md:flex flex-col w-[var(--sidebar-w)] shrink-0 border-r border-line bg-panel/40 sticky top-0 h-screen">' +
        '<div class="px-4 h-16 flex items-center border-b border-line">' + brand(false) + '</div>' +
        '<nav id="desktop-side-nav" class="flex-1 p-3 space-y-1 overflow-y-auto"></nav>' +
        '<div id="sidebar-identity" class="p-3 border-t border-line"></div>' +
      '</aside>' +

      // ---- Mobile navigation drawer ----
      '<div id="mobile-nav-drawer" class="md:hidden fixed inset-0 z-50 hidden" role="dialog" aria-modal="true">' +
        '<div id="mobile-nav-backdrop" class="absolute inset-0 bg-black/70 backdrop-blur-xs"></div>' +
        '<div class="relative w-4/5 max-w-xs h-full bg-panel border-r border-line shadow-2xl flex flex-col justify-between overflow-y-auto">' +
          '<div>' +
            '<div class="px-4 h-14 flex items-center justify-between border-b border-line">' +
              brand(false) +
              '<button id="mobile-nav-close" class="text-muted hover:text-ink p-1.5 rounded-lg hover:bg-panel2 transition-colors" aria-label="Close menu">' +
                ui.icon('x', 'w-5 h-5') +
              '</button>' +
            '</div>' +
            '<nav id="mobile-drawer-nav" class="p-3 space-y-1"></nav>' +
          '</div>' +
          '<div id="mobile-drawer-identity" class="p-3 border-t border-line"></div>' +
        '</div>' +
      '</div>' +

      // ---- Main column ----
      '<div class="flex-1 min-w-0 flex flex-col min-h-screen">' +
        '<div id="dev-preview-slot"></div>' +
        '<header class="app-topbar md:hidden sticky top-0 z-30 h-14 px-4 flex items-center justify-between border-b border-line bg-bg/90 backdrop-blur">' +
          '<div class="flex items-center gap-2">' +
            '<button id="mobile-menu-toggle" class="p-2 -ml-1.5 text-muted hover:text-ink rounded-lg hover:bg-panel2 transition-colors flex items-center justify-center" aria-label="Open navigation menu">' +
              ui.icon('menu', 'w-5 h-5') +
            '</button>' +
            brand(true) +
          '</div>' +
          '<div class="flex items-center gap-2.5 min-w-0">' +
            '<span id="section-title" class="font-display font-semibold text-xs sm:text-sm truncate max-w-[125px] sm:max-w-[200px] text-right text-muted"></span>' +
            '<div id="mobile-identity" class="shrink-0"></div>' +
          '</div>' +
        '</header>' +

        '<main id="content" class="flex-1 w-full max-w-[1840px] mx-auto px-3 sm:px-4 md:px-6 lg:px-8 py-4 md:py-6 pb-12"></main>' +
      '</div>' +
    '</div>';

  /* ---- Mobile Drawer Controls ---- */
  function initMobileDrawer() {
    const toggleBtn = document.getElementById('mobile-menu-toggle');
    const closeBtn = document.getElementById('mobile-nav-close');
    const drawer = document.getElementById('mobile-nav-drawer');
    const backdrop = document.getElementById('mobile-nav-backdrop');

    function openDrawer() {
      if (drawer) drawer.classList.remove('hidden');
    }
    function closeDrawer() {
      if (drawer) drawer.classList.add('hidden');
    }

    if (toggleBtn) toggleBtn.addEventListener('click', openDrawer);
    if (closeBtn) closeBtn.addEventListener('click', closeDrawer);
    if (backdrop) backdrop.addEventListener('click', closeDrawer);

    const drawerNav = document.getElementById('mobile-drawer-nav');
    if (drawerNav) {
      drawerNav.querySelectorAll('a').forEach((link) => {
        link.addEventListener('click', closeDrawer);
      });
    }

    window.addEventListener('hashchange', closeDrawer);
  }
  initMobileDrawer();

  /* ---- Identity chips (live outside #content, refreshed on change) ---- */
  function sidebarChip() {
    const u = auth.current();
    if (!u) return '<p class="text-xs text-muted">Not signed in</p>';
    const isTM = auth.isRealTechManager && auth.isRealTechManager();
    const override = isTM && auth.getDevOverride && auth.getDevOverride();

    let devBtn = '';
    if (isTM) {
      devBtn =
        '<div class="mt-2.5 pt-2.5 border-t border-line/60">' +
          '<button type="button" class="dev-options-trigger w-full flex items-center justify-between px-2.5 py-1.5 rounded-lg border ' +
            (override ? 'border-purple-500 bg-purple-500/20 text-purple-200 shadow-sm ring-1 ring-purple-500/50' : 'border-purple-500/30 bg-purple-500/10 text-purple-300 hover:bg-purple-500/20') +
            ' text-xs font-semibold transition-all group">' +
            '<span class="flex items-center gap-1.5">' +
              '<span class="w-2 h-2 rounded-full ' + (override ? 'bg-purple-400 animate-pulse' : 'bg-purple-500') + '"></span>' +
              '<span>Dev Sandbox</span>' +
            '</span>' +
            '<span class="text-[10px] uppercase font-mono px-1.5 py-0.5 rounded bg-purple-900/60 text-purple-200 border border-purple-500/40">' +
              (override ? (override.label || 'Preview') : 'TM Tools') +
            '</span>' +
          '</button>' +
        '</div>';
    }

    return '<div class="flex items-center gap-2.5">' +
        '<span class="w-8 h-8 rounded-full bg-panel2 border border-line flex items-center justify-center text-xs font-display font-semibold shrink-0">' + ui.esc(auth.initials(u)) + '</span>' +
        '<span class="min-w-0 flex-1">' +
          '<span class="block text-sm font-medium truncate flex items-center gap-1.5">' +
            ui.esc(auth.displayName(u)) +
            (override ? '<span class="text-[9px] px-1 py-0.2 rounded bg-purple-500/20 text-purple-300 font-mono font-bold">PREVIEW</span>' : '') +
          '</span>' +
          '<span class="block text-[11px] text-muted truncate">' + ui.esc(u.position) + (u.admin ? ' \u00b7 Admin' : u.trainer ? ' \u00b7 Trainer' : '') + '</span>' +
        '</span>' +
        '<button id="switch-user" class="text-muted hover:text-ink p-1 shrink-0" title="Sign out" aria-label="Sign out">' + ui.icon('power', 'w-4 h-4') + '</button>' +
      '</div>' +
      devBtn +
      '<p class="text-[10px] text-muted mt-2 tabular">v' + RMTP.meta.version + '</p>';
  }

  function mobileChip() {
    const u = auth.current();
    const isTM = auth.isRealTechManager && auth.isRealTechManager();
    const override = isTM && auth.getDevOverride && auth.getDevOverride();
    return '<div class="flex items-center gap-1.5">' +
      (isTM ? '<button type="button" class="dev-options-trigger w-8 h-8 rounded-full border border-purple-500/40 bg-purple-500/20 text-purple-300 hover:bg-purple-500/30 flex items-center justify-center text-xs" title="Dev Role Switcher">' + (override ? '⚡' : '🛠️') + '</button>' : '') +
      '<button id="switch-user-m" class="w-8 h-8 rounded-full bg-panel2 border border-line flex items-center justify-center text-[11px] font-display font-semibold" title="Sign out" aria-label="Sign out">' +
        ui.esc(u ? auth.initials(u) : '?') + '</button>' +
    '</div>';
  }

  function refreshIdentity() {
    const s = document.getElementById('sidebar-identity');
    const mm = document.getElementById('mobile-identity');
    const md = document.getElementById('mobile-drawer-identity');
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
    if (md) {
      md.innerHTML = sidebarChip();
      const swd = md.querySelector('#switch-user');
      if (swd) swd.addEventListener('click', () => auth.signOut());
    }

    // Wire all Dev Options buttons
    document.querySelectorAll('.dev-options-trigger').forEach((btn) => {
      btn.addEventListener('click', () => {
        if (auth.openDevModal) auth.openDevModal();
      });
    });

    // Render persistent Dev Preview banner if active
    const slot = document.getElementById('dev-preview-slot');
    if (slot) {
      const isTM = auth.isRealTechManager && auth.isRealTechManager();
      const override = isTM && auth.getDevOverride && auth.getDevOverride();
      if (override) {
        const cur = auth.current();
        const curPos = cur ? cur.position : '';
        const curAdm = cur ? !!cur.admin : false;
        const curTrn = cur ? !!cur.trainer : false;
        const label = override.label || curPos || 'Preview';

        slot.innerHTML =
          '<div class="bg-purple-950/95 border-b border-purple-500/40 text-purple-200 px-3 sm:px-4 py-1.5 flex flex-wrap items-center justify-between gap-2 text-xs sticky top-0 z-40 backdrop-blur shadow-md">' +
            '<div class="flex items-center gap-2 min-w-0">' +
              '<span class="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-purple-500/30 text-purple-100 text-[10px] font-bold uppercase tracking-wider border border-purple-400/40 shrink-0">' +
                '⚡ Dev Preview' +
              '</span>' +
              '<span class="text-purple-100 font-semibold truncate text-xs">' +
                'Viewing as: <span class="underline decoration-purple-400 font-bold">' + ui.esc(label) + '</span>' +
              '</span>' +
              '<span class="text-purple-300/80 text-[11px] hidden sm:inline">' +
                (curAdm ? 'Admin: ON' : 'Admin: OFF') + ' &middot; ' + (curTrn ? 'Trainer: ON' : 'Trainer: OFF') +
              '</span>' +
            '</div>' +
            '<div class="flex items-center gap-1 shrink-0">' +
              '<span class="text-[11px] text-purple-300/70 hidden lg:inline mr-1">Quick Swap:</span>' +
              '<button type="button" id="dev-quick-duty" class="btn btn-xs border border-purple-400/40 bg-purple-900/60 hover:bg-purple-800 text-purple-100 !py-0.5 !px-2 text-[11px] ' + (curPos === 'Duty Tech' && !curAdm ? 'ring-1 ring-white font-bold bg-purple-800' : '') + '">' +
                'Duty Tech' +
              '</button>' +
              '<button type="button" id="dev-quick-freelancer" class="btn btn-xs border border-purple-400/40 bg-purple-900/60 hover:bg-purple-800 text-purple-100 !py-0.5 !px-2 text-[11px] ' + (curPos === 'Freelancer' ? 'ring-1 ring-white font-bold bg-purple-800' : '') + '">' +
                'Freelancer' +
              '</button>' +
              '<button type="button" id="dev-quick-senior" class="btn btn-xs border border-purple-400/40 bg-purple-900/60 hover:bg-purple-800 text-purple-100 !py-0.5 !px-2 text-[11px] ' + (curPos === 'Senior Tech' ? 'ring-1 ring-white font-bold bg-purple-800' : '') + '">' +
                'Senior Tech' +
              '</button>' +
              '<button type="button" id="dev-banner-options" class="btn btn-xs border border-purple-400/40 bg-purple-900/60 hover:bg-purple-800 text-purple-100 !py-0.5 !px-2 text-[11px]" title="Open Dev Sandbox">' +
                '⚙️ Sandbox' +
              '</button>' +
              '<button type="button" id="dev-banner-exit" class="btn btn-xs bg-purple-600 hover:bg-purple-500 text-white font-semibold !py-0.5 !px-2.5 text-[11px] shadow-sm ml-1" title="Exit Preview and Return to Technical Manager">' +
                '✕ Exit Preview' +
              '</button>' +
            '</div>' +
          '</div>';

        const qDuty = slot.querySelector('#dev-quick-duty');
        if (qDuty) qDuty.addEventListener('click', () => {
          auth.setDevOverride({ type: 'preset', position: 'Duty Tech', admin: false, trainer: false, label: 'Duty Tech' });
          ui.toast('Switched preview to Duty Tech (Staff Tech)', 'ok');
        });
        const qFree = slot.querySelector('#dev-quick-freelancer');
        if (qFree) qFree.addEventListener('click', () => {
          auth.setDevOverride({ type: 'preset', position: 'Freelancer', admin: false, trainer: false, label: 'Freelancer' });
          ui.toast('Switched preview to Freelancer (Restricted)', 'ok');
        });
        const qSenior = slot.querySelector('#dev-quick-senior');
        if (qSenior) qSenior.addEventListener('click', () => {
          auth.setDevOverride({ type: 'preset', position: 'Senior Tech', admin: true, trainer: true, label: 'Senior Tech' });
          ui.toast('Switched preview to Senior Tech', 'ok');
        });
        const bOpt = slot.querySelector('#dev-banner-options');
        if (bOpt) bOpt.addEventListener('click', () => auth.openDevModal());
        const bExit = slot.querySelector('#dev-banner-exit');
        if (bExit) bExit.addEventListener('click', () => {
          auth.clearDevOverride();
          ui.toast('Exited preview mode \u2014 back to Technical Manager', 'ok');
        });
      } else {
        slot.innerHTML = '';
      }
    }
    renderNavigation();
  }
  RMTP.shell = { refreshIdentity, renderNavigation };

  // Seed first-run data, establish identity, draw chips, then route.
  (async function boot() {
    const sbOn = RMTP.supabase && RMTP.supabase.isConfigured();
    // (SharePoint/Graph backend disabled — using Supabase backend)
    // const spOn = !sbOn && RMTP.graph && RMTP.graph.isConfigured();

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
        // Fail loud: the app is configured for Supabase but couldn't reach it.
        // Do NOT silently fall back to local seed data — that hides the problem
        // and shows stale/wrong data. Show a clear message with a Retry.
        console.error('[boot] Supabase unreachable', e);
        showBackendError(e && e.message);
        return;
      }
    /*
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
        console.error('[boot] SharePoint unreachable', e);
        showBackendError(e && e.message);
        return;
      }
    */
    } else {
      RMTP.store.init();
      RMTP.auth.ensureSession();                // locked login if nobody is signed in
    }
    // Sync RMTP.SPACES with database venues, ensuring default spaces are never lost
    const defaultSpaces = RMTP.DEFAULT_SPACES || ['The Stage', 'The Studio', 'The Mix', 'Screen One', 'Screen Two', 'Screen Three'];
    const deletedSpaces = new Set(RMTP.store.read('deleted_spaces', []) || []);
    const dbVenues = RMTP.store.all('venues') || [];

    // Ensure default spaces have entries in the venues store
    const existingVenuesMap = new Map(dbVenues.map(v => [(v.name || v.id || '').trim(), v]));
    defaultSpaces.forEach(name => {
      if (!deletedSpaces.has(name) && !existingVenuesMap.has(name)) {
        const seedTpl = (RMTP.seed?.venues || []).find(sv => sv.name === name || sv.id === name);
        const venueRecord = seedTpl ? JSON.parse(JSON.stringify(seedTpl)) : {
          id: name,
          name: name,
          capacity: '',
          stageDimensions: '',
          inventory: '',
          audio: {
            inputChannels: 32,
            localInputChannels: 8,
            outputChannels: 16,
            localOutputChannels: 8,
            prefix: name.slice(0, 2).toUpperCase(),
            mixingDeskProtocol: 'Dante',
            mixingDeskInvId: '',
            stageboxes: []
          },
          dmx: []
        };
        RMTP.store.upsert('venues', venueRecord);
        existingVenuesMap.set(name, venueRecord);
      }
    });

    // Re-read venues after seeding
    const allVenues = RMTP.store.all('venues') || [];
    allVenues.forEach(v => {
      if (!v.crewDisciplines || !Array.isArray(v.crewDisciplines) || v.crewDisciplines.length === 0) {
        const specs = RMTP.getSpaceCrewSpecs(v.name || v.id);
        v.crewDisciplines = specs.disciplines.map(d => ({ ...d }));
        v.basicCrew = specs.total;
        RMTP.store.upsert('venues', v);
      }
    });
    const spaceNamesSet = new Set();
    
    // Always include non-deleted default spaces
    defaultSpaces.filter(s => !deletedSpaces.has(s)).forEach(s => spaceNamesSet.add(s));
    
    // Add all database spaces that aren't deleted
    allVenues.forEach(v => {
      const n = (v.name || v.id || '').trim();
      if (n && !deletedSpaces.has(n)) {
        spaceNamesSet.add(n);
      }
    });

    const spaceOrder = {
      'The Stage': 1, 'The Studio': 2, 'The Mix': 3, 
      'Screen One': 4, 'Screen Two': 5, 'Screen Three': 6,
      'Streetside': 7
    };
    RMTP.SPACES = Array.from(spaceNamesSet).sort((a, b) => {
      const wa = spaceOrder[a] || 99;
      const wb = spaceOrder[b] || 99;
      return wa !== wb ? wa - wb : a.localeCompare(b);
    });
    RMTP.LOCATIONS = RMTP.SPACES.concat(RMTP.STORES || []);
    refreshIdentity();
    RMTP.router.start();
    
    // Auto-sync Artifax on boot if configured and function is available
    setTimeout(() => {
      if (typeof RMTP.syncArtifax === 'function') {
        RMTP.syncArtifax(true); // pass silent flag if supported
      }
    }, 2000);
  })();

  // Full-screen "can't reach the database" state — replaces the old silent
  // fallback to local mode when a backend is configured but unreachable.
  function showBackendError(detail) {
    const app = document.getElementById('app');
    const modal = document.getElementById('modal-layer');
    if (modal) modal.innerHTML = '';
    if (!app) return;
    app.innerHTML =
      '<div class="min-h-[75vh] flex items-center justify-center p-6">' +
        '<div class="panel p-8 max-w-md text-center">' +
          RMTP.ui.icon('alert', 'w-10 h-10 mx-auto') + '<div style="color:var(--danger)"></div>' +
          '<h1 class="text-lg font-semibold mt-4">Can\u2019t reach the database</h1>' +
          '<p class="text-sm text-muted mt-2 leading-relaxed">This app saves to Supabase, but it couldn\u2019t connect just now. ' +
            'To avoid showing stale data or losing changes, it hasn\u2019t loaded. Check your connection and try again.</p>' +
          (detail ? '<p class="text-[11px] text-muted mt-3 tabular break-words">' + RMTP.ui.esc(String(detail)) + '</p>' : '') +
          '<button id="rm-retry" class="btn btn-primary mt-5 mx-auto justify-center">Retry</button>' +
        '</div>' +
      '</div>';
    const r = document.getElementById('rm-retry');
    if (r) r.addEventListener('click', () => window.location.reload());
  }
})();
