import test from 'node:test';
import assert from 'node:assert/strict';
import { access, readFile } from 'node:fs/promises';
import { allowedImageHost, sanitizeLiveDrawingMessage, sanitizeSharedBoard, TierForgeRoom } from '../src/worker.js';
await import('../png-metadata.js');

for (const [name, minimum] of [['sts2-relics', 250], ['sts2-cards', 500]]) {
  test(`${name} bundled catalog has hosted images and remote fallbacks`, async () => {
    const catalog = JSON.parse(await readFile(new URL(`../catalogs/${name}.json`, import.meta.url)));
    assert.ok(catalog.items.length >= minimum);
    assert.ok(catalog.items.every(item => item.name && /^Images\/catalogs\//.test(item.img)));
    assert.ok(catalog.items.every(item => typeof item.description === 'string' && item.notes === ''));
    assert.ok(catalog.items.every(item => /^https:\/\/slaythespire\.wiki\.gg\/images\//.test(item.fallbackImg)));
    await Promise.all(catalog.items.map(item => access(new URL(`../${item.img}`, import.meta.url))));
    const sample = catalog.items[Math.floor(catalog.items.length / 2)];
    const metadata = await TierForgePng.extract(await readFile(new URL(`../${sample.img}`, import.meta.url)));
    assert.equal(metadata.type, 'tierforge-item');
    assert.equal(metadata.item.name, sample.name);
    assert.equal(metadata.item.description, sample.description);
  });
}

test('image proxy only permits configured source hosts', () => {
  assert.equal(allowedImageHost('slaythespire.wiki.gg'), true);
  assert.equal(allowedImageHost('tiermaker.com'), true);
  assert.equal(allowedImageHost('cdn.tiermaker.com'), true);
  assert.equal(allowedImageHost('example.com'), false);
  assert.equal(allowedImageHost('tiermaker.com.example.com'), false);
});

test('co-op boards keep shared images and replace local images with placeholders', () => {
  const board = { tiers: [], pool: ['local', 'catalog', 'remote'], items: {
    local: { id: 'local', name: 'Local', img: 'tierforge-image:private.png', localImg: 'Images/imports/private.png' },
    catalog: { id: 'catalog', name: 'Catalog', img: 'Images/catalogs/game/item.png' },
    remote: { id: 'remote', name: 'Remote', img: 'https://example.com/item.png' },
  } };
  const shared = sanitizeSharedBoard(board);
  assert.equal(shared.items.local.img, undefined);
  assert.equal(shared.items.local.localImg, undefined);
  assert.equal(shared.items.catalog.img, 'Images/catalogs/game/item.png');
  assert.equal(shared.items.remote.img, 'https://example.com/item.png');
  assert.equal(board.items.local.img, 'tierforge-image:private.png');
});

test('live co-op drawing messages are bounded and sanitized', () => {
  assert.deepEqual(sanitizeLiveDrawingMessage({phase:'start',id:'stroke-1',subBoardId:'main',tool:'erase',
    color:'#AABBCC',width:999,points:[{x:12,y:34},{x:56,y:78}]}),
  {phase:'start',id:'stroke-1',subBoardId:'main',tool:'erase',color:'#AABBCC',width:200,points:[{x:12,y:34}]});
  assert.deepEqual(sanitizeLiveDrawingMessage({phase:'points',id:'stroke-1',points:[{x:-20000,y:20000},{x:'bad',y:1}]}),
    {phase:'points',id:'stroke-1',points:[{x:-10000,y:10000}]});
  assert.deepEqual(sanitizeLiveDrawingMessage({phase:'end',id:'stroke-1'}),{phase:'end',id:'stroke-1'});
  assert.equal(sanitizeLiveDrawingMessage({phase:'start',id:'',points:[]}),null);
});

test('live co-op drawing is relayed without storing room state', async () => {
  const sent=[];
  const sender={deserializeAttachment:()=>({participantId:'one'}),send:()=>{}};
  const peer={deserializeAttachment:()=>({participantId:'two'}),send:value=>sent.push(JSON.parse(value))};
  const roomState={participants:{one:{id:'one'},two:{id:'two'}}};
  const room=new TierForgeRoom({storage:{get:async()=>roomState},getWebSockets:()=>[sender,peer]});
  await room.webSocketMessage(sender,JSON.stringify({type:'drawing',phase:'start',id:'stroke-1',
    subBoardId:'main',tool:'pen',color:'#123456',width:8,points:[{x:10,y:20}]}));
  assert.deepEqual(sent,[{type:'drawing',participantId:'one',phase:'start',id:'stroke-1',
    subBoardId:'main',tool:'pen',color:'#123456',width:8,points:[{x:10,y:20}]}]);
});
