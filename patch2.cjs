const fs = require('fs');
let code = fs.readFileSync('js/views/advancing.js', 'utf8');

code = code.replace(
  /const baseId = record\.id;\s+checkedSpaces\.forEach\(\(sp, idx\) => \{\s+const multiRecord = Object\.assign\(\{\}, record, \{\s+id: idx === 0 \? baseId : store\.uid\('evt'\),\s+space: sp\s+\}\);/,
  `const baseId = record.id;
        const generatedGroupId = store.uid('grp'); // generate a shared groupId
        checkedSpaces.forEach((sp, idx) => {
          const multiRecord = Object.assign({}, record, {
            id: idx === 0 ? baseId : store.uid('evt'),
            groupId: generatedGroupId,
            space: sp
          });`
);

fs.writeFileSync('js/views/advancing.js', code);
