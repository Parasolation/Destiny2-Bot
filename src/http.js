export class UserError extends Error {}

export async function jsonRequest(url, { timeout = 15000, maxBytes = 8_000_000, ...options } = {}) {
  let response;
  try {
    response = await fetch(url, { ...options, redirect: 'error', signal: AbortSignal.timeout(timeout) });
  } catch { throw new UserError('数据源暂时无法连接，请稍后重试。'); }
  if (!response.ok) {
    await response.body?.cancel();
    throw new UserError(`数据源返回 HTTP ${response.status}，请稍后重试。`);
  }
  const chunks = [];
  let size = 0;
  try {
    for await (const chunk of response.body) {
      size += chunk.length;
      if (size > maxBytes) throw new Error('size');
      chunks.push(chunk);
    }
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch { throw new UserError('数据源返回内容不完整或格式异常，请稍后重试。'); }
}

export class CachedRequests {
  constructor({ maxEntries = 100, clock = Date.now } = {}) {
    this.cache = new Map(); this.pending = new Map(); this.maxEntries = maxEntries; this.clock = clock;
  }
  async get(key, ttl, producer) {
    const found = this.cache.get(key);
    if (found && found.expires > this.clock()) return found.value;
    if (this.pending.has(key)) return this.pending.get(key);
    const request = Promise.resolve().then(producer).then(value => {
      this.cache.delete(key);
      this.cache.set(key, { value, expires: this.clock() + ttl });
      while (this.cache.size > this.maxEntries) this.cache.delete(this.cache.keys().next().value);
      return value;
    }).finally(() => this.pending.delete(key));
    this.pending.set(key, request);
    return request;
  }
}
