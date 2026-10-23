import test from 'node:test';
import assert from 'node:assert/strict';
import { LiveStats, parseRoomIdHtml } from '../src/live.js';
import { parseCommand, queryCard } from '../src/commands.js';
import { MemeService, parseMemes } from '../src/memes.js';
import { CachedRequests, UserError } from '../src/http.js';
import { buildIndex, DestinyService } from '../src/destiny.js';
import { Admission, createMessageHandler } from '../src/runtime.js';
import { cardHtml } from '../src/cards.js';
import { validateConfig } from '../src/config.js';

test('vanity room number resolves from escaped room metadata, not unrelated recommendations', () => {
  const json = JSON.stringify({ roomInfo: { room: { room_id: 6979222, vipId: 6657 } } });
  const html = `<script>self.__next_f.push([1,${JSON.stringify(json)}])</script>`;
  assert.equal(parseRoomIdHtml(html), '6979222');
  assert.equal(parseRoomIdHtml('$ROOM.room_id = 12345;'), '12345');
  assert.throws(() => parseRoomIdHtml('{"recommendation":{"room_id":99999}}'));
});

test('real-time window expires; participant count prevents a single spammer winning', () => {
  let now = 1000000;
  const live = new LiveStats({ windowMinutes: 1, clock: () => now });
  live.setConnected();
  for (let i = 0; i < 15; i++) live.ingest({ txt: '刷屏', uid: 'u1', cid: `spam${i}` });
  live.ingest({ txt: '好枪', uid: 'u2', cid: 'a' });
  live.ingest({ txt: '好枪', uid: 'u3', cid: 'b' });
  live.ingest({ txt: '好枪', uid: 'u3', cid: 'b' });
  assert.equal(live.snapshot().count, 17);
  assert.equal(live.snapshot().rows[0].text, '好枪');
  assert.equal(live.snapshot().rows[0].users, 2);
  now += 60001;
  assert.equal(live.snapshot().count, 0);
  assert.equal(live.ids.size, 0);
  assert.equal(live.snapshot().complete, true);
});

test('reconnection clears old observations; bounded cache marks partial results', () => {
  let now = 1000;
  const live = new LiveStats({ clock: () => now, maxMessages: 2 }); live.setConnected();
  for (let i = 0; i < 4; i++) { now++; live.ingest({ txt: `a${i}`, uid: i + 1, cid: i + 1 }); }
  assert.equal(live.snapshot().capped, true);
  assert.equal(live.messages.length, 2); assert.equal(live.ids.size, 2);
  live.setDisconnected(); assert.equal(live.snapshot().rows.length, 0);
  now++; live.setConnected(); assert.equal(live.snapshot().count, 0); assert.equal(live.snapshot().complete, false);
});

test('normalization merges equivalent text, keeps meaning, and filters configured words', () => {
  const live = new LiveStats({ blockedWords: ['广告'] }); live.setConnected();
  live.ingest({ txt: 'ＧＧ', uid: 'u' }); live.ingest({ txt: 'gg', uid: 'v' });
  live.ingest({ txt: '广告内容', uid: 'x' }); live.ingest({ txt: '不GG', uid: 'z' });
  assert.equal(live.snapshot().rows[0].users, 2); assert.equal(live.snapshot().count, 3);
});

test('command parser handles official mentions, slash, pages and Bungie tag', () => {
  assert.deepEqual(parseCommand('<@!123> /6657 热门 第2页'), { type: 'meme', mode: 'hot', keyword: '', page: 2 });
  assert.deepEqual(parseCommand('玩家 守护者#1234'), { type: 'player', keyword: '守护者#1234', page: 1 });
  assert.equal(parseCommand('Perk 狂暴').type, 'perk');
  assert.throws(() => parseCommand('6657 搜索'), UserError);
  assert.throws(() => parseCommand('6657 热门 第0页'), UserError);
  assert.throws(() => parseCommand('x'.repeat(200)), UserError);
});

test('website API maps documented schemas without confusing copy count with live count', async () => {
  assert.deepEqual(parseMemes({ code: 200, data: [{ barrage: '你好', barrageId: 7, cnt: '12' }] }), [{ id: '7', text: '你好', copies: 12 }]);
  assert.equal(parseMemes({ code: 200, data: { list: [], total: 0 } }).length, 0);
  assert.throws(() => parseMemes({ code: 401, data: null }), UserError);
  assert.throws(() => parseMemes({ code: 200, data: { surprise: [] } }), UserError);
  let calls = 0;
  const service = new MemeService({ request: async (url, opts) => {
    calls++; assert.equal(url, 'https://api.hguofichp.cn/machine/pageSearch');
    assert.deepEqual(JSON.parse(opts.body), { barrage: '好枪', pageNum: 2, pageSize: 8, sort: 0 });
    assert.equal(opts.headers.dpahjdoiaw, undefined);
    return { code: 200, data: { list: [{ id: 3, barrage: '好枪', cnt: 8 }], total: 10 } };
  } });
  const [a, b] = await Promise.all([service.query('search', '好枪', 2), service.query('search', '好枪', 2)]);
  assert.equal(calls, 1); assert.equal(a.total, 10); assert.equal(a, b);
});

