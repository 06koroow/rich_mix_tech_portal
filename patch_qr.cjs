const fs = require('fs');
let code = fs.readFileSync('js/qr.js', 'utf8');

const targetQR = `  function ensureItemTrackers(item) {
    if (!item) return item;
    const { refNumber, qrCode, unitTrackers, unitTags } = generateTrackers(item);
    item.refNumber = item.refNumber || refNumber;
    item.qrCode = item.qrCode || qrCode;
    item.unitTrackers = unitTrackers;
    item.unitTags = unitTags;
    return item;
  }`;

const replacementQR = `  function ensureItemTrackers(item) {
    if (!item) return item;
    const { refNumber, qrCode, unitTrackers, unitTags } = generateTrackers(item);
    item.refNumber = item.refNumber || refNumber;
    item.qrCode = item.qrCode || qrCode;
    const currentQty = Math.max(1, Number(item.qty) || 1);
    if (!Array.isArray(item.unitTrackers) || item.unitTrackers.length !== currentQty) {
      item.unitTrackers = unitTrackers;
      item.unitTags = unitTags;
    }
    return item;
  }`;

if (code.includes(targetQR)) {
  code = code.replace(targetQR, replacementQR);
  fs.writeFileSync('js/qr.js', code);
  console.log("Patched qr.js");
} else {
  console.log("Could not find targetQR in qr.js");
}
