const fs = require('fs');
let code = fs.readFileSync('js/views/advancing.js', 'utf8');

const targetFinalTechs = `      const finalTechs = techs.filter((t) => t.userId || (t.isFreelancer && t.freelancerName.trim()));
      if (finalTechs.some((t) => !t.role)) { ui.toast('Pick a role for each tagged technician', 'danger'); return; }`;

const replaceFinalTechs = `      const finalTechs = techs.filter((t) => t.userId || (t.isFreelancer && t.freelancerName.trim()) || t.isNoTech);
      if (finalTechs.some((t) => !t.isNoTech && !t.role)) { ui.toast('Pick a role for each tagged technician', 'danger'); return; }`;

code = code.replace(targetFinalTechs, replaceFinalTechs);

fs.writeFileSync('js/views/advancing.js', code);
