const fs = require('fs');
let code = fs.readFileSync('js/views/inventory.js', 'utf8');

// I'll define helpers at the top or inside the inventory scope.
const targetHelpers = `  let selectMode = false;`;
const replacementHelpers = `  let selectMode = false;

  // --- Tracker Persistence Helpers ---
  function takeTrackers(item, qtyToTake) {
    if (!item.unitTrackers) RMTP.qr.ensureItemTrackers(item);
    const trackers = item.unitTrackers || [];
    const taken = trackers.slice(0, qtyToTake);
    const remaining = trackers.slice(qtyToTake);
    return { taken, remaining };
  }
  function mergeTrackers(targetItem, incomingTrackers) {
    if (!targetItem.unitTrackers) RMTP.qr.ensureItemTrackers(targetItem);
    return (targetItem.unitTrackers || []).concat(incomingTrackers || []);
  }`;

code = code.replace(targetHelpers, replacementHelpers);

// Now patch moveQty
const targetMoveQty = `    if (qty >= qtyOf(item)) {
      // whole line moves — merge into destination if one exists, else relocate
      if (target) {
        store.upsert('inventory', Object.assign({}, target, { qty: qtyOf(target) + qtyOf(item), movements: (target.movements || []).concat({ from: item.location || '', to: toLocation, at, by, note: 'Merged ' + qtyOf(item) }) }));
        store.remove('inventory', item.id);
      } else {
        store.upsert('inventory', Object.assign({}, item, { location: toLocation, movements: (item.movements || []).concat({ from: item.location || '', to: toLocation, at, by, note: '' }) }));
      }
    } else {
      // split: reduce source, add to (or create) destination line
      store.upsert('inventory', Object.assign({}, item, { qty: qtyOf(item) - qty, movements: (item.movements || []).concat({ from: item.location || '', to: toLocation, at, by, note: 'Moved ' + qty + ' to ' + toLocation }) }));
      if (target) {
        store.upsert('inventory', Object.assign({}, target, { qty: qtyOf(target) + qty, movements: (target.movements || []).concat({ from: item.location || '', to: toLocation, at, by, note: '+' + qty }) }));
      } else {
        store.upsert('inventory', Object.assign({}, item, { id: store.uid('inv'), qty: qty, location: toLocation, status: 'in', heldBy: '', outAt: '', movements: [{ from: item.location || '', to: toLocation, at, by, note: 'Split ' + qty + ' from ' + (item.location || '\u2014') }] }));
      }
    }`;

const replacementMoveQty = `    if (qty >= qtyOf(item)) {
      // whole line moves — merge into destination if one exists, else relocate
      if (target) {
        store.upsert('inventory', Object.assign({}, target, { qty: qtyOf(target) + qtyOf(item), unitTrackers: mergeTrackers(target, item.unitTrackers), movements: (target.movements || []).concat({ from: item.location || '', to: toLocation, at, by, note: 'Merged ' + qtyOf(item) }) }));
        store.remove('inventory', item.id);
      } else {
        store.upsert('inventory', Object.assign({}, item, { location: toLocation, movements: (item.movements || []).concat({ from: item.location || '', to: toLocation, at, by, note: '' }) }));
      }
    } else {
      // split: reduce source, add to (or create) destination line
      const { taken, remaining } = takeTrackers(item, qty);
      store.upsert('inventory', Object.assign({}, item, { qty: qtyOf(item) - qty, unitTrackers: remaining, movements: (item.movements || []).concat({ from: item.location || '', to: toLocation, at, by, note: 'Moved ' + qty + ' to ' + toLocation }) }));
      if (target) {
        store.upsert('inventory', Object.assign({}, target, { qty: qtyOf(target) + qty, unitTrackers: mergeTrackers(target, taken), movements: (target.movements || []).concat({ from: item.location || '', to: toLocation, at, by, note: '+' + qty }) }));
      } else {
        store.upsert('inventory', Object.assign({}, item, { id: store.uid('inv'), qty: qty, unitTrackers: taken, location: toLocation, status: 'in', heldBy: '', outAt: '', movements: [{ from: item.location || '', to: toLocation, at, by, note: 'Split ' + qty + ' from ' + (item.location || '\u2014') }] }));
      }
    }`;

code = code.replace(targetMoveQty, replacementMoveQty);

// Patch signOutQty
const targetSignOutQty = `    if (qty >= qtyOf(item)) {
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
    } else {
      // source stays in at its location; a new out line carries the moved qty
      store.upsert('inventory', Object.assign({}, item, { qty: qtyOf(item) - qty }));
      const newLine = Object.assign({}, item, {
        id: store.uid('inv'),
        qty: qty,
        previousLocation: loc === 'SERVICE' ? prevLoc : (item.previousLocation || item.location || 'Store A'),
        originLocation: item.originLocation || prevLoc,
        status: loc === 'SERVICE' ? 'service' : 'out',
        heldBy: holder,
        outAt: at,
        location: loc,
        movements: moving ? [{ from: item.location || '', to: dest, at, by, note }] : [],
      });
      store.upsert('inventory', newLine);
      return newLine;
    }`;

