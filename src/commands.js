import { UserError } from './http.js';
import { dateTime } from './cards.js';
import { MEME_PAGE_SIZE } from './memes.js';
import { CRAFTING_PAGE_SIZE } from './crafting.js';

export function parseCommand(input) {
  let text = String(input ?? '').replace(/<@!?[^>]+>/g, '').trim().replace(/^[/／]/, '').trim();
  if (text.length > 160) throw new UserError('指令太长，请将关键词控制在 80 字以内。');
  let page = 1;
  const pagination = text.match(/\s+第?(\d+)页$/);
  if (pagination) { page = Number(pagination[1]); text = text.slice(0, pagination.index).trim(); }
  if (page < 1 || page > 50) throw new UserError('页码范围是 1–50。');
  if (/^(帮助|菜单|help)$/i.test(text)) return { type: 'help' };
  if (/^(状态|status)$/i.test(text)) return { type: 'status' };
  if (/^(绑定|我的绑定)$/.test(text)) return { type: 'binding' };
  if (/^(解绑|取消绑定)$/.test(text)) return { type: 'unbind' };
  const bind = text.match(/^绑定\s+(.+)$/);
  if (bind) return { type: 'bind', keyword: bind[1] };
  if (/^(玩家|我的角色)$/.test(text)) return { type: 'player', keyword: '', page };
  const craft = text.match(/^(锻造|图样|可锻造)(?:\s+(.+))?$/);
  if (craft) return { type: 'crafting', filter: craft[1] === '可锻造' ? '可锻造' : craft[2] || '', page };
  const meme = text.match(/^(?:6657\s*)?(热门|周榜|随机|实时|搜索)(?:\s+(.+))?$/);
  if (meme) {
    const mode = ({ 热门: 'hot', 周榜: 'week', 随机: 'random', 实时: 'live', 搜索: 'search' })[meme[1]];
    if (mode === 'search' && !meme[2]) throw new UserError('示例：搜索 关键词');
    if (mode !== 'search' && meme[2]) throw new UserError('这条指令不需要关键词。翻页示例：周榜 第2页');
    return { type: 'meme', mode, keyword: meme[2] || '', page };
  }
  const destiny = text.match(/^(武器|perk|词条|玩家)\s+(.+)$/i);
  if (destiny) return { type: ({ 武器: 'weapon', perk: 'perk', 词条: 'perk', 玩家: 'player' })[destiny[1].toLowerCase()], keyword: destiny[2], page };
  return { type: 'help', unknown: true };
}

export function helpCard() {
  return { title: '守护者的群聊工具箱', label: '使用帮助', subtitle: '在群里 @机器人，然后输入下面的指令', source: '本地帮助 · v0.2', compact: true,
    rows: [
      { title: '先绑定，再查自己的进度', text: '绑定 Bungie名称#1234\n玩家　/　锻造　/　可锻造\n我的绑定　/　解绑', meta: '在当前群内按发送者记住账号，重启后仍保留。' },
      { title: '命运 2 武器与图样', text: '武器 武器名称　/　Perk 词条名称\n锻造 武器名称　/　锻造 进行中\n锻造 未解锁　/　锻造 第2页', meta: '锻造查看红框图样进度；无需再次填写玩家名。' },
      { title: '玩机器烂梗与实时弹幕', text: '热门　/　周榜　/　随机\n搜索 关键词　/　实时', meta: '列表最多 20 条；随机 5 条。来源不足时按实际数量展示。' },
      { title: '翻页与运行状态', text: '周榜 第2页　/　搜索 关键词 第2页\n状态', meta: '全部图片回复；较长内容会分图。' },
    ] };
}

export function liveCard(snapshot, config) {
  if (!snapshot.connected) return { title: '实时弹幕暂不可用', label: '6657 LIVE', source: `斗鱼 ${config.roomId} 房间 · 本机采集`, at: snapshot.at,
    rows: [{ text: snapshot.state }], notice: '连接恢复后会重新开始统计。此时不展示旧排行榜。' };
  return { title: '6657 实时弹幕热榜', label: '6657 LIVE', compact: true, at: snapshot.at, source: `斗鱼 ${config.roomId} 房间 · 本机采集`,
    subtitle: `${dateTime(snapshot.start)} — ${dateTime(snapshot.at)}`,
    stats: [{ label: '采集到的弹幕', value: snapshot.count }, { label: '参与账号', value: snapshot.users }, { label: '目标统计窗口', value: `${config.windowMinutes} 分钟` }],
    rows: snapshot.rows.length ? snapshot.rows.map((x, i) => ({ rank: i + 1, text: x.text, meta: `${x.users} 人参与  ·  ${x.count} 次出现` })) : [{ text: '这段时间还没有收到符合条件的弹幕。' }],
    notice: [!snapshot.complete ? '尚未覆盖完整统计窗口，仅展示上述实际采集时段。' : '', snapshot.capped ? '消息量超过缓存上限，本次为部分样本。' : '',
      '按参与人数、出现次数排序；合并大小写和空白差异，过滤重复消息 ID。不代表平台全量统计。'].filter(Boolean).join('\n') };
}

