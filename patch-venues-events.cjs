const fs = require('fs');
let code = fs.readFileSync('js/views/venues.js', 'utf8');

const injection = `
    const btnAddSpace = m.root.querySelector('#btn-add-space');
    if (btnAddSpace) {
      btnAddSpace.addEventListener('click', () => {
        const name = prompt('Enter name for the new space:');
        if (name && name.trim()) {
          const newName = name.trim();
          if (RMTP.SPACES.indexOf(newName) === -1) {
            RMTP.SPACES.push(newName);
            RMTP.SPACES.sort();
            RMTP.LOCATIONS = RMTP.SPACES.concat(RMTP.STORES || []);
            m.activeSpace = newName;
            loadVenueData(); // creates the default store entry
            store.upsert('venues', m.venueData);
            ui.toast('Space added: ' + newName, 'ok');
            render();
          } else {
            ui.toast('Space already exists', 'danger');
          }
        }
      });
    }

    const btnDeleteSpace = m.root.querySelector('#btn-delete-space');
    if (btnDeleteSpace) {
      btnDeleteSpace.addEventListener('click', () => {
        if (!m.activeSpace) return;
        const confirmName = prompt('WARNING: You are about to delete the space "' + m.activeSpace + '".\\nThis cannot be undone. Type the name of the space exactly to confirm:');
        if (confirmName === m.activeSpace) {
          store.remove('venues', m.activeSpace);
          const idx = RMTP.SPACES.indexOf(m.activeSpace);
          if (idx > -1) {
            RMTP.SPACES.splice(idx, 1);
            RMTP.LOCATIONS = RMTP.SPACES.concat(RMTP.STORES || []);
          }
          ui.toast('Space deleted: ' + m.activeSpace, 'ok');
          m.activeSpace = null;
          render();
        } else if (confirmName !== null) {
          ui.toast('Deletion cancelled: Space name did not match', 'danger');
        }
      });
    }

    const saveBtn = m.root.querySelector('#btn-save-venue');
`;

code = code.replace(/    const saveBtn = m\.root\.querySelector\('#btn-save-venue'\);/, injection);

fs.writeFileSync('js/views/venues.js', code);
console.log("Patched venues events");
