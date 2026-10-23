import { UserError } from './http.js';
import { MODES, className, number, value, duration, date, day, mergeHistory, activityRow, statTiles, recordState, collectibleState } from './report-data.js';
import { buildPvpCard } from './pvp-data.js';

const normalize = text => String(text || '').normalize('NFKC').toLowerCase().replace(/\s+/g, '');
const weaponNames = { AutoRifle: '自动步枪', HandCannon: '手炮', PulseRifle: '脉冲步枪', ScoutRifle: '斥候步枪', FusionRifle: '融合步枪', Sniper: '狙击步枪', Shotgun: '霰弹枪', MachineGun: '机枪', RocketLauncher: '火箭发射器', SideArm: '手枪', Sword: '刀剑', Submachinegun: '微型冲锋枪', GrenadeLauncher: '榴弹发射器', Bow: '弓', TraceRifle: '追踪步枪', Glaive: '偃月' };

export class GuardianReports {
  constructor(destiny) { this.destiny = destiny; }
  async catalog() {
    const index = await this.destiny.load();
    if (!index.reportVersion || !index.reportCatalog) throw new UserError('战绩数据库需要更新，请运行 05-sync-destiny.cmd 后重启机器人。');
    return index.reportCatalog;
  }
  async identity(nameOrBinding) { return this.destiny.player(nameOrBinding); }
  base(title, player, extra = {}) {
    return { layout: 'guardian-report', title, subtitle: player?.displayName || '命运 2 · 公开活动', at: Date.now(), sections: [],
      source: 'Bungie 官方 API / Manifest · 数据及游戏图片 © Bungie', ...extra };
  }
  accountPath(player) {
    this.destiny.validateMembership(player);
    return `/Destiny2/${player.membershipType}/Account/${player.membershipId}`;
  }
  async account(player) {
    const path = this.accountPath(player) + '/Stats/?groups=1,2';
    return this.destiny.cache.get(path, 60000, () => this.destiny.api(path));
  }
  async modeStats(player, mode) {
    if (['pvp','pve'].includes(mode)) return (await this.account(player)).mergedAllCharacters?.results?.[MODES[mode].key]?.allTime;
    const path = this.accountPath(player) + `/Character/0/Stats/?modes=${MODES[mode].id}&groups=1,2`;
    const result = await this.destiny.cache.get(path, 60000, () => this.destiny.api(path));
    return result[MODES[mode].key]?.allTime;
  }
  async history(player, characters, mode = 0, count = 100) {
    const results = await Promise.allSettled(characters.map(async character => {
      const path = this.accountPath(player) + `/Character/${character.characterId}/Stats/Activities/?count=${count}&mode=${mode}&page=0`;
      const response = await this.destiny.cache.get(path, 60000, () => this.destiny.api(path));
      return { activities: response.activities || [], character };
    }));
    const ok = results.filter(x => x.status === 'fulfilled').map(x => x.value);
    if (!ok.length) throw new UserError('未能获取活动历史，可能未公开、正在限流或接口暂不可用。请稍后重试。');
    return { rows: mergeHistory(ok), partial: ok.length !== results.length, capped: ok.some(x => x.activities.length >= count) };
  }
  async aggregate(player, characters, mode, catalog) {
    const results = await Promise.allSettled(characters.map(async character => {
      const path = this.accountPath(player) + `/Character/${character.characterId}/Stats/AggregateActivityStats/`;
      const response = await this.destiny.cache.get(path, 60000, () => this.destiny.api(path));
      return (response.activities || []).filter(a => catalog.activities[a.activityHash]?.modes?.includes(mode)).map(a => {
        const def = catalog.activities[a.activityHash], v = a.values;
        const ms = value(v,'fastestCompletionMsForActivity');
        return { title: def.name, background: def.background, text: className(character.classType),
          metrics: [{ label: '官方完成次数', value: number(value(v,'activityCompletions')) }, { label: '累计时长', value: duration(value(v,'activitySecondsPlayed')) }, { label: '最快完成', value: ms > 0 ? duration(ms / 1000) : '未返回' }],
          meta: `活动编号 ${a.activityHash} · 每个角色分别统计`, sort: value(v,'activitySecondsPlayed') || 0 };
      });
    }));
    return { rows: results.filter(x => x.status === 'fulfilled').flatMap(x => x.value).sort((a,b) => b.sort - a.sort), partial: results.some(x => x.status === 'rejected') };
  }
  async pvpDetails(player, rows, {budgetMs = 18000} = {}) {
    const enriched=rows.map(row=>({...row,precision:null,weapons:[]}));
    let next=0;const deadline=Date.now()+budgetMs;
    await Promise.all(Array.from({length:Math.min(4,enriched.length)},async()=>{
      while(next<enriched.length && Date.now()<deadline) {
        const row=enriched[next++],id=String(row.activityDetails.instanceId);
        if (!/^\d{1,20}$/.test(id)) continue;
        try {
          const report=await this.destiny.cache.get('pgcr:'+id,300000,()=>this.destiny.api(`/Destiny2/Stats/PostGameCarnageReport/${id}/`,{timeout:6000}));
          const entry=(report.entries || []).find(entry=>String(entry.characterId)===String(row.character?.characterId)
            && String(entry.player?.destinyUserInfo?.membershipId)===String(player.membershipId));
          const precision=value(entry?.extended?.values,'precisionKills');
          if(precision != null && precision>=0) row.precision=precision;
          row.weapons=entry?.extended?.weapons || [];
        } catch { /* History remains useful when a battle report is unavailable. */ }
      }
    }));
    return enriched;
  }
  async pvpBreakdown(player) {
    const path=this.accountPath(player)+'/Character/0/Stats/?modes=69,70,84,19,48&groups=1,2';
    return this.destiny.cache.get(path,60000,()=>this.destiny.api(path));
  }
  async combat(nameOrBinding, mode = 'all', page = 1) {
    const maxPage = ['raid','dungeon'].includes(mode) ? 50 : 5;
    if (!MODES[mode] || page < 1 || page > maxPage) throw new UserError('近期战绩每页 20 条，支持第 1–5 页；突袭／地牢累计可继续翻页。');
    const { player, characters } = await this.identity(nameOrBinding), catalog = await this.catalog(), definition = MODES[mode];
    const [recent, statsResult] = await Promise.all([
      page <= 5 ? this.history(player, characters, definition.id, page * 20 + 1) : Promise.resolve({rows:[],partial:false,capped:false}),
      mode === 'all' ? Promise.resolve({ ok: true }) : this.modeStats(player, mode).then(stats => ({ ok: true, stats }), () => ({ ok: false })),
    ]);
    const stats = statsResult.stats, competitive = ['pvp','trials','iron','gambit'].includes(mode);
    const rows = recent.rows.slice((page - 1) * 20, page * 20);
    if (['pvp','trials','iron'].includes(mode)) {
      const [details,breakdown]=await Promise.all([
        this.pvpDetails(player,rows),
        mode==='pvp' ? this.pvpBreakdown(player).then(data=>({data}),()=>({failed:true})) : Promise.resolve({}),
      ]);
      return buildPvpCard({player,definition,stats,statsOk:statsResult.ok,recent:{rows:details,partial:recent.partial,more:page<5 && (recent.rows.length>page*20 || recent.capped)},page,catalog,breakdown:breakdown.data,breakdownFailed:breakdown.failed});
    }
    const card = this.base(definition.title, player, { eyebrow: definition.en, background: catalog.activities[rows[0]?.activityDetails.referenceId]?.background,
      accent: competitive ? 'red' : 'teal', metrics: mode === 'all' ? [] : statTiles(stats, competitive) });
    if (mode !== 'all') {
      const entered = value(stats,'activitiesEntered'), won = value(stats,'activitiesWon');
      card.sections.push({ title: '累计数据', text: stats ? `官方统计时长 ${duration(value(stats,'secondsPlayed'))} · 最高单场击杀 ${number(value(stats,'bestSingleGameKills'))}${competitive ? ` · 胜率 ${entered > 0 && won != null ? number(won / entered * 100) + '%' : '未返回'}` : ''}` : statsResult.ok ? '接口没有返回该模式的累计战绩：可能尚无记录或未公开；不按 0 计算。' : '累计战绩接口暂不可用，已保留可用的近期记录。' });
      const weapons = Object.entries(weaponNames).map(([key,title]) => ({ title, count: value(stats,'weaponKills' + key) })).filter(x => x.count > 0).sort((a,b) => b.count - a.count).slice(0,6);
      if (weapons.length) card.sections.push({ title: '常用武器类型 · 按累计击杀', pills: weapons.map(x => `${x.title} ${number(x.count)}`) });
    }
    if (['raid','dungeon'].includes(mode)) {
      const totals = await this.aggregate(player, characters, definition.id, catalog);
      const aggregateRows = totals.rows.slice((page - 1) * 12, page * 12);
      card.sections.push({ title: `副本累计 · 第 ${page} 页`, rows: aggregateRows,
        text: totals.rows.length ? `共 ${totals.rows.length} 条角色／活动记录，每页 12 条。完成次数可能含检查点；不等同于全程通关、单人或无暇。${totals.partial ? '部分角色累计接口未返回。' : ''}` : totals.partial ? '副本累计数据暂不可用。' : '没有返回该类副本的累计记录。' });
    }
    card.sections.push({ title: `近期记录 · 第 ${page} 页`, text: page > 5 ? '近期记录最多展示前 5 页；此页只继续展示副本累计。' : rows.length ? `本页 ${rows.length} 场${page === 5 ? ' · 已达到近期记录展示上限' : recent.rows.length > page * 20 || recent.capped ? ' · 可尝试下一页' : ' · 已到当前可见记录末尾'}` : '暂无可显示的近期记录。可能没有参与记录、历史未公开，或已超过可见页数。', rows: rows.map(a => activityRow(a,catalog)) });
    card.notice = `累计数据与近期记录为不同范围；近期仅含现存角色。时间为北京时间；时长为本人参与时长。K/D 与效率沿用官方值。${recent.partial ? '\n部分角色历史读取失败，本次不是完整列表。' : ''}\n发送「${definition.title.replace('战绩','')} 第2页」或「战绩 第2页」翻页；「对局 编号」查看战报。`;
    if (mode === 'all') card.notice = card.notice.replace('近期 第2页','战绩 第2页');
    if (mode === 'trials') card.notice = card.notice.replace('奥西里斯试炼 第2页','试炼 第2页');
    return card;
  }
  async career(nameOrBinding) {
    const { player, characters } = await this.identity(nameOrBinding);
    const [account, profile] = await Promise.all([this.account(player), this.destiny.profile(player,'100,200,900')]);
    const stats = account.mergedAllCharacters?.merged?.allTime;
    const record = profile.profileRecords?.data;
    return this.base('守护者生涯', player, { eyebrow: 'GUARDIAN CAREER', background: characters[0]?.emblemBackgroundPath,
      metrics: [{ label: '官方活动时长', value: duration(value(stats,'secondsPlayed')) }, { label: '参与活动', value: number(value(stats,'activitiesEntered')) }, { label: '累计击杀', value: number(value(stats,'kills')) }, { label: '守护者等级', value: number(profile.profile?.data?.currentGuardianRank) }],
      sections: [{ title: '角色档案', rows: characters.map(c => ({ title: className(c.classType), icon: c.emblemPath, background: c.emblemBackgroundPath,
        text: `光等 ${number(c.light)} · 角色记录时长 ${c.minutesPlayedTotal == null ? '—' : duration(Number(c.minutesPlayedTotal) * 60)}`, meta: `最后游玩 ${date(c.dateLastPlayed)}` })) },
      { title: '成就分数', metrics: [{ label: '当前分数', value: number(record?.activeScore) }, { label: '传承分数', value: number(record?.legacyScore) }, { label: '生涯分数', value: number(record?.lifetimeScore) }] },
      { title: '模式概览', rows: ['pve','pvp'].map(mode => ({ title: MODES[mode].title, metrics: statTiles(account.mergedAllCharacters?.results?.[MODES[mode].key]?.allTime,mode === 'pvp') })) }],
      notice: '生涯统计采用 Bungie 合并结果，可能包含已删除角色；角色时长采用角色档案，统计口径不同。不推算入坑日期或外部排名。' });
  }
  async heatmap(nameOrBinding) {
    const { player, characters } = await this.identity(nameOrBinding), catalog = await this.catalog();
    const history = await this.history(player,characters,0,100), now = Date.now(), counts = {};
    const days = Array.from({ length: 91 }, (_,i) => day(now - (90 - i) * 86400000));
    for (const a of history.rows) { const key = day(a.period); counts[key] = (counts[key] || 0) + 1; }
    const within = history.rows.filter(a => days.includes(day(a.period)));
    const top = new Map();for (const a of within) { const def = catalog.activities[a.activityDetails.referenceId]; const key = def?.name || `活动 ${a.activityDetails.referenceId}`; top.set(key, (top.get(key) || 0) + 1); }
    return this.base('近期活动热力图',player,{ eyebrow: 'ACTIVITY HEATMAP',
      metrics: [{ label: '窗口内样本', value: within.length }, { label: '有记录日期', value: new Set(within.map(a => day(a.period))).size }, { label: '获取到的去重记录', value: history.rows.length }],
      sections: [{ title: '最近 91 天 · 按北京时间', heatmap: days.map(d => ({ date: d, count: counts[d] || 0 })), text: `${days[0]} — ${days.at(-1)} · 每格一天，数字为样本内活动次数。` },
        { title: '样本内常玩活动', rows: [...top].sort((a,b) => b[1]-a[1]).slice(0,10).map(([title,count]) => ({ title, badge: `${count} 场` })) }],
      notice: `每个现存角色最多读取最近 100 条活动后合并去重；这是近期样本，不是完整生涯热力图。空格表示样本内无记录，不证明当天未游玩。${history.capped ? '至少一个角色已达到读取上限。' : ''}${history.partial ? '部分角色读取失败。' : ''}` });
  }
  async loadout(nameOrBinding) {
    const { player, characters } = await this.identity(nameOrBinding), catalog = await this.catalog();
    const profile = await this.destiny.profile(player,'100,200,205,300,305');
    return this.base('当前装备与配装',player,{ eyebrow:'EQUIPPED LOADOUT', sections: characters.map(c => {
      const equipment = profile.characterEquipment?.data?.[c.characterId]?.items;
      const equipped = (equipment || []).filter(item => [2,3,16].includes(catalog.items[item.itemHash]?.type));
      return { title: `${className(c.classType)} · 光等 ${number(c.light)}`, text: equipment ? '展示当前装备的武器、护甲与职业分支；插槽只列已启用且可见的选项。' : '该角色装备未公开或未返回。', rows: equipped.map(item => {
        const def = catalog.items[item.itemHash], instance = profile.itemComponents?.instances?.data?.[item.itemInstanceId];
        const sockets = profile.itemComponents?.sockets?.data?.[item.itemInstanceId]?.sockets;
        const plugs = [...new Set((sockets || []).filter(s => s.isEnabled && s.isVisible).map(s => s.plugHash))].map(hash => catalog.items[hash]).filter(Boolean);
        return { title:def.name,icon:def.icon,badge:instance?.primaryStat?.value == null ? def.tier : `光等 ${instance.primaryStat.value}`,text:def.typeName,
          chips:plugs.map(p => ({text:p.name,icon:p.icon})), meta: sockets ? '插槽数据来自当前装备实例' : '插槽未返回或该物品没有实例插槽' };
      }) };
    }), notice:'只读当前公开装备，不是游戏内保存的配装槽；未授权切换装备或读取私有背包。数据可能缓存 60 秒。' });
  }
  async records(nameOrBinding, kind, keyword = '', page = 1) {
    const { player } = await this.identity(nameOrBinding), catalog = await this.catalog();
    const collecting = kind === 'collection';
    const profile = await this.destiny.profile(player,collecting ? '100,800' : '100,900');
    if (!keyword && kind !== 'titles') throw new UserError(`请带上关键词，例如「${collecting ? '收藏 雷神' : '成就 独狼'}」。`);
    const query = normalize(keyword);
    const matches = Object.values(collecting ? catalog.collectibles : catalog.records).filter(d => (kind !== 'titles' || (d.title && !d.gilding)) && (!query || normalize(d.name + ' ' + (d.title || '')).includes(query) || d.hash === keyword));
    const rows = matches.map(def => {
      const state = collecting ? collectibleState(def.hash,profile) : recordState(def,profile,catalog);
      if (state.hidden) return null;
      return { title: def.title && def.title !== def.name ? `${def.title} · ${def.name}` : def.name, icon: def.icon, text: collecting ? def.source || def.description : def.description,
        badge: state.status, tone: state.complete || state.acquired ? 'good' : 'muted', metrics: state.progress, meta:`${collecting ? '收藏' : '成就'}编号 ${def.hash}` };
    }).filter(Boolean).sort((a,b)=>Number(b.tone === 'good')-Number(a.tone === 'good') || a.title.localeCompare(b.title,'zh-CN'));
    return this.base(kind === 'titles' ? '称号进度' : `${collecting ? '收藏' : '成就'} · ${keyword}`,player,{ eyebrow:'GUARDIAN COLLECTION',
      sections:[{title:`第 ${page} / ${Math.max(1,Math.ceil(rows.length / 12))} 页 · 共 ${rows.length} 项`,rows:rows.slice((page-1)*12,page*12),text:rows.length ? '' : '没有找到可显示的匹配记录。'}],
      notice:'每页 12 项，追加「第2页」翻页。隐藏／未揭晓的记录不展示；缺失进度标为未公开。角色级成就采用已完成或一个可见角色的进度，不把多个角色相加。' });
  }
  async weekly() {
    const catalog = await this.catalog();
    const response = await this.destiny.cache.get('public-milestones',300000,()=>this.destiny.api('/Destiny2/Milestones/'));
    const milestones = Object.values(response).sort((a,b) => (a.order || 0)-(b.order || 0));
    return this.base('本周公开活动',null,{eyebrow:'WEEKLY DIRECTOR',sections:milestones.map(m => {
      const def = catalog.milestones[m.milestoneHash];
      return {title:def?.name || `活动 ${m.milestoneHash}`,text:[def?.description,m.startDate ? `开始 ${date(m.startDate)}` : '',m.endDate ? `结束 ${date(m.endDate)}` : ''].filter(Boolean).join('\n'),
        rows:[...new Map((m.activities || []).map(a => [a.activityHash,a])).values()].map(a => { const activity = catalog.activities[a.activityHash];return {title:activity?.name || `活动 ${a.activityHash}`,background:activity?.background,text:activity?.description,
          pills:(a.challengeObjectiveHashes || []).map(hash => catalog.objectives[hash]?.text || `挑战 ${hash}`)}; }) };
    }),notice:'来自 Bungie 当前公开里程碑，缓存最多 5 分钟。只覆盖接口公开的轮换与挑战，不代表完整社区周报、商人库存或个人巅峰完成状态。'});
  }
  async team(nameOrBinding) {
    const { player, characters } = await this.identity(nameOrBinding), catalog = await this.catalog();
    const profile = await this.destiny.profile(player,'100,200,204,1000');
    const transitory = profile.profileTransitoryData?.data;
    return this.base('当前活动与队伍',player,{eyebrow:'FIRETEAM STATUS',sections:[{title:'角色活动',rows:characters.map(c=>{
      const a=profile.characterActivities?.data?.[c.characterId],def=catalog.activities[a?.currentActivityHash];
      return {title:className(c.classType),text:def?.name || '未返回当前活动，可能处于轨道、离线或资料未公开',background:def?.background,meta:a?.dateActivityStarted?`活动开始 ${date(a.dateActivityStarted)}`:''};
    })},{title:'火力战队',text:transitory?.partyMembers?.length ? '成员由 Bungie 临时数据返回，可能有延迟。' : '没有返回可见的实时队伍数据，不能据此认定你正在单人游玩。',rows:(transitory?.partyMembers || []).map(m=>({title:m.displayName || '未返回成员名',text:m.status == null ? '' : `官方状态码 ${m.status}`}))}],notice:'此接口属于临时状态，Bungie 不保证实时性。未公开成员不会被补查或猜测。'});
  }
  async lastMatch(nameOrBinding) {
    const {player,characters}=await this.identity(nameOrBinding);
    const recent=await this.history(player,characters,0,1);
    if (!recent.rows.length) throw new UserError('当前没有可见的近期对局，无法选择上一局。');
    const card=await this.match(String(recent.rows[0].activityDetails.instanceId));
    if (recent.partial) card.notice += '\n部分角色历史未返回；这是已成功获取角色中的最近一局。';
    return card;
  }
  async match(id) {
    if (!/^\d{1,20}$/.test(id)) throw new UserError('用法：对局 活动编号（编号在战绩图片底部）。');
    const catalog = await this.catalog();
    let response;
    try { response = await this.destiny.cache.get('pgcr:'+id,60000,()=>this.destiny.api(`/Destiny2/Stats/PostGameCarnageReport/${id}/`)); }
    catch { throw new UserError('对局战报暂时未能获取。战报可能尚未生成、未公开或接口不可用；可以先用「战绩」查看个人记录。'); }
    const def=catalog.activities[response.activityDetails?.referenceId];
    return this.base(def?.name || '对局战报',null,{eyebrow:'POST GAME REPORT',subtitle:`对局 ${id} · ${date(response.period)}`,background:def?.background,
      sections:[{title:`战报参与者 · ${(response.entries || []).length} 条角色记录`,text:response.activityWasStartedFromBeginning == null ? '' : response.activityWasStartedFromBeginning ? '官方标记：此活动实例从起点开始。' : '官方标记：此活动实例不是从起点开始。',rows:(response.entries || []).map(entry=>{
        const identity=entry.player?.destinyUserInfo; const code=identity?.bungieGlobalDisplayNameCode;
        const name=identity?.bungieGlobalDisplayName ? identity.bungieGlobalDisplayName+(code == null ? '' : '#'+String(code).padStart(4,'0')) : identity?.displayName || '未公开名称';
        const v=entry.values;
        return {title:name,icon:entry.player?.destinyUserInfo?.iconPath,text:`${entry.player?.characterClass || '角色'} · 参与 ${duration(value(v,'timePlayedSeconds'))}`,badge: value(v,'standing') === 0 ? '胜利' : value(v,'standing') === 1 ? '失败' : value(v,'completed') === 1 ? '已完成' : '完成状态未确认',
          metrics:[{label:'击杀',value:number(value(v,'kills'))},{label:'死亡',value:number(value(v,'deaths'))},{label:'助攻',value:number(value(v,'assists'))},{label:'K/D',value:number(value(v,'killsDeathsRatio'))}],meta:value(v,'team') == null ? '' : `队伍 ${number(value(v,'team'))}`};
      })}],notice:'展示官方战报中的参与记录，包含中途加入／离开的角色；个人零死亡不等于整队无暇。'});
  }
}
