import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { BindingStore, bindingKey } from '../src/bindings.js';
import { parseCommand, queryCard } from '../src/commands.js';
import { buildCraftingIndex, patternProgress, craftingPage } from '../src/crafting.js';
import { MemeService } from '../src/memes.js';
import { UserError } from '../src/http.js';
import { DestinyService } from '../src/destiny.js';

async function temporaryStore(t) {
  const parent = path.resolve(tmpdir());
  const directory = await mkdtemp(path.join(parent, 'guardian-bindings-'));
  t.after(async () => {
    if (path.dirname(path.resolve(directory)) !== parent || !path.basename(directory).startsWith('guardian-bindings-')) throw new Error('Unexpected cleanup directory');
    await rm(directory, { recursive: true, force: true });
  });
  return new BindingStore(directory);
}
const key = (sender, group = 'group-one') => bindingKey({ scope: 'group', targetId: group }, sender, 'app');
const account = { membershipId: '1234567890', membershipType: 3, displayName: '测试守护者#1234' };

test('bindings persist, isolate senders and groups, and serialize concurrent changes', async t => {
  const store = await temporaryStore(t);
  await Promise.all([store.set(key('alice'), account), store.set(key('bob'), { ...account, membershipId: '9876543210' })]);
  assert.equal((await store.get(key('alice'))).membershipId, account.membershipId);
  assert.equal(await store.get(key('alice', 'another-group')), undefined);
  assert.equal(await store.get(key('charlie')), undefined);
  const loaded = new BindingStore(store.directory);
  assert.equal((await loaded.get(key('bob'))).membershipId, '9876543210');
  await loaded.set(key('alice'), null);
  const restarted = new BindingStore(store.directory);
  assert.equal(await restarted.get(key('alice')), undefined);
  assert.ok(await restarted.get(key('bob')));
  assert.equal((await readFile(store.file, 'utf8')).includes('group-one'), false);
  assert.throws(() => store.set(null, account), UserError);
  assert.equal(bindingKey({ scope: 'group', targetId: 'g' }, ''), null);
});

test('corrupt bindings are not overwritten', async t => {
  const store = await temporaryStore(t);
  await writeFile(store.file, '{invalid-json');
  await assert.rejects(store.set(key('alice'), account), /绑定文件格式异常/);
  assert.equal(await readFile(store.file, 'utf8'), '{invalid-json');
});

test('short meme commands, bindings and crafting filters work with mention and pagination', () => {
  assert.deepEqual(parseCommand('<@!123> 周榜 第2页'), { type: 'meme', mode: 'week', keyword: '', page: 2 });
  assert.deepEqual(parseCommand('搜索 玩机器'), { type: 'meme', mode: 'search', keyword: '玩机器', page: 1 });
  assert.equal(parseCommand('6657 热门').mode, 'hot');
  assert.equal(parseCommand('随机').mode, 'random');
  assert.equal(parseCommand('实时').mode, 'live');
  assert.deepEqual(parseCommand('绑定 测试#0123'), { type: 'bind', keyword: '测试#0123' });
  assert.equal(parseCommand('玩家').keyword, '');
  assert.deepEqual(parseCommand('锻造 未解锁 第2页'), { type: 'crafting', filter: '未解锁', page: 2 });
  assert.equal(parseCommand('可锻造').filter, '可锻造');
});

test('binding lookup is required for personal queries; failed rebinding preserves the previous account', async t => {
  const bindings = await temporaryStore(t);
  const services = { config: {}, bindings, destiny: {
    resolvePlayer: async name => { if (name === '不存在#9999') throw new UserError('未找到'); return account; },
    player: async binding => ({ player: binding, characters: [{ classType: 1, light: 2000 }], at: 1 }),
    crafting: async (binding, filter) => ({ player: binding, rows: [], total: 0, unlocked: 0, locked: 0, unknown: 0, at: 1, filter }),
  } };
  await assert.rejects(queryCard(parseCommand('锻造'), services, { userKey: key('alice') }), /还没有绑定/);
  await queryCard(parseCommand('绑定 测试#1234'), services, { userKey: key('alice') });
  assert.equal((await queryCard(parseCommand('玩家'), services, { userKey: key('alice') })).title, account.displayName);
  assert.match((await queryCard(parseCommand('锻造'), services, { userKey: key('alice') })).subtitle, /测试守护者/);
  await assert.rejects(queryCard(parseCommand('绑定 不存在#9999'), services, { userKey: key('alice') }), /未找到/);
  assert.equal((await bindings.get(key('alice'))).membershipId, account.membershipId);
  await assert.rejects(queryCard(parseCommand('锻造'), services, { userKey: key('bob') }), /还没有绑定/);
  await queryCard(parseCommand('解绑'), services, { userKey: key('alice') });
  assert.equal(await bindings.get(key('alice')), undefined);
});

