const fs = require('fs');
let content = fs.readFileSync('js/views/presets.js', 'utf8');

content = content.replace(
  /'<button type="button" data-sb-add-ch="' \+ sbIdx \+ '" class="btn btn-ghost !py-1 !px-2 text-xs text-accent font-semibold flex items-center gap-1">' \+\n\s*ui\.icon\('plus', 'w-3 h-3'\) \+ '<span>Add Socket<\/span>' \+\n\s*'<\/button>' \+/,
  `'<button type="button" data-sb-add-ch="' + sbIdx + '" class="btn btn-ghost !py-1 !px-2 text-xs text-accent font-semibold flex items-center gap-1" title="Add Input Socket">' +
                  ui.icon('plus', 'w-3 h-3') + '<span>In</span>' +
                '</button>' +
                '<button type="button" data-sb-add-out="' + sbIdx + '" class="btn btn-ghost !py-1 !px-2 text-xs text-accent font-semibold flex items-center gap-1" title="Add Output Socket">' +
                  ui.icon('plus', 'w-3 h-3') + '<span>Out</span>' +
                '</button>' +`
);

content = content.replace(
  /(\s*container\.querySelectorAll\('\[data-sb-add-ch\]'\)\.forEach\(\(btn\) => \{[\s\S]*?\}\);\n\s*\}\);)/,
  `$1
      container.querySelectorAll('[data-sb-add-out]').forEach((btn) => {
        btn.addEventListener('click', () => {
          const idx = +btn.getAttribute('data-sb-add-out');
          const box = sheet.stageboxes[idx];
          if (!box.outputs) box.outputs = [];
          box.outputs.push({
            socket: box.outputs.length + 1,
            destination: '',
            homeRunCh: null
          });
          renderStageboxes();
        });
      });`
);

fs.writeFileSync('js/views/presets.js', content);
