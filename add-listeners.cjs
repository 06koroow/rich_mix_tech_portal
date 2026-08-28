const fs = require('fs');
let code = fs.readFileSync('js/views/presets.js', 'utf8');

const injectionPoint = 'setStep(currentStep);';

const injectionCode = `
    const spSelect = m.root.querySelector('#ps-space');
    if (spSelect) {
      spSelect.addEventListener('change', () => {
        sheet.space = spSelect.value;
        if (confirm('Pull Room I/O and Stagebox configuration from ' + spSelect.value + ' venue settings? (This will overwrite current Home Run setup)')) {
          applyVenueRoomIO(spSelect.value, true);
          ui.toast('Applied Venue I/O defaults for ' + spSelect.value, 'ok');
        }
      });
    }

    const loadRoomBtn = m.root.querySelector('#btn-save-room-io');
    if (loadRoomBtn) {
      loadRoomBtn.addEventListener('click', () => {
        sheet.space = m.root.querySelector('#ps-space').value || 'The Stage';
        if (confirm('Overwrite current Home Run and Stagebox setup with ' + sheet.space + ' venue defaults?')) {
          applyVenueRoomIO(sheet.space, true);
          ui.toast('Pulled Venue I/O defaults', 'ok');
        }
      });
    }

    setStep(currentStep);`;

if (code.includes(injectionPoint)) {
  if (code.includes('applyVenueRoomIO(spSelect.value, true)')) {
    console.log("Already injected.");
  } else {
    code = code.replace(injectionPoint, injectionCode);
    fs.writeFileSync('js/views/presets.js', code);
    console.log("Listeners added!");
  }
} else {
  console.log("Injection point not found.");
}
