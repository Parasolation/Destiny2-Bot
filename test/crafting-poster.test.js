import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { buildPatternSources } from '../src/crafting-sources.js';
import { craftingPage, groupPatterns } from '../src/crafting.js';
import { BungieAssets, bungieImageUrl } from '../src/bungie-assets.js';
import { craftingPosterHtml } from '../src/crafting-poster.js';

test('raid badges resolve missing/reissued sources, and real raid art wins over same-name story missions', () => {
  const enrich = buildPatternSources({ items: {
    1: { hash: 1, itemType: 3, displayProperties: { name: '测试弓' }, inventory: { recipeItemHash: 10 } },
    2: { hash: 2, itemType: 3, displayProperties: { name: '测试弓' }, collectibleHash: 5 },
  }, collectibles: { 5: { itemHash: 2, displayProperties: { name: '测试弓' }, sourceString: '来源：“救赎花园”突袭' } },
  nodes: { 8: { hash: 8, displayProperties: { name: '突袭：最后一愿' }, children: { presentationNodes: [{ presentationNodeHash: 9 }] } },
    9: { hash: 9, children: { collectibles: [{ collectibleHash: 5 }] } } },
  activities: { 1: { hash: 1, displayProperties: { name: '最后一愿' }, activityModeTypes: [2,7], pgcrImage: '/img/destiny_content/pgcr/story.jpg' },
    2: { hash: 2, displayProperties: { name: '最后一愿: 标准' }, activityModeTypes: [4,7], pgcrImage: '/img/destiny_content/pgcr/raid.jpg' } } });
  const result = enrich({ name: '测试弓', icon: '/record.jpg' });
  assert.equal(result.group.name, '最后一愿'); assert.equal(result.group.background, '/img/destiny_content/pgcr/raid.jpg');
  assert.equal(result.icon, '/record.jpg');
  assert.equal(enrich({ name: '无法匹配' }).group.name, '来源待确认');
});

test('ambiguous crafted weapon matches do not pick an arbitrary activity', () => {
  const weapon = (hash, source) => ({ hash, itemType: 3, displayProperties: { name: '重名武器' }, inventory: { recipeItemHash: hash + 100 }, collectibleHash: source });
  const enrich = buildPatternSources({ items: { 1: weapon(1, 3), 2: weapon(2, 4) }, collectibles: { 3: { sourceString: '来源：深岩墓室' }, 4: { sourceString: '来源：最后一愿' } } });
  assert.equal(enrich({ name: '重名武器' }).group.name, '来源待确认');
});

test('a complete poster keeps every pattern once, supports activity filtering and escapes all profile text', () => {
  const rows = Array.from({ length: 183 }, (_, i) => ({ hash: String(i), name: `武器${i}`, known: i !== 182, unlocked: i < 43,
    progress: i === 182 ? null : i % 5, target: 5, group: { name: i < 100 ? '门徒誓约' : '深岩墓室', order: i < 100 ? 0 : 1 } }));
  const result = craftingPage(rows, '', 2, true);
  assert.equal(result.rows.length, 183);
  assert.equal(craftingPage(rows, '门徒', 1, true).rows.length, 100);
  assert.equal(groupPatterns(result.rows).reduce((n, g) => n + g.rows.length, 0), 183);
  const html = craftingPosterHtml({ patterns: result.rows, ...result, playerName: '<script>unsafe</script>', filter: '"<&' });
  assert.equal((html.match(/data-pattern=/g) || []).length, 183);
  assert.ok(html.includes('data-pattern="182"')); assert.ok(html.includes('未返回进度'));
  assert.ok(!html.includes('<script>')); assert.ok(html.includes('&lt;script&gt;'));
  assert.equal((html.match(/data-pattern="182"/g) || []).length, 1);
});

test('art is limited to official static raster images, fetched once and cached; failed art is optional', async t => {
  for (const invalid of ['https://evil.test/a.jpg', 'https://www.bungie.net.evil.test/common/destiny2_content/a.jpg', 'http://www.bungie.net/common/destiny2_content/a.jpg', '/Platform/account.jpg', '/img/destiny_content/a.svg', 'file:///tmp/a.png', 'https://user:secret@www.bungie.net/img/destiny_content/a.jpg', '/img/destiny_content/a.jpg?secret=x']) assert.equal(bungieImageUrl(invalid), null);
  const parent = path.resolve(tmpdir()); const directory = await mkdtemp(path.join(parent, 'guardian-art-'));
  t.after(async () => { if (path.dirname(path.resolve(directory)) !== parent || !path.basename(directory).startsWith('guardian-art-')) throw new Error('Invalid cleanup path'); await rm(directory, { recursive: true, force: true }); });
  let calls = 0;
  const request = async (url, options) => { calls++; assert.equal(options.redirect, 'error'); return new Response(Buffer.from([255,216,255,224,0,0])); };
  const assets = new BungieAssets({ directory, request }); const image = '/img/destiny_content/test.jpg';
  const results = await Promise.all([assets.get(image), assets.get(image)]);
  assert.equal(calls, 1); assert.equal(results[0], results[1]);
  assert.match(await new BungieAssets({ directory, request }).get(image), /^data:image\/jpeg;base64,/); assert.equal(calls, 1);
  const broken = new BungieAssets({ directory, request: async () => new Response('<html>no image</html>') });
  assert.equal(await broken.get('/img/destiny_content/missing.jpg'), null);
});
