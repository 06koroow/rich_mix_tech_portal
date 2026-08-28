const fs = require('fs');
let code = fs.readFileSync('js/views/presets.js', 'utf8');

// 1. Initializer
code = code.replace(
  /    if \(!Array\.isArray\(sheet\.patchPoints\)\) sheet\.patchPoints = JSON\.parse\(JSON\.stringify\(DEFAULT_PATCH_POINTS\)\);/,
  "    if (!Array.isArray(sheet.patchPoints)) sheet.patchPoints = JSON.parse(JSON.stringify(DEFAULT_PATCH_POINTS));\n    if (!sheet.actMutes) sheet.actMutes = {};"
);

// 2. Tab Navigation
const oldTabs = /'<button type="button" data-ps-tab="4" class="flex-1 min-w-\[150px\] py-2 px-3 rounded-lg text-xs font-bold transition-all flex items-center justify-center gap-2 ' \+ \(currentStep === 4 \? 'bg-accent text-accent-ink shadow-xs' : 'text-muted hover:text-ink hover:bg-panel'\) \+ '">'.*?'<span>Repatches & Summary<\/span>'.*?'<\/button>'.*?'<\/div>'/s;

if (code.match(oldTabs)) {
    const newTabs = "'<button type=\"button\" data-ps-tab=\"4\" class=\"flex-1 min-w-[150px] py-2 px-3 rounded-lg text-xs font-bold transition-all flex items-center justify-center gap-2 ' + (currentStep === 4 ? 'bg-accent text-accent-ink shadow-xs' : 'text-muted hover:text-ink hover:bg-panel') + '\">' +\n" +
      "              '<span class=\"w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-mono ' + (currentStep === 4 ? 'bg-accent-ink text-accent' : 'bg-panel2 border border-line text-muted') + '\">4</span>' +\n" +
      "              '<span>Repatches & Run Order</span>' +\n" +
      "            '</button>' +\n" +
      "            '<button type=\"button\" data-ps-tab=\"5\" class=\"flex-1 min-w-[150px] py-2 px-3 rounded-lg text-xs font-bold transition-all flex items-center justify-center gap-2 ' + (currentStep === 5 ? 'bg-accent text-accent-ink shadow-xs' : 'text-muted hover:text-ink hover:bg-panel') + '\">' +\n" +
      "              '<span class=\"w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-mono ' + (currentStep === 5 ? 'bg-accent-ink text-accent' : 'bg-panel2 border border-line text-muted') + '\">5</span>' +\n" +
      "              '<span>Mixing IO Summary</span>' +\n" +
      "            '</button>' +\n" +
      "          '</div>'";
    code = code.replace(oldTabs, newTabs);
} else {
    console.log("Could not match oldTabs");
}

// 3. change currentStep upper bound
code = code.replace(/currentStep = initialStep \? Math\.max\(1, Math\.min\(4, parseInt\(initialStep, 10\)\)\) : 1;/, 'currentStep = initialStep ? Math.max(1, Math.min(5, parseInt(initialStep, 10))) : 1;');
code = code.replace(/currentStep = Math\.max\(1, Math\.min\(4, step\)\);/, 'currentStep = Math.max(1, Math.min(5, step));');
code = code.replace(/style="' \+ \(currentStep === 4 \? 'display:none;' : ''\) \+ '">Next Step &rarr;<\/button>/, 'style="\' + (currentStep === 5 ? \'display:none;\' : \'\') + \'">Next Step &rarr;</button>');

fs.writeFileSync('js/views/presets.js', code);
console.log("Step 5 nav added");
