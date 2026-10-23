const nameOf = item => item?.displayProperties?.name || '';
const compact = text => String(text || '').normalize('NFKC').toLowerCase().replace(/\s+/g, '');
const WEAPON_CATEGORIES = new Set([3956125808, 4241085061]);
const STAT_ORDER = [4043523819, 3614673599, 2523465841, 1240592695, 155624089, 943549884, 4188031367, 1345609583, 2715839340, 2714457168, 1931675084, 3555269338, 3871231066, 4284893193, 2961396640, 447667954];
const NUMERIC_STATS = new Set([3555269338, 3871231066, 4284893193, 2961396640, 447667954]);
const validPlug = item => item && !item.redacted && !item.blacklisted && !item.plug?.isDummyPlug && nameOf(item)
  && item.itemTypeDisplayName && !/trackers|masterworks|shader|ornament|memento/i.test(item.plug?.plugCategoryIdentifier || '');
const plugInfo = item => ({ hash: String(item.hash), name: nameOf(item), description: item.displayProperties.description || '',
  icon: item.displayProperties.icon || '', type: item.itemTypeDisplayName || '', enhanced: /^强化|^Enhanced/i.test(item.itemTypeDisplayName || '') });
const identity = p => JSON.stringify([p.name, p.type, p.description, p.icon]);

export function buildEquipmentIndex(items, plugSets = {}, stats = {}, collectibles = {}) {
  const equipment = {}, allPlugs = new Map();
  for (const item of Object.values(items)) {
    if (item.itemType !== 3 || item.redacted || item.blacklisted || !nameOf(item)) continue;
    const columns = [], intrinsics = [];
    for (const category of item.sockets?.socketCategories || []) {
      if (!WEAPON_CATEGORIES.has(category.socketCategoryHash)) continue;
      for (const position of category.socketIndexes || []) {
        const socket = item.sockets.socketEntries?.[position]; if (!socket || socket.defaultVisible === false) continue;
        const pool = plugSets[socket.randomizedPlugSetHash] || plugSets[socket.reusablePlugSetHash];
        const options = (pool?.reusablePlugItems || []).filter(p => p.currentlyCanRoll !== false).map(p => p.plugItemHash);
        const hashes = [...new Set([socket.singleInitialItemHash, ...(socket.reusablePlugItems || []).map(p => p.plugItemHash), ...options])];
        const unique = new Map();
        for (const hash of hashes) if (validPlug(items[hash])) { const plug = plugInfo(items[hash]); unique.set(identity(plug), plug); allPlugs.set(identity(plug), plug); }
        const plugs = [...unique.values()]; if (!plugs.length) continue;
        if (category.socketCategoryHash === 3956125808) intrinsics.push(...plugs);
        else columns.push({ slot: position, label: plugs[0].type.replace(/^强化/, ''), plugs: plugs.sort((a,b) => Number(a.enhanced) - Number(b.enhanced) || a.name.localeCompare(b.name, 'zh-CN')) });
      }
    }
    const values = item.stats?.stats || {};
    equipment[item.hash] = { icon: item.displayProperties.icon || '', screenshot: item.screenshot || '', flavor: item.flavorText || '',
      sourceText: (collectibles[item.collectibleHash]?.sourceString || '').replace(/^来源[：:]\s*/, ''),
      ammo: ({ 1: '主要弹药', 2: '特殊弹药', 3: '重型弹药' })[item.equippingBlock?.ammoType] || '',
      intrinsics, columns,
      attributes: STAT_ORDER.filter(hash => Number.isFinite(values[hash]?.value) && stats[hash]?.displayProperties?.name).map(hash => ({
        name: stats[hash].displayProperties.name, value: values[hash].value, bar: !NUMERIC_STATS.has(hash), max: values[hash].displayMaximum || 100,
      })) };
  }
  return { equipment, weaponPerks: [...allPlugs.values()].sort((a,b) => a.name.localeCompare(b.name, 'zh-CN') || Number(a.enhanced) - Number(b.enhanced)), equipmentVersion: 1 };
}

export function equipmentSearch(index, kind, keyword, page = 1) {
  const query = compact(keyword);
  const collection = kind === 'weapon' ? index.weapons : index.weaponPerks;
  const patternWeapons = new Set((index.patterns || []).map(p => p.itemHash));
  const candidates = collection.filter(x => x.hash === keyword || compact(x.name).includes(query));
  const exactPerks = kind === 'perk' ? candidates.filter(x => compact(x.name) === query) : [];
  const matches = (exactPerks.length ? exactPerks : candidates)
    .sort((a,b) => Number(compact(b.name) === query) - Number(compact(a.name) === query)
      || a.name.localeCompare(b.name, 'zh-CN') || Number(a.enhanced) - Number(b.enhanced)
      || Number(patternWeapons.has(b.hash)) - Number(patternWeapons.has(a.hash)) || Number(a.hash) - Number(b.hash));
  // A detailed weapon includes its complete perk pool; one result per image
  // keeps it readable and makes multiple identically named releases explicit.
  const pageSize = kind === 'weapon' ? 1 : 6;
  const rows = matches.slice((page - 1) * pageSize, page * pageSize).map(row => kind === 'weapon' ? { ...row, ...index.equipment[row.hash], craftable: patternWeapons.has(row.hash) } : row);
  return { rows, total: matches.length, page, pages: Math.max(1, Math.ceil(matches.length / pageSize)), pageSize, index };
}
