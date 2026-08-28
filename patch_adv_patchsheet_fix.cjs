const fs = require('fs');
let code = fs.readFileSync('js/views/advancing.js', 'utf8');

const targetBtn = `    // Stagebox Patch Sheet button
    const btnOpenPatchSheet = m.root.querySelector('#btn-open-patch-sheet-builder');
    if (btnOpenPatchSheet) {
      btnOpenPatchSheet.addEventListener('click', () => {
        // Auto-save the event to ensure patch sheet builder pulls the latest channel list
        const saveBtn = m.root.querySelector('#modal-save-btn');
        if (saveBtn) {
          saveBtn.click(); // Triggers the save function which updates the DB
        }

        setTimeout(() => {
          const allSheets = RMTP.presets.getAllPatchSheets();
          const existingForEvent = (ev && ev.id) ? allSheets.find((s) => s.eventId === ev.id) : null;
          if (existingForEvent) {
            RMTP.presets.openPatchSheetModal(existingForEvent);
          } else {
            RMTP.presets.openPatchSheetModal({
              id: null,
              name: (ev && ev.name ? ev.name + ' — Stagebox Patch Plan' : 'Event Patch Sheet'),
              eventId: (ev && ev.id) || null,
              eventName: (ev && ev.name) || '',
              space: (ev && (ev.space || (spaceSelect && spaceSelect.value))) || 'The Stage',
              date: (ev && ev.date) || new Date().toISOString().slice(0, 10),
              notes: (ev && ev.techInfo) || ''
            });
          }
        }, 100);
      });
    }`;

const replacementBtn = `    // Stagebox Patch Sheet button
    const btnOpenPatchSheet = m.root.querySelector('#btn-open-patch-sheet-builder');
    if (btnOpenPatchSheet) {
      btnOpenPatchSheet.addEventListener('click', () => {
        // Auto-save the event to ensure patch sheet builder pulls the latest channel list
        const saveBtn = m.root.querySelector('[data-save]');
        if (saveBtn) {
          saveBtn.click(); // Triggers the save function which updates the DB
        }

        setTimeout(() => {
          const allSheets = RMTP.presets.getAllPatchSheets();
          const existingForEvent = (ev && ev.id) ? allSheets.find((s) => s.eventId === ev.id) : null;
          if (existingForEvent) {
            RMTP.presets.openPatchSheetModal(existingForEvent);
          } else {
            RMTP.presets.openPatchSheetModal({
              id: null,
              name: (ev && ev.name ? ev.name + ' — Stagebox Patch Plan' : 'Event Patch Sheet'),
              eventId: (ev && ev.id) || null,
              eventName: (ev && ev.name) || '',
              space: (ev && (ev.space || (spaceSelect && spaceSelect.value))) || 'The Stage',
              date: (ev && ev.date) || new Date().toISOString().slice(0, 10),
              notes: (ev && ev.techInfo) || ''
            });
          }
        }, 200);
      });
    }`;

if (code.includes(targetBtn)) {
  code = code.replace(targetBtn, replacementBtn);
  fs.writeFileSync('js/views/advancing.js', code);
  console.log("Patched data-save in advancing.js");
} else {
  console.log("Could not find btnOpenPatchSheet in advancing.js (already modified?)");
}
