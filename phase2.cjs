const fs = require('fs');
let code = fs.readFileSync('js/views/advancing.js', 'utf8');

// 1. Tabbed Event Modal
// Let's replace the whole bodyHtml construction in openEventModal
// We'll use regex to inject the tab wrappers.

console.log("Applying Phase 2 patches...");

// Replace bodyHtml assignment
const bodyHtmlStart = `const bodyHtml = groupHtml +`;
const replacementBodyHtmlStart = `const bodyHtml = groupHtml +
      '<div class="flex items-center gap-4 mb-4 border-b border-line px-1 overflow-x-auto hide-scrollbar">' +
        '<button data-modal-tab="overview" class="pb-2 text-xs font-semibold text-accent border-b-2 border-accent transition-colors shrink-0">Overview</button>' +
        '<button data-modal-tab="schedule" class="pb-2 text-xs font-semibold text-muted border-b-2 border-transparent hover:text-ink transition-colors shrink-0">Schedule</button>' +
        '<button data-modal-tab="tech" class="pb-2 text-xs font-semibold text-muted border-b-2 border-transparent hover:text-ink transition-colors shrink-0">Tech Specs</button>' +
        '<button data-modal-tab="reports" class="pb-2 text-xs font-semibold text-muted border-b-2 border-transparent hover:text-ink transition-colors shrink-0">Reports</button>' +
      '</div>' +
      '<div id="modal-tab-content-overview" class="modal-tab-content grid sm:grid-cols-2 gap-4">';`;

code = code.replace(bodyHtmlStart, replacementBodyHtmlStart);

// At the end of overview, before schedule:
code = code.replace(
  `'<div class="eyebrow mt-4 mb-2 flex items-center justify-between">' +`,
  `'</div>' + // end overview tab\n      '<div id="modal-tab-content-schedule" class="modal-tab-content hidden grid gap-4">' +\n      '<div class="eyebrow mt-4 mb-2 flex items-center justify-between">' +`
);

// Before tech requirements:
code = code.replace(
  `// Tech Requirements\n        '<div class="eyebrow mt-5 mb-2">Tech Requirements</div>'`,
  `'</div>' + // end schedule tab\n      '<div id="modal-tab-content-tech" class="modal-tab-content hidden grid gap-4">' +\n        // Tech Requirements\n        '<div class="eyebrow mt-5 mb-2">Tech Requirements</div>'`
);

// Before Shift Reports:
code = code.replace(
  `// Shift Reports Section`,
  `'</div>' + // end tech tab\n      '<div id="modal-tab-content-reports" class="modal-tab-content hidden grid gap-4">' +\n        // Shift Reports Section`
);

// At the end of Shift Reports (before footerHtml):
code = code.replace(
  `const footerHtml =`,
  `'</div>'; // end reports tab\n\n    const footerHtml =`
);

// Inject tab listener code
const modalInitCode = `size: 'md:max-w-3xl'\n    });`;
const tabListenerCode = `size: 'md:max-w-3xl'\n    });\n
    m.root.querySelectorAll('[data-modal-tab]').forEach((btn) => {
      btn.addEventListener('click', () => {
        m.root.querySelectorAll('[data-modal-tab]').forEach(b => {
          b.className = 'pb-2 text-xs font-semibold text-muted border-b-2 border-transparent hover:text-ink transition-colors shrink-0';
        });
        btn.className = 'pb-2 text-xs font-semibold text-accent border-b-2 border-accent transition-colors shrink-0';
        m.root.querySelectorAll('.modal-tab-content').forEach(c => c.classList.add('hidden'));
        m.root.querySelector('#modal-tab-content-' + btn.getAttribute('data-modal-tab')).classList.remove('hidden');
      });
    });\n`;
code = code.replace(modalInitCode, tabListenerCode);

// 2. Today & Tomorrow Highlights
// In renderList logic
const finalShownCode = `(finalShown.length ? '<div class="grid gap-3.5">' + finalShown.map(item => item.isGroup ? renderGroupedCard(item) : renderEventCard(item)).join('') + '</div>'\n                         : ui.empty(emptyMsg[0], emptyMsg[1], emptyMsg[2]))`;

const newFinalShownCode = `(finalShown.length ? (() => {
            if (currentTab !== 'upcoming') {
              return '<div class="grid gap-3.5">' + finalShown.map(item => item.isGroup ? renderGroupedCard(item) : renderEventCard(item)).join('') + '</div>';
            }
            
            const now = new Date();
            const todayStr = now.toISOString().slice(0, 10);
            const tomorrow = new Date(now);
            tomorrow.setDate(tomorrow.getDate() + 1);
            const tomorrowStr = tomorrow.toISOString().slice(0, 10);
            
            const isToday = (e) => e.date === todayStr;
            const isTomorrow = (e) => e.date === tomorrowStr;
            const isLater = (e) => e.date > tomorrowStr || !e.date;

            const tdy = finalShown.filter(isToday);
            const tmw = finalShown.filter(isTomorrow);
            const ltr = finalShown.filter(isLater);

            let html = '';
            if (tdy.length) {
              html += '<div class="mb-6"><h3 class="text-xs font-bold uppercase tracking-wider text-accent mb-3 flex items-center gap-2"><span class="w-2 h-2 rounded-full bg-accent animate-pulse"></span>Today</h3><div class="grid gap-3.5">' + tdy.map(item => item.isGroup ? renderGroupedCard(item) : renderEventCard(item)).join('') + '</div></div>';
            }
            if (tmw.length) {
              html += '<div class="mb-6"><h3 class="text-xs font-bold uppercase tracking-wider text-ink mb-3">Tomorrow</h3><div class="grid gap-3.5">' + tmw.map(item => item.isGroup ? renderGroupedCard(item) : renderEventCard(item)).join('') + '</div></div>';
            }
            if (ltr.length) {
              html += '<div><h3 class="text-xs font-bold uppercase tracking-wider text-muted mb-3">Upcoming</h3><div class="grid gap-3.5">' + ltr.map(item => item.isGroup ? renderGroupedCard(item) : renderEventCard(item)).join('') + '</div></div>';
            }
            return html;
          })() : ui.empty(emptyMsg[0], emptyMsg[1], emptyMsg[2]))`;

