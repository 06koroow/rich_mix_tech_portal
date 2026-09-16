const fs = require('fs');
let code = fs.readFileSync('js/router.js', 'utf8');

const tScroll = `    content.scrollTop = 0;
    window.scrollTo(0, 0);`;

const rScroll = `    if (!RMTP._isSoftRender) {
      content.scrollTop = 0;
      window.scrollTo(0, 0);
    }`;

code = code.replace(tScroll, rScroll);
fs.writeFileSync('js/router.js', code);
