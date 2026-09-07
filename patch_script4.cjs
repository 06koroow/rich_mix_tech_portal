const fs = require('fs');
let content = fs.readFileSync('js/views/presets.js', 'utf8');

const replacement = `    // Sync master global channels into House Act
    const techReqs = eventRecord.tech_requirements || eventRecord.techRequirements || {};
    const hasGlobal = techReqs.channel_list && (techReqs.channel_list.inputs || techReqs.channel_list.outputs);
    if (hasGlobal) {
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
        // If a global patch sheet exists, ignore the artist specific custom lists
        channelInputs: hasGlobal ? [] : (Array.isArray(it.channelInputs) ? JSON.parse(JSON.stringify(it.channelInputs)) : []),
        channelOutputs: hasGlobal ? [] : (Array.isArray(it.channelOutputs) ? JSON.parse(JSON.stringify(it.channelOutputs)) : [])
      });
    });`;

const regex = /\/\/ Sync master global channels into House Act[\s\S]*?channelOutputs: Array\.isArray\(it\.channelOutputs\) \? JSON\.parse\(JSON\.stringify\(it\.channelOutputs\)\) : \[\]\n\s*\}\);\n\s*\}\);/;
content = content.replace(regex, replacement);

fs.writeFileSync('js/views/presets.js', content);
