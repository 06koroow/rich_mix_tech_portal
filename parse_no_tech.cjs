const fs = require('fs');
let code = fs.readFileSync('js/views/advancing.js', 'utf8');

const tTechLabel = `  function techLabel(t) {
    let name;`;
const rTechLabel = `  function techLabel(t) {
    if (t.isNoTech) return 'No Tech Needed';
    let name;`;
code = code.replace(tTechLabel, rTechLabel);

const tHtml1 = `uOpts += '<option value="__freelancer__" ' + (t.isFreelancer ? 'selected' : '') + '>Freelancer (Custom)</option>';`;
const rHtml1 = `uOpts += '<option value="__freelancer__" ' + (t.isFreelancer ? 'selected' : '') + '>Freelancer (Custom)</option>';
        uOpts += '<option value="__no_tech__" ' + (t.isNoTech ? 'selected' : '') + '>No Tech Needed</option>';`;
code = code.replace(tHtml1, rHtml1);

const tHtml2 = `if (t.isFreelancer) {
          rowHtml += '<input type="text" data-t-freelancer="' + i + '" class="field flex-1" placeholder="Freelancer Name" value="' + ui.esc(t.freelancerName) + '">';
        }`;
const rHtml2 = `if (t.isFreelancer) {
          rowHtml += '<input type="text" data-t-freelancer="' + i + '" class="field flex-1" placeholder="Freelancer Name" value="' + ui.esc(t.freelancerName) + '">';
        }`; // Wait, this doesn't change anything, so I can just leave it.

const tWire = `          if (val === '__freelancer__') {
            techs[idx].isFreelancer = true;
            techs[idx].userId = '';
          } else {
            techs[idx].isFreelancer = false;
            techs[idx].userId = val;
          }`;
const rWire = `          if (val === '__freelancer__') {
            techs[idx].isFreelancer = true;
            techs[idx].isNoTech = false;
            techs[idx].userId = '';
          } else if (val === '__no_tech__') {
            techs[idx].isFreelancer = false;
            techs[idx].isNoTech = true;
            techs[idx].userId = '';
            techs[idx].role = 'None';
          } else {
            techs[idx].isFreelancer = false;
            techs[idx].isNoTech = false;
            techs[idx].userId = val;
          }`;

// Check if tWire exists exactly as written
code = code.replace(tWire, rWire);

// also I need to update where `techs` array is built from `RMTP.eventTechnicians(ev)` inside the modal
const tMap = `    let techs = RMTP.eventTechnicians(ev).map((t) => ({ 
      userId: t.userId || '', 
      role: t.role || '',
      isFreelancer: !!t.isFreelancer,
      freelancerName: t.freelancerName || '',
      startTime: t.startTime || '',
      finishTime: t.finishTime || ''
    }));`;
const rMap = `    let techs = RMTP.eventTechnicians(ev).map((t) => ({ 
      userId: t.userId || '', 
      role: t.role || '',
      isFreelancer: !!t.isFreelancer,
      isNoTech: !!t.isNoTech,
      freelancerName: t.freelancerName || '',
      startTime: t.startTime || '',
      finishTime: t.finishTime || ''
    }));`;
code = code.replace(tMap, rMap);

fs.writeFileSync('js/views/advancing.js', code);
