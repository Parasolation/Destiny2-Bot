import { UserError } from './http.js';
import { dateTime } from './cards.js';

export function parseCommand(input) {
  let text = String(input ?? '').replace(/<@!?[^>]+>/g, '').trim().replace(/^[/／]/, '').trim();
  if (text.length > 160) throw new UserError('指令太长，请将关键词控制在 80 字以内。');
  let page = 1;
  const pagination = text.match(/\s+第?(\d+)页$/);
  if (pagination) { page = Number(pagination[1]); text = text.slice(0, pagination.index).trim(); }
  if (page < 1 || page > 50) throw new UserError('页码范围是 1–50。');
  if (/^(帮助|菜单|help)$/i.test(text)) return { type: 'help' };
  if (/^(状态|status)$/i.test(text)) return { type: 'status' };
  const meme = text.match(/^6657\s*(热门|周榜|随机|实时|搜索)(?:\s+(.+))?$/);
  if (meme) {
    const mode = ({ 热门: 'hot', 周榜: 'week', 随机: 'random', 实时: 'live', 搜索: 'search' })[meme[1]];
    if (mode === 'search' && !meme[2]) throw new UserError('示例：6657 搜索 关键词');
    if (mode !== 'search' && meme[2]) throw new UserError('这条指令不需要关键词。翻页示例：6657 热门 第2页');
    return { type: 'meme', mode, keyword: meme[2] || '', page };
  }
  const destiny = text.match(/^(武器|perk|词条|玩家)\s+(.+)$/i);
  if (destiny) return { type: ({ 武器: 'weapon', perk: 'perk', 词条: 'perk', 玩家: 'player' })[destiny[1].toLowerCase()], keyword: destiny[2], page };
  return { type: 'help', unknown: true };
}

export function helpCard() {
  return { title: '守护者的群聊工具箱', label: '使用帮助', subtitle: '在群里 @机器人，然后输入下面的指令', source: '本地帮助 · v0.1',
    rows: [
      { title: '命运 2', text: '武器 武器名称\nPerk 词条名称\n玩家 Bungie名称#1234', meta: '支持中文名称；同名多个结果可按页查看。' },
      { title: '6657 烂梗库', text: '6657 热门　/　6657 周榜\n6657 随机\n6657 搜索 关键词', meta: '来源 sb6657.cn；热门榜按网站提供的顺序展示。' },
      { title: '6657 直播间', text: '6657 实时', meta: '展示最近一段时间实际采集到的弹幕，按参与人数优先排序。' },
      { title: '翻页与运行状态', text: '武器 名称 第2页\n6657 热门 第2页\n状态', meta: '查询结果、帮助和错误提示均使用图片回复。' },
    ] };
}

export function liveCard(snapshot, config) {
  if (!snapshot.connected) return { title: '实时弹幕暂不可用', label: '6657 LIVE', source: `斗鱼 ${config.roomId} 房间 · 本机采集`, at: snapshot.at,
    rows: [{ text: snapshot.state }], notice: '连接恢复后会重新开始统计。此时不展示旧排行榜。' };
  return { title: '6657 实时弹幕热榜', label: '6657 LIVE', at: snapshot.at, source: `斗鱼 ${config.roomId} 房间 · 本机采集`,
    subtitle: `${dateTime(snapshot.start)} — ${dateTime(snapshot.at)}`,
    stats: [{ label: '采集到的弹幕', value: snapshot.count }, { label: '参与账号', value: snapshot.users }, { label: '目标统计窗口', value: `${config.windowMinutes} 分钟` }],
    rows: snapshot.rows.length ? snapshot.rows.map((x, i) => ({ rank: i + 1, text: x.text, meta: `${x.users} 人参与  ·  ${x.count} 次出现` })) : [{ text: '这段时间还没有收到符合条件的弹幕。' }],
    notice: [!snapshot.complete ? '尚未覆盖完整统计窗口，仅展示上述实际采集时段。' : '', snapshot.capped ? '消息量超过缓存上限，本次为部分样本。' : '',
      '按参与人数、出现次数排序；合并大小写和空白差异，过滤重复消息 ID。不代表平台全量统计。'].filter(Boolean).join('\n') };
}

