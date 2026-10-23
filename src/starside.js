import { readFile, writeFile, mkdir, rename } from 'node:fs/promises';
import path from 'node:path';
import { DATA } from './config.js';

export const STARSIDE_URL = 'https://starside.work/weapons/index.html';
const DAY = 86400000;
const AUTHORS = { Aegis: 'Aegis', LGpig: '小棒猪' };

// The public page ships JSON assignments, not an API. Never execute its scripts.
export function parseStarsideAssignment(text, name) {
  const prefix = `window.${name} = `;
  const value = text.trim();
  if (!value.startsWith(prefix)) throw new Error('Starside data format changed');
  return JSON.parse(value.slice(prefix.length).replace(/;\s*$/, ''));
}

export function buildRecommendations(index, pool, descriptions, fetchedAt = Date.now()) {
  if (!Array.isArray(index.w) || !index.w.length || index.w.length !== pool.w?.length
      || !Array.isArray(pool.p) || !Array.isArray(pool.L) || !descriptions.au) throw new Error('Starside tables do not match');
  const weapons = {};
  for (let i = 0; i < index.w.length; i++) {
    const row = index.w[i], details = pool.w[i];
    if (!/^\d+$/.test(String(row[0])) || !Array.isArray(details?.[3]) || !Array.isArray(details[2])) throw new Error('Invalid weapon row');
    const marks = new Map();
    for (const [plugIndex, bits] of details[3]) {
      if (!pool.p[plugIndex] || ![1, 2, 3].includes(bits)) throw new Error('Invalid recommendation');
      marks.set(plugIndex, bits);
    }
    const perks = {};
    for (const column of details[2]) {
      const cells = pool.L[column[2]];
      if (!Array.isArray(cells)) throw new Error('Invalid perk column');
      for (const cell of cells) {
        const bits = marks.get(cell[0]);
        if (!bits) continue;
        for (const p of [cell[0], cell[1]].filter(p => p >= 0)) {
          const hash = pool.p[p]?.[0];
          if (!/^\d+$/.test(String(hash))) throw new Error('Invalid perk hash');
          perks[hash] = bits;
        }
      }
    }
    // Match weapon hashes exactly. Ratings follow the same representative as the
    // website; perk recommendations always use this particular release's pool.
    const ratings = (descriptions.au[row[15]] || []).filter(b => AUTHORS[b[0]]).flatMap(b =>
      (b[1] || []).map(([context, grade]) => ({ author: AUTHORS[b[0]], context: String(context || '').slice(0, 60), grade: String(grade).slice(0, 60) })));
    const masterworks = (details[5] || []).filter(name => (pool.M[details[6]] || []).some(option => option[0] === name));
    weapons[row[0]] = { perks, ratings, masterworks, sharedRating: row[15] !== i };
  }
  return { version: 1, fetchedAt, weapons };
}

async function download(name) {
  const response = await fetch(`https://starside.work/weapons/${name}.js`, { redirect: 'error', signal: AbortSignal.timeout(6000) });
  if (!response.ok) { await response.body?.cancel(); throw new Error('Starside unavailable'); }
  const chunks = []; let size = 0;
  for await (const chunk of response.body) {
    size += chunk.length;
    if (size > 3_000_000) throw new Error('Starside data too large');
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString('utf8');
}

export class StarsideRecommendations {
  constructor({ directory = DATA, request = download, clock = Date.now } = {}) {
    this.file = path.join(directory, 'starside-recommendations.json');
    this.request = request; this.clock = clock; this.cache = null; this.loaded = false; this.retryAt = 0; this.pending = null;
  }
  async load() {
    if (!this.pending) this.pending = this.refresh().finally(() => { this.pending = null; });
    return this.pending;
  }
  async refresh() {
    if (!this.loaded) {
      this.loaded = true;
      try {
        const saved = JSON.parse(await readFile(this.file, 'utf8'));
        if (saved.version === 1 && Number.isFinite(saved.fetchedAt) && saved.weapons && Object.keys(saved.weapons).length) this.cache = saved;
      } catch {}
    }
    const now = this.clock();
    if (this.cache && now - this.cache.fetchedAt < DAY) return this.cache;
    if (now < this.retryAt) return this.usableCache();
    try {
      const [index, pool, descriptions] = await Promise.all(['index', 'pool', 'text'].map(name => this.request(name)));
      const value = buildRecommendations(parseStarsideAssignment(index, 'WPN'), parseStarsideAssignment(pool, 'WPN_POOL'), parseStarsideAssignment(descriptions, 'WPN_TEXT'), now);
      this.cache = value;
      // A read-only disk must not turn a successful recommendation into a failed query.
      try {
        await mkdir(path.dirname(this.file), { recursive: true });
        await writeFile(this.file + '.tmp', JSON.stringify(value), 'utf8');
        await rename(this.file + '.tmp', this.file);
      } catch {}
      return value;
    } catch {
      this.retryAt = now + 5 * 60000;
      return this.usableCache();
    }
  }
  usableCache() { return this.cache && this.clock() - this.cache.fetchedAt < 7 * DAY ? this.cache : null; }
  async annotate(weapons) {
    if (!weapons.length) return weapons;
    const data = await this.load();
    return weapons.map(weapon => ({ ...weapon, recommendations: {
      ...(data?.weapons[weapon.hash] || {}), status: !data ? 'unavailable' : data.weapons[weapon.hash] ? 'ready' : 'missing',
      fetchedAt: data?.fetchedAt, stale: Boolean(data && this.clock() - data.fetchedAt >= DAY),
      url: `${STARSIDE_URL}?w=${encodeURIComponent(weapon.hash)}`,
    } }));
  }
}
