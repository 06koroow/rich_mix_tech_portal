const fs = require('fs');
let code = fs.readFileSync('js/views/inventory.js', 'utf8');

const regexMoveQty = /function moveQty\(item, qty, toLocation\) \{[\s\S]*?(?=function handleScan)/;

const newMovementLogic = `function moveQty(item, qty, toLocation) {
    const at = new Date().toISOString(), by = actor();
    store.upsert('inventory', Object.assign({}, item, {
      location: toLocation,
      movements: (item.movements || []).concat({ from: item.location || '', to: toLocation, at, by, note: '' })
    }));
  }

  /* ---- Scan → resolve item(s) → open the kit piece detail view ---- */
  `;

// Let's check where handleScan actually starts