export function craftingCard(result, command) {
  return { title: '武器图样 · 锻造进度', label: 'DESTINY 2', compact: true, at: result.at,
    subtitle: `${result.player.displayName}\n${command.filter || '全部图样'} · 第 ${command.page} 页 / 共 ${Math.max(1, Math.ceil(result.total / CRAFTING_PAGE_SIZE))} 页 · 本类 ${result.total} 件`,
    source: 'Bungie 官方 API · 公开图样记录',
    stats: [{ label: '图样已解锁', value: result.unlocked }, { label: '尚未解锁', value: result.locked }, { label: '未返回数据', value: result.unknown }],
    rows: result.rows.length ? result.rows.map(r => ({ title: r.name,
      text: !r.known ? '未返回进度' : `${r.unlocked ? '图样已解锁 · 可锻造' : '未解锁'}${r.target != null ? `　${r.progress} / ${r.target}` : ''}` })) : [{ text: '本页没有符合条件的图样，可换筛选条件或查看上一页。' }],
    notice: '默认优先展示正在收集的图样。发送「可锻造」「锻造 未解锁」或「锻造 第2页」切换。\n可锻造表示图样已解锁，实际塑形仍需材料和相应游戏权限。数据缓存最多 60 秒。' };
}

export async function queryCard(command, { memes, destiny, live, config, bindings }, { userKey } = {}) {
  if (command.type === 'help') return { ...helpCard(), notice: command.unknown ? '未识别这条指令，请参考以下用法。' : undefined };
  const getBinding = async () => {
    if (!bindings) throw new UserError('请在 QQ 群里 @机器人使用绑定和个人查询。');
    const binding = await bindings.get(userKey);
    if (!binding) throw new UserError('你在这里还没有绑定账号。请先发送「绑定 Bungie名称#1234」，之后直接发送「玩家」或「锻造」。');
    return binding;
  };
  if (command.type === 'bind') {
    if (!bindings) throw new UserError('请在 QQ 群里 @机器人发送「绑定 Bungie名称#1234」。');
    bindings.requireKey(userKey);
    const player = await destiny.resolvePlayer(command.keyword);
    await bindings.set(userKey, player);
    return { title: '绑定成功', label: 'DESTINY 2', source: '本地账号绑定', rows: [{ title: player.displayName,
      text: '以后直接发送「玩家」「锻造」「可锻造」即可。', meta: '当前群内为你保存的查询账号，重启后仍保留。' }], notice: '发送「我的绑定」查看，发送「解绑」移除。' };
  }
  if (command.type === 'binding') {
    const binding = await getBinding();
    return { title: '我的绑定', label: 'DESTINY 2', source: '本地账号绑定', rows: [{ title: binding.displayName, text: '玩家　/　锻造　/　可锻造\n重新发送「绑定 名称#1234」可更换账号。' }] };
  }
  if (command.type === 'unbind') {
    if (!bindings) throw new UserError('请在 QQ 群里 @机器人使用解绑。');
    await bindings.set(userKey, null);
    return { title: '已解除绑定', label: 'DESTINY 2', source: '本地账号绑定', rows: [{ text: '已清除你在这里保存的查询账号。其他群成员的绑定不受影响。' }] };
  }
  if (command.type === 'crafting') return craftingCard(await destiny.crafting(await getBinding(), command.filter, command.page), command);
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
    const titles = { hot: '6657 · 24 小时热门', week: '6657 · 近 7 天热门', random: '6657 · 随机烂梗', search: `6657 · ${command.keyword}` };
    return { title: titles[command.mode], label: '6657 MEMES', compact: true, at: result.fetchedAt, source: 'sb6657.cn · 玩机器烂梗库',
      subtitle: command.mode === 'random' ? `本次随机 ${result.rows.length} 条` : `第 ${command.page} 页 · 本次 ${result.rows.length} 条 / 共 ${result.total} 条 · 缓存最多 60 秒`,
      rows: result.rows.length ? result.rows.map((x, i) => ({ rank: command.mode === 'random' ? i + 1 : (command.page - 1) * MEME_PAGE_SIZE + i + 1, text: x.text,
        meta: `网站复制次数 ${x.copies}  ·  编号 ${x.id}` })) : [{ text: '没有找到结果，试试其他关键词或上一页。' }],
      notice: '此处为网站烂梗数据。直播间当前热榜请发送「实时」。列表翻页示例：「周榜 第2页」。' };
  }
  if (command.type === 'player') {
    const { player, characters, at } = await destiny.player(command.keyword || await getBinding());
    return { title: player.displayName || command.keyword, label: 'DESTINY 2', at, source: 'Bungie 官方 API · 公开角色资料',
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
