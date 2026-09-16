const fs = require('fs');
let code = fs.readFileSync('js/views/advancing.js', 'utf8');

const targetHtmlStart = `  el.innerHTML =
    '<div class="view-enter">' +`;

const replaceHtmlStart = `  el.innerHTML =
    '<div class="' + (RMTP._isSearching ? '' : 'view-enter') + '">' +`;

code = code.replace(targetHtmlStart, replaceHtmlStart);

const targetBindSearch = `  const bindSearch = (id) => {
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
  };`;

const replaceBindSearch = `  const bindSearch = (id) => {
    const input = el.querySelector('#' + id);
    if (input) {
      input.addEventListener('input', (e) => {
        RMTP._advQuickSearch = e.target.value;
        const caret = e.target.selectionStart;
        RMTP._isSearching = true;
        RMTP.router.render();
        RMTP._isSearching = false;
        const newEl = document.getElementById(id);
        if (newEl) {
          newEl.focus();
          newEl.setSelectionRange(caret, caret);
        }
      });
    }
  };`;

code = code.replace(targetBindSearch, replaceBindSearch);

fs.writeFileSync('js/views/advancing.js', code);
