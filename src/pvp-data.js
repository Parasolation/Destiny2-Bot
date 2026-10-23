import { number, value, duration, date } from './report-data.js';

export const PVP_MODES = {
  pvpCompetitive: '竞技', pvpQuickplay: '快速游戏', trials_of_osiris: '奥西里斯试炼', ironBanner: '铁旗', rumble: '混战',
};
const TYPES = { AutoRifle:'自动步枪', HandCannon:'手炮', PulseRifle:'脉冲步枪', ScoutRifle:'斥候步枪', FusionRifle:'融合步枪', BeamRifle:'追踪步枪（旧字段）', Sniper:'狙击步枪', Shotgun:'霰弹枪', MachineGun:'机枪', RocketLauncher:'火箭发射器', SideArm:'手枪', Sword:'刀剑', Submachinegun:'微型冲锋枪', GrenadeLauncher:'榴弹发射器', Bow:'弓', TraceRifle:'追踪步枪', Glaive:'偃月' };
export const count = (stats,key) => { const n = value(stats,key); return n != null && n >= 0 ? n : null; };
export const decimal = n => n == null || !Number.isFinite(n) ? '—' : n.toFixed(2);
export const quotient = (a,b) => a == null || b == null || b <= 0 ? null : a / b;
export const percentage = (a,b) => { const ratio = quotient(a,b);return ratio == null || ratio < 0 || ratio > 1 ? '—' : `${(ratio*100).toFixed(2)}%`; };
const kd = (k,d) => k == null || d == null ? null : k / Math.max(1,d);
const tile = (label,value) => ({label,value});

export function pvpOverview(stats) {
  const n = key => count(stats,key), kills=n('kills'), deaths=n('deaths'), assists=n('assists'), games=n('activitiesEntered');
  const calculatedKda = kills == null || assists == null ? null : kd(kills + assists/2,deaths);
  const calculatedEfficiency = kills == null || assists == null ? null : kd(kills + assists,deaths);
  return {
    headline: [tile('K/D',decimal(n('killsDeathsRatio') ?? kd(kills,deaths))),tile('KDA · 半助攻',decimal(n('killsDeathsAssists') ?? calculatedKda)),tile('效率 · KA/D',decimal(n('efficiency') ?? calculatedEfficiency)),tile('爆头率',percentage(n('precisionKills'),kills)),tile('胜率',percentage(n('activitiesWon'),games))],
    totals: [tile('参与场次',number(games)),tile('胜利场次',number(n('activitiesWon'))),tile('总击杀',number(kills)),tile('总死亡',number(deaths)),tile('总助攻',number(assists)),tile('精准击杀',number(n('precisionKills'))),
      tile('场均击杀',decimal(quotient(kills,games))),tile('场均死亡',decimal(quotient(deaths,games))),tile('场均助攻',decimal(quotient(assists,games))),tile('每分钟击杀',decimal(quotient(kills,n('secondsPlayed') == null ? null : n('secondsPlayed')/60))),tile('场均得分',decimal(quotient(n('score'),games))),tile('累计时长',duration(n('secondsPlayed')))],
    records: [tile('最高单场击杀',number(n('bestSingleGameKills'))),tile('最高连杀',number(n('longestKillSpree'))),tile('最高单场精准击杀',number(n('mostPrecisionKills'))),tile('最高单场得分',number(n('bestSingleGameScore'))),tile('平均存活',duration(n('averageLifespan'))),tile('官方战斗评分',decimal(n('combatRating')))],
  };
}

export function pvpWeaponTypes(stats) {
  return Object.entries(TYPES).map(([key,name]) => {
    const kills=count(stats,'weaponKills'+key),precision=count(stats,'weaponPrecisionKills'+key);
    const ratio=count(stats,'weaponKillsPrecisionKills'+key);
    return {name,kills,precision,headshots: precision != null ? percentage(precision,kills) : ratio != null && ratio <= 1 ? `${(ratio*100).toFixed(2)}%` : '—',share:percentage(kills,count(stats,'kills'))};
  }).filter(x=>x.kills>0).sort((a,b)=>b.kills-a.kills);
}

export function pvpRecentSummary(rows) {
  const sum = key => rows.length && rows.every(a=>count(a.values,key)!=null) ? rows.reduce((n,a)=>n+count(a.values,key),0) : null;
  const kills=sum('kills'),deaths=sum('deaths'),assists=sum('assists');
  const known=rows.filter(a=>[0,1].includes(value(a.values,'standing'))),wins=known.filter(a=>value(a.values,'standing')===0).length;
  const precisionRows=rows.filter(a=>a.precision != null),precision=precisionRows.reduce((n,a)=>n+a.precision,0),precisionKills=precisionRows.reduce((n,a)=>n+(count(a.values,'kills') || 0),0);
  return { kills,deaths,assists,wins,losses:known.length-wins,unknown:rows.length-known.length,precisionCount:precisionRows.length,
    tiles:[tile('场数',number(rows.length)),tile('胜 / 负 / 未知',`${wins} / ${known.length-wins} / ${rows.length-known.length}`),tile('K/D',decimal(kd(kills,deaths))),tile('KDA',decimal(kills == null || assists == null ? null : kd(kills+assists/2,deaths))),tile('效率 KA/D',decimal(kills == null || assists == null ? null : kd(kills+assists,deaths))),tile('爆头率 · 已取得战报',percentage(precision,precisionKills))],
    sequence: rows.map(a=>value(a.values,'standing')===0?'W':value(a.values,'standing')===1?'L':'?'),
  };
}

