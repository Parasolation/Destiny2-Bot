import { createRequire } from 'node:module';

export function parseRoomIdHtml(html) {
  // The current room page embeds Next.js flight data as JSON-escaped strings.
  // Decode quote escaping only; never evaluate any site scripts.
  const decoded = html.replace(/\\+"/g, '"');
  const match = decoded.match(/"roomInfo"\s*:\s*\{\s*"room"\s*:\s*\{\s*"room_id"\s*:\s*"?(\d+)/)
    || decoded.match(/\$ROOM\.room_id\s*=\s*["']?(\d+)/);
  if (!match) throw new Error('房间页面未提供真实房间号。');
  return match[1];
}

export async function resolveRoomId(displayRoom) {
  if (!/^\d+$/.test(String(displayRoom))) throw new Error('无效的斗鱼房间号。');
  const response = await fetch(`https://www.douyu.com/${displayRoom}`, { signal: AbortSignal.timeout(15000), redirect: 'error' });
  if (!response.ok) { await response.body?.cancel(); throw new Error('无法读取斗鱼房间页面。'); }
  const chunks = []; let length = 0;
  for await (const chunk of response.body) {
    length += chunk.length;
    if (length > 4_000_000) throw new Error('斗鱼房间页面过大。');
    chunks.push(chunk);
  }
  return parseRoomIdHtml(Buffer.concat(chunks).toString('utf8'));
}

export function normalizeDanmaku(value) {
  return String(value ?? '').normalize('NFKC').replace(/[\u200B-\u200D\uFEFF]/g, '').replace(/\s+/g, ' ').trim().toLowerCase();
}

export class LiveStats {
  constructor({ windowMinutes = 5, topN = 8, blockedWords = [], maxMessages = 120000, clock = Date.now } = {}) {
    Object.assign(this, { windowMinutes, topN, maxMessages, clock });
    this.blockedWords = blockedWords.map(normalizeDanmaku).filter(Boolean);
    this.messages = []; this.ids = new Map(); this.connected = false; this.connectedSince = 0;
    this.state = '正在连接'; this.trimmedAt = 0; this.lastMessageAt = 0;
  }
  setConnected() {
    this.connected = true; this.connectedSince = this.clock(); this.state = '采集中';
    // A fresh connection starts a new continuous observation period.
    this.messages = []; this.ids.clear(); this.trimmedAt = 0; this.lastMessageAt = 0;
  }
  setDisconnected(state = '连接中断，等待重连') { this.connected = false; this.state = state; }
  prune(now) {
    const cutoff = now - this.windowMinutes * 60000;
    let n = 0;
    while (n < this.messages.length && this.messages[n].time <= cutoff) n++;
    if (n) this.messages.splice(0, n);
    for (const [id, time] of this.ids) { if (time <= cutoff) this.ids.delete(id); else break; }
  }
  ingest(msg) {
    if (!this.connected) return;
    const now = this.clock();
    this.prune(now);
    const text = String(msg.txt ?? '').trim();
    const normalized = normalizeDanmaku(text);
    if (!normalized || text.length > 500 || this.blockedWords.some(w => normalized.includes(w))) return;
    const id = msg.cid ? String(msg.cid) : null;
    if (id && this.ids.has(id)) return;
    if (id) this.ids.set(id, now);
    this.messages.push({ text, normalized, uid: msg.uid ? String(msg.uid) : null, time: now });
    this.lastMessageAt = now;
    if (this.messages.length > this.maxMessages) {
      const removed = this.messages.splice(0, this.messages.length - this.maxMessages);
      this.trimmedAt = removed.at(-1).time + 1;
    }
    while (this.ids.size > this.maxMessages) this.ids.delete(this.ids.keys().next().value);
  }
  snapshot() {
    const now = this.clock(); this.prune(now);
    const start = Math.max(now - this.windowMinutes * 60000, this.connectedSince, this.trimmedAt);
    if (!this.connected) return { connected: false, state: this.state, rows: [], count: 0, at: now, start: now, complete: false };
    const byText = new Map(); const allUsers = new Set();
    for (const m of this.messages) {
      if (m.time < start) continue;
      let item = byText.get(m.normalized);
      if (!item) { item = { text: m.text, count: 0, users: new Set() }; byText.set(m.normalized, item); }
      item.count++;
      if (m.uid) { item.users.add(m.uid); allUsers.add(m.uid); }
    }
    const rows = [...byText.values()].map(x => ({ text: x.text, count: x.count, users: x.users.size }))
      .sort((a, b) => b.users - a.users || b.count - a.count || a.text.localeCompare(b.text)).slice(0, this.topN);
    return { connected: true, state: this.state, rows, count: [...byText.values()].reduce((n, x) => n + x.count, 0),
      users: allUsers.size, at: now, start, complete: now - start >= this.windowMinutes * 60000,
      capped: this.trimmedAt > now - this.windowMinutes * 60000, lastMessageAt: this.lastMessageAt };
  }
}

export async function startCollector(config, stats, logger = console) {
  if (!config.enabled) { stats.setDisconnected('实时采集已关闭'); return () => {}; }
  // 3.2.0's ESM build still calls require('ws'); select its actual CommonJS export.
  const { Client } = createRequire(import.meta.url)('douyudm');
  let current, timer, watchdog, stopped = false, failures = 0, roomId, resolvedAt = 0;
  const connect = async () => {
    if (stopped) return;
    try {
      if (!roomId || Date.now() - resolvedAt > 1800000) { roomId = await resolveRoomId(config.roomId); resolvedAt = Date.now(); }
    } catch {
      if (!stopped) {
        stats.setDisconnected('暂时无法解析直播间，60 秒后重试');
        logger.warn('斗鱼房间解析失败，60 秒后重试。');
        timer = setTimeout(connect, 60000);
      }
      return;
    }
    if (stopped) return;
    const client = new Client(roomId, { retries: 6, retryDelay: 1500,
      ignore: ['uenter', 'rss', 'spbc', 'gdp', 'onlinegift'] });
    current = client;
    let retryScheduled = false;
    const retry = () => {
      if (stopped || retryScheduled || current !== client) return;
      retryScheduled = true;
      clearTimeout(watchdog);
      stats.setDisconnected();
      client.close();
      const delay = Math.min(60000, 2000 * 2 ** Math.min(failures++, 5));
      logger.warn(`斗鱼连接中断，${delay / 1000} 秒后重连。`);
      timer = setTimeout(connect, delay);
    };
    client.on('connect', () => {
      if (stopped || retryScheduled) return;
      stats.setDisconnected('已连接，等待斗鱼确认登录');
      clearTimeout(watchdog); watchdog = setTimeout(retry, 15000);
    });
    const received = () => { if (stopped || retryScheduled) return; clearTimeout(watchdog); watchdog = setTimeout(retry, 90000); };
    client.on('loginres', () => {
      if (stopped || retryScheduled) return;
      failures = 0; stats.setConnected(); received(); logger.info(`斗鱼弹幕登录成功（${config.roomId} → ${roomId}），开始统计。`);
    });
    client.on('mrkl', received);
    client.on('chatmsg', msg => { if (!stopped && !retryScheduled) { received(); stats.ingest(msg); } });
    client.on('disconnect', retry);
    client.on('error', retry);
    watchdog = setTimeout(retry, 45000);
    try { client.run(); } catch { retry(); }
  };
  connect();
  return () => { stopped = true; clearTimeout(timer); clearTimeout(watchdog); current?.close(); stats.setDisconnected('采集已停止'); };
}