code = code.replace(finalShownCode, newFinalShownCode);

// 3. Unassigned Shifts Chip
// First, add filter state
code = code.replace(
  `let includeUnassigned = (RMTP._advIncludeUnassigned !== undefined ? RMTP._advIncludeUnassigned : true);`,
  `let includeUnassigned = (RMTP._advIncludeUnassigned !== undefined ? RMTP._advIncludeUnassigned : true);\n  let filterRequiresCrew = (RMTP._advRequiresCrew !== undefined ? RMTP._advRequiresCrew : false);`
);

// Apply filter logic
const filterLogic = `if (filters.space && e.space !== filters.space) return false;`;
const newFilterLogic = `if (filterRequiresCrew) {
        const evTechs = RMTP.eventTechnicians(e);
        const leadId = RMTP.getAdvancingLeadId(e);
        if (evTechs.length > 0 || leadId) return false;
      }\n      if (filters.space && e.space !== filters.space) return false;`;
code = code.replace(filterLogic, newFilterLogic);

// Add to active filter count
code = code.replace(
  `if (!includeUnassigned) activeFilterCount++;`,
  `if (!includeUnassigned) activeFilterCount++;\n  if (filterRequiresCrew) activeFilterCount++;`
);

// Add toggle pill UI
const filterBtnHtml = `'<button id="adv-filter-toggle-btn" class="btn btn-ghost text-xs flex items-center gap-2 border border-line bg-panel2 hover:bg-panel font-medium py-2 px-3 rounded-lg transition shrink-0">' +`;
const newFilterBtnHtml = `(isAdmin ? '<label class="flex items-center gap-1.5 px-3 py-2 rounded-lg border border-line text-xs font-medium cursor-pointer transition select-none ' + (filterRequiresCrew ? 'bg-danger text-white border-danger shadow-2xs' : 'bg-panel2 hover:bg-panel text-ink') + '"><input type="checkbox" id="adv-req-crew-toggle" class="hidden" ' + (filterRequiresCrew ? 'checked' : '') + '> ' + ui.icon('alert', 'w-3.5 h-3.5') + '<span>Requires Crew</span></label>' : '') +
          '<button id="adv-filter-toggle-btn" class="btn btn-ghost text-xs flex items-center gap-2 border border-line bg-panel2 hover:bg-panel font-medium py-2 px-3 rounded-lg transition shrink-0">' +`;
code = code.replace(filterBtnHtml, newFilterBtnHtml);

// Add toggle event listener
const filterBtnEvent = `const filterBtn = el.querySelector('#adv-filter-toggle-btn');`;
const newFilterBtnEvent = `const reqCrewToggle = el.querySelector('#adv-req-crew-toggle');
    if (reqCrewToggle) {
      reqCrewToggle.addEventListener('change', (e) => {
        filterRequiresCrew = RMTP._advRequiresCrew = e.target.checked;
        RMTP.router.render();
      });
    }
    const filterBtn = el.querySelector('#adv-filter-toggle-btn');`;
code = code.replace(filterBtnEvent, newFilterBtnEvent);

// 4. Surface Critical Reports
const renderEventCardStart = `function renderEventCard(ev, groupContext = false) {`;
const newRenderEventCardStart = `function renderEventCard(ev, groupContext = false) {
    const hasReports = store.all('reports').some(r => r.eventId === ev.id);`;
code = code.replace(renderEventCardStart, newRenderEventCardStart);

const eventCardIcons = `(notesCount > 0 ? '<span class="flex items-center gap-0.5 text-muted" title="' + notesCount + ' tech notes">' + ui.icon('file', 'w-3 h-3') + notesCount + '</span>' : '') +`;
const newEventCardIcons = `(notesCount > 0 ? '<span class="flex items-center gap-0.5 text-muted" title="' + notesCount + ' tech notes">' + ui.icon('file', 'w-3 h-3') + notesCount + '</span>' : '') +
        (hasReports ? '<span class="flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[10px] font-bold bg-danger/15 text-danger border border-danger/30" title="Shift reports submitted">' + ui.icon('alert', 'w-3 h-3') + 'Reports</span>' : '') +`;
code = code.replace(eventCardIcons, newEventCardIcons);

fs.writeFileSync('js/views/advancing.js', code);
console.log("Phase 2 complete.");
