import { readFile, writeFile, mkdir, rename } from 'node:fs/promises';
import path from 'node:path';
import { DATA } from './config.js';
import { CachedRequests, jsonRequest, UserError } from './http.js';
import { buildCraftingIndex, patternProgress, craftingPage } from './crafting.js';

const ORIGIN = 'https://www.bungie.net';
const compact = value => String(value || '').normalize('NFKC').toLowerCase().replace(/\s+/g, '');
const itemInfo = d => ({ hash: String(d.hash), name: d.displayProperties?.name || '', description: d.displayProperties?.description || '',
  type: d.itemTypeDisplayName || '', tier: d.inventory?.tierTypeName || '',
  damage: ({ 1: '动能', 2: '电弧', 3: '烈日', 4: '虚空', 6: '冰影', 7: '缚丝' })[d.defaultDamageType] || '',
  stats: Object.values(d.stats?.stats || {}).map(s => ({ hash: String(s.statHash), value: s.value })) });

export function buildIndex(items, perks, stats) {
  const weapons = [], plugs = [];
  for (const d of Object.values(items)) {
    if (!d.displayProperties?.name) continue;
    if (d.itemType === 3) weapons.push(itemInfo(d));
    if (d.plug && d.itemType !== 3) plugs.push({ ...itemInfo(d), hash: `item:${d.hash}` });
  }
  for (const d of Object.values(perks)) if (d.displayProperties?.name) plugs.push({ hash: `perk:${d.hash}`, name: d.displayProperties.name,
    description: d.displayProperties.description || '', type: 'Perk', stats: [] });
  return { weapons, perks: plugs, statNames: Object.fromEntries(Object.entries(stats).map(([k, v]) => [k, v.displayProperties?.name || k])) };
}

