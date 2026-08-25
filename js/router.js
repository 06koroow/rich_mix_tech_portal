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
    const id = RMTP.views[view] ? view : RMTP.HOME;
    const content = document.getElementById('content');
    if (!content) return;

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

    content.scrollTop = 0;
    window.scrollTo(0, 0);
  }

  function start() {
    window.addEventListener('hashchange', render);
    if (!location.hash) location.replace('#/' + RMTP.HOME);
    render();
  }

  return { start, render, parse };
})();
