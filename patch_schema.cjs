const fs = require('fs');
let code = fs.readFileSync('js/views/advancing.js', 'utf8');

const targetHtml = `'</pre>' +
        '</div>'
      ) : '';`;

const replacementHtml = `'</pre>' +
          '<div class="mt-2 text-right">' +
            '<button type="button" id="sync-retry-schema-btn" class="btn border border-line !py-1 text-xs bg-panel hover:bg-panel2 font-semibold">I have run this, reload schema cache</button>' +
          '</div>' +
        '</div>'
      ) : '';`;

code = code.replace(targetHtml, replacementHtml);

const targetDrainBtn = `const drainBtn = m.root.querySelector('#sync-drain-btn');`;

const replacementDrainBtn = `const retrySchemaBtn = m.root.querySelector('#sync-retry-schema-btn');
    if (retrySchemaBtn) {
      retrySchemaBtn.addEventListener('click', () => {
        try {
          if (window.localStorage) {
            localStorage.removeItem('sb_unsupported_cols');
            localStorage.removeItem('sb_unsupported_tables');
          }
        } catch(e) {}
        ui.toast('Schema cache cleared, reloading...', 'info');
        setTimeout(() => window.location.reload(), 500);
      });
    }

    const drainBtn = m.root.querySelector('#sync-drain-btn');`;

code = code.replace(targetDrainBtn, replacementDrainBtn);

fs.writeFileSync('js/views/advancing.js', code);
console.log("Patched schema reload");