export function pvpMatchRow(a,catalog) {
  const v=a.values,standing=value(v,'standing'), modes=a.activityDetails?.modes || [];
  const labels={10:'占领',12:'冲突',19:'铁旗',37:'生存',38:'倒计时',48:'混战',69:'竞技',70:'快速游戏',71:'冲突',72:'竞技冲突',73:'占领',74:'竞技占领',80:'淘汰',81:'动量控制',84:'试炼',88:'裂隙',89:'区域占领',90:'铁旗裂隙',91:'铁旗区域占领',92:'遗物'};
  const mode = modes.includes(84) ? '试炼' : modes.includes(19) ? '铁旗' : labels[a.activityDetails?.mode] || (modes.includes(69) ? '竞技' : modes.includes(48) ? '混战' : '熔炉');
  return {id:String(a.activityDetails.instanceId),time:date(a.period),name:catalog.activities[a.activityDetails.referenceId]?.name || `活动 ${a.activityDetails.referenceId}`,mode,
    result:standing===0?'胜':standing===1?'负':'—',private:Boolean(a.activityDetails.isPrivate),
    kills:number(count(v,'kills')),deaths:number(count(v,'deaths')),assists:number(count(v,'assists')),kd:decimal(count(v,'killsDeathsRatio') ?? kd(count(v,'kills'),count(v,'deaths'))),
    kda:decimal(count(v,'killsDeathsAssists') ?? (count(v,'kills') == null || count(v,'assists') == null ? null : kd(count(v,'kills')+count(v,'assists')/2,count(v,'deaths')))),
    efficiency:decimal(count(v,'efficiency')),precision:number(a.precision),headshots:percentage(a.precision,count(v,'kills')),score:number(count(v,'score')),duration:duration(count(v,'timePlayedSeconds'))};
}

export function pvpRecentWeapons(rows,catalog) {
  const weapons=new Map();
  for(const a of rows) for(const weapon of a.weapons || []) {
    const hash=String(weapon.referenceId),kills=count(weapon.values,'uniqueWeaponKills');if(kills==null || kills<=0)continue;
    const precision=count(weapon.values,'uniqueWeaponPrecisionKills'),def=catalog.items?.[hash];
    const prior=weapons.get(hash) || {hash,name:def?.name || `武器 ${hash}`,icon:def?.icon,kills:0,precision:0,unknownPrecision:false};
    prior.kills+=kills;if(precision == null)prior.unknownPrecision=true;else prior.precision+=precision;weapons.set(hash,prior);
  }
  return [...weapons.values()].sort((a,b)=>b.kills-a.kills).slice(0,10).map(w=>({...w,headshots:w.unknownPrecision?'—':percentage(w.precision,w.kills),precision:w.unknownPrecision?null:w.precision}));
}

export function buildPvpCard({player,definition,stats,statsOk,recent,page,catalog,breakdown,breakdownFailed}) {
  const overview=pvpOverview(stats),summary=pvpRecentSummary(recent.rows);
  return {layout:'pvp-stat-report',title:definition.title,subtitle:player.displayName,at:Date.now(),page,...overview,
    noStats:!stats,statsMessage:stats ? '' : statsOk ? '暂无可读取的累计战绩，未返回字段保留为 —。' : '累计统计暂时无法取得，以下保留可读取的近期记录。',
    weaponTypes:pvpWeaponTypes(stats),recentWeapons:pvpRecentWeapons(recent.rows,catalog),recentSummary:summary,
    matches:recent.rows.map(a=>pvpMatchRow(a,catalog)),partial:recent.partial,more:recent.more,
    modes:breakdown ? Object.entries(PVP_MODES).map(([key,name])=>{const s=breakdown[key]?.allTime;const overview=pvpOverview(s);return {name,games:number(count(s,'activitiesEntered')),kd:overview.headline[0].value,kda:overview.headline[1].value,headshots:overview.headline[3].value,winRate:overview.headline[4].value};}) : [],breakdownFailed,
    notice:`KDA=(击杀+助攻÷2)/死亡；效率 KA/D=(击杀+助攻)/死亡。0 死亡时分母按 1。\n爆头率=精准击杀/击杀，代表终结击杀比例，并非命中率；武器分类单独计算。近期按总击杀、总死亡汇总，不取各局比率的平均。\n累计包含官方合并统计，近期仅含现存角色。近期精准击杀已取得 ${summary.precisionCount}/${recent.rows.length} 场战报，缺失显示 —；近期爆头率只使用这些战报对应的击杀。${recent.partial?'部分角色历史读取失败。':''}\n${page<5?`「${definition.title.replace('战绩','')} 第${page+1}页」继续翻页；`: '近期最多显示前 5 页；'}「对局 编号」看完整战报。`,source:'Bungie 官方 API · 查询数据可能缓存 60 秒；单局战报缓存 5 分钟'};
}
