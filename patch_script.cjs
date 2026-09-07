const fs = require('fs');

const content = fs.readFileSync('js/views/presets.js', 'utf8');

const regex = /function renderSignalFlow\(\) \{[\s\S]*?(?=function renderRepatches\(\) \{)/;
const replacement = `function renderSignalFlow() {
      const hr = getHomeRunConfig(sheet);
      const totalInputs = Math.max(1, parseInt(hr.inputChannels, 10) || 32);
      const hrPrefix = (hr.prefix || 'HR').trim();
      const matrixEl = m.root.querySelector('#ps-signal-flow-matrix');
      if (!matrixEl) return;

      const acts = sheet.acts || [];
      
      let thead = '<tr class="border-b border-line bg-panel2 text-[10px] font-bold text-muted uppercase tracking-wider">';
      thead += '<th class="py-2 px-3 border-r border-line bg-panel sticky left-0 z-10 w-24">Home Run</th>';
      
      for (let i = 0; i < acts.length; i++) {
        const act = acts[i];
        const isHouse = act.id === 'act-house';
        thead += '<th class="py-2 px-3 min-w-[180px] ' + (isHouse ? 'bg-panel2/50' : '') + '">' + ui.esc(act.name) + '</th>';
        if (i < acts.length - 1) {
           thead += '<th class="py-2 px-2 w-24 text-center bg-panel2 border-x border-line/60">Changeover</th>';
        }
      }
      thead += '</tr>';

      let tbody = '';
      for (let ch = 1; ch <= totalInputs; ch++) {
        const padCh = ch < 10 ? '0' + ch : ch;
        let row = '<tr class="border-b border-line/40 hover:bg-panel/50">';
        row += '<td class="py-2 px-3 border-r border-line bg-panel sticky left-0 z-10"><span class="font-mono font-bold text-ink">' + hrPrefix + ' ' + padCh + '</span></td>';
        
        let prevCellData = null;
        
        for (let i = 0; i < acts.length; i++) {
          const act = acts[i];
          
          let cellPatch = null;
          let sbObj = null;
          let chIdxObj = -1;
          let sbIdxObj = -1;
          
          for (let sbIdx = 0; sbIdx < sheet.stageboxes.length; sbIdx++) {
            const b = sheet.stageboxes[sbIdx];
            const cIdx = (b.channels || []).findIndex(c => c.actId === act.id && parseInt(c.homeRunCh, 10) === ch);
            if (cIdx > -1) {
              cellPatch = b.channels[cIdx];
              sbObj = b;
              chIdxObj = cIdx;
              sbIdxObj = sbIdx;
              break;
            }
          }
          
          const hasPatch = !!cellPatch;
          const sbName = hasPatch ? (sbObj.name || 'Box ' + sbObj.letter) : '';
          const inst = hasPatch ? (cellPatch.instrument || '') : '';
          const mic = hasPatch ? (cellPatch.mic || '') : '';
          
          const currentCellData = hasPatch ? { sb: sbObj.id, socket: cellPatch.socket, inst: inst, mic: mic } : null;
          
          if (i > 0) {
            let coText = '';
            let coClass = 'text-muted';
            let coBg = 'bg-panel2';
            
            if (!currentCellData) {
               coText = 'Not Used Next Act';
               coClass = 'text-muted';
            } else if (!prevCellData) {
               coText = 'ADD PATCH';
               coClass = 'text-info font-bold';
               coBg = 'bg-info/10';
            } else {
               if (currentCellData.sb === prevCellData.sb && currentCellData.socket === prevCellData.socket && currentCellData.inst === prevCellData.inst && currentCellData.mic === prevCellData.mic) {
                  coText = 'No Change';
                  coClass = 'text-muted';
               } else {
                  coText = 'REPATCH';
                  coClass = 'text-warning font-bold';
                  coBg = 'bg-warning/20';
               }
            }
            row += '<td class="py-2 px-2 text-center text-[10px] ' + coClass + ' ' + coBg + ' border-x border-line/60">' + coText + '</td>';
          }
          
          row += '<td class="py-2 px-2 align-top">';
          if (hasPatch) {
             row += '<div class="grid gap-1 bg-panel border border-line p-1.5 rounded text-xs shadow-2xs">' +
                 '<div class="flex justify-between items-center text-[10px] font-bold text-muted uppercase">' +
                   '<span>' + ui.esc(sbName) + ' &middot; Skt ' + cellPatch.socket + '</span>' +
                   '<button type="button" data-mat-unpatch="' + sbIdxObj + '-' + chIdxObj + '" class="text-danger hover:bg-danger/10 px-1 rounded" title="Remove Patch">' + ui.icon('x', 'w-3 h-3') + '</button>' +
                 '</div>' +
                 '<input type="text" data-mat-inst="' + sbIdxObj + '-' + chIdxObj + '" class="field !py-0.5 !px-1.5 text-xs font-bold text-ink w-full" value="' + ui.esc(inst) + '" placeholder="Instrument..." />' +
                 '<input type="text" data-mat-mic="' + sbIdxObj + '-' + chIdxObj + '" class="field !py-0.5 !px-1.5 text-[10px] text-muted w-full" value="' + ui.esc(mic) + '" placeholder="Mic..." />' +
               '</div>';
          } else {
             row += '<select data-mat-add="' + act.id + '-' + ch + '" class="bg-panel2/50 text-xs border border-line/50 rounded py-1 px-1 text-muted w-full">' +
                 '<option value="">+ Add Patch...</option>' +
                 sheet.stageboxes.map((sb, sIdx) => {
                   return '<optgroup label="' + ui.esc(sb.name || sb.letter) + '">' + 
                     Array.from({length: sb.capacity}, (_, sockI) => sockI+1).map(sock => {
                       return '<option value="' + sIdx + '-' + sock + '">' + ui.esc(sb.letter || '') + sock + '</option>';
                     }).join('') +
                   '</optgroup>';
                 }).join('') +
               '</select>';
          }
          row += '</td>';
          prevCellData = currentCellData;
        }
        row += '</tr>';
        tbody += row;
      }

      matrixEl.innerHTML = '<div class="overflow-x-auto bg-panel border border-line rounded-xl shadow-xs">' +
          '<table class="w-full text-left border-collapse min-w-max">' +
            '<thead>' + thead + '</thead>' +
            '<tbody>' + tbody + '</tbody>' +
          '</table>' +
        '</div>';

      matrixEl.querySelectorAll('[data-mat-add]').forEach(sel => {
        sel.addEventListener('change', () => {
          if (!sel.value) return;
          const [actId, hrCh] = sel.getAttribute('data-mat-add').split('-');
          const [sbIdx, socket] = sel.value.split('-').map(Number);
          const box = sheet.stageboxes[sbIdx];
          if (!box.channels) box.channels = [];
          box.channels.push({
            socket: socket,
            actId: actId,
            instrument: '',
            mic: '',
            phantom: false,
            repatch: false,
            homeRunCh: parseInt(hrCh, 10)
          });
          renderSignalFlow();
        });
      });

      matrixEl.querySelectorAll('[data-mat-unpatch]').forEach(btn => {
        btn.addEventListener('click', () => {
          const [sbIdx, chIdx] = btn.getAttribute('data-mat-unpatch').split('-').map(Number);
          sheet.stageboxes[sbIdx].channels.splice(chIdx, 1);
          renderSignalFlow();
        });
      });

      matrixEl.querySelectorAll('[data-mat-inst]').forEach(inp => {
        inp.addEventListener('input', () => {
          const [sbIdx, chIdx] = inp.getAttribute('data-mat-inst').split('-').map(Number);
          sheet.stageboxes[sbIdx].channels[chIdx].instrument = inp.value;
        });
      });

      matrixEl.querySelectorAll('[data-mat-mic]').forEach(inp => {
        inp.addEventListener('input', () => {
          const [sbIdx, chIdx] = inp.getAttribute('data-mat-mic').split('-').map(Number);
          sheet.stageboxes[sbIdx].channels[chIdx].mic = inp.value;
        });
      });
    }

    /* ---- Step 4: Repatches (Auto-Computed) ---- */
    `;
const updated = content.replace(regex, replacement);
fs.writeFileSync('js/views/presets.js', updated);
