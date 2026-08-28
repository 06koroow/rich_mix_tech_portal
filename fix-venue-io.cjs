const fs = require('fs');
let code = fs.readFileSync('js/views/venues.js', 'utf8');

const regexUi = /'<div class="grid grid-cols-3 gap-4 border-t border-line pt-4">' \+\n\s*'<div><label class="text-\[10px\] font-bold text-muted uppercase">Home Run Inputs<\/label><input type="number" class="field" id="v-audio-in" value="' \+ m\.venueData\.audio\.inputChannels \+ '"><\/div>' \+\n\s*'<div><label class="text-\[10px\] font-bold text-muted uppercase">Home Run Outputs<\/label><input type="number" class="field" id="v-audio-out" value="' \+ m\.venueData\.audio\.outputChannels \+ '"><\/div>' \+\n\s*'<div><label class="text-\[10px\] font-bold text-muted uppercase">Prefix<\/label><input type="text" class="field" id="v-audio-pref" value="' \+ ui\.esc\(m\.venueData\.audio\.prefix\) \+ '"><\/div>' \+\n\s*'<\/div>' \+/;

const replacementUi = \`'<div class="grid grid-cols-2 sm:grid-cols-5 gap-3 border-t border-line pt-4">' +
                  '<div><label class="text-[10px] font-bold text-muted uppercase" title="Total Network/Stage Inputs">Total Inputs</label><input type="number" class="field !px-2 !py-1.5" id="v-audio-in" value="' + m.venueData.audio.inputChannels + '"></div>' +
                  '<div><label class="text-[10px] font-bold text-muted uppercase text-accent" title="Local FOH Desk Inputs">Local Ins (FOH)</label><input type="number" class="field !px-2 !py-1.5 border-accent/30 bg-accent/5" id="v-audio-local-in" value="' + (m.venueData.audio.localInputChannels || 0) + '"></div>' +
                  '<div><label class="text-[10px] font-bold text-muted uppercase" title="Total Network/Stage Outputs">Total Outputs</label><input type="number" class="field !px-2 !py-1.5" id="v-audio-out" value="' + m.venueData.audio.outputChannels + '"></div>' +
                  '<div><label class="text-[10px] font-bold text-muted uppercase text-accent" title="Local FOH Desk Outputs">Local Outs (FOH)</label><input type="number" class="field !px-2 !py-1.5 border-accent/30 bg-accent/5" id="v-audio-local-out" value="' + (m.venueData.audio.localOutputChannels || 0) + '"></div>' +
                  '<div><label class="text-[10px] font-bold text-muted uppercase">Prefix</label><input type="text" class="field !px-2 !py-1.5" id="v-audio-pref" value="' + ui.esc(m.venueData.audio.prefix) + '"></div>' +
                '</div>' +\`;

if (code.match(regexUi)) {
    code = code.replace(regexUi, replacementUi);
    console.log("Replaced UI grid.");
} else {
    console.log("Failed to match UI regex.");
}

const regexBind = /bindInput\('#v-audio-in', m\.venueData\.audio, 'inputChannels', true\);\n\s*bindInput\('#v-audio-out', m\.venueData\.audio, 'outputChannels', true\);/;
const replacementBind = \`bindInput('#v-audio-in', m.venueData.audio, 'inputChannels', true);
    bindInput('#v-audio-local-in', m.venueData.audio, 'localInputChannels', true);
    bindInput('#v-audio-out', m.venueData.audio, 'outputChannels', true);
    bindInput('#v-audio-local-out', m.venueData.audio, 'localOutputChannels', true);\`;

if (code.match(regexBind)) {
    code = code.replace(regexBind, replacementBind);
    console.log("Replaced event bindings.");
} else {
    console.log("Failed to match bindings regex.");
}

const defaultAudio = /audio: \{\n\s*inputChannels: 48,\n\s*outputChannels: 24,/;
const replacementAudio = \`audio: {
          inputChannels: 48,
          localInputChannels: 8,
          outputChannels: 24,
          localOutputChannels: 8,\`;

if (code.match(defaultAudio)) {
    code = code.replace(defaultAudio, replacementAudio);
    console.log("Replaced default audio structure.");
} else {
    console.log("Failed to match default audio regex.");
}

fs.writeFileSync('js/views/venues.js', code);
