const fs = require('fs');
let code = fs.readFileSync('js/views/inventory.js', 'utf8');

const target = /async function signInGroup\(items, after\) \{[\s\S]*?(?=async function signIn\(item, after\))/;
const replacement = `async function signInGroup(items, after) {
    if (!items || !items.length) return;
    const first = items[0];
    const totalQty = items.length;
    if (items.some(isFlagged) && !isAdmin) {
      ui.toast('Only an admin can return reported kit to use — resolve it in Maintenance', 'danger');
      if (after) after();
      return;
    }
    const ok = await ui.confirm('Sign ' + (totalQty > 1 ? totalQty + ' × ' : '') + '“' + first.name + '” back in' + (first.heldBy ? ' from ' + first.heldBy : '') + '?',
      { title: 'Sign back in', confirmLabel: 'Sign in' });
    if (!ok) { if (after) after(); return; }

    items.forEach((item) => {
      const fresh = store.find('inventory', item.id);
      if (!fresh) return;
      const at = new Date().toISOString(), by = actor();
      store.upsert('inventory', Object.assign({}, fresh, { 
        status: 'in', 
        heldBy: '', 
        outAt: '',
        movements: (fresh.movements || []).concat({ from: fresh.location || '', to: fresh.location || '', at, by, note: 'Signed in' })
      }));
    });

    ui.toast(first.name + ' back in', 'ok');
    render();
    if (after) after();
  }

  `;

code = code.replace(target, replacement);
fs.writeFileSync('js/views/inventory.js', code);
console.log("Patched signInGroup");
