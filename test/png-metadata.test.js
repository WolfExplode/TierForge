import test from 'node:test';
import assert from 'node:assert/strict';

await import('../png-metadata.js');

const pixel = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
  'base64',
);

test('TierForge board JSON round-trips through PNG metadata', async () => {
  const board = { v: 1, title: 'Unicode ⚒ board', tiers: [{ label: 'S', items: ['one'] }],
    pool: [], items: { one: { name: 'Café' } } };
  const packed = TierForgePng.embed(pixel, board);
  assert.ok(packed.length > pixel.length);
  assert.deepEqual(await TierForgePng.extract(packed), board);
});

test('ordinary PNGs remain ordinary image imports', async () => {
  assert.equal(await TierForgePng.extract(pixel), null);
});

test('re-embedding replaces stale TierForge metadata', async () => {
  const first = TierForgePng.embed(pixel, { type: 'tierforge-item', item: { name: 'Old name' } });
  const second = TierForgePng.embed(first, { type: 'tierforge-item', item: { name: 'Booming Conch' } });
  assert.deepEqual(await TierForgePng.extract(second),
    { type: 'tierforge-item', item: { name: 'Booming Conch' } });
  assert.equal(second.length, first.length + 'Booming Conch'.length - 'Old name'.length);
});
