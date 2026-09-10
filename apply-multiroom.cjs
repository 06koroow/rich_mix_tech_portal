const fs = require('fs');
let code = fs.readFileSync('js/views/advancing.js', 'utf8');

// Edit 1: UI HTML
const search1 = `'<select id="e-space" class="field font-semibold text-accent pl-8.5 cursor-pointer ' + (!hasSpaceInitial ? 'border-accent/40 bg-accent/5 ring-2 ring-accent/10' : '') + '">\\' +
                    blankOpt(RMTP.SPACES, ev.space, '\\u25cb Choose a Space / Room\\u2026') +
                  '</select>' +
                '</div>' +`;

const replace1 = `'<select id="e-space" class="field font-semibold text-accent pl-8.5 cursor-pointer ' + (!hasSpaceInitial ? 'border-accent/40 bg-accent/5 ring-2 ring-accent/10' : '') + '">\\' +
                    blankOpt(RMTP.SPACES, ev.space, '\\u25cb Choose a Space / Room\\u2026') +
                    (!existing ? '<option value="Multi Room">Multi Room...</option>' : '') +
                  '</select>' +
                '</div>' +
                '<div id="e-multi-room-wrap" class="hidden mt-3 p-3 bg-panel2/50 border border-line rounded-lg">' +
                  '<p class="text-[11px] font-bold text-ink uppercase tracking-wider mb-2">Select Linked Spaces</p>' +
                  '<div class="grid grid-cols-2 gap-2">' +
                    RMTP.SPACES.map(s => '<label class="flex items-center gap-2 text-xs cursor-pointer"><input type="checkbox" name="e-multi-spaces" value="'+s+'" class="w-3.5 h-3.5 accent-[var(--accent)]"><span>'+s+'</span></label>').join('') +
                  '</div>' +
                '</div>' +`;

code = code.replace(search1, replace1);

// Edit 2: updateSpaceWorkflow toggle
const search2 = `      if (spaceSelect) {
        spaceSelect.classList.toggle('border-accent/40', !hasSpace);
        spaceSelect.classList.toggle('bg-accent/5', !hasSpace);
        spaceSelect.classList.toggle('ring-2', !hasSpace);
        spaceSelect.classList.toggle('ring-accent/10', !hasSpace);
      }`;

const replace2 = `      if (spaceSelect) {
        spaceSelect.classList.toggle('border-accent/40', !hasSpace);
        spaceSelect.classList.toggle('bg-accent/5', !hasSpace);
        spaceSelect.classList.toggle('ring-2', !hasSpace);
        spaceSelect.classList.toggle('ring-accent/10', !hasSpace);
      }
      const multiWrap = m.root.querySelector('#e-multi-room-wrap');
      if (multiWrap) {
        multiWrap.classList.toggle('hidden', currentSpace !== 'Multi Room');
      }`;

code = code.replace(search2, replace2);

// Edit 3: Save Logic
const search3 = `      record.dcp_test_event_id = linkedDcpId;

      store.upsert('advancing', record);`;

const replace3 = `      record.dcp_test_event_id = linkedDcpId;

      if (chosenSpace === 'Multi Room') {
        const checkedSpaces = Array.from(m.root.querySelectorAll('input[name="e-multi-spaces"]:checked')).map(cb => cb.value);
        if (checkedSpaces.length === 0) {
          ui.toast('Please select at least one space for Multi Room', 'danger');
          return;
        }
        
        const baseId = record.id;
        checkedSpaces.forEach((sp, idx) => {
          const multiRecord = Object.assign({}, record, {
            id: idx === 0 ? baseId : store.uid('evt'),
            space: sp
          });
          store.upsert('advancing', multiRecord);
        });
      } else {
        store.upsert('advancing', record);
      }`;

code = code.replace(search3, replace3);

fs.writeFileSync('js/views/advancing.js', code);
console.log("Patched advancing.js successfully!");
