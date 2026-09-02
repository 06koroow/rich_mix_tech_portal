const fs = require('fs');
let code = fs.readFileSync('js/views/inventory.js', 'utf8');

const target = `          const tagChipsHtml = grp.tags.length
            ? grp.tags.map((t) => '<span class="tabular text-xs text-accent font-mono inline-flex items-center px-1.5 py-0.5 rounded bg-accent/10 border border-accent/20 font-medium">' + ui.esc(t) + '</span>').join(' ')
            : '';`;

const replacement = `          let tagChipsHtml = '';
          if (grp.tags.length) {
            const previewTags = grp.tags.slice(0, 4);
            const extraCount = grp.tags.length - 4;
            tagChipsHtml = previewTags.map((t) => '<span class="tabular text-xs text-accent font-mono inline-flex items-center px-1.5 py-0.5 rounded bg-accent/10 border border-accent/20 font-medium">' + ui.esc(t) + '</span>').join(' ');
            if (extraCount > 0) {
              tagChipsHtml += ' <span class="tabular text-xs text-muted font-medium inline-flex items-center px-1.5 py-0.5 rounded bg-panel2 border border-line">[+' + extraCount + ' more]</span>';
            }
          }`;

if (code.includes(target)) {
  code = code.replace(target, replacement);
  fs.writeFileSync('js/views/inventory.js', code);
  console.log("Patched renderList");
} else {
  console.log("Could not find target in renderList");
}
