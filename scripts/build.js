import { copyFile, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const output = path.join(root, 'public');

await rm(output, { recursive: true, force: true });
await mkdir(output, { recursive: true });
const html = await readFile(path.join(root, 'tierforge.html'), 'utf8');
await Promise.all([
  writeFile(path.join(output, 'index.html'), html.replace('</head>',
    '<meta name="tierforge-runtime" content="static">\n</head>')),
  copyFile(path.join(root, 'app.css'), path.join(output, 'app.css')),
  copyFile(path.join(root, 'app.js'), path.join(output, 'app.js')),
]);

process.stdout.write('Built Cloudflare static assets in public/\n');
