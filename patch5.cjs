const fs = require('fs');
let code = fs.readFileSync('supabase/functions/artifax-sync/index.ts', 'utf8');

const regex = /return list\.map\(\(r\) => \(\{\s*id: String\([^\)]+\),\s*groupId: String\([^\)]+\),\s*title: String\([^\)]+\),[\s\S]*?\}\)\);/;

const replacement = `return list.map((r) => {
    const title = String(r.title || r.name || r.EventName || r.arrangement_description || r.arrangement_name || "Untitled");
    const groupId = String(r.arrangement_id || r.arrangementId || r.ArrangementId || r.groupId || r.GroupId || r.event_id || r.EventId || title);
    
    return {
      id: String(r.id || r.instanceId || r.InstanceId || r.event_id),
      groupId: groupId,
      title: title,
      room: String(r.room || r.roomName || r.RoomName || r.room_name || ""),
      type: String(r.type || r.arrangementType || r.ArrangementType || r.arrangement_type_name || ""),
      start: String(r.start || r.startDateTime || r.StartDateTime || r.start_date_time || ""),
      end: String(r.end || r.endDateTime || r.EndDateTime || r.end_date_time || ""),
      contact: String(r.contact || r.contactName || r.CustomerName || r.client_name || r.arrangement_contact_entity_full_name || ""),
      notes: String(r.notes || r.description || ""),
      status: String(r.status || r.Status || r.event_status_name || "Confirmed"),
    };
  });`;

code = code.replace(regex, replacement);
fs.writeFileSync('supabase/functions/artifax-sync/index.ts', code);
