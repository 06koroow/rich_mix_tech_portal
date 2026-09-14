import re

with open('js/views/advancing.js', 'r') as f:
    content = f.read()

pattern = re.compile(r'  function openMergeModal\(targetEv\)\s+\{[\s\S]*?RMTP\.router\.render\(\);\s+\}\);\s+\}', re.MULTILINE)

new_func = """  function openMergeModal(targetEv) {
    const allEvents = store.all('advancing').filter(e => 
      e.id !== targetEv.id && 
      !e.deleted && 
      !isPastEvent(e.date) && 
      e.space === targetEv.space
    );
      
    // Sort by date (ascending)
    allEvents.sort((a, b) => new Date(a.date || '9999').getTime() - new Date(b.date || '9999').getTime());

    const optionsHtml = allEvents.map(e => 
      '<option value="' + e.id + '">' + (e.date ? ui.formatDate(e.date) : 'TBC') + ' \u2013 ' + ui.esc(e.name || '') + '</option>'
    ).join('');

    const bodyHtml = 
      '<div class="text-sm text-ink/80 mb-4">' +
        'Select another upcoming event in <strong>' + ui.esc(targetEv.space || 'this space') + '</strong> to merge into <strong>' + ui.esc(targetEv.name) + '</strong>.' +
      '</div>' +
      '<div class="form-group">' +
        '<label>Select source event</label>' +
        '<select id="merge-target" class="form-control">' +
          '<option value="">-- Select Event --</option>' +
          optionsHtml +
        '</select>' +
      '</div>' +
      '<div id="merge-comparison" class="hidden mt-4 space-y-4 border-t border-line pt-4"></div>';

    const footerHtml = 
      '<button data-close class="btn btn-ghost">Cancel</button>' +
      '<button id="confirm-merge-btn" class="btn btn-primary" disabled>Merge Events</button>';

    const m = ui.modal({
      title: 'Merge Event',
      body: bodyHtml,
      footer: footerHtml
    });

    const mergeSelect = m.root.querySelector('#merge-target');
    const compContainer = m.root.querySelector('#merge-comparison');
    const confirmBtn = m.root.querySelector('#confirm-merge-btn');

    mergeSelect.addEventListener('change', () => {
      const sourceId = mergeSelect.value;
      if (!sourceId) {
        compContainer.classList.add('hidden');
        confirmBtn.disabled = true;
        return;
      }
      
      const src = store.find('advancing', sourceId);
      if (!src) return;

      compContainer.classList.remove('hidden');
      confirmBtn.disabled = false;
      
      const renderSection = (sectionName, key, tHtml, sHtml) => {
        return '<div class="mb-4">' +
                 '<div class="text-xs font-semibold uppercase text-muted tracking-wider mb-2">' + sectionName + '</div>' +
                 '<div class="grid grid-cols-2 gap-3">' +
                   '<label class="block p-3 rounded border border-line bg-panel2 cursor-pointer hover:border-accent transition relative">' +
                     '<div class="flex items-center justify-between mb-2 border-b border-line pb-1"><span class="font-medium text-ink text-xs">Target (Keep This)</span><input type="radio" name="merge_' + key + '" value="target" class="w-3.5 h-3.5" checked></div>' +
                     '<div class="text-xs text-muted space-y-1">' + tHtml + '</div>' +
                   '</label>' +
                   '<label class="block p-3 rounded border border-line bg-panel2 cursor-pointer hover:border-accent transition relative">' +
                     '<div class="flex items-center justify-between mb-2 border-b border-line pb-1"><span class="font-medium text-ink text-xs">Source Event</span><input type="radio" name="merge_' + key + '" value="source" class="w-3.5 h-3.5"></div>' +
                     '<div class="text-xs text-muted space-y-1">' + sHtml + '</div>' +
                   '</label>' +
                 '</div>' +
               '</div>';
      };

      const tSched = Array.isArray(targetEv.schedule_items) ? targetEv.schedule_items.length : 0;
      const sSched = Array.isArray(src.schedule_items) ? src.schedule_items.length : 0;

      const tTechCount = Object.keys(targetEv.techRequirements || {}).length + (targetEv.techInfo ? 1 : 0);
      const sTechCount = Object.keys(src.techRequirements || {}).length + (src.techInfo ? 1 : 0);

      compContainer.innerHTML = 
        renderSection('Core Details', 'core', 
          '<div><strong class="text-ink">' + ui.esc(targetEv.name) + '</strong></div>' +
          '<div>' + ui.esc(targetEv.date || 'TBC') + ' ' + ui.esc(targetEv.startTime || '') + ' - ' + ui.esc(targetEv.finishTime || '') + '</div>' +
          '<div>' + (targetEv.artifaxId ? 'Artifax: ' + targetEv.artifaxId : 'No Artifax Link') + '</div>',
          '<div><strong class="text-ink">' + ui.esc(src.name) + '</strong></div>' +
          '<div>' + ui.esc(src.date || 'TBC') + ' ' + ui.esc(src.startTime || '') + ' - ' + ui.esc(src.finishTime || '') + '</div>' +
          '<div>' + (src.artifaxId ? 'Artifax: ' + src.artifaxId : 'No Artifax Link') + '</div>'
        ) +
        renderSection('Tech Requirements', 'tech',
          '<div>' + tTechCount + ' tech sections/notes filled</div>',
          '<div>' + sTechCount + ' tech sections/notes filled</div>'
        ) +
        renderSection('Schedule', 'schedule',
          '<div>' + tSched + ' schedule items</div>',
          '<div>' + sSched + ' schedule items</div>'
        ) +
        '<div class="text-[11px] text-muted mt-2">Note: Linked reports and maintenance issues from both events will be combined automatically. The source event will be moved to the Deleted Events tab.</div>';
    });

    confirmBtn.addEventListener('click', async () => {
      const sourceId = mergeSelect.value;
      if (!sourceId) return;
      const src = store.find('advancing', sourceId);
      if (!src) return;

      const merged = Object.assign({}, targetEv);
      
      const getVal = (key) => {
        const checked = compContainer.querySelector('input[name="merge_' + key + '"]:checked');
        return checked ? checked.value : 'target';
      };

      if (getVal('core') === 'source') {
        merged.name = src.name || '';
        merged.date = src.date || '';
        merged.startTime = src.startTime || '';
        merged.finishTime = src.finishTime || '';
        merged.artifaxId = src.artifaxId || '';
        merged.category = src.category || '';
        merged.clientContact = src.clientContact || '';
        merged.status = src.status || '';
      }

      if (getVal('tech') === 'source') {
        merged.techRequirements = JSON.parse(JSON.stringify(src.techRequirements || {}));
        merged.techInfo = src.techInfo || '';
      }

      if (getVal('schedule') === 'source') {
        merged.schedule_items = JSON.parse(JSON.stringify(src.schedule_items || []));
      }

      // Re-assign reports from source to target
      const sReports = reportsFor(src.id);
      for (const r of sReports) {
        r.eventId = targetEv.id;
        store.upsert('reports', r);
      }

      store.upsert('advancing', merged);
      store.update('advancing', src.id, { deleted: true }); // Soft delete source event
        
      if (RMTP.syncSb && RMTP.syncSb.drain) await RMTP.syncSb.drain();
        
      ui.toast('Events merged successfully', 'ok');
      m.close();
      openEventModal(merged);
      RMTP.router.render();
    });
  }"""

new_content = pattern.sub(new_func, content)
with open('js/views/advancing.js', 'w') as f:
    f.write(new_content)
print("Replaced!")
