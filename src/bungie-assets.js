import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile, rename, unlink } from 'node:fs/promises';
import path from 'node:path';
import { DATA } from './config.js';

const MAX_BYTES = 6_000_000;
export function bungieImageUrl(value) {
  if (typeof value !== 'string' || !value || /[\\\s]/.test(value)) return null;
  let url;
  try { url = new URL(value, 'https://www.bungie.net'); } catch { return null; }
  if (url.origin !== 'https://www.bungie.net' || url.username || url.password || url.search || url.hash
    || !/^\/(?:common\/destiny2_content|img\/destiny_content)\/[a-zA-Z0-9_./-]+\.(?:png|jpg|jpeg|webp)$/i.test(url.pathname)) return null;
  return url.href;
}
export function imageMime(bytes) {
  if (bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]))) return 'image/png';
  if (bytes.length >= 3 && bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) return 'image/jpeg';
  if (bytes.length >= 12 && bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP') return 'image/webp';
  return null;
}

export class BungieAssets {
  constructor({ directory = path.join(DATA, 'assets'), request = fetch } = {}) {
    this.directory = directory; this.request = request; this.pending = new Map(); this.failed = new Map();
  }
  async get(value) {
    const url = bungieImageUrl(value); if (!url) return null;
    if ((this.failed.get(url) || 0) > Date.now()) return null;
    if (this.pending.has(url)) return this.pending.get(url);
    const work = this.load(url).catch(() => { this.failed.set(url, Date.now() + 60000); return null; }).finally(() => this.pending.delete(url));
    this.pending.set(url, work); return work;
  }
  async load(url) {
    const file = path.join(this.directory, createHash('sha256').update(url).digest('hex') + '.img');
    let bytes;
    try { const saved = await readFile(file); if (saved.length <= MAX_BYTES && imageMime(saved)) bytes = saved; } catch {}
    if (!bytes) {
      const response = await this.request(url, { redirect: 'error', signal: AbortSignal.timeout(5000) });
      if (!response.ok || Number(response.headers.get('content-length')) > MAX_BYTES) { await response.body?.cancel(); throw new Error('Image unavailable'); }
      const chunks = []; let length = 0;
      for await (const chunk of response.body) { length += chunk.length; if (length > MAX_BYTES) throw new Error('Image too large'); chunks.push(chunk); }
      bytes = Buffer.concat(chunks); if (!imageMime(bytes)) throw new Error('Invalid image');
      await mkdir(this.directory, { recursive: true });
      const temporary = file + '.' + randomUUID() + '.tmp';
      try { await writeFile(temporary, bytes); await rename(temporary, file); }
      finally { await unlink(temporary).catch(() => {}); }
    }
    return `data:${imageMime(bytes)};base64,${bytes.toString('base64')}`;
  }
  async prepare(paths, { budgetMs = 25000 } = {}) {
    const unique = [...new Set(paths.filter(Boolean))]; const images = new Map(); let next = 0;
    const deadline = Date.now() + budgetMs;
    await Promise.all(Array.from({ length: Math.min(8, unique.length) }, async () => {
      while (next < unique.length && Date.now() < deadline) {
        const value = unique[next++]; images.set(value, await this.get(value));
      }
    }));
    return images;
  }
}
