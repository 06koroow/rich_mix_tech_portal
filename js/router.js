/* ============================================================
   router.js — tiny hash router
   ------------------------------------------------------------
   #/<view>/<param0>/<param1> ... -> RMTP.views[view](contentEl, params)
   No dependencies, no history API (hash keeps file:// happy).
   ============================================================ */
RMTP.router = (function () {

  function parse() {
    const raw = (location.hash || '').replace(/^#\/?/, '');   // strip "#/" or "#"
    const [pathPart, queryPart] = raw.split('?');
    const segments = (pathPart || '').split('/').filter(Boolean);
    const view = segments[0] || RMTP.HOME;
    const query = {};
    if (queryPart) {
      queryPart.split('&').forEach((pair) => {
        const [k, v] = pair.split('=');
        if (k) query[decodeURIComponent(k)] = decodeURIComponent(v || '');
      });
    }
    return { view, params: segments.slice(1), query };
  }

  function getDefaultHome() {
    if (RMTP.auth && typeof RMTP.auth.getDefaultHome === 'function' && RMTP.auth.current()) {
      return RMTP.auth.getDefaultHome();
    }
    const isHires = RMTP.auth && RMTP.auth.isHiresTeam && RMTP.auth.isHiresTeam();
    return isHires ? 'hires' : RMTP.HOME;
  }

  function render() {
    const { view, params, query } = parse();
    const defaultHome = getDefaultHome();
    let id = RMTP.views[view] ? view : defaultHome;

    // Unified configurable role-view access guard
    if (RMTP.auth && RMTP.auth.current && RMTP.auth.current() && typeof RMTP.auth.canAccessView === 'function') {
      if (!RMTP.auth.canAccessView(id)) {
        const navItem = (RMTP.nav || []).find((n) => n.id === id);
        const rawHash = (location.hash || '').replace(/^#\/?/, '');
        if (!RMTP._suppressAccessToast && rawHash && id !== RMTP.HOME && RMTP.ui && RMTP.ui.toast) {
          RMTP.ui.toast('Access to ' + (navItem ? navItem.label : id) + ' is currently disabled for your user level.', 'info');
        }
        if (id !== defaultHome) {
          location.replace('#/' + defaultHome);
          return;
        }
      }
    }

    // Background-check latest role views on navigation in Supabase mode (throttled)
    if (RMTP.syncSb && typeof RMTP.syncSb.pullRoleViews === 'function') {
      RMTP.syncSb.pullRoleViews({ minGapMs: 5000 }).catch(() => {});
    }

    const content = document.getElementById('content');
    if (!content) return;

    RMTP._previousView = RMTP._currentView || null;
    RMTP._currentView = id;

    // Update navigation to ensure correct items are visible and active
    if (RMTP.shell && typeof RMTP.shell.renderNavigation === 'function') {
      RMTP.shell.renderNavigation();
    }

    content.innerHTML = '';
    try {
      RMTP.views[id](content, params, query);
    } catch (e) {
      console.error('[router] view "' + id + '" failed', e);
      content.innerHTML = '<div class="panel p-6"><p class="font-display font-semibold text-danger">Something went wrong</p>' +
        '<p class="text-sm text-muted mt-1">This view hit an error. Check the console for details.</p></div>';
    }

    // Update active nav + section title
    const nav = RMTP.nav.find((n) => n.id === id);
    document.querySelectorAll('[data-nav]').forEach((a) => {
      if (a.getAttribute('data-nav') === id) a.setAttribute('aria-current', 'page');
      else a.removeAttribute('aria-current');
    });
    const title = document.getElementById('section-title');
    if (title && nav) title.textContent = nav.label;

    if (!RMTP._isSoftRender) {
      content.scrollTop = 0;
      window.scrollTo(0, 0);
    }
  }

  function start() {
    window.addEventListener('hashchange', render);
    if (!location.hash) location.replace('#/' + getDefaultHome());
    render();
  }

  return { start, render, parse };
})();
