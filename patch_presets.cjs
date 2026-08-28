const fs = require('fs');
let code = fs.readFileSync('js/views/presets.js', 'utf8');

const targetFunction = `  /* Helper to extract and synchronize artists from an Advancing Event into a Patch Sheet */
  function syncArtistsFromEvent(targetSheet, eventRecord, isAuto) {
    if (!targetSheet || !eventRecord) return false;
    const schedule = Array.isArray(eventRecord.schedule_items)
      ? eventRecord.schedule_items
      : (Array.isArray(eventRecord.scheduleItems) ? eventRecord.scheduleItems : []);
    const scheduleActs = schedule.filter((it) => it && (it.type === 'act' || (it.customName && it.customName.trim())));

    if (!scheduleActs.length) return false;

    const houseAct = (targetSheet.acts || []).find((a) => a.id === 'act-house') || { id: 'act-house', name: 'House / Venue Core', color: 'slate' };
    const newActs = [houseAct];

    scheduleActs.forEach((it, idx) => {
      const actName = (it.customName && it.customName.trim()) ? it.customName.trim() : (it.label || ('Act ' + (idx + 1)));
      const existing = (targetSheet.acts || []).find((a) => a.name && a.name.toLowerCase().trim() === actName.toLowerCase());
      const colObj = existing ? { id: existing.color } : (ACT_COLORS[(idx + 1) % ACT_COLORS.length] || ACT_COLORS[0]);

      newActs.push({
        id: (existing && existing.id) || ('act-' + (idx + 1) + '-' + Date.now().toString(36)),
        name: actName,
        color: colObj.id,
        stageTime: it.time || '',
        duration: it.duration || '',
        channelInputs: Array.isArray(it.channelInputs) ? JSON.parse(JSON.stringify(it.channelInputs)) : [],
        channelOutputs: Array.isArray(it.channelOutputs) ? JSON.parse(JSON.stringify(it.channelOutputs)) : []
      });
    });

    targetSheet.acts = newActs;
    return true;
  }`;

const replacementFunction = `  /* Helper to extract and synchronize artists from an Advancing Event into a Patch Sheet */
  function syncArtistsFromEvent(targetSheet, eventRecord, isAuto) {
    if (!targetSheet || !eventRecord) return false;
    const schedule = Array.isArray(eventRecord.schedule_items)
      ? eventRecord.schedule_items
      : (Array.isArray(eventRecord.scheduleItems) ? eventRecord.scheduleItems : []);
    const scheduleActs = schedule.filter((it) => it && (it.type === 'act' || (it.customName && it.customName.trim())));

    const houseAct = (targetSheet.acts || []).find((a) => a.id === 'act-house') || { id: 'act-house', name: 'House / Venue Core', color: 'slate' };
    
    // Sync master global channels into House Act
    const techReqs = eventRecord.tech_requirements || eventRecord.techRequirements || {};
    if (techReqs.channel_list) {
      if (Array.isArray(techReqs.channel_list.inputs)) {
        houseAct.channelInputs = JSON.parse(JSON.stringify(techReqs.channel_list.inputs));
      }
      if (Array.isArray(techReqs.channel_list.outputs)) {
        houseAct.channelOutputs = JSON.parse(JSON.stringify(techReqs.channel_list.outputs));
      }
    }

    if (!scheduleActs.length && (!houseAct.channelInputs || !houseAct.channelInputs.length)) return false;

    const newActs = [houseAct];

    scheduleActs.forEach((it, idx) => {
      const actName = (it.customName && it.customName.trim()) ? it.customName.trim() : (it.label || ('Act ' + (idx + 1)));
      const existing = (targetSheet.acts || []).find((a) => a.name && a.name.toLowerCase().trim() === actName.toLowerCase());
      const colObj = existing ? { id: existing.color } : (ACT_COLORS[(idx + 1) % ACT_COLORS.length] || ACT_COLORS[0]);

      newActs.push({
        id: (existing && existing.id) || ('act-' + (idx + 1) + '-' + Date.now().toString(36)),
        name: actName,
        color: colObj.id,
        stageTime: it.time || '',
        duration: it.duration || '',
        channelInputs: Array.isArray(it.channelInputs) ? JSON.parse(JSON.stringify(it.channelInputs)) : [],
        channelOutputs: Array.isArray(it.channelOutputs) ? JSON.parse(JSON.stringify(it.channelOutputs)) : []
      });
    });

    targetSheet.acts = newActs;
    return true;
  }`;

if (code.includes(targetFunction)) {
  code = code.replace(targetFunction, replacementFunction);
  fs.writeFileSync('js/views/presets.js', code);
  console.log("Patched syncArtistsFromEvent");
} else {
  console.log("Could not find targetFunction in presets.js");
}
