import fs from 'fs';

fs.mkdirSync('dist/esm', { recursive: true });
fs.writeFileSync('dist/esm/package.json', JSON.stringify({ type: 'module' }, null, 2) + '\n');
