import { bungieImageUrl } from './bungie-assets.js';
export const MODES = {
  all: { id: 0, title: '近期战绩', en: 'ACTIVITY LOG' },
  pvp: { id: 5, key: 'allPvP', title: 'PVP 战绩', en: 'CRUCIBLE REPORT' },
  pve: { id: 7, key: 'allPvE', title: 'PVE 战绩', en: 'VANGUARD REPORT' },
  raid: { id: 4, key: 'raid', title: '突袭战绩', en: 'RAID REPORT' },
  dungeon: { id: 82, key: 'dungeon', title: '地牢战绩', en: 'DUNGEON REPORT' },
  trials: { id: 84, key: 'trials_of_osiris', title: '奥西里斯试炼', en: 'TRIALS REPORT' },
  gambit: { id: 63, key: 'pvecomp_gambit', title: '智谋战绩', en: 'GAMBIT REPORT' },
  nightfall: { id: 46, key: 'scored_nightfall', title: '日落战绩', en: 'NIGHTFALL REPORT' },
  iron: { id: 19, key: 'ironBanner', title: '铁旗战绩', en: 'IRON BANNER' },
};
export const className = n => ({ 0: '泰坦', 1: '猎人', 2: '术士' })[n] || '角色';
export const number = v => v == null || !Number.isFinite(Number(v)) ? '—' : Number(v).toLocaleString('zh-CN', { maximumFractionDigits: 2 });
export const value = (values, key) => typeof values?.[key]?.basic?.value === 'number' && Number.isFinite(values[key].basic.value) ? values[key].basic.value : null;
export const duration = seconds => seconds == null ? '—' : seconds >= 3600 ? `${number(Math.floor(seconds / 3600))} 时 ${Math.floor(seconds % 3600 / 60)} 分` : `${Math.floor(seconds / 60)} 分 ${Math.floor(seconds % 60)} 秒`;
export const date = at => Number.isFinite(Date.parse(at)) ? new Date(at).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false }) : '时间未知';
export const day = at => new Date(at).toLocaleDateString('en-CA', { timeZone: 'Asia/Shanghai' });
const info = d => ({ hash: String(d.hash), name: d.displayProperties?.name || '', description: d.displayProperties?.description || '', icon: d.displayProperties?.hasIcon === false || !bungieImageUrl(d.displayProperties?.icon) ? '' : d.displayProperties.icon });

// A portable, compact catalog: the bot never depends on developer-only raw JSON files.
export function buildReportCatalog(tables) {
  const table = key => Object.values(tables['Destiny' + key + 'Definition'] || {});
  const map = rows => Object.fromEntries(rows.map(x => [x.hash, x]));
  return { reportVersion: 1, reportCatalog: {
    activities: map(table('Activity').filter(d => !d.redacted).map(d => ({ ...info(d), background: bungieImageUrl(d.pgcrImage) ? d.pgcrImage : '', modes: d.activityModeTypes || [d.directActivityModeType], pvp: d.isPvP }))),
    items: map(table('InventoryItem').filter(d => d.displayProperties?.name && !d.redacted).map(d => ({ ...info(d), type: d.itemType, typeName: d.itemTypeDisplayName, tier: d.inventory?.tierTypeName, bucket: d.inventory?.bucketTypeHash }))),
    records: map(table('Record').filter(d => d.displayProperties?.name && !d.redacted).map(d => ({ ...info(d), scope: d.scope, title: d.titleInfo?.hasTitle ? Object.values(d.titleInfo.titlesByGender || {})[0] : '', gilding: d.forTitleGilding, objectives: d.objectiveHashes || [] }))),
    collectibles: map(table('Collectible').filter(d => d.displayProperties?.name && !d.redacted).map(d => ({ ...info(d), item: d.itemHash, source: d.sourceString }))),
    objectives: map(table('Objective').map(d => ({ ...info(d), target: d.completionValue, text: d.progressDescription }))),
    milestones: map(table('Milestone').map(d => ({ ...info(d), order: d.defaultOrder }))),
    statNames: Object.fromEntries(table('Stat').map(d => [String(d.hash), d.displayProperties?.name || '属性'])),
  } };
}

