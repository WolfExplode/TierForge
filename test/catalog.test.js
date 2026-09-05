import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { allowedImageHost } from '../src/worker.js';

for (const [name, minimum] of [['sts2-relics', 250], ['sts2-cards', 500]]) {
  test(`${name} bundled catalog has usable wiki images`, async () => {
    const catalog = JSON.parse(await readFile(new URL(`../catalogs/${name}.json`, import.meta.url)));
    assert.ok(catalog.items.length >= minimum);
    assert.ok(catalog.items.every(item => item.name && /^https:\/\/slaythespire\.wiki\.gg\/images\//.test(item.img)));
  });
}

test('image proxy only permits configured source hosts', () => {
  assert.equal(allowedImageHost('slaythespire.wiki.gg'), true);
  assert.equal(allowedImageHost('tiermaker.com'), true);
  assert.equal(allowedImageHost('cdn.tiermaker.com'), true);
  assert.equal(allowedImageHost('example.com'), false);
  assert.equal(allowedImageHost('tiermaker.com.example.com'), false);
});
