import { readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const catalogs = [
  { id: 'sts2-cards', directory: 'Images/catalogs/slay-the-spire-2/cards' },
  { id: 'sts2-relics', directory: 'Images/catalogs/slay-the-spire-2/relics' },
];

const slug = value => String(value || '').toLowerCase()
  .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

for (const definition of catalogs) {
  const catalogPath = path.join(root, 'catalogs', `${definition.id}.json`);
  const assetDirectory = path.join(root, ...definition.directory.split('/'));
  const catalog = JSON.parse(await readFile(catalogPath, 'utf8'));
  const files = await readdir(assetDirectory);
  const seen = new Set();
  const missing = [];

  catalog.items = catalog.items.map((item, index) => {
    let key = slug(item.name) || String(index + 1);
    if (seen.has(key)) key = `${key}-${index + 1}`;
    seen.add(key);
    const matches = files.filter(file => file.startsWith(`${key}_`));
    if (matches.length !== 1) {
      missing.push(`${item.name} (${key}: ${matches.length} files)`);
      return item;
    }
    const remote = [item.fallbackImg, item.src, item.img]
      .find(value => /^https?:\/\//i.test(value || '')) || '';
    return {
      ...item,
      img: `${definition.directory}/${matches[0]}`,
      ...(remote ? { fallbackImg: remote, src: remote } : {}),
    };
  });

  if (missing.length) {
    throw new Error(`${definition.id}: could not uniquely link ${missing.length} item(s):\n${missing.join('\n')}`);
  }
  await writeFile(catalogPath, `${JSON.stringify(catalog)}\n`);
  process.stdout.write(`Linked ${catalog.items.length} ${definition.id} images.\n`);
}