export function mergeHistory(responses) {
  const seen = new Map();
  for (const { activities = [], character } of responses) for (const activity of activities) {
    const id = activity.activityDetails?.instanceId;
    if (!id || !Number.isFinite(Date.parse(activity.period))) continue;
    const previous = seen.get(String(id));
    // One account can switch characters in the same instance. Keep one participation,
    // not the sum of duplicate account kills/time or a second completion.
    if (!previous || (value(activity.values, 'timePlayedSeconds') ?? 0) > (value(previous.values, 'timePlayedSeconds') ?? 0)) seen.set(String(id), { ...activity, character });
  }
  return [...seen.values()].sort((a, b) => Date.parse(b.period) - Date.parse(a.period) || String(b.activityDetails.instanceId).localeCompare(String(a.activityDetails.instanceId)));
}

export function activityRow(a, catalog) {
  const details = a.activityDetails || {}, def = catalog.activities[details.referenceId] || {}, v = a.values;
  const competitive = (details.modes || []).includes(5) || [5,63,75,84].includes(details.mode);
  const standing = value(v, 'standing'), complete = value(v, 'completed');
  const status = competitive ? standing === 0 ? '胜利' : standing === 1 ? '失败' : '结果未返回' : complete === 1 ? '已完成' : complete === 0 ? '未完成' : '完成状态未知';
  return { title: def.name || `活动 ${details.referenceId}`, background: def.background,
    text: `${date(a.period)} · ${className(a.character?.classType)} · ${duration(value(v, 'timePlayedSeconds'))}`,
    badge: status, tone: status === '胜利' || status === '已完成' ? 'good' : 'muted',
    metrics: [{ label: '击杀', value: number(value(v,'kills')) }, { label: '死亡', value: number(value(v,'deaths')) }, { label: '助攻', value: number(value(v,'assists')) }, { label: 'K/D', value: number(value(v,'killsDeathsRatio')) }],
    meta: `对局 ${details.instanceId}${details.isPrivate ? ' · 私人比赛' : ''}`, };
}

export function statTiles(stats, competitive = false) {
  return [ ['参与场次', 'activitiesEntered'], [competitive ? '胜利场次' : '完成场次', competitive ? 'activitiesWon' : 'activitiesCleared'], ['总击杀', 'kills'], ['总死亡', 'deaths'], ['K/D', 'killsDeathsRatio'], ['效率 (K+A)/D', 'efficiency'] ].map(([label,key]) => ({ label, value: number(value(stats,key)) }));
}

export function recordState(def, profile, catalog) {
  const sources = def.scope === 1 ? Object.values(profile.characterRecords?.data || {}).map(x => x.records?.[def.hash]).filter(Boolean) : [profile.profileRecords?.data?.records?.[def.hash]].filter(Boolean);
  const visible = sources.filter(x => !(x.state & 16) && !(x.state & 8));
  if (sources.length && !visible.length) return { hidden: true };
  if (!visible.length) return { status: '进度未公开', known: false, progress: [] };
  const r = visible.find(x => (x.state & 1) || !(x.state & 4)) || visible[0];
  return { known: true, complete: Boolean(r.state & 1) || !(r.state & 4), status: r.state & 64 ? '可装备称号' : r.state & 1 ? '已领取' : !(r.state & 4) ? '已完成，待领取' : '未完成',
    progress: (r.objectives || []).map(o => ({ label: catalog.objectives[o.objectiveHash]?.text || '目标进度', value: o.progress == null ? '未返回' : `${number(o.progress)} / ${number(o.completionValue ?? catalog.objectives[o.objectiveHash]?.target)}` })) };
}

export function collectibleState(hash, profile) {
  const records = [profile.profileCollectibles?.data?.collectibles?.[hash], ...Object.values(profile.characterCollectibles?.data || {}).map(x => x.collectibles?.[hash])].filter(Boolean);
  const visible = records.filter(x => !(x.state & 4) && !(x.state & 2));
  if (records.length && !visible.length) return { hidden: true };
  if (!visible.length) return { status: '进度未公开' };
  const acquired = visible.some(x => !(x.state & 1));
  return { status: acquired ? '已收藏' : '未收藏', acquired };
}
