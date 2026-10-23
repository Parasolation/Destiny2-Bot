// Sources and art come from the same localized Bungie Manifest as the patterns.
// A raid collection badge is stronger evidence than a stale sourceString.
const RAID_NAMES = ['救赎的边缘', '克洛塔的末日', '梦魇根源', '国王的陨落', '门徒誓约', '玻璃拱顶', '深岩墓室', '救赎花园', '最后一愿'];
const DUNGEON_NAMES = ['深渊机灵', '二象性'];
const nameOf = d => d?.displayProperties?.name || '';
const unique = xs => [...new Set(xs.filter(Boolean))];

export function buildPatternSources({ items = {}, collectibles = {}, nodes = {}, activities = {}, seasons = {} } = {}) {
  const weapons = Object.values(items).filter(i => i.itemType === 3 && !i.redacted);
  const byName = new Map();
  for (const i of weapons) { const name = nameOf(i); if (!byName.has(name)) byName.set(name, []); byName.get(name).push(i); }
  const activityArt = name => Object.values(activities).filter(a => !a.redacted
    && (nameOf(a) === name || nameOf(a).startsWith(name + ':') || nameOf(a).startsWith(name + '：') || (name === '王座世界' && nameOf(a) === '萨瓦图恩的王座世界'))
    && (!RAID_NAMES.includes(name) || a.activityModeTypes?.includes(4)) && a.pgcrImage && !/missing|placeholder/i.test(a.pgcrImage))
    .sort((a, b) => Number(b.activityModeTypes?.includes(4)) - Number(a.activityModeTypes?.includes(4)) || a.hash - b.hash)[0]?.pgcrImage || '';
  const groups = new Map();
  const add = (name, kind, order, background = '') => { const group = { name, kind, order, background }; groups.set(name, group); return group; };
  RAID_NAMES.forEach((name, i) => add(name, '突袭', i, activityArt(name)));
  DUNGEON_NAMES.forEach((name, i) => add(name, '地牢', 20 + i, activityArt(name)));
  for (const season of Object.values(seasons)) {
    const name = nameOf(season);
    if (name) add(name, '赛季 / 篇章', 100 - (season.seasonNumber || 0), season.backgroundImagePath || '');
  }

  const badgeNames = new Map();
  const collectBadge = (hash, visited = new Set()) => {
    if (visited.has(hash)) return []; visited.add(hash);
    const children = nodes[hash]?.children;
    return [...(children?.collectibles || []).map(c => collectibles[c.collectibleHash]),
      ...(children?.presentationNodes || []).flatMap(n => collectBadge(n.presentationNodeHash, visited))].filter(Boolean);
  };
  for (const node of Object.values(nodes)) {
    const raid = RAID_NAMES.find(n => nameOf(node) === n || nameOf(node) === `突袭：${n}`);
    if (!raid) continue;
    for (const c of collectBadge(node.hash)) {
      if (items[c.itemHash]?.itemType !== 3) continue;
      const name = nameOf(c); if (!badgeNames.has(name)) badgeNames.set(name, new Set()); badgeNames.get(name).add(raid);
    }
  }
  const sourceGroup = source => {
    const raid = RAID_NAMES.find(n => source.includes(n)); if (raid) return groups.get(raid);
    const dungeon = DUNGEON_NAMES.find(n => source.includes(n)); if (dungeon) return groups.get(dungeon);
    for (const group of groups.values()) if (group.kind === '赛季 / 篇章' && source.includes(group.name)) return group;
    const season = source.match(/([\u4e00-\u9fff]{2,6}赛季)/)?.[1];
    if (season) return groups.get(season) || add(season, '赛季 / 篇章', 100);
    const episode = source.match(/篇章[：:]([^”」]+)[”」]/)?.[1];
    if (episode) return groups.get(`篇章：${episode}`) || add(`篇章：${episode}`, '赛季 / 篇章', 65);
    const world = [['苍白之心', '苍白之心'], ['光陨之秋', '内欧姆那'], ['内欧姆那', '内欧姆那'], ['王座世界', '王座世界'], ['泉源', '王座世界'], ['邪姬魅影', '王座世界'], ['开普勒', '开普勒']].find(([key]) => source.includes(key));
    if (world) return groups.get(world[1]) || add(world[1], '目的地', 110, activityArt(world[1]));
    if (source.includes('遗落利维坦')) return groups.get('宿怨赛季') || add('宿怨赛季', '赛季 / 篇章', 83);
    if (source.includes('永恒宝藏')) return groups.get('永恒挑战') || add('永恒挑战', '活动', 105, activityArt('永恒挑战'));
    if (/异域|异国|证据板|炽天使之盾|苦命鸳鸯|亡魂要塞|首席调查员/.test(source)) return groups.get('异域任务与奖励') || add('异域任务与奖励', '异域武器', 120);
    if (source.includes('季票')) return groups.get('季票奖励') || add('季票奖励', '赛季 / 篇章', 101);
    if (source) return groups.get('世界掉落与其他来源') || add('世界掉落与其他来源', '其他来源', 130);
    return groups.get('来源待确认') || add('来源待确认', '其他来源', 140);
  };
  // Release tags are only used when all explicit seasonal sources for that tag
  // agree. Do not guess a season for ambiguous reissues or generic source text.
  const releaseSeasons = new Map();
  for (const item of weapons.filter(i => i.inventory?.recipeItemHash)) {
    const source = collectibles[item.collectibleHash]?.sourceString || '';
    if (!source.includes('赛季')) continue;
    const group = sourceGroup(source);
    for (const tag of item.traitIds || []) if (tag.startsWith('releases.')) {
      if (!releaseSeasons.has(tag)) releaseSeasons.set(tag, new Set()); releaseSeasons.get(tag).add(group.name);
    }
  }
  return pattern => {
    const candidates = (byName.get(pattern.name) || []).filter(i => i.inventory?.recipeItemHash);
    const item = candidates.length === 1 ? candidates[0] : null;
    let source = item ? collectibles[item.collectibleHash]?.sourceString || '' : '';
    let group;
    const badges = badgeNames.get(pattern.name);
    if (item && badges?.size === 1) { group = groups.get([...badges][0]); source = `来源：${group.name}突袭（收藏证章）`; }
    if (!group && item && (!source || source.includes('季票'))) {
      const names = unique((item.traitIds || []).flatMap(tag => [...(releaseSeasons.get(tag) || [])]));
      if (names.length === 1) { group = groups.get(names[0]); source ||= `版本归属：${group.name}（发布标记）`; }
    }
    group ||= sourceGroup(source);
    return { icon: pattern.icon || item?.displayProperties?.icon || '', itemHash: item ? String(item.hash) : '',
      weaponType: item?.itemTypeDisplayName || '', sourceText: source.replace(/^来源[：:]\s*/, '') || '官方来源信息暂缺',
      group: { ...group } };
  };
}
