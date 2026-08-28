const fs = require('fs');
let code = fs.readFileSync('js/views/presets.js', 'utf8');

const oldBannerRegex = /'<p class="text-muted leading-relaxed">For channels shared across all artists \(like standard Drum Kits\), set the Act to <strong class="text-ink">House \/ Venue Core<\/strong>\. If an instrument changes between acts \(like Vocal Mics\), assign the channel to the first act, then use the <strong><span class="text-accent">' \+ ui\.icon\('copy', 'w-3 h-3 inline-block relative -top-\[1px\]'\) \+ ' Add Changeover<\/span><\/strong> button to map the same socket to a different instrument for the next act\.<\/p>' \+/;

const newBanner = `'<p class="text-muted leading-relaxed mb-1.5">For channels shared across all artists (like standard Drum Kits), set the Act to <strong class="text-ink">House / Venue Core</strong>.</p>' +
                '<p class="text-muted leading-relaxed">If acts have different requirements (e.g. 2 vocal mics vs 3), assign the base sockets to the first act, then use the <strong><span class="text-accent">' + ui.icon('copy', 'w-3 h-3 inline-block relative -top-[1px]') + ' Add Changeover</span></strong> button to share that socket with the next act. For additional mics unique to later acts, just add a new socket and assign it directly to them.</p>' +`;

if (code.match(oldBannerRegex)) {
  code = code.replace(oldBannerRegex, newBanner);
  fs.writeFileSync('js/views/presets.js', code);
  console.log("Updated banner");
} else {
  console.log("Regex did not match");
}