export async function queryCard(command, { memes, destiny, live, config }) {
  if (command.type === 'help') return { ...helpCard(), notice: command.unknown ? '未识别这条指令，请参考以下用法。' : undefined };
  if (command.type === 'status') {
    let index;
    try { index = await destiny.load(); } catch {}
    const snapshot = live.snapshot();
    return { title: '机器人运行状态', label: 'STATUS', source: '本机运行状态', rows: [
      { title: 'QQ 官方机器人', text: '已收到本次查询，正在通过图片回复。' },
      { title: '命运 2 数据库', text: index ? `本地数据库可用\n同步于 ${dateTime(index.syncedAt)}` : '未同步，请在笔记本运行 05-sync-destiny.cmd。' },
      { title: '6657 实时采集', text: snapshot.state },
    ] };
  }
  if (command.type === 'meme') {
    if (command.mode === 'live') return liveCard(live.snapshot(), config.douyu);
    const result = await memes.query(command.mode, command.keyword, command.page);
    const titles = { hot: '6657 · 24 小时热门', week: '6657 · 近 7 天热门', random: '6657 · 随机一条', search: `6657 · ${command.keyword}` };
    return { title: titles[command.mode], label: '6657 MEMES', at: result.fetchedAt, source: 'sb6657.cn · 玩机器烂梗库',
      subtitle: command.mode === 'random' ? '来自烂梗库的一次随机抽取' : `第 ${command.page} 页 · 数据缓存最多 60 秒`,
      rows: result.rows.length ? result.rows.map((x, i) => ({ rank: command.mode === 'random' ? undefined : (command.page - 1) * 8 + i + 1, text: x.text,
        meta: `网站复制次数 ${x.copies}  ·  编号 ${x.id}` })) : [{ text: '没有找到结果，试试其他关键词或上一页。' }],
      notice: '此处为网站烂梗数据。直播间当前热榜请发送「6657 实时」。' };
  }
  if (command.type === 'player') {
    const { player, characters, at } = await destiny.player(command.keyword);
    return { title: command.keyword, label: 'DESTINY 2', at, source: 'Bungie 官方 API · 公开角色资料',
      subtitle: `平台：${({ 1: 'Xbox', 2: 'PlayStation', 3: 'Steam', 6: 'Epic' })[player.membershipType] || player.membershipType}`,
      rows: characters.map(c => ({ title: ({ 0: '泰坦', 1: '猎人', 2: '术士' })[c.classType] || '角色', text: `光等 ${c.light ?? '未知'}\n累计游玩 ${Math.floor(Number(c.minutesPlayedTotal || 0) / 60)} 小时`,
        meta: c.dateLastPlayed ? `最后游玩 ${dateTime(new Date(c.dateLastPlayed))}` : '' })), notice: '只展示公开资料；此版本尚未接入私人账号授权。' };
  }
  const { rows, total, index } = await destiny.search(command.type, command.keyword, command.page);
  const kind = command.type === 'weapon' ? '武器' : 'Perk / 插槽';
  return { title: `${kind} · ${command.keyword}`, label: 'DESTINY 2', at: index.syncedAt,
    subtitle: `找到 ${total} 条 · 第 ${command.page} 页 · 每页最多 6 条`, source: 'Bungie 官方 Manifest · 本地同步数据库',
    rows: rows.length ? rows.map(x => ({ title: x.name, text: x.description || '官方数据库暂无文字描述。',
      meta: [x.type, x.tier, x.damage, `编号 ${x.hash}`, ...(x.stats || [])
        .filter(s => index.statNames[s.hash] && !/^\d+$/.test(index.statNames[s.hash]))
        .slice(0, 8).map(s => `${index.statNames[s.hash]} ${s.value}`)].filter(Boolean).join('  ·  ') })) : [{ text: '没有找到结果。请用游戏内正式名称、较短关键词，或尝试其他页码。' }],
    notice: '时间为数据库同步时间。版本更新后请重新同步。此处为官方基础描述，不包含社区测试的隐藏数值。' };
}