export class DestinyService {
  constructor(config, { request = jsonRequest, directory = DATA } = {}) {
    this.config = config; this.request = request; this.directory = directory;
    this.file = path.join(directory, `manifest-${config.language || 'zh-chs'}.json`); this.index = null;
    this.cache = new CachedRequests();
  }
  async api(endpoint, options = {}) {
    if (!this.config.apiKey) throw new UserError('尚未配置 Bungie API Key。请在笔记本的 config.json 中填写，然后运行 05-sync-destiny.cmd。');
    const payload = await this.request(`${ORIGIN}/Platform${endpoint}`, { ...options,
      headers: { 'X-API-Key': this.config.apiKey, 'User-Agent': 'GuardianQQBot/0.1', 'Content-Type': 'application/json', ...options.headers } });
    if (payload.ErrorCode !== 1) throw new UserError(`Bungie 查询未成功（${payload.ErrorStatus || payload.ErrorCode}），可能正在维护、资料未公开或已限流。`);
    return payload.Response;
  }
  async load() {
    if (this.index) return this.index;
    try { this.index = JSON.parse(await readFile(this.file, 'utf8')); }
    catch { throw new UserError('本地命运 2 数据库尚未准备好。请在笔记本运行 05-sync-destiny.cmd，同步完成后重启机器人。'); }
    return this.index;
  }
  async sync(log = console.log) {
    const manifest = await this.api('/Destiny2/Manifest/');
    const components = manifest.jsonWorldComponentContentPaths?.[this.config.language || 'zh-chs'];
    if (!components) throw new UserError('Bungie 暂未提供所选语言的数据库。');
    const tables = {};
    for (const name of ['DestinyInventoryItemDefinition', 'DestinySandboxPerkDefinition', 'DestinyStatDefinition', 'DestinyRecordDefinition', 'DestinyObjectiveDefinition']) {
      const location = new URL(components[name], ORIGIN);
      if (location.origin !== ORIGIN || !location.pathname.startsWith('/common/')) throw new UserError('Bungie 数据库地址异常。');
      log(`正在下载 ${name}，首次下载可能需要几分钟……`);
      tables[name] = await this.request(location.href, { timeout: 180000, maxBytes: 300_000_000 });
    }
    const index = { ...buildIndex(tables.DestinyInventoryItemDefinition, tables.DestinySandboxPerkDefinition, tables.DestinyStatDefinition),
      patterns: buildCraftingIndex(tables.DestinyRecordDefinition, tables.DestinyObjectiveDefinition),
      version: manifest.version, syncedAt: Date.now(), language: this.config.language || 'zh-chs' };
    if (!index.weapons.length || !index.perks.length || !index.patterns.length) throw new UserError('Bungie 返回的数据库为空，保留原缓存。');
    await mkdir(this.directory, { recursive: true });
    await writeFile(this.file + '.tmp', JSON.stringify(index), 'utf8');
    await rename(this.file + '.tmp', this.file);
    this.index = index;
    log(`同步完成：${index.weapons.length} 件武器、${index.perks.length} 条 Perk / 插槽资料、${index.patterns.length} 个武器图样。`);
    return index;
  }
  async search(kind, term, page = 1) {
    const index = await this.load(); const query = compact(term);
    const collection = kind === 'weapon' ? index.weapons : index.perks;
    const matches = collection.filter(x => x.hash === term || compact(x.name).includes(query))
      .sort((a, b) => Number(compact(b.name) === query) - Number(compact(a.name) === query) || a.name.localeCompare(b.name));
    return { rows: matches.slice((page - 1) * 6, page * 6), total: matches.length, index };
  }
  async resolvePlayer(name) {
    const match = name.match(/^(.+)#(\d{4})$/);
    if (!match) throw new UserError('请使用完整 Bungie 名称，例如：玩家 守护者#1234');
    return this.cache.get(`resolve:${name}`, 60000, async () => {
      const players = await this.api('/Destiny2/SearchDestinyPlayerByBungieName/-1/', { method: 'POST',
        body: JSON.stringify({ displayName: match[1], displayNameCode: Number(match[2]) }) });
      if (!players?.length) throw new UserError('未找到该玩家，请确认 Bungie 名称和四位编号。');
      const player = players.find(x => x.membershipType === x.crossSaveOverride) || players[0];
      this.validateMembership(player);
      return { membershipId: player.membershipId, membershipType: player.membershipType,
        displayName: player.bungieGlobalDisplayName && player.bungieGlobalDisplayNameCode != null
          ? `${player.bungieGlobalDisplayName}#${String(player.bungieGlobalDisplayNameCode).padStart(4, '0')}` : name };
    });
  }
  validateMembership(player) {
    if (!/^\d+$/.test(String(player?.membershipId)) || ![1, 2, 3, 5, 6].includes(player?.membershipType)) throw new UserError('Bungie 返回的玩家平台信息不完整，请稍后重试。');
  }
  async profile(player, components) {
    this.validateMembership(player);
    return this.cache.get(`profile:${player.membershipType}:${player.membershipId}:${components}`, 60000,
      () => this.api(`/Destiny2/${player.membershipType}/Profile/${player.membershipId}/?components=${components}`));
  }
  async player(nameOrBinding) {
      const player = typeof nameOrBinding === 'string' ? await this.resolvePlayer(nameOrBinding) : nameOrBinding;
      const profile = await this.profile(player, '100,200');
      const characters = Object.values(profile.characters?.data || {});
      if (!characters.length) throw new UserError('玩家资料未公开或没有可用角色；当前版本仅查询公开资料。');
      return { player, characters, at: Date.now() };
  }
  async crafting(player, filter = '', page = 1) {
    const index = await this.load();
    if (!index.patterns?.length) throw new UserError('本地图样数据库需要更新，请运行 05-sync-destiny.cmd 并重启机器人。');
    const profile = await this.profile(player, '100,900');
    const result = craftingPage(patternProgress(index.patterns, profile), filter, page);
    const minted = Date.parse(profile.secondaryComponentsMintedTimestamp || profile.responseMintedTimestamp);
    return { ...result, at: Number.isFinite(minted) ? minted : Date.now(), player };
  }
}
