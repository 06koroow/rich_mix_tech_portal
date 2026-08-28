const fs = require('fs');
let code = fs.readFileSync('js/views/presets.js', 'utf8');

const injection = `
      container.querySelectorAll('[data-out-dest]').forEach((inp) => {
        inp.addEventListener('input', () => {
          const [sbIdx, outIdx] = inp.getAttribute('data-out-dest').split('-').map(Number);
          sheet.stageboxes[sbIdx].outputs[outIdx].destination = inp.value;
        });
      });
      container.querySelectorAll('[data-out-hr]').forEach((sel) => {
        sel.addEventListener('change', () => {
          const [sbIdx, outIdx] = sel.getAttribute('data-out-hr').split('-').map(Number);
          sheet.stageboxes[sbIdx].outputs[outIdx].homeRunCh = sel.value ? parseInt(sel.value, 10) : null;
          renderStageboxes();
        });
      });
`;

code = code.replace(
  /      container\.querySelectorAll\('\[data-ch-hr\]'\)\.forEach\(\(sel\) => \{/,
  injection + "      container.querySelectorAll('[data-ch-hr]').forEach((sel) => {"
);

fs.writeFileSync('js/views/presets.js', code);
console.log("Injected listeners.");
