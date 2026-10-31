import { UserError } from './http.js';

const STREAM_URL = 'https://api.hguofichp.cn/machine/hotwall/stream';
const MAX_BYTES = 512 * 1024;

function parseSnapshot(frame) {
  let event = '';
  const data = [];
  for (const line of frame.split(/\r\n|\r|\n/)) {
    if (line.startsWith('event:')) event = line.slice(6).trim();
    if (line.startsWith('data:')) data.push(line.slice(5).replace(/^ /, ''));
  }
  if (event !== 'snapshot') return null;
  const snapshot = JSON.parse(data.join('\n'));
  if (!Array.isArray(snapshot?.items)) throw new UserError('热度墙快照格式异常。');
  return snapshot.items.map((item, index) => {
    if (typeof item?.barrage !== 'string' || !Number.isSafeInteger(item.count) || item.count < 0) {
      throw new UserError('热度墙返回了格式异常的排名条目。');
    }
    return { rank: index + 1, text: item.barrage, meta: `站内热度 ${item.count}` };
  });
}

export async function fetchHeatwallSection(streamRequest = fetch, { timeoutMs = 18000 } = {}) {
  const controller = new AbortController();
  let reader;
  const timer = setTimeout(() => {
    controller.abort();
    reader?.cancel().catch(() => {});
  }, timeoutMs);
  try {
    const response = await streamRequest(STREAM_URL, {
      headers: { Accept: 'text/event-stream' }, credentials: 'omit', redirect: 'error', signal: controller.signal,
    });
    if (!response.ok) throw new UserError(`热度墙返回 HTTP ${response.status}，本次无法取得排行。`);
    if (!response.body || !/^text\/event-stream\b/i.test(response.headers.get('content-type') || '')) {
      throw new UserError('热度墙未返回实时快照流。');
    }
    reader = response.body.getReader();
    controller.signal.throwIfAborted();
    const decoder = new TextDecoder();
    let bytes = 0;
    let pending = '';
    while (true) {
      const { value, done } = await reader.read();
      if (done) throw new UserError('热度墙连接已结束，尚未取得排行快照。');
      bytes += value.byteLength;
      if (bytes > MAX_BYTES) throw new UserError('热度墙数据超过本次读取上限。');
      const frames = (pending + decoder.decode(value, { stream: true })).split(/\r?\n\r?\n|\r\r/);
      pending = frames.pop();
      for (const frame of frames) {
        const rows = parseSnapshot(frame);
        if (rows === null) continue;
        return {
          title: '站点热度墙 · 近 5 分钟', subtitle: `烂梗库站内互动排行 · ${rows.length} 条`,
          rows: rows.length ? rows : [{ text: '最近 5 分钟暂无上榜条目。' }],
        };
      }
    }
  } catch (error) {
    if (controller.signal.aborted) throw new UserError('热度墙快照读取超时。');
    if (error instanceof UserError) throw error;
    throw new UserError('热度墙快照暂时无法读取。');
  } finally {
    clearTimeout(timer);
    controller.abort();
    if (reader) {
      reader.cancel().catch(() => {});
      reader.releaseLock();
    }
  }
}
