import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { importSource } from '../src/importer.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const output = path.join(root, 'catalogs');
const sources = [
  ['sts2-relics', 'https://slaythespire.wiki.gg/wiki/Slay_the_Spire_2:Relics_List'],
  ['sts2-cards', 'https://slaythespire.wiki.gg/wiki/Slay_the_Spire_2:Cards_List'],
];

await mkdir(output, { recursive: true });
for (const [id, url] of sources) {
  process.stdout.write(`Refreshing ${id}...\n`);
  const pack = await importSource(url, { root, log: message => process.stdout.write(`${message}\n`) });
  const catalog = {
    id,
    source: url,
    updated: new Date().toISOString(),
    items: pack.items.map(({ name, tags, notes, img, src }) => ({ name, tags, notes, img, src })),
  };
  await writeFile(path.join(output, `${id}.json`), `${JSON.stringify(catalog)}\n`);
  process.stdout.write(`Saved ${catalog.items.length} items.\n`);
}
