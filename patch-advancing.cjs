const fs = require('fs');
let code = fs.readFileSync('js/views/advancing.js', 'utf8');

const regex = /if \(afx\) afx\.addEventListener\('click', async \(\) => \{[\s\S]*?\}\);/;

const newLogic = `
  if (afx) afx.addEventListener('click', async () => {
    afx.disabled = true; ui.toast('Syncing from Artifax...', 'info');
    try {
      const res = await fetch('/api/artifax/sync');
      if (!res.ok) {
        const text = await res.text();
        ui.toast('Artifax HTTP Error: ' + text, 'danger'); 
        afx.disabled = false; 
        return; 
      }
      
      const data = await res.json();
      if (data.error) {
        ui.toast('Artifax API Error: ' + data.error, 'danger');
        afx.disabled = false;
        return;
      }
      
      const list = Array.isArray(data) ? data : (data.instances ?? data.results ?? data.events ?? []);
      
      const ROOM_TO_SPACE = {
        "The Stage": "The Stage",
        "Studio": "The Studio",
        "The Studio": "The Studio",
        "Mix": "The Mix",
        "The Mix": "The Mix",
        "Screen 1": "Screen One",
        "Screen 2": "Screen Two",
        "Screen 3": "Screen Three"
      };

      const toCategory = (type) => {
        const t = (type || "").toLowerCase();
        if (/cinema|film|screening|dcp/.test(t)) return "Cinema";
        if (/hire|private|wedding|corporate|conference|launch/.test(t)) return "Private Hires";
        return "Programme";
      };

      let created = 0, updated = 0, skipped = 0;
      const existingEvents = store.getAll('advancing');

      for (const r of list) {
        const id = String(r.id ?? r.instanceId ?? r.InstanceId);
        const title = r.title ?? r.name ?? r.EventName ?? "Untitled";
        const room = r.room ?? r.roomName ?? r.RoomName ?? "";
        const type = r.type ?? r.arrangementType ?? r.ArrangementType ?? "";
        const start = r.start ?? r.startDateTime ?? r.StartDateTime;
        const end = r.end ?? r.endDateTime ?? r.EndDateTime;
        const contact = r.contact ?? r.contactName ?? r.CustomerName ?? "";
        const status = r.status ?? r.Status ?? "Confirmed";

        const space = ROOM_TO_SPACE[room] ?? "";
        if (!space) { skipped++; continue; }

        const startDate = start ? new Date(start) : null;
        const endDate = end ? new Date(end) : null;
        const hhmm = (d) => (d ? d.toISOString().slice(11, 16) : "");
        const cancelled = /cancel/i.test(status);

        const booking = {
          artifaxId: id,
          name: title,
          category: toCategory(type),
          space: space,
          date: startDate ? startDate.toISOString().slice(0, 10) : "",
          startTime: hhmm(startDate),
          finishTime: hhmm(endDate),
          clientContact: contact,
          status: cancelled ? "Cancelled" : "Confirmed"
        };

        const existing = existingEvents.find(e => e.artifaxId === id);
        let row = null;
        
        if (existing) {
          row = { ...existing, ...booking, id: existing.id };
          updated++;
        } else {
          row = { id: 'evt-afx-' + id, ...booking };
          created++;
        }
        
        store.upsert('advancing', row);
      }

      if (RMTP.syncSb && RMTP.syncSb.drain) RMTP.syncSb.drain();
      
      ui.toast('Artifax: ' + created + ' added, ' + updated + ' updated', 'ok');
      RMTP.router.render();
    } catch (e) {
      ui.toast('Artifax sync failed: ' + e.message, 'danger'); afx.disabled = false;
    }
  });`;

code = code.replace(regex, newLogic.trim());
fs.writeFileSync('js/views/advancing.js', code);
console.log("Patched advancing.js");
