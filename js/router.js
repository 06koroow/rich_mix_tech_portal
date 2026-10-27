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

  function render() {
    const { view, params, query } = parse();
    let id = RMTP.views[view] ? view : RMTP.HOME;

    // Guard restricted views: Patch & Preset Manager and Venues & Spaces are Technical Manager and Admin only
    if (id === 'presets' || id === 'venues') {
      const isTMOrAdmin = RMTP.auth && (RMTP.auth.isTechManagerOrAdmin ? RMTP.auth.isTechManagerOrAdmin() : (RMTP.auth.isTechManager() || RMTP.auth.isAdmin()));
      if (!isTMOrAdmin) {
        if (RMTP.ui && RMTP.ui.toast) {
          RMTP.ui.toast('Access to ' + (id === 'presets' ? 'Patch & Preset Manager' : 'Venues & Spaces') + ' is restricted to Technical Managers.', 'info');
        }
        location.replace('#/' + RMTP.HOME);
        return;
      }
    }

    // Guard DCP Tracker: viewable by everyone except Freelancers
    if (id === 'dcp') {
      const isFreelancer = RMTP.auth && (RMTP.auth.isFreelancer ? RMTP.auth.isFreelancer() : (RMTP.auth.current() && RMTP.auth.current().position === 'Freelancer'));
      if (isFreelancer) {
        if (RMTP.ui && RMTP.ui.toast) {
          RMTP.ui.toast('Access to the DCP Tracker & Cinema QC Console is restricted to staff technicians.', 'info');
        }
        location.replace('#/' + RMTP.HOME);
        return;
      }
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
    if (!location.hash) location.replace('#/' + RMTP.HOME);
    render();
  }

  return { start, render, parse };
})();
