const fs = require('fs');
let code = fs.readFileSync('js/views/advancing.js', 'utf8');

code = code.replace(/RMTP\._isSearching \?/g, 'RMTP._isSoftRender ?');
code = code.replace(/RMTP\._isSearching =/g, 'RMTP._isSoftRender =');

const targetFilterToggle = `  const filterToggleBtn = el.querySelector('#adv-filter-toggle-btn');
  if (filterToggleBtn) filterToggleBtn.addEventListener('click', () => {
    RMTP._advFiltersPanelOpen = !filtersPanelOpen;
    RMTP.router.render();
  });`;

const replaceFilterToggle = `  const filterToggleBtn = el.querySelector('#adv-filter-toggle-btn');
  if (filterToggleBtn) filterToggleBtn.addEventListener('click', () => {
    RMTP._advFiltersPanelOpen = !filtersPanelOpen;
    RMTP._isSoftRender = true;
    RMTP.router.render();
    RMTP._isSoftRender = false;
  });`;

code = code.replace(targetFilterToggle, replaceFilterToggle);

fs.writeFileSync('js/views/advancing.js', code);