const patterns = [1, 2, 3, 4].map(n => ({ hash: String(n), name: `武器${n}`, objectives: [{ hash: String(100 + n), target: 5 }] }));
const record = (n, progress, state = 4) => ({ state, objectives: [{ objectiveHash: 100 + n, progress, completionValue: 5 }] });
test('pattern progress distinguishes unlocked, partial, zero, absent and private data without double counting', () => {
  const profile = { profileRecords: { privacy: 1, data: { records: { 1: record(1, 5, 1), 2: record(2, 3), 3: record(3, 0) } } },
    characterRecords: { privacy: 1, data: { a: { records: { 2: record(2, 3) } }, b: { records: { 2: record(2, 3) } } } } };
  const result = patternProgress(patterns, profile);
  assert.equal(result[0].unlocked, true);
  assert.equal(result[1].progress, 3);
  assert.equal(result[2].known, true); assert.equal(result[2].progress, 0);
  assert.equal(result[3].known, false); assert.equal(result[3].progress, null);
  const page = craftingPage(result);
  assert.equal(page.rows[0].name, '武器2');
  assert.deepEqual([page.unlocked, page.locked, page.unknown], [1, 2, 1]);
  assert.equal(craftingPage(result, '可锻造').total, 1);
  assert.equal(craftingPage(result, '未解锁').total, 2);
  assert.equal(craftingPage(result, '进行中').total, 1);
  assert.equal(craftingPage(result, '武器4').rows[0].known, false);
  assert.equal(patternProgress(patterns, { profileRecords: { ...profile.profileRecords, privacy: 2 } })[1].progress, 3);
  assert.throws(() => patternProgress(patterns, { profileRecords: { privacy: 2 } }), /公开/);
  assert.throws(() => patternProgress(patterns, {}), /公开/);
});

test('catalog uses Bungie pattern records and each objective threshold, not a universal five-red-border assumption', () => {
  const def = { hash: 7, displayProperties: { name: '异域图样' }, completionInfo: { toastStyle: 8 }, objectiveHashes: [9] };
  const index = buildCraftingIndex({ 7: def, 8: { ...def, hash: 8, redacted: true }, 9: { ...def, completionInfo: { toastStyle: 1 } } }, { 9: { completionValue: 1 } });
  assert.equal(index.length, 1); assert.equal(index[0].objectives[0].target, 1);
  const result = patternProgress(index, { profileRecords: { data: { records: { 7: { state: 0, objectives: [{ objectiveHash: 9, progress: 1 }] } } } } });
  assert.equal(result[0].target, 1); assert.equal(result[0].unlocked, true);
});

test('crafting uses the saved membership and records component without searching a display name again', async () => {
  let calls = 0;
  const service = new DestinyService({ apiKey: 'fixture' }, { request: async url => {
    calls++; assert.match(url, /\/3\/Profile\/1234567890\/\?components=100,900$/);
    return { ErrorCode: 1, Response: { profileRecords: { data: { records: { 1: record(1, 2) } } } } };
  } });
  service.index = { patterns };
  assert.equal((await service.crafting(account)).rows[0].progress, 2);
  await service.crafting(account, '可锻造'); assert.equal(calls, 1);
});

test('meme pages keep 20 entries and random deduplicates within a bounded number of requests', async () => {
  const many = new MemeService({ request: async () => ({ code: 200, data: Array.from({ length: 45 }, (_, i) => ({ id: i, barrage: `弹幕${i}`, cnt: i })) }) });
  assert.equal((await many.query('week')).rows.length, 20);
  assert.equal((await many.query('week', '', 2)).rows[0].id, '20');
  assert.equal((await many.query('week', '', 3)).rows.length, 5);
  let calls = 0;
  const random = new MemeService({ request: async () => { calls++; return { code: 200, data: { id: calls, barrage: `随机${Math.floor(calls / 2)}`, cnt: 0 } }; } });
  const batch = await random.query('random');
  assert.equal(batch.rows.length, 5); assert.equal(new Set(batch.rows.map(r => r.text)).size, 5); assert.equal(calls, 8);
});
