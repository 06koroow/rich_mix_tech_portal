const fs = require('fs');
let code = fs.readFileSync('js/views/advancing.js', 'utf8');

const targetSearch = `  const addEv = el.querySelector('#add-event');
  if (addEv) addEv.addEventListener('click', () => openForm());`;

const replaceSearch = `  const addEv = el.querySelector('#add-event');
  if (addEv) addEv.addEventListener('click', () => openForm());

  const bindSearch = (id) => {
    const input = el.querySelector('#' + id);
    if (input) {
      input.addEventListener('input', (e) => {
        RMTP._advQuickSearch = e.target.value;
        const caret = e.target.selectionStart;
        RMTP.router.render();
        const newEl = document.getElementById(id);
        if (newEl) {
          newEl.focus();
          newEl.setSelectionRange(caret, caret);
        }
      });
    }
  };
  bindSearch('adv-quick-search-mobile');
  bindSearch('adv-quick-search-desktop');
`;

code = code.replace(targetSearch, replaceSearch);
fs.writeFileSync('js/views/advancing.js', code);
