const fs = require('fs');
let code = fs.readFileSync('js/views/venues.js', 'utf8');

// Patching the empty state
code = code.replace(
  /'<div class="flex h-\[calc\(100vh-100px\)\] border border-line rounded-xl bg-panel overflow-hidden shadow-sm">'\s*\+\s*'<div class="w-64 border-r border-line bg-panel2\/30 flex flex-col">'/,
  "'<div class=\"flex flex-col md:flex-row h-[calc(100vh-100px)] border border-line rounded-xl bg-panel overflow-hidden shadow-sm\">' +\n        '<div class=\"w-full md:w-64 border-b md:border-b-0 md:border-r border-line bg-panel2/30 flex flex-col shrink-0 max-h-[35vh] md:max-h-none overflow-y-auto\">'"
);

// Patching the loaded state
code = code.replace(
  /'<div class="flex h-\[calc\(100vh-100px\)\] border border-line rounded-xl bg-panel overflow-hidden shadow-sm">'\s*\+\s*\/\/ Left Sidebar: List of Venues\s*'<div class="w-64 border-r border-line bg-panel2\/30 flex flex-col">'/,
  "'<div class=\"flex flex-col md:flex-row h-[calc(100vh-100px)] border border-line rounded-xl bg-panel overflow-hidden shadow-sm\">' +\n        // Left Sidebar: List of Venues\n        '<div class=\"w-full md:w-64 border-b md:border-b-0 md:border-r border-line bg-panel2/30 flex flex-col shrink-0 max-h-[35vh] md:max-h-none\">'"
);

// Header flex responsiveness
code = code.replace(
  /'<div class="px-6 py-4 border-b border-line flex items-center justify-between bg-panel\/50 backdrop-blur sticky top-0 z-10">'\s*\+\s*'<h1 class="text-xl font-display font-bold">'\s*\+\s*ui\.esc\(m\.activeSpace \|\| 'Select a Venue'\)\s*\+\s*'<\/h1>'\s*\+\s*'<div class="flex gap-2">'/g,
  "'<div class=\"px-4 md:px-6 py-4 border-b border-line flex flex-col md:flex-row md:items-center justify-between gap-3 bg-panel/50 backdrop-blur sticky top-0 z-10\">' +\n            '<h1 class=\"text-xl font-display font-bold\">' + ui.esc(m.activeSpace || 'Select a Venue') + '</h1>' +\n            '<div class=\"flex flex-wrap gap-2\">'"
);

// Grids responsiveness
code = code.replace(/class="grid grid-cols-2/g, 'class="grid grid-cols-1 md:grid-cols-2');

// Make inventory header responsive
code = code.replace(
  /'<div class="flex items-center justify-between gap-2 border-b border-line pb-2 mb-3">'\s*\+\s*'<h3 class="text-xs font-bold uppercase tracking-wider text-muted">Base Inventory<\/h3>'\s*\+\s*'<div class="flex items-center gap-2">'/g,
  "'<div class=\"flex flex-col md:flex-row md:items-center justify-between gap-3 border-b border-line pb-2 mb-3\">' +\n                '<h3 class=\"text-xs font-bold uppercase tracking-wider text-muted\">Base Inventory</h3>' +\n                '<div class=\"flex flex-wrap items-center gap-2\">'"
);


fs.writeFileSync('js/views/venues.js', code);
console.log('Patched venues.js for mobile!');
