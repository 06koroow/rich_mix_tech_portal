/* ============================================================
   guides.js — Interactive User Guides & Documentation Center
   ------------------------------------------------------------
   Provides in-app interactive reading, searching, markdown download,
   and clean one-click printable views for all 11 portal pages.
   ============================================================ */
(function () {
  const ui = RMTP.ui;

  const GUIDES_DATA = [
    {
      id: 'dashboard',
      num: '01',
      title: 'Dashboard',
      route: '#/dashboard',
      icon: 'grid',
      filename: '01-dashboard.md',
      audience: 'All Technical Staff',
      summary: 'Venue pulse, today\'s schedule, active duty reports, maintenance alerts, and fast-action shortcuts.',
      category: 'Overview & Handovers'
    },
    {
      id: 'advancing',
      num: '02',
      title: 'Event Advancing',
      route: '#/advancing',
      icon: 'clip',
      filename: '02-advancing.md',
      audience: 'Technical Managers, Senior Techs, Coordinators',
      summary: 'Pre-production specs, soundcheck/doors/curfew timing, multi-technician bookings, live schedules, tech specs, and Artifax sync.',
      category: 'Pre-Production & Production'
    },
    {
      id: 'dcp',
      num: '03',
      title: 'Pre-Screening Tracker & Cinema QC',
      route: '#/dcp',
      icon: 'film',
      filename: '03-pre-screening-tracker.md',
      audience: 'Cinema Technicians, Technical Managers',
      summary: '7-point DCP verification checklist, KDM/CPL validation, technician issues & notes, PDF QC report generation, and client notification emails.',
      category: 'Cinema Exhibition'
    },
    {
      id: 'tasks',
      num: '04',
      title: 'Jobs & Tasks',
      route: '#/tasks',
      icon: 'list',
      filename: '04-jobs-and-tasks.md',
      audience: 'Duty Technicians, Technical Managers',
      summary: 'Operational task queue, priority levels, technician assignments, automated QC follow-ups, and maintenance work orders.',
      category: 'Day-of-Show Operations'
    },
    {
      id: 'rota',
      num: '05',
      title: 'Rota & Shifts',
      route: '#/rota',
      icon: 'calendar',
      filename: '05-rota-and-shifts.md',
      audience: 'All Staff, Freelancers, Technical Managers',
      summary: 'Technical staffing schedules, discipline assignments (Sound, LX, AV, Cinema), confirmation states (Pencil/Confirmed), and Artifax shift sync.',
      category: 'Staffing & Scheduling'
    },
    {
      id: 'presets',
      num: '06',
      title: 'Patch & Preset Manager',
      route: '#/presets',
      icon: 'sliders',
      filename: '06-patch-and-preset-manager.md',
      audience: 'Technical Managers, Senior Sound/LX Techs',
      summary: 'Audio console routing, stagebox channel mapping (Midas S16, Wing), DMX fixture personality profiles, and console presets.',
      category: 'Audio & Lighting Systems'
    },
    {
      id: 'venues',
      num: '07',
      title: 'Venues & Spaces',
      route: '#/venues',
      icon: 'mapPin',
      filename: '07-venues-and-spaces.md',
      audience: 'Technical Managers, Senior Techs, Planners',
      summary: 'Master room profiles (The Stage, Studio, Mix, Screen 1/2/3, Streetside, Foyer), capacities, stage dimensions, basic crew rules, and static kit.',
      category: 'Building & Specifications'
    },
    {
      id: 'maintenance',
      num: '08',
      title: 'Maintenance & Repairs',
      route: '#/maintenance',
      icon: 'wrench',
      filename: '08-maintenance.md',
      audience: 'All Technicians, Technical Managers',
      summary: 'Fault logging, condition tracking, equipment repairs, work orders, parent-child kit splitting, and location restoration upon resolution.',
      category: 'Equipment Upkeep'
    },
    {
      id: 'inventory',
      num: '09',
      title: 'Inventory & Equipment Tracking',
      route: '#/inventory',
      icon: 'box',
      filename: '09-inventory.md',
      audience: 'All Technicians, Technical Managers',
      summary: 'Asset register, QR barcode lookup and scanning, check-in/out, kit displacements between rooms, and movement audit histories.',
      category: 'Asset Management'
    },
    {
      id: 'procedures',
      num: '10',
      title: 'Standard Operating Procedures & H&S',
      route: '#/procedures',
      icon: 'book',
      filename: '10-procedures.md',
      audience: 'All Technicians, Freelancers, Trainees',
      summary: 'Opening/closing checklists, PA/lighting power-up orders, emergency fire evacuation protocols, working at height, and trainer sign-offs.',
      category: 'Health & Safety & SOPs'
    },
    {
      id: 'users',
      num: '11',
      title: 'Users & Permissions',
      route: '#/users',
      icon: 'users',
      filename: '11-users-and-permissions.md',
      audience: 'Technical Managers, Administrators',
      summary: 'Role-Based Access Control (Admin, TM, Senior Tech, Duty Tech, Freelancer), trainer qualification privileges, and user disciplines.',
      category: 'Administration'
    }
  ];

  // In-memory cache of raw markdown texts fetched from docs/user-guides/
  const markdownCache = {};

  async function fetchGuideMarkdown(filename) {
    if (markdownCache[filename]) return markdownCache[filename];
    try {
      const res = await fetch('docs/user-guides/' + filename);
      if (res.ok) {
        const text = await res.text();
        markdownCache[filename] = text;
        return text;
      }
    } catch (e) {
      console.warn('Could not fetch markdown for ' + filename, e);
    }
    return '';
  }

  /* Simple, safe Markdown to formatted HTML parser */
  function renderMarkdownToHtml(md) {
    if (!md) return '<p class="text-muted italic">Documentation content loading...</p>';

    // Escape HTML first for security
    const lines = md.split('\n');
    let html = '';
    let inList = false;
    let inTable = false;
    let tableRows = [];

    function closeList() {
      if (inList) { html += '</ul>'; inList = false; }
    }
    function closeTable() {
      if (inTable) {
        html += '<div class="overflow-x-auto my-3"><table class="w-full text-xs text-left border-collapse border border-line divide-y divide-line">' +
          tableRows.join('') + '</table></div>';
        inTable = false;
        tableRows = [];
      }
    }

    for (let i = 0; i < lines.length; i++) {
      let line = lines[i];

      // Table row
      if (line.trim().startsWith('|') && line.trim().endsWith('|')) {
        closeList();
        if (line.includes('---')) continue; // Skip header divider line
        const cols = line.split('|').slice(1, -1).map(c => c.trim());
        if (!inTable) {
          inTable = true;
          tableRows.push('<tr class="bg-panel2/80 font-bold text-ink border-b border-line">' +
            cols.map(c => '<th class="py-2 px-3 border border-line">' + formatInline(c) + '</th>').join('') + '</tr>');
        } else {
          tableRows.push('<tr class="border-b border-line/60 hover:bg-panel2/30">' +
            cols.map(c => '<td class="py-1.5 px-3 border border-line">' + formatInline(c) + '</td>').join('') + '</tr>');
        }
        continue;
      } else {
        closeTable();
      }

      // Headers
      if (line.startsWith('# ')) {
        closeList();
        html += '<h1 class="text-xl sm:text-2xl font-display font-bold text-ink mt-2 mb-4 pb-2 border-b border-line flex items-center gap-2">' +
          formatInline(line.slice(2)) + '</h1>';
        continue;
      }
      if (line.startsWith('## ')) {
        closeList();
        html += '<h2 class="text-base sm:text-lg font-display font-bold text-accent mt-6 mb-3 pb-1 border-b border-line/50 flex items-center gap-2">' +
          formatInline(line.slice(3)) + '</h2>';
        continue;
      }
      if (line.startsWith('### ')) {
        closeList();
        html += '<h3 class="text-sm font-bold text-ink mt-4 mb-2">' + formatInline(line.slice(4)) + '</h3>';
        continue;
      }

      // Horizontal Rule
      if (line.trim() === '---' || line.trim() === '***') {
        closeList();
        html += '<hr class="border-line my-5" />';
        continue;
      }

      // Blockquotes / Callout Alerts
      if (line.startsWith('> ')) {
        closeList();
        html += '<div class="p-3 my-3 rounded-lg bg-accent/10 border-l-4 border-accent text-ink text-xs leading-relaxed">' +
          formatInline(line.slice(2)) + '</div>';
        continue;
      }

      // Unordered lists
      if (line.trim().startsWith('- ') || line.trim().startsWith('* ')) {
        if (!inList) { html += '<ul class="list-disc list-inside space-y-1.5 my-2 text-xs leading-relaxed text-ink/90">'; inList = true; }
        const itemContent = line.trim().slice(2);
        html += '<li>' + formatInline(itemContent) + '</li>';
        continue;
      }

      // Numbered lists
      const numMatch = line.trim().match(/^(\d+)\.\s+(.*)/);
      if (numMatch) {
        closeList();
        html += '<div class="flex items-start gap-2 my-1.5 text-xs leading-relaxed text-ink/90">' +
          '<span class="font-mono font-bold text-accent shrink-0 mt-0.5">' + numMatch[1] + '.</span>' +
          '<div>' + formatInline(numMatch[2]) + '</div></div>';
        continue;
      }

      // Regular paragraph
      if (line.trim()) {
        closeList();
        html += '<p class="text-xs leading-relaxed text-ink/90 my-2">' + formatInline(line) + '</p>';
      }
    }
    closeList();
    closeTable();

    return html;
  }

  function formatInline(str) {
    return ui.esc(str)
      .replace(/\*\*(.*?)\*\*/g, '<strong class="font-bold text-ink">$1</strong>')
      .replace(/\*(.*?)\*/g, '<em class="italic">$1</em>')
      .replace(/`([^`]+)`/g, '<code class="px-1.5 py-0.5 rounded bg-panel2 text-[11px] font-mono font-semibold text-accent border border-line">$1</code>')
      .replace(/&rarr;/g, '&rarr;')
      .replace(/&plusmn;/g, '&plusmn;')
      .replace(/\[(.*?)\]\((.*?)\)/g, '<a href="$2" class="text-accent underline hover:text-white">$1</a>');
  }

  /* ---- Main View Renderer ---- */
  async function renderGuidesView(el, params) {
    let activeGuideId = (params && params[0]) || 'dashboard';
    let searchQuery = '';

    function getFilteredGuides() {
      const q = searchQuery.toLowerCase().trim();
      if (!q) return GUIDES_DATA;
      return GUIDES_DATA.filter(g =>
        g.title.toLowerCase().includes(q) ||
        g.summary.toLowerCase().includes(q) ||
        g.category.toLowerCase().includes(q) ||
        g.audience.toLowerCase().includes(q)
      );
    }

    async function updateGuideContent() {
      const guide = GUIDES_DATA.find(g => g.id === activeGuideId) || GUIDES_DATA[0];
      const contentPane = el.querySelector('#guide-reader-pane');
      if (!contentPane) return;

      contentPane.innerHTML =
        '<div class="flex items-center justify-center py-16 text-muted gap-2 text-xs">' +
          ui.icon('refresh', 'w-4 h-4 animate-spin') + '<span>Loading user guide documentation...</span>' +
        '</div>';

      const rawMd = await fetchGuideMarkdown(guide.filename);
      const renderedHtml = renderMarkdownToHtml(rawMd);

      contentPane.innerHTML =
        '<div id="printable-guide-document" class="space-y-4">' +
          // Guide Document Action Bar
          '<div class="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-3.5 rounded-xl bg-panel2/60 border border-line no-print">' +
            '<div class="flex items-center gap-2">' +
              '<span class="w-7 h-7 rounded-lg bg-accent/20 text-accent font-mono font-bold text-xs flex items-center justify-center shrink-0">' +
                guide.num +
              '</span>' +
              '<div>' +
                '<div class="font-bold text-sm text-ink">' + ui.esc(guide.title) + '</div>' +
                '<div class="text-[11px] text-muted font-mono">' + ui.esc(guide.route) + ' &middot; ' + ui.esc(guide.audience) + '</div>' +
              '</div>' +
            '</div>' +
            '<div class="flex items-center gap-2 flex-wrap">' +
              '<button type="button" id="btn-print-guide" class="btn btn-ghost !py-1 !px-2.5 text-xs flex items-center gap-1.5 border border-line shadow-2xs font-semibold text-ink" title="Print clean, letterheaded A4 guide">' +
                ui.icon('printer', 'w-3.5 h-3.5 text-accent') + '<span>Print Guide</span>' +
              '</button>' +
              '<button type="button" id="btn-copy-md" class="btn btn-ghost !py-1 !px-2.5 text-xs flex items-center gap-1.5 border border-line shadow-2xs font-semibold text-ink" title="Copy raw Markdown to clipboard">' +
                ui.icon('copy', 'w-3.5 h-3.5') + '<span>Copy .md</span>' +
              '</button>' +
              '<a href="docs/user-guides/' + guide.filename + '" download="' + guide.filename + '" class="btn btn-ghost !py-1 !px-2.5 text-xs flex items-center gap-1.5 border border-line shadow-2xs font-semibold text-accent hover:bg-accent/10" title="Download raw markdown document">' +
                ui.icon('download', 'w-3.5 h-3.5') + '<span>Download</span>' +
              '</a>' +
              '<a href="' + guide.route + '" class="btn btn-primary !py-1 !px-2.5 text-xs font-semibold flex items-center gap-1 shadow-2xs" title="Jump directly to this live portal page">' +
                '<span>Open Page &rarr;</span>' +
              '</a>' +
            '</div>' +
          '</div>' +

          // Rich Mix Printable Header (Visible in print mode)
          '<div class="hidden print-header p-4 mb-4 border-b-2 border-slate-900 flex items-center justify-between">' +
            '<div>' +
              '<div class="font-display font-bold text-lg text-slate-900 tracking-tight">RICH MIX &middot; TECHNICAL PORTAL USER GUIDE</div>' +
              '<div class="text-xs text-slate-600 font-mono">Module ' + guide.num + ': ' + ui.esc(guide.title) + ' &middot; Official Operating Standard</div>' +
            '</div>' +
            '<div class="text-right text-[11px] text-slate-500 font-mono">' +
              '<div>richmix.org.uk</div>' +
              '<div>Bethnal Green Road, London</div>' +
            '</div>' +
          '</div>' +

          // Rendered Markdown Content
          '<article class="prose prose-sm max-w-none text-ink bg-panel p-5 sm:p-6 rounded-xl border border-line shadow-2xs leading-relaxed">' +
            renderedHtml +
          '</article>' +

          // Rich Mix Printable Footer
          '<div class="hidden print-footer pt-4 mt-6 border-t border-slate-300 text-center text-[10px] text-slate-500 font-mono">' +
            'Rich Mix Cultural Foundation &middot; 35-47 Bethnal Green Road, London, E1 6LA &middot; Registered Charity no: 1089163' +
          '</div>' +
        '</div>';

      // Attach Guide Action Listeners
      const btnPrint = contentPane.querySelector('#btn-print-guide');
      if (btnPrint) {
        btnPrint.addEventListener('click', () => {
          window.print();
        });
      }

      const btnCopy = contentPane.querySelector('#btn-copy-md');
      if (btnCopy) {
        btnCopy.addEventListener('click', async () => {
          try {
            await navigator.clipboard.writeText(rawMd);
            ui.toast('Copied ' + guide.filename + ' to clipboard', 'ok');
          } catch (e) {
            ui.toast('Failed to copy text', 'danger');
          }
        });
      }
    }

    function renderView() {
      const filtered = getFilteredGuides();
      const activeGuide = GUIDES_DATA.find(g => g.id === activeGuideId) || GUIDES_DATA[0];

      el.innerHTML =
        '<div class="space-y-4 max-w-7xl mx-auto">' +
          // Header Bar
          '<div class="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-2 border-b border-line no-print">' +
            '<div>' +
              '<h1 class="text-xl sm:text-2xl font-display font-bold text-ink flex items-center gap-2">' +
                ui.icon('book', 'w-6 h-6 text-accent') + '<span>User Guides &amp; Operational Manuals</span>' +
              '</h1>' +
              '<p class="text-xs text-muted mt-0.5">' +
                'One comprehensive operational and reference guide per application page. Formatted for screen reading and printable A4 handouts.' +
              '</p>' +
            '</div>' +
            '<div class="flex items-center gap-2">' +
              '<div class="relative w-full sm:w-64">' +
                '<input type="text" id="guides-search-input" value="' + ui.esc(searchQuery) + '" placeholder="Search guides, tools, roles..." class="field !py-1.5 !pl-8 !pr-3 !text-xs w-full bg-panel text-ink" />' +
                '<span class="absolute left-2.5 top-2.5 text-muted pointer-events-none">' + ui.icon('search', 'w-3.5 h-3.5') + '</span>' +
              '</div>' +
            '</div>' +
          '</div>' +

          // Main Layout: 2 Columns (Sidebar Guide Directory + Active Reader)
          '<div class="grid grid-cols-1 lg:grid-cols-12 gap-4 items-start">' +
            // Sidebar: Directory (lg:col-span-4)
            '<div class="lg:col-span-4 space-y-2 no-print">' +
              '<div class="text-[11px] font-mono font-bold uppercase tracking-wider text-muted px-1 flex items-center justify-between">' +
                '<span>Modules Directory (' + filtered.length + ')</span>' +
                '<span>11 Pages</span>' +
              '</div>' +
              '<div class="space-y-1.5 max-h-[calc(100vh-220px)] overflow-y-auto pr-1">' +
                filtered.map(g => {
                  const isSel = g.id === activeGuideId;
                  return (
                    '<button type="button" data-guide-tab="' + g.id + '" class="w-full text-left p-2.5 rounded-xl border transition-all flex items-start gap-2.5 ' +
                      (isSel
                        ? 'bg-accent/15 border-accent/60 shadow-2xs ring-1 ring-accent/40'
                        : 'bg-panel border-line hover:border-line-hi hover:bg-panel2/60') + '">' +
                      '<span class="w-6 h-6 rounded-md font-mono font-bold text-[11px] flex items-center justify-center shrink-0 mt-0.5 ' +
                        (isSel ? 'bg-accent text-accent-ink font-bold' : 'bg-panel2 text-muted border border-line') + '">' +
                        g.num +
                      '</span>' +
                      '<div class="min-w-0 flex-1">' +
                        '<div class="flex items-center justify-between gap-1">' +
                          '<span class="font-bold text-xs truncate ' + (isSel ? 'text-accent' : 'text-ink') + '">' + ui.esc(g.title) + '</span>' +
                          '<span class="text-[9px] font-mono text-muted uppercase shrink-0">' + ui.esc(g.category.split(' ')[0]) + '</span>' +
                        '</div>' +
                        '<div class="text-[11px] text-muted truncate mt-0.5">' + ui.esc(g.summary) + '</div>' +
                        '<div class="text-[10px] text-muted/80 font-mono mt-1">' + ui.esc(g.route) + '</div>' +
                      '</div>' +
                    '</button>'
                  );
                }).join('') +
              '</div>' +
            '</div>' +

            // Main Reader Pane (lg:col-span-8)
            '<div id="guide-reader-pane" class="lg:col-span-8 min-w-0">' +
              // Filled asynchronously by updateGuideContent()
            '</div>' +
          '</div>' +
        '</div>';

      // Event Listeners
      const searchInput = el.querySelector('#guides-search-input');
      if (searchInput) {
        searchInput.addEventListener('input', (e) => {
          searchQuery = e.target.value;
          renderView();
          // refocus and keep cursor at end
          const newInp = el.querySelector('#guides-search-input');
          if (newInp) {
            newInp.focus();
            newInp.setSelectionRange(newInp.value.length, newInp.value.length);
          }
        });
      }

      el.querySelectorAll('[data-guide-tab]').forEach(btn => {
        btn.addEventListener('click', () => {
          const id = btn.getAttribute('data-guide-tab');
          if (id === activeGuideId) return;
          activeGuideId = id;
          location.hash = '#/guides/' + id;
          renderView();
        });
      });

      updateGuideContent();
    }

    renderView();
  }

  // Register view on RMTP.views
  RMTP.views.guides = renderGuidesView;

  /* Global helper to open a specific guide modal from any page in the portal */
  RMTP.openGuideModal = function (guideId) {
    location.hash = '#/guides/' + (guideId || 'dashboard');
  };
})();
