const fs = require('fs');

// 1. Update CSS
let css = fs.readFileSync('css/app.css', 'utf8');

const oldSectionTitle = `.adv-print-section-title {
  font-family: "IBM Plex Mono", monospace;
  font-size: 10px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.14em;
  color: #475569;
  margin-bottom: 8px;
}`;

const newSectionTitle = `.adv-print-section-title {
  font-family: "Space Grotesk", sans-serif;
  font-size: 13px;
  font-weight: 800;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: #0f172a;
  background: #f1f5f9;
  border: 1px solid #cbd5e1;
  border-left: 4px solid #0f172a;
  border-radius: 4px;
  padding: 6px 10px;
  margin-bottom: 12px;
  display: flex;
  align-items: center;
  justify-content: space-between;
}`;

const oldSection = `.adv-print-section {
  margin-bottom: 14px;
  border-bottom: 1px solid #e2e8f0;
  padding-bottom: 12px;
  page-break-inside: avoid;
  break-inside: avoid;
}`;

const newSection = `.adv-print-section {
  margin-bottom: 20px;
  padding-bottom: 4px;
  page-break-inside: avoid;
  break-inside: avoid;
}`;

if (css.includes('.adv-print-section-title {')) {
  css = css.replace(oldSectionTitle, newSectionTitle);
  css = css.replace(oldSection, newSection);
  fs.writeFileSync('css/app.css', css);
  console.log("Updated css/app.css");
} else {
  console.log("Could not find CSS to update.");
}

// 2. Update JS
let js = fs.readFileSync('js/views/advancing.js', 'utf8');

const oldJsPattern = `                const outList = Array.isArray(it.channelOutputs) ? it.channelOutputs : [];
                let parts = [];
                if (inList.length) parts.push('<strong style="color:#059669;">' + inList.length + ' In:</strong> ' + ui.esc(inList.map((c) => (c.channel || '') + ':' + (c.instrument || 'In')).join(', ')));
                if (outList.length) parts.push('<strong style="color:#0284c7;">' + outList.length + ' Out:</strong> ' + ui.esc(outList.map((o) => (o.num || '') + ':' + (o.name || o.dest || 'Mix')).join(', ')));
                techReqParts.push('<div style="font-size:11px;display:flex;flex-direction:column;gap:2px;">' + parts.join('') + '</div>');`;

const newJsPattern = `                const outList = Array.isArray(it.channelOutputs) ? it.channelOutputs : [];
                let parts = [];
                
                if (inList.length) {
                  let inHtml = '<div style="margin-bottom: 4px;">';
                  inHtml += '<strong style="color:#059669; font-size: 10px; display: block; margin-bottom: 2px;">' + inList.length + ' Inputs:</strong>';
                  inHtml += '<table style="width: 100%; border-collapse: collapse; font-size: 10px;">';
                  inHtml += '<thead><tr style="border-bottom: 1px solid #cbd5e1; color: #475569; text-align: left;"><th style="padding: 2px; width: 30px;">Ch</th><th style="padding: 2px;">Instrument</th><th style="padding: 2px;">Mic/DI</th></tr></thead>';
                  inHtml += '<tbody>';
                  inList.forEach(c => {
                    inHtml += '<tr style="border-bottom: 1px solid #f1f5f9;">';
                    inHtml += '<td style="padding: 2px; font-weight: 600;">' + (c.channel || '') + '</td>';
                    inHtml += '<td style="padding: 2px;">' + ui.esc(c.instrument || '') + '</td>';
                    inHtml += '<td style="padding: 2px; color: #64748b;">' + ui.esc(c.mic || '') + '</td>';
                    inHtml += '</tr>';
                  });
                  inHtml += '</tbody></table></div>';
                  parts.push(inHtml);
                }
                
                if (outList.length) {
                  let outHtml = '<div>';
                  outHtml += '<strong style="color:#0284c7; font-size: 10px; display: block; margin-bottom: 2px;">' + outList.length + ' Outputs / Monitors:</strong>';
                  outHtml += '<table style="width: 100%; border-collapse: collapse; font-size: 10px;">';
                  outHtml += '<thead><tr style="border-bottom: 1px solid #cbd5e1; color: #475569; text-align: left;"><th style="padding: 2px; width: 30px;">Out</th><th style="padding: 2px;">Name</th><th style="padding: 2px;">Destination</th></tr></thead>';
                  outHtml += '<tbody>';
                  outList.forEach(o => {
                    outHtml += '<tr style="border-bottom: 1px solid #f1f5f9;">';
                    outHtml += '<td style="padding: 2px; font-weight: 600;">' + (o.num || '') + '</td>';
                    outHtml += '<td style="padding: 2px;">' + ui.esc(o.name || '') + '</td>';
                    outHtml += '<td style="padding: 2px; color: #64748b;">' + ui.esc(o.dest || '') + '</td>';
                    outHtml += '</tr>';
                  });
                  outHtml += '</tbody></table></div>';
                  parts.push(outHtml);
                }
                
                techReqParts.push('<div style="font-size:11px;display:flex;flex-direction:column;gap:6px;">' + parts.join('') + '</div>');`;

if (js.includes('if (inList.length) parts.push(\'<strong style="color:#059669;">\' + inList.length + \' In:</strong> \' + ui.esc(inList.map((c) => (c.channel || \'\') + \':\' + (c.instrument || \'In\')).join(\', \')));')) {
  js = js.replace(oldJsPattern, newJsPattern);
  fs.writeFileSync('js/views/advancing.js', js);
  console.log("Updated js/views/advancing.js");
} else {
  console.log("Could not find JS to update.");
}