test('cache does not keep rejected requests and expires successfully cached data', async () => {
  let now = 0, calls = 0; const cache = new CachedRequests({ clock: () => now });
  await assert.rejects(cache.get('a', 10, () => { throw new Error('failed'); }));
  const run = () => ++calls;
  assert.equal(await cache.get('a', 10, run), 1);
  assert.equal(await cache.get('a', 10, run), 1);
  now = 11; assert.equal(await cache.get('a', 10, run), 2);
});

test('manifest index and public character query use correct Bungie paths and Cross Save platform', async () => {
  const index = buildIndex({ 1: { hash: 1, itemType: 3, displayProperties: { name: '测试枪', description: '武器' } }, 2: { hash: 2, plug: {}, displayProperties: { name: '狂暴' } } }, {}, {});
  assert.equal(index.weapons.length, 1); assert.equal(index.perks.length, 1);
  const calls = [];
  const destiny = new DestinyService({ apiKey: 'test-key' }, { request: async (url, opts) => {
    calls.push(url); assert.equal(opts.headers['X-API-Key'], 'test-key');
    return { ErrorCode: 1, Response: calls.length === 1 ? [
      { membershipId: 'xbox', membershipType: 1, crossSaveOverride: 3 },
      { membershipId: 'steam', membershipType: 3, crossSaveOverride: 3 },
    ] : { characters: { data: { a: { classType: 1, light: 123 } } } } };
  } });
  assert.equal((await destiny.player('测试#1234')).characters.length, 1);
  assert.match(calls[1], /\/Destiny2\/3\/Profile\/steam\/\?components=100,200$/);
  await assert.rejects(destiny.player('没有编号'), UserError);
});

test('admission deduplicates callbacks and bounds concurrent queries with one cooldown warning', () => {
  let now = 1000; const gate = new Admission({ maxPending: 1, clock: () => now });
  assert.equal(gate.enter('m1', 'u1'), 'ok');
  assert.equal(gate.enter('m1', 'u1'), 'duplicate');
  assert.equal(gate.enter('m2', 'u1'), 'cooldown');
  assert.equal(gate.enter('m3', 'u1'), 'silent');
  assert.equal(gate.enter('m4', 'u2'), 'busy');
  gate.leave(); now += 10001;
  assert.equal(gate.enter('m5', 'u1'), 'ok');
});

test('all replies are images tied to the original message, including service errors', async () => {
  const sent = [], cards = [], logs = [];
  const target = { scope: 'group', targetId: 'g', msgId: 'original' };
  const handler = createMessageHandler({
    bot: { sendImage: async (...args) => sent.push(args) },
    renderer: { render: async card => { cards.push(card); return [Buffer.from('png')]; } },
    services: { config: { qq: { allowedGroupIds: [] } }, memes: { query: async () => { throw new UserError('数据源维护'); } } },
    admission: new Admission(), fallbackImages: { cooldown: [Buffer.from('cooldown')] }, logger: { error: x => logs.push(x) },
  });
  await handler(null, { content: '6657 热门', senderId: 'u', replyTarget: target });
  assert.equal(cards[0].rows[0].text, '数据源维护');
  assert.equal(sent.length, 1); assert.equal(sent[0][0], target); assert.ok(Buffer.isBuffer(sent[0][1].buffer));
  await handler(null, { content: '帮助', senderId: 'u', replyTarget: target });
  assert.equal(sent.length, 1);
});

test('render template escapes user content and blocks active resources', () => {
  const html = cardHtml({ title: '<script>x</script>', rows: [{ text: '<img src="http://example.com" onerror="x">' }] });
  assert.ok(!html.includes('<script>')); assert.ok(!html.includes('<img'));
  assert.ok(html.includes('&lt;img')); assert.ok(html.includes("default-src 'none'"));
});

test('invalid config is rejected before external connections', () => {
  assert.throws(() => validateConfig({ douyu: { windowMinutes: -1 } }));
  assert.throws(() => validateConfig({ douyu: { blockedWords: [null] } }));
  assert.throws(() => validateConfig({}, { requireQQ: true }));
});
