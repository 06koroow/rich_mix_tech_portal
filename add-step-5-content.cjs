const fs = require('fs');
let code = fs.readFileSync('js/views/presets.js', 'utf8');

const endOfStep4 = /'<div id="ps-master-schedule-preview" class="overflow-x-auto"><\/div>' \+\n\s*'<\/div>' \+\n\s*'<\/div>' \+\n\s*'<\/div>',\n\s*footer:/;

const step5Html = `'<div id="ps-step-5" class="' + (currentStep === 5 ? 'grid gap-5' : 'hidden') + '">' +
            '<div class="p-3.5 rounded-xl bg-panel border border-line flex flex-col gap-3 shadow-xs">' +
              '<div class="flex items-center justify-between pb-2 border-b border-line/60 flex-wrap gap-2">' +
                '<div class="flex items-center gap-2">' +
                  '<span class="text-accent">' + ui.icon('grid', 'w-4 h-4') + '</span>' +
                  '<span class="font-bold text-ink uppercase tracking-wider text-xs">Mixing Console IO Summary</span>' +
                '</div>' +
                '<div class="text-[10px] text-muted max-w-sm text-right">Click a cell to toggle whether an act is using that input. This updates the running order for the engineers.</div>' +
              '</div>' +
              '<div id="ps-mixing-io-preview" class="overflow-x-auto"></div>' +
            '</div>' +
          '</div>' +
        '</div>',
      footer:`;

if (code.match(endOfStep4)) {
    code = code.replace(endOfStep4, step5Html);
    fs.writeFileSync('js/views/presets.js', code);
    console.log("Step 5 content added");
} else {
    console.log("Could not find end of step 4");
}
