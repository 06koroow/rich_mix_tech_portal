const fs = require('fs');
let code = fs.readFileSync('js/views/advancing.js', 'utf8');

// 1. Add quickSearch state
code = code.replace(
  /let filtersPanelOpen = \(RMTP\._advFiltersPanelOpen !== undefined \? RMTP\._advFiltersPanelOpen : false\);/,
  "let filtersPanelOpen = (RMTP._advFiltersPanelOpen !== undefined ? RMTP._advFiltersPanelOpen : false);\n  let quickSearch = RMTP._advQuickSearch || '';"
);

// 2. Filter shown array
code = code.replace(
  /\.filter\(\(e\) => \(\!filters\.space \|\| e\.space === filters\.space\) && \(\!filters\.date \|\| e\.date === filters\.date\)\)/,
  `.filter((e) => {
      if (filters.space && e.space !== filters.space) return false;
      if (filters.date && e.date !== filters.date) return false;
      if (quickSearch) {
        const q = quickSearch.toLowerCase();
        const evName = (e.name || '').toLowerCase();
        const evSpace = (e.space || '').toLowerCase();
        const evDate = (e.date ? ui.formatDate(e.date).toLowerCase() : '');
        if (!evName.includes(q) && !evSpace.includes(q) && !evDate.includes(q)) {
          return false;
        }
      }
      return true;
    })`
);

// 3. Inject quick search input html
const oldHtml = `      // Top Control Bar: Collapsible Filter Menu Trigger (Left) + Add Event Button (Right)
      '<div class="flex items-center justify-between gap-3 mb-4">' +
        '<button id="adv-filter-toggle-btn" class="btn btn-ghost text-xs flex items-center gap-2 border border-line bg-panel2 hover:bg-panel font-medium py-2 px-3 rounded-lg transition">' +
          ui.icon('filter', 'w-3.5 h-3.5 text-accent') +
          '<span>Filters & Crew</span>' +
          (activeFilterCount > 0 ? '<span class="px-1.5 py-0.2 rounded-full text-[10px] bg-accent text-accent-ink font-bold">' + activeFilterCount + '</span>' : '') +
          '<span class="text-muted transition-transform ' + (filtersPanelOpen ? 'rotate-180 text-accent' : '') + '">' + ui.icon('arrowD', 'w-3.5 h-3.5') + '</span>' +
        '</button>' +
        (canManageEvents ? '<button id="add-event" class="btn btn-primary text-xs py-2 px-3 flex items-center gap-1.5">' + ui.icon('plus', 'w-4 h-4') + 'Add event</button>' : '') +
      '</div>' +`;

const newHtml = `      // Top Control Bar: Search Input (Mobile) + Collapsible Filter Menu Trigger (Left) + Add Event Button (Right)
      '<div class="flex flex-col md:flex-row md:items-center justify-between gap-3 mb-4">' +
        '<div class="flex items-center w-full md:hidden bg-panel border border-line rounded-lg px-3 py-1 shadow-xs">' +
          ui.icon('search', 'w-4 h-4 text-muted') +
          '<input type="text" id="adv-quick-search-mobile" class="field flex-1 border-none shadow-none bg-transparent focus:ring-0 text-sm ml-2" placeholder="Search events..." value="' + ui.esc(quickSearch) + '">' +
        '</div>' +
        '<div class="flex items-center justify-between md:justify-start gap-3 w-full">' +
          '<button id="adv-filter-toggle-btn" class="btn btn-ghost text-xs flex items-center gap-2 border border-line bg-panel2 hover:bg-panel font-medium py-2 px-3 rounded-lg transition shrink-0">' +
            ui.icon('filter', 'w-3.5 h-3.5 text-accent') +
            '<span>Filters & Crew</span>' +
            (activeFilterCount > 0 ? '<span class="px-1.5 py-0.2 rounded-full text-[10px] bg-accent text-accent-ink font-bold">' + activeFilterCount + '</span>' : '') +
            '<span class="text-muted transition-transform ' + (filtersPanelOpen ? 'rotate-180 text-accent' : '') + '">' + ui.icon('arrowD', 'w-3.5 h-3.5') + '</span>' +
          '</button>' +
          '<div class="hidden md:flex items-center bg-panel border border-line rounded-lg px-3 py-1 shadow-xs max-w-xs">' +
            ui.icon('search', 'w-4 h-4 text-muted') +
            '<input type="text" id="adv-quick-search-desktop" class="field border-none shadow-none bg-transparent focus:ring-0 text-sm ml-2" placeholder="Search events..." value="' + ui.esc(quickSearch) + '">' +
          '</div>' +
          (canManageEvents ? '<button id="add-event" class="btn btn-primary text-xs py-2 px-3 flex items-center gap-1.5 shrink-0 ml-auto">' + ui.icon('plus', 'w-4 h-4') + '<span class="hidden sm:inline">Add event</span></button>' : '') +
        '</div>' +
      '</div>' +`;

code = code.replace(oldHtml, newHtml);

// 4. Add event listener
code = code.replace(
  /const filterToggleBtn = m\.root\.querySelector\('#adv-filter-toggle-btn'\);/,
  `['#adv-quick-search-mobile', '#adv-quick-search-desktop'].forEach(sel => {
      const searchInp = m.root.querySelector(sel);
      if (searchInp) {
        searchInp.addEventListener('input', () => {
          RMTP._advQuickSearch = searchInp.value;
          render();
        });
      }
    });
    
    const filterToggleBtn = m.root.querySelector('#adv-filter-toggle-btn');`
);

fs.writeFileSync('js/views/advancing.js', code);
console.log('Patched Quick Search!');
