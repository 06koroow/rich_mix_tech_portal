const fs = require('fs');
let code = fs.readFileSync('js/views/advancing.js', 'utf8');

// Update line 2328 mapping
code = code.replace(
  /let techs = RMTP\.eventTechnicians\(ev\)\.map\(\(t\) => \(\{ userId: t\.userId, role: t\.role \|\| '' \}\)\);/g,
  `let techs = RMTP.eventTechnicians(ev).map((t) => ({ 
      userId: t.userId || '', 
      role: t.role || '',
      isFreelancer: !!t.isFreelancer,
      freelancerName: t.freelancerName || '',
      startTime: t.startTime || '',
      finishTime: t.finishTime || ''
    }));`
);

// We need to replace the entire techAreaHtml and wireTechs function logic.
// We can use a regex from `function techAreaHtml() {` to `wireTechs();`

const oldTechHtmlStart = 'function techAreaHtml() {';
const oldWireEnd = '    wireTechs();';

const startIndex = code.indexOf(oldTechHtmlStart);
const endIndex = code.indexOf(oldWireEnd, startIndex) + oldWireEnd.length;

if (startIndex > -1 && endIndex > -1) {
  const newTechLogic = `function techAreaHtml() {
      const rows = techs.map((t, i) => {
        const usedElsewhere = techs.filter((x, j) => j !== i).map((x) => x.userId);
        let uOpts = '<option value="">Select technician\u2026</option>' + allUsers
          .filter((u) => u.id === t.userId || usedElsewhere.indexOf(u.id) === -1)
          .map((u) => '<option value="' + u.id + '" ' + (u.id === t.userId && !t.isFreelancer ? 'selected' : '') + '>' + ui.esc(auth.displayName(u)) + '</option>').join('');
        uOpts += '<option value="__freelancer__" ' + (t.isFreelancer ? 'selected' : '') + '>Freelancer (Custom)</option>';

        const rOpts = '<option value="">Select role\u2026</option>' + RMTP.SHIFT_ROLES
          .map((r) => '<option ' + (r === t.role ? 'selected' : '') + '>' + r + '</option>').join('');
          
        let rowHtml = '<div class="flex flex-col gap-2 p-2 border border-line rounded-lg bg-panel2/50">' +
          '<div class="flex items-center gap-2">' +
            '<select data-t-user="' + i + '" class="field flex-1">' + uOpts + '</select>';
            
        if (t.isFreelancer) {
          rowHtml += '<input type="text" data-t-freelancer="' + i + '" class="field flex-1" placeholder="Freelancer Name" value="' + ui.esc(t.freelancerName) + '">';
        }
        
        rowHtml += '<select data-t-role="' + i + '" class="field w-32 shrink-0">' + rOpts + '</select>' +
            '<button type="button" data-t-remove="' + i + '" class="btn btn-danger !p-2 shrink-0" title="Remove">' + ui.icon('trash', 'w-4 h-4') + '</button>' +
          '</div>';

        const placeholderStart = (m.root.querySelector('#e-start') ? m.root.querySelector('#e-start').value : ev.startTime) || '';
        const placeholderEnd = (m.root.querySelector('#e-finish') ? m.root.querySelector('#e-finish').value : ev.finishTime) || '';
        
        rowHtml += '<div class="flex items-center gap-2 text-xs">' +
            '<span class="text-muted w-12">Times:</span>' +
            '<input type="time" data-t-start="' + i + '" class="field !py-1 !px-2 flex-1" value="' + (t.startTime || '') + '" placeholder="' + placeholderStart + '">' +
            '<span class="text-muted">to</span>' +
            '<input type="time" data-t-end="' + i + '" class="field !py-1 !px-2 flex-1" value="' + (t.finishTime || '') + '" placeholder="' + placeholderEnd + '">' +
            '<span class="text-muted italic text-[10px] ml-1">(Blank = event times)</span>' +
          '</div>';

        rowHtml += '</div>';
        return rowHtml;
      }).join('');
      return (rows ? '<div class="grid gap-2 mb-2">' + rows + '</div>' : '<p class="text-xs text-muted mb-2">No technicians tagged yet.</p>') +
        '<button type="button" data-t-add class="btn btn-ghost">' + ui.icon('plus', 'w-4 h-4') + 'Add technician / freelancer</button>';
    }

    function wireTechs() {
      ['#e-tech-area', '#e-cinema-tech-area'].forEach((sel) => {
        const area = m.root.querySelector(sel);
        if (!area) return;
        area.innerHTML = techAreaHtml();
        area.querySelectorAll('[data-t-user]').forEach((s) => s.addEventListener('change', () => {
          const val = s.value;
          const idx = +s.getAttribute('data-t-user');
          if (val === '__freelancer__') {
            techs[idx].isFreelancer = true;
            techs[idx].userId = '';
          } else {
            techs[idx].isFreelancer = false;
            techs[idx].userId = val;
          }
          wireTechs();
        }));
        area.querySelectorAll('[data-t-freelancer]').forEach((s) => s.addEventListener('input', () => {
          techs[+s.getAttribute('data-t-freelancer')].freelancerName = s.value;
        }));
        area.querySelectorAll('[data-t-role]').forEach((s) => s.addEventListener('change', () => {
          techs[+s.getAttribute('data-t-role')].role = s.value;
        }));
        area.querySelectorAll('[data-t-start]').forEach((s) => s.addEventListener('change', () => {
          techs[+s.getAttribute('data-t-start')].startTime = s.value;
        }));
        area.querySelectorAll('[data-t-end]').forEach((s) => s.addEventListener('change', () => {
          techs[+s.getAttribute('data-t-end')].finishTime = s.value;
        }));
        area.querySelectorAll('[data-t-remove]').forEach((btn) => btn.addEventListener('click', () => {
          techs.splice(+btn.getAttribute('data-t-remove'), 1); wireTechs();
        }));
        const addBtn = area.querySelector('[data-t-add]');
        if (addBtn) addBtn.addEventListener('click', () => { techs.push({ userId: '', role: '', isFreelancer: false, freelancerName: '', startTime: '', finishTime: '' }); wireTechs(); });
      });
      updateSectionBannerPills();
    }
    wireTechs();`;
    
  code = code.substring(0, startIndex) + newTechLogic + code.substring(endIndex);
}

// Update finalTechs logic in save
code = code.replace(
  /const finalTechs = techs\.filter\(\(t\) => t\.userId\);/g,
  `const finalTechs = techs.filter((t) => t.userId || (t.isFreelancer && t.freelancerName.trim()));`
);

fs.writeFileSync('js/views/advancing.js', code);
console.log('Patched tech area logic!');
