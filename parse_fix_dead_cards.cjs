const fs = require('fs');
let code = fs.readFileSync('js/views/advancing.js', 'utf8');

const target1 = `        if (advViewMode === 'list') {
          const card = document.querySelector('[data-event-card="' + targetEv.id + '"]');
          if (card) {
            const temp = document.createElement('div');
            temp.innerHTML = renderEventCard(updated);
            const newCard = temp.firstElementChild;
            if (newCard) {
              card.replaceWith(newCard);
              return;
            }
          }
        }
        RMTP.router.render();`;

const replace1 = `        RMTP._isSoftRender = true;
        RMTP.router.render();
        RMTP._isSoftRender = false;`;

code = code.replace(target1, replace1);

const target2 = `      if (existing && chosenSpace !== 'Multi Room' && typeof advViewMode !== 'undefined' && advViewMode === 'list') {
        const card = document.querySelector('[data-event-card="' + record.id + '"]');
        if (card) {
          const temp = document.createElement('div');
          temp.innerHTML = renderEventCard(record);
          const newCard = temp.firstElementChild;
          if (newCard) {
            card.replaceWith(newCard);
            return;
          }
        }
      }
      RMTP.router.render();`;

const replace2 = `      RMTP._isSoftRender = true;
      RMTP.router.render();
      RMTP._isSoftRender = false;`;

code = code.replace(target2, replace2);

fs.writeFileSync('js/views/advancing.js', code);
