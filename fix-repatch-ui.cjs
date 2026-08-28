const fs = require('fs');
let code = fs.readFileSync('js/views/presets.js', 'utf8');

const step2HeaderRegex = /            '<div class="flex items-center justify-between flex-wrap gap-2">' \+\n              '<div class="flex items-center gap-2">' \+\n                '<span class="text-accent">' \+ ui\.icon\('box', 'w-4 h-4'\) \+ '<\/span>' \+\n                '<span class="font-bold text-ink uppercase tracking-wider text-xs">Stageboxes & Sub-Snakes Layout<\/span>' \+\n                '<span id="ps-stagebox-count-badge" class="font-mono text-\[11px\] px-2 py-0\.5 rounded bg-panel2 border border-line font-semibold"><\/span>' \+\n              '<\/div>' \+\n              '<div class="flex items-center gap-1\.5 flex-wrap">' \+\n                '<span class="text-\[11px\] text-muted mr-1">Quick Add:<\/span>' \+\n                '<button type="button" data-add-sb-preset="4" class="btn btn-ghost !py-1 !px-2 text-xs border border-line">\+ 4 Ch<\/button>' \+\n                '<button type="button" data-add-sb-preset="8" class="btn btn-ghost !py-1 !px-2 text-xs border border-line">\+ 8 Ch<\/button>' \+\n                '<button type="button" data-add-sb-preset="16" class="btn btn-ghost !py-1 !px-2 text-xs border border-line">\+ 16 Ch<\/button>' \+\n                '<button type="button" id="btn-add-custom-sb" class="btn btn-primary !py-1 !px-2\.5 text-xs flex items-center gap-1 font-semibold">' \+\n                  ui\.icon\('plus', 'w-3\.5 h-3\.5'\) \+ '<span>Custom Box<\/span>' \+\n                '<\/button>' \+\n              '<\/div>' \+\n            '<\/div>' \+\n            '<div id="ps-stageboxes-container" class="grid gap-4"><\/div>' \+/;

const step2HeaderNew = `            '<div class="flex items-center justify-between flex-wrap gap-2">' +
              '<div class="flex items-center gap-2">' +
                '<span class="text-accent">' + ui.icon('box', 'w-4 h-4') + '</span>' +
                '<span class="font-bold text-ink uppercase tracking-wider text-xs">Stageboxes & Sub-Snakes Layout</span>' +
                '<span id="ps-stagebox-count-badge" class="font-mono text-[11px] px-2 py-0.5 rounded bg-panel2 border border-line font-semibold"></span>' +
              '</div>' +
              '<div class="flex items-center gap-1.5 flex-wrap">' +
                '<span class="text-[11px] text-muted mr-1">Quick Add:</span>' +
                '<button type="button" data-add-sb-preset="4" class="btn btn-ghost !py-1 !px-2 text-xs border border-line">+ 4 Ch</button>' +
                '<button type="button" data-add-sb-preset="8" class="btn btn-ghost !py-1 !px-2 text-xs border border-line">+ 8 Ch</button>' +
                '<button type="button" data-add-sb-preset="16" class="btn btn-ghost !py-1 !px-2 text-xs border border-line">+ 16 Ch</button>' +
                '<button type="button" id="btn-add-custom-sb" class="btn btn-primary !py-1 !px-2.5 text-xs flex items-center gap-1 font-semibold">' +
                  ui.icon('plus', 'w-3.5 h-3.5') + '<span>Custom Box</span>' +
                '</button>' +
              '</div>' +
            '</div>' +
            '<div class="flex items-start gap-3 p-3.5 bg-accent/5 border border-accent/20 rounded-lg text-xs">' +
              '<div class="mt-0.5 text-accent">' + ui.icon('info', 'w-4 h-4') + '</div>' +
              '<div>' +
                '<p class="font-bold text-accent mb-0.5">Festival Patching Strategy</p>' +
                '<p class="text-muted leading-relaxed">For channels shared across all artists (like standard Drum Kits), set the Act to <strong class="text-ink">House / Venue Core</strong>. If an instrument changes between acts (like Vocal Mics), assign the channel to the first act, then use the <strong><span class="text-accent">' + ui.icon('copy', 'w-3 h-3 inline-block relative -top-[1px]') + ' Add Changeover</span></strong> button to map the same socket to a different instrument for the next act.</p>' +
              '</div>' +
            '</div>' +
            '<div id="ps-stageboxes-container" class="grid gap-4"></div>' +`;

if (code.match(step2HeaderRegex)) {
  code = code.replace(step2HeaderRegex, step2HeaderNew);
  fs.writeFileSync('js/views/presets.js', code);
  console.log("Updated step 2 header");
} else {
  console.log("Failed to match step 2 header");
}
