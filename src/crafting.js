import { UserError } from './http.js';

export const CRAFTING_PAGE_SIZE = 20;

export function buildCraftingIndex(records, objectives) {
  // Bungie's CraftingRecipeUnlocked toast identifies weapon pattern records.
  return Object.values(records).filter(r => !r.redacted && !r.blacklisted && r.completionInfo?.toastStyle === 8 && r.displayProperties?.name)
    .map(r => ({ hash: String(r.hash), name: r.displayProperties.name, description: r.displayProperties.description || '',
      objectives: (r.objectiveHashes || []).map(hash => ({ hash: String(hash), target: objectives[hash]?.completionValue ?? null })) }));
}

function stateOf(pattern, record) {
  if (!record || !Number.isInteger(record.state) || (record.state & 16)) return { known: false, unlocked: false, progress: null, target: null };
  const unlocked = Boolean(record.state & 1) || !(record.state & 4);
  const goals = pattern.objectives.map(def => {
    const actual = record.objectives?.find(x => String(x.objectiveHash) === def.hash);
    const target = Number.isFinite(actual?.completionValue) ? actual.completionValue : def.target;
    if (!Number.isFinite(actual?.progress) || !Number.isFinite(target) || target <= 0) return null;
    return { progress: Math.min(target, Math.max(0, actual.progress)), target };
  });
  const numeric = goals.length && goals.every(Boolean);
  return { known: true, unlocked, progress: numeric ? goals.reduce((n, x) => n + x.progress, 0) : null,
    target: numeric ? goals.reduce((n, x) => n + x.target, 0) : null };
}

export function patternProgress(patterns, profile) {
  // A component may be labelled Private (2) while Bungie still returns its data
  // to this request. Presence of data, not that label, determines availability.
  const readable = component => component?.data && typeof component.data === 'object';
  const sources = [];
  if (readable(profile.profileRecords) && profile.profileRecords.data.records) sources.push(profile.profileRecords.data.records);
  if (readable(profile.characterRecords)) {
    for (const character of Object.values(profile.characterRecords.data)) if (character.records) sources.push(character.records);
  }
  if (!sources.some(source => Object.keys(source).length)) throw new UserError('没有取得公开的图样进度。请检查 Bungie 游戏资料的隐私设置；本次不会把未公开的数据算作 0。');
  return patterns.map(pattern => {
    const states = sources.map(source => stateOf(pattern, source[pattern.hash]));
    // The same account record can appear on several characters. Choose its best
    // reported state; adding them would count one red border more than once.
    states.sort((a, b) => Number(b.known) - Number(a.known) || Number(b.unlocked) - Number(a.unlocked)
      || ((b.progress ?? -1) / (b.target || 1)) - ((a.progress ?? -1) / (a.target || 1)));
    return { ...pattern, ...states[0] };
  });
}

export function craftingPage(allRows, filter = '', page = 1) {
  const normalize = s => String(s).normalize('NFKC').toLowerCase().replace(/\s+/g, '');
  const query = normalize(filter);
  const rows = allRows.filter(row => {
    if (['可锻造', '已解锁'].includes(query)) return row.known && row.unlocked;
    if (query === '未解锁') return row.known && !row.unlocked;
    if (query === '进行中') return row.known && !row.unlocked && row.progress > 0;
    return !query || query === '全部' || normalize(row.name).includes(query);
  });
  const order = r => !r.known ? 3 : r.unlocked ? 2 : r.progress > 0 ? 0 : 1;
  rows.sort((a, b) => order(a) - order(b) || (b.progress || 0) / (b.target || 1) - (a.progress || 0) / (a.target || 1) || a.name.localeCompare(b.name, 'zh-CN'));
  return { rows: rows.slice((page - 1) * CRAFTING_PAGE_SIZE, page * CRAFTING_PAGE_SIZE), total: rows.length,
    unlocked: allRows.filter(r => r.known && r.unlocked).length, locked: allRows.filter(r => r.known && !r.unlocked).length,
    unknown: allRows.filter(r => !r.known).length };
}
