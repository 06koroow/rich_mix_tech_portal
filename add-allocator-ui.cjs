const fs = require('fs');
let code = fs.readFileSync('js/views/presets.js', 'utf8');

const target = /'<\/div>' \+\n\s*'<\/div>' \+\n\s*'<div id="ps-stageboxes-container" class="grid gap-4"><\/div>' \+/;
const injection = `'</div>' +
            '</div>' +
            '<div id="ps-custom-channels-allocator"></div>' +
            '<div id="ps-stageboxes-container" class="grid gap-4"></div>' +`;

if (code.match(target)) {
    code = code.replace(target, injection);
    fs.writeFileSync('js/views/presets.js', code);
    console.log("Injected ps-custom-channels-allocator container");
} else {
    console.log("Could not find injection target for allocator container");
}
