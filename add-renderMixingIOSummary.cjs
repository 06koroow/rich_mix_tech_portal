const fs = require('fs');
let code = fs.readFileSync('js/views/presets.js', 'utf8');

const injection = `
    function renderMixingIOSummary() {
      const ioEl = m.root.querySelector('#ps-mixing-io-preview');
      if (!ioEl) return;
      const hr = getHomeRunConfig(sheet);
      const mapping = computeHomeRunMapping(sheet);
      
      const acts = sheet.acts || [];
      const performingActs = acts.filter(a => a.id !== 'act-house');
      if (performingActs.length === 0) {
         ioEl.innerHTML = '<div class="p-4 text-center text-muted italic">Add acts to the event to view the IO summary grid.</div>';
         return;
      }
      
      // Build header row with Acts
      let thead = '<thead><tr class="border-b border-line bg-panel2/60 text-muted uppercase text-[10px] font-bold">' +
        '<th class="p-2 border-r border-line w-20 sticky left-0 z-10 bg-panel2 font-mono">CH</th>';
      
      performingActs.forEach(act => {
        const col = getActColorObj(act.color);
        thead += '<th class="p-2 border-r border-line/40 text-center min-w-[120px]"><span class="px-2 py-0.5 rounded ' + col.bg + ' ' + col.text + ' border ' + col.border + '">' + ui.esc(act.name) + '</span></th>';
      });
      thead += '</tr></thead>';
      
      let tbody = '<tbody class="divide-y divide-line/40">';
      
      mapping.forEach(mRow => {
        let anyPatched = mRow.assignedSockets.length > 0;
        if (!anyPatched) return; // skip entirely unused channels to keep it dense, or maybe show them? let's show all for a true patch sheet, or just ones up to highest used? Let's show all up to highest used.
      });
      
      // Find highest patched channel to trim empty tail
      let highestUsed = 0;
      mapping.forEach((mRow, i) => {
         if (mRow.assignedSockets.length > 0) highestUsed = i;
      });
      
      for (let i = 0; i <= highestUsed; i++) {
        const mRow = mapping[i];
        
        tbody += '<tr class="hover:bg-panel2/40 transition-colors">' +
          '<td class="p-2 border-r border-line font-mono font-bold text-accent sticky left-0 z-10 bg-panel">' + mRow.label + '</td>';
          
        performingActs.forEach(act => {
           // Find socket for this act
           // It's this act if actId matches, OR if it's 'act-house'.
           // If multiple, repatch/changeover logic dictates we take the one assigned to this act, or the shared one.
           let actSocket = mRow.assignedSockets.find(s => s.actId === act.id);
           if (!actSocket) {
             actSocket = mRow.assignedSockets.find(s => s.actId === 'act-house');
           }
           
           const isMuted = sheet.actMutes && sheet.actMutes[act.id] && sheet.actMutes[act.id][mRow.chNumber];
           
           if (!actSocket) {
             tbody += '<td class="p-2 border-r border-line/40 text-center"><span class="text-muted/40 font-mono text-[10px]">\u2014</span></td>';
           } else {
             const bgClass = isMuted ? 'opacity-30 grayscale' : 'hover:bg-accent/10 cursor-pointer';
             const iconHtml = isMuted ? '<div class="absolute top-1 left-1 text-danger/80" title="Unassigned / Muted for this act">' + ui.icon('x', 'w-3 h-3') + '</div>' : '';
             
             tbody += '<td class="p-2 border-r border-line/40 text-center relative transition-all ' + bgClass + '" data-toggle-mute="' + act.id + '-' + mRow.chNumber + '">' +
               iconHtml + 
               '<div class="font-bold text-ink text-[11px]">' + ui.esc(actSocket.instrument || 'Line') + '</div>' +
               '<div class="text-[10px] text-muted font-mono mt-0.5">' + ui.esc(actSocket.mic || '') + ' ' + (actSocket.phantom ? '<b class="text-danger">+48V</b>' : '') + '</div>' +
             '</td>';
           }
        });
        
        tbody += '</tr>';
      }
      
      tbody += '</tbody>';
      
      ioEl.innerHTML = '<table class="w-full border-collapse text-left text-xs bg-panel">' + thead + tbody + '</table>';
      
      // Wire events
      ioEl.querySelectorAll('[data-toggle-mute]').forEach(td => {
        td.addEventListener('click', () => {
           const parts = td.getAttribute('data-toggle-mute').split('-');
           const actId = parts.slice(0, parts.length - 1).join('-');
           const chNum = parseInt(parts[parts.length - 1], 10);
           
           if (!sheet.actMutes) sheet.actMutes = {};
           if (!sheet.actMutes[actId]) sheet.actMutes[actId] = {};
           
           sheet.actMutes[actId][chNum] = !sheet.actMutes[actId][chNum];
           renderMixingIOSummary();
        });
      });
    }
`;

code = code.replace(
  /    function renderMasterSchedule\(\) \{/,
  injection + "\n    function renderMasterSchedule() {"
);

fs.writeFileSync('js/views/presets.js', code);
console.log("Injected renderMixingIOSummary");