const replacementSignOutQty = `    if (qty >= qtyOf(item)) {
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
    } else {
      // source stays in at its location; a new out line carries the moved qty
      const { taken, remaining } = takeTrackers(item, qty);
      store.upsert('inventory', Object.assign({}, item, { qty: qtyOf(item) - qty, unitTrackers: remaining }));
      const newLine = Object.assign({}, item, {
        id: store.uid('inv'),
        qty: qty,
        unitTrackers: taken,
        previousLocation: loc === 'SERVICE' ? prevLoc : (item.previousLocation || item.location || 'Store A'),
        originLocation: item.originLocation || prevLoc,
        status: loc === 'SERVICE' ? 'service' : 'out',
        heldBy: holder,
        outAt: at,
        location: loc,
        movements: moving ? [{ from: item.location || '', to: dest, at, by, note }] : [],
      });
      store.upsert('inventory', newLine);
      return newLine;
    }`;

code = code.replace(targetSignOutQty, replacementSignOutQty);

// Patch signInQty
const targetSignInQty = `    if (qty >= qtyOf(item)) {
      if (target) {
        store.upsert('inventory', Object.assign({}, target, { qty: qtyOf(target) + qtyOf(item), movements: (target.movements || []).concat({ from: item.location || '', to: loc, at, by, note: 'Merged ' + qtyOf(item) + ' (Signed in)' }) }));
        store.remove('inventory', item.id);
      } else {
        store.upsert('inventory', Object.assign({}, item, { status: 'in', location: loc, heldBy: '', outAt: '', movements: (item.movements || []).concat({ from: item.location || '', to: loc, at, by, note }) }));
      }
    } else {
      store.upsert('inventory', Object.assign({}, item, { qty: qtyOf(item) - qty, movements: (item.movements || []).concat({ from: item.location || '', to: loc, at, by, note: 'Signed in ' + qty + ' to ' + loc }) }));
      if (target) {
        store.upsert('inventory', Object.assign({}, target, { qty: qtyOf(target) + qty, movements: (target.movements || []).concat({ from: item.location || '', to: loc, at, by, note: 'Signed in ' + qty }) }));
      } else {
        store.upsert('inventory', Object.assign({}, item, { id: store.uid('inv'), qty: qty, status: 'in', location: loc, heldBy: '', outAt: '', movements: [{ from: item.location || '', to: loc, at, by, note: 'Signed in ' + qty + ' from ' + (item.location || '\u2014') }] }));
      }
    }`;

const replacementSignInQty = `    if (qty >= qtyOf(item)) {
      if (target) {
        store.upsert('inventory', Object.assign({}, target, { qty: qtyOf(target) + qtyOf(item), unitTrackers: mergeTrackers(target, item.unitTrackers), movements: (target.movements || []).concat({ from: item.location || '', to: loc, at, by, note: 'Merged ' + qtyOf(item) + ' (Signed in)' }) }));
        store.remove('inventory', item.id);
      } else {
        store.upsert('inventory', Object.assign({}, item, { status: 'in', location: loc, heldBy: '', outAt: '', movements: (item.movements || []).concat({ from: item.location || '', to: loc, at, by, note }) }));
      }
    } else {
      const { taken, remaining } = takeTrackers(item, qty);
      store.upsert('inventory', Object.assign({}, item, { qty: qtyOf(item) - qty, unitTrackers: remaining, movements: (item.movements || []).concat({ from: item.location || '', to: loc, at, by, note: 'Signed in ' + qty + ' to ' + loc }) }));
      if (target) {
        store.upsert('inventory', Object.assign({}, target, { qty: qtyOf(target) + qty, unitTrackers: mergeTrackers(target, taken), movements: (target.movements || []).concat({ from: item.location || '', to: loc, at, by, note: 'Signed in ' + qty }) }));
      } else {
        store.upsert('inventory', Object.assign({}, item, { id: store.uid('inv'), qty: qty, unitTrackers: taken, status: 'in', location: loc, heldBy: '', outAt: '', movements: [{ from: item.location || '', to: loc, at, by, note: 'Signed in ' + qty + ' from ' + (item.location || '\u2014') }] }));
      }
    }`;

code = code.replace(targetSignInQty, replacementSignInQty);

fs.writeFileSync('js/views/inventory.js', code);
console.log("Patched move/sign-out/sign-in logic for tracker persistence.");
