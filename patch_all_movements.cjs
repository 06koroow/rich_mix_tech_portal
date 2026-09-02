const fs = require('fs');
let code = fs.readFileSync('js/views/inventory.js', 'utf8');

const moveQtyTarget = /function moveQty\(item, qty, toLocation\) \{[\s\S]*?(?=function handleScan)/;
const moveQtyReplacement = `function moveQty(item, qty, toLocation) {
    const at = new Date().toISOString(), by = actor();
    store.upsert('inventory', Object.assign({}, item, {
      location: toLocation,
      movements: (item.movements || []).concat({ from: item.location || '', to: toLocation, at, by, note: '' })
    }));
  }

  /* ---- Scan → resolve item(s) → open the kit piece detail view ---- */
  `;
code = code.replace(moveQtyTarget, moveQtyReplacement);

const signOutQtyTarget = /function signOutQty\(item, qty, holder, dest\) \{[\s\S]*?(?=function signOut\(item, after\))/;
const signOutQtyReplacement = `function signOutQty(item, qty, holder, dest) {
    const at = new Date().toISOString(), by = actor();
    const moving = dest && dest !== item.location;
    const loc = moving ? dest : item.location;
    const note = 'Signed out to ' + holder;
    const prevLoc = item.location && item.location !== 'SERVICE' ? item.location : (item.previousLocation || item.originLocation || 'Store A');
    
    const updated = Object.assign({}, item, {
      previousLocation: loc === 'SERVICE' ? prevLoc : (item.previousLocation || item.location || 'Store A'),
      originLocation: item.originLocation || prevLoc,
      status: loc === 'SERVICE' ? 'service' : 'out',
      heldBy: holder,
      outAt: at,
      location: loc,
      movements: moving ? (item.movements || []).concat({ from: item.location || '', to: dest, at, by, note }) : (item.movements || []),
    });
    store.upsert('inventory', updated);
    return updated;
  }

  `;
code = code.replace(signOutQtyTarget, signOutQtyReplacement);


const signInGroupTarget = /items\.forEach\(\(item\) => \{[\s\S]*?\}\);/;
const signInGroupReplacement = `items.forEach((item) => {
      const fresh = store.find('inventory', item.id);
      if (!fresh) return;
      store.upsert('inventory', Object.assign({}, fresh, { status: 'in', heldBy: '', outAt: '' }));
    });`;

if (code.includes('items.forEach((item) => {')) {
  // It's safer to just replace signInGroup entirely. Let's do that.
}
