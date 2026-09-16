const fs = require('fs');
let code = fs.readFileSync('js/views/advancing.js', 'utf8');

const callsToSoftRender = [
  `RMTP._advViewMode = 'list';
    RMTP.router.render();`,
  `RMTP._advViewMode = 'calendar';
    RMTP.router.render();`,
  `RMTP._advFiltersPanelOpen = !filtersPanelOpen;
    RMTP.router.render();`,
  `filters.tab = b.getAttribute('data-adv-tab');
      RMTP.router.render();`,
  `filters.space = b.getAttribute('data-space');
      RMTP.router.render();`,
  `filters.date = dateIn.value; RMTP.router.render();`,
  `filters.date = getTodayString(); RMTP.router.render();`,
  `RMTP._advIncludeUnassigned = true;
    RMTP.router.render();`,
  `RMTP._advTechFilter = Array.from(m.root.querySelectorAll('input[type="checkbox"]:checked')).map(cb => cb.value);
      RMTP._advIncludeUnassigned = m.root.querySelector('#filter-unassigned').checked;
      RMTP.router.render();`
];

callsToSoftRender.forEach((block) => {
  const replacement = block.replace('RMTP.router.render();', 'RMTP._isSoftRender = true; RMTP.router.render(); RMTP._isSoftRender = false;');
  code = code.replace(block, replacement);
});

fs.writeFileSync('js/views/advancing.js', code);
