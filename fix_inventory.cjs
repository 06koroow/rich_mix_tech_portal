const fs = require('fs');
let code = fs.readFileSync('js/views/inventory.js', 'utf8');

const regex = /function renderSetupCategories\(\) \{[\s\S]*?function openForm\(existing\)/;
const replacement = `function renderSetupCategories() {
    const renderList = (container) => {
      const all = getCategories();
      const html = all.map(c => 
        '<div class="flex items-center justify-between p-2 border border-line rounded bg-panel">' +
          '<input type="text" class="field !py-1 !px-2 flex-1 mr-2 bg-transparent hover:border-line focus:bg-panel2" value="' + ui.esc(c) + '" data-old-cat="' + ui.esc(c) + '" />' +
          '<button class="btn btn-ghost text-danger !p-1" data-del-cat="' + ui.esc(c) + '" title="Remove from all items">' + ui.icon('x', 'w-4 h-4') + '</button>' +
        '</div>'
      ).join('');
      container.innerHTML = html || '<div class="text-muted text-sm italic">No categories found.</div>';
      
      container.querySelectorAll('input[data-old-cat]').forEach(inp => {
        inp.addEventListener('change', () => {
          const old = inp.getAttribute('data-old-cat');
          const nu = inp.value.trim();
          if (nu && nu !== old) {
            let updated = 0;
            store.all('inventory').forEach(it => {
              if (it.category === old) {
                it.category = nu;
                store.upsert('inventory', it);
                updated++;
              }
            });
            if (updated > 0) ui.toast('Updated ' + updated + ' items to ' + nu, 'ok');
            renderList(container);
            render();
          }
        });
      });
      container.querySelectorAll('button[data-del-cat]').forEach(btn => {
        btn.addEventListener('click', () => {
          const cat = btn.getAttribute('data-del-cat');
          if (confirm('Reassign all items in "' + cat + '" to "Other"?')) {
            let updated = 0;
            store.all('inventory').forEach(it => {
              if (it.category === cat) {
                it.category = 'Other';
                store.upsert('inventory', it);
                updated++;
              }
            });
            if (updated > 0) ui.toast('Reassigned ' + updated + ' items to Other', 'ok');
            renderList(container);
            render();
          }
        });
      });
    };

    const modal = ui.modal({
      title: 'Setup Categories',
      size: 'md:max-w-md',
      body:
        '<p class="text-xs text-muted mb-4">Categories are automatically generated from your inventory list. Renaming or deleting here will apply to all existing items.</p>' +
        '<div class="space-y-2 max-h-96 overflow-y-auto" id="cat-list"></div>',
      actions: [ { label: 'Done', type: 'ghost', click: () => { modal.close(); render(); } } ]
    });
    
    const container = modal.root.querySelector('#cat-list');
    renderList(container);
  }

  function openForm(existing)`;

code = code.replace(regex, replacement);
fs.writeFileSync('js/views/inventory.js', code);
