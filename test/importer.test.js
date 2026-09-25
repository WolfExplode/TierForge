import test from 'node:test';
import assert from 'node:assert/strict';
import { originalWikiImageUrl, parseCharacters, parseTemplateCode, parseWikiCards, parseWikiPotions, parseWikiRelics,
  prettyName, selectNamedItems, wikiItemType } from '../src/importer.js';

test('prettyName derives a readable item name', () => {
  assert.equal(prettyName('ashenStrike_card.png'), 'Ashen Strike Card');
});

test('parseTemplateCode retains rows and placements', () => {
  const result = parseTemplateCode('<script>templateCode = "cards==Great|1|12|13==Okay|3|14"</script>');
  assert.equal(result.template, 'cards');
  assert.deepEqual(result.tiers[0], { label: 'Great', color: '#ffbf7f', ids: ['12', '13'] });
});

test('parseCharacters reads TierMaker tiles', () => {
  const result = parseCharacters('<div id="4" class="character" title="Bash" style="background-image:url(&quot;/bash.png&quot;)"></div>');
  assert.deepEqual(result, [{ key: '4', src: 'https://tiermaker.com/bash.png', name: 'Bash' }]);
});

test('originalWikiImageUrl removes the MediaWiki thumbnail segment', () => {
  assert.equal(originalWikiImageUrl('https://slaythespire.wiki.gg/images/thumb/a/a1/Card.png/150px-Card.png'),
    'https://slaythespire.wiki.gg/images/a/a1/Card.png');
});

test('parseWikiCards extracts searchable metadata', () => {
  const html = '<div class="card-box" data-name="Test Card" data-color="Ironclad" data-rarity="Rare" data-type="Attack" data-tags="Strike, Fire" data-cost="2">' +
    '<div class="img-base"><img src="/images/Test.png"></div><div class="desc-base">Deal <b>12</b> damage.</div></div>';
  const [card] = parseWikiCards(html);
  assert.equal(card.name, 'Test Card');
  assert.equal(card.src, 'https://slaythespire.wiki.gg/images/Test.png');
  assert.deepEqual(card.tags, ['Ironclad', 'Rare', 'Attack', 'Strike', 'Fire']);
  assert.equal(card.description, 'Cost 2. Deal 12 damage.');
  assert.equal(card.notes, '');
});

test('parseWikiRelics extracts relic metadata and original image URLs', () => {
  const html = '<div class="relic-box" data-name="Arcane Scroll" data-rarity="Common" data-character="Any" data-ancient="Neow" data-ancient-upgrade="Yes" data-tags="Draw, Magic">' +
    '<span class="img-base"><img src="/images/thumb/StS2_ArcaneScroll.png/80px-StS2_ArcaneScroll.png"></span>' +
    '<div class="relic-desc">Draw <b>2</b> cards and gain <img alt="StS2 EnergyColorless.png" src="energy.png">.</div></div>';
  const [relic] = parseWikiRelics(html);
  assert.equal(relic.name, 'Arcane Scroll');
  assert.equal(relic.src, 'https://slaythespire.wiki.gg/images/StS2_ArcaneScroll.png');
  assert.deepEqual(relic.tags, ['Common', 'Any', 'Neow', 'Ancient', 'Draw', 'Magic']);
  assert.equal(relic.description, 'Draw 2 cards and gain 1 Energy.');
  assert.equal(relic.notes, '');
});

test('parseWikiPotions extracts potion metadata and original image URLs', () => {
  const html = '<div class="potion-box" data-name="Block Potion" data-rarity="Common" data-character="Any" data-tags="Block">' +
    '<span class="potion-image-wrap"><span class="img-base"><a href="/wiki/x"><img alt="StS2 BlockPotion.png" src="/images/thumb/StS2_BlockPotion.png/80px-StS2_BlockPotion.png"></a></span></span>' +
    '<div class="potion-text"><div class="potion-meta">Common - Any</div><div class="potion-desc"><div class="potion-desc compendium-cell-desc">Gain <b>12</b> Block.</div></div></div></div>';
  const [potion] = parseWikiPotions(html);
  assert.equal(potion.name, 'Block Potion');
  assert.equal(potion.src, 'https://slaythespire.wiki.gg/images/StS2_BlockPotion.png');
  assert.deepEqual(potion.tags, ['Common', 'Any', 'Block']);
  assert.equal(potion.description, 'Gain 12 Block.');
});

test('wikiItemType reads the list type from the URL', () => {
  assert.equal(wikiItemType('https://slaythespire.wiki.gg/wiki/Slay_the_Spire_2:Relics_List'), 'relic');
  assert.equal(wikiItemType('https://slaythespire.wiki.gg/wiki/Slay_the_Spire_2:Potions_List'), 'potion');
  assert.equal(wikiItemType('https://slaythespire.wiki.gg/wiki/Slay_the_Spire_2:Cards_List'), 'card');
});

test('named item selection is punctuation-insensitive and optional', () => {
  const items = [{ name: 'Ashen Strike' }, { name: 'All For One' }, { name: 'Pomander' }];
  assert.deepEqual(selectNamedItems(items, ['ashen-strike', 'All_for_One']), items.slice(0, 2));
  assert.deepEqual(selectNamedItems(items, ['80px StS2Pomander']), items.slice(2));
  assert.equal(selectNamedItems(items), items);
  assert.deepEqual(selectNamedItems(items, []), []);
});
