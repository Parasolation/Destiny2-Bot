import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { parseStarsideAssignment, buildRecommendations, StarsideRecommendations } from '../src/starside.js';
import { equipmentHtml } from '../src/equipment-cards.js';

function fixture() {
  const first = ['100', '测试枪']; first[15] = 0;
  const second = ['101', '测试枪']; second[15] = 1;
  const poolRow = [0, [], [[0, 1, 0]], [[0, 3]], 0, ['填装速度', '不存在'], 0];
  return { index: { w: [first, second] }, pool: {
    w: [poolRow, [0, [], [[0, 1, 0]], [], 0, [], 0]],
    p: [[200, '测试词条'], [201, '测试词条']], L: [[[0, 1]]], M: [[['填装速度']]],
  }, text: { au: { 0: [['Aegis', [['清怪', 'A']], ['不应复制的长评语']]], 1: [] } } };
}

async function temp(t) {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'guardian-starside-'));
  t.after(() => rm(dir, { recursive: true, force: true })); return dir;
}

test('Starside assignments are parsed as JSON, and recommendations match the release and enhanced hashes', () => {
  assert.deepEqual(parseStarsideAssignment('window.WPN = {"w":[]};', 'WPN'), { w: [] });
  assert.throws(() => parseStarsideAssignment('window.WPN = {}; process.exit();', 'WPN'));
  assert.throws(() => parseStarsideAssignment('window.WPN = (() => ({}))();', 'WPN'));
  const f = fixture(), data = buildRecommendations(f.index, f.pool, f.text, 123);
  assert.deepEqual(data.weapons[100].perks, { 200: 3, 201: 3 });
  assert.deepEqual(data.weapons[101].perks, {});
  assert.deepEqual(data.weapons[100].masterworks, ['填装速度']);
  assert.equal(data.weapons[100].ratings[0].context, '清怪');
  assert.ok(!JSON.stringify(data).includes('不应复制的长评语'));
  assert.throws(() => buildRecommendations({ w: [] }, f.pool, f.text));
});

test('recommendation requests coalesce, persist across restarts, and show dated stale data during a source outage', async t => {
  const directory = await temp(t), f = fixture(); let now = 100000, calls = 0;
  const request = async name => { calls++; return `window.${{ index: 'WPN', pool: 'WPN_POOL', text: 'WPN_TEXT' }[name]} = ${JSON.stringify(f[name])};`; };
  const first = new StarsideRecommendations({ directory, request, clock: () => now });
  await Promise.all([first.load(), first.load()]); assert.equal(calls, 3);
  const second = new StarsideRecommendations({ directory, request, clock: () => now });
  const [missing] = await second.annotate([{ hash: '999', name: '测试枪' }]);
  assert.equal(calls, 3); assert.equal(missing.recommendations.status, 'missing');
  assert.equal(missing.recommendations.perks, undefined);
  now += 2 * 86400000;
  second.request = async () => { calls++; throw Error('offline'); };
  const [cached] = await second.annotate([{ hash: '100' }]);
  assert.equal(cached.recommendations.stale, true);
  assert.equal(cached.recommendations.perks[200], 3);
  const count = calls; await second.load(); assert.equal(calls, count);
  now += 8 * 86400000;
  const [expired] = await second.annotate([{ hash: '100' }]);
  assert.equal(expired.recommendations.status, 'unavailable');
});

test('source failures without a cache preserve the weapon query and back off', async t => {
  let calls = 0;
  const source = new StarsideRecommendations({ directory: await temp(t), request: async () => { calls++; throw Error('offline'); } });
  const [weapon] = await source.annotate([{ hash: '100', name: '测试枪' }]);
  assert.equal(weapon.name, '测试枪'); assert.equal(weapon.recommendations.status, 'unavailable');
  await source.load(); assert.equal(calls, 3);
});

test('recommendation badges retain author identity and attribution without inserting external HTML', () => {
  const html = equipmentHtml({ layout: 'weapon-detail', page: 1, pages: 1, total: 1, items: [{ name: '测试枪',
    columns: [{ label: '特性', plugs: [{ hash: '200', name: '测试词条' }, { hash: '201', name: '测试词条', enhanced: true }] }],
    recommendations: { status: 'ready', perks: { 200: 1, 201: 2 }, fetchedAt: 123, stale: true, url: 'https://starside.work/weapons/index.html?w=100',
      ratings: [{ author: 'Aegis', grade: '<script>bad</script>', context: '清怪' }], masterworks: ['填装速度'] },
  }] });
  assert.ok(html.includes('双方推荐')); assert.ok(html.includes('更新失败，显示此前缓存'));
  assert.ok(html.includes('Aegis 大师杰作建议')); assert.ok(html.includes('starside.work/weapons/index.html?w=100'));
  assert.ok(!html.includes('<script>')); assert.equal((html.match(/class="pool-perk"/g) || []).length, 1);
});
