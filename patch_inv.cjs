const fs = require('fs');
let code = fs.readFileSync('js/views/inventory.js', 'utf8');

// 1. Patch openForm
const openFormTarget = `      const record = Object.assign({}, r, {
        id: r.id || store.uid('inv'),
        tag: m.root.querySelector('#i-tag').value.trim(),
        name: name,
        category: m.root.querySelector('#i-category').value,
        condition: m.root.querySelector('#i-condition').value,
        location: newLocation,
        homeLocation: m.root.querySelector('#i-home-location').value || newLocation,
        qty: Number(m.root.querySelector('#i-qty').value) || 0,
        notes: m.root.querySelector('#i-notes').value.trim(),
        static: m.root.querySelector('#i-static').checked,
        status: r.status || 'in',
        movements: movements,
      });
      store.upsert('inventory', record);`;

const openFormReplacement = `      const isNew = !r.id;
      const targetQty = Number(m.root.querySelector('#i-qty').value) || 1;
      const baseTag = m.root.querySelector('#i-tag').value.trim();
      const sharedData = {
        name: name,
        category: m.root.querySelector('#i-category').value,
        condition: m.root.querySelector('#i-condition').value,
        location: newLocation,
        homeLocation: m.root.querySelector('#i-home-location').value || newLocation,
        notes: m.root.querySelector('#i-notes').value.trim(),
        static: m.root.querySelector('#i-static').checked,
        status: r.status || 'in',
        movements: movements,
      };

      if (isNew && targetQty > 1) {
        for (let i = 1; i <= targetQty; i++) {
          const suffix = '-' + String(i).padStart(2, '0');
          store.upsert('inventory', Object.assign({}, r, sharedData, {
            id: store.uid('inv'),
            tag: baseTag ? baseTag + suffix : '',
            qty: 1
          }));
        }
      } else {
        store.upsert('inventory', Object.assign({}, r, sharedData, {
          id: r.id || store.uid('inv'),
          tag: baseTag,
          qty: isNew ? 1 : targetQty // Preserve existing qty if they didn't migrate
        }));
      }`;

code = code.replace(openFormTarget, openFormReplacement);

fs.writeFileSync('js/views/inventory.js', code);
console.log("Patched openForm");
