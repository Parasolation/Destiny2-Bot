import { CachedRequests, jsonRequest, UserError } from './http.js';
import { fetchExtraRanking } from './meme-extra-rankings.js';

export const MEME_PAGE_SIZE = 20;
export const RANDOM_COUNT = 5;
const RANKING_PATHS = new Map([
  ['hot', '/machine/hotBarrageOf24H'],
  ['week', '/machine/hotBarrageOf7Day'],
]);

export function parseMemes(payload) {
  if (payload.code !== 200) throw new UserError('6657 烂梗库暂时不可用，或接口需要登录。请稍后重试。');
  const data = payload.data;
  const rows = Array.isArray(data) ? data : Array.isArray(data?.list) ? data.list : data?.barrage ? [data] : [];
  if (!data || (!Array.isArray(data) && !Array.isArray(data.list) && !data.barrage)) throw new UserError('6657 接口格式发生变化，需要更新适配。');
  return rows.filter(x => typeof x.barrage === 'string').map(x => ({
    id: String(x.barrageId ?? x.id ?? ''), text: x.barrage,
    copies: Number(x.cnt) || 0,
  }));
}

export class MemeService {
  constructor({ request = jsonRequest, streamRequest = fetch } = {}) {
    this.request = request;
    this.streamRequest = streamRequest;
    this.cache = new CachedRequests();
  }
  async extraRanking(mode) {
    const ttl = mode === 'annual' ? 24 * 60 * 60 * 1000 : 60000;
    return this.cache.get(`extra:${mode}`, ttl, () => fetchExtraRanking(mode, this.request, this.streamRequest));
  }
  async ranking(mode) {
    const path = RANKING_PATHS.get(mode);
    if (!path) throw new UserError('未知的弹幕排行榜。');
    // Both endpoints return the complete ranking. Share it across individual pages and all.
    return this.cache.get(`ranking:${mode}`, 60000, async () => {
      const payload = await this.request(`https://api.hguofichp.cn${path}`, {});
      const rows = parseMemes(payload);
      return { rows, fetchedAt: Date.now(), total: payload.data?.total ?? rows.length };
    });
  }
  async query(mode, keyword = '', page = 1) {
    if (RANKING_PATHS.has(mode)) {
      const result = await this.ranking(mode);
      return { ...result, rows: result.rows.slice((page - 1) * MEME_PAGE_SIZE, page * MEME_PAGE_SIZE) };
    }
    const paths = { random: '/machine/getRandOne', search: '/machine/pageSearch' };
    if (!paths[mode]) throw new UserError('未知的 6657 查询。');
    const run = async () => {
      const options = mode === 'search' ? {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ barrage: keyword, pageNum: page, pageSize: MEME_PAGE_SIZE, sort: 0 }),
      } : {};
      // Do not impersonate the website with its dpahjdoiaw attribution header.
      const payload = await this.request(`https://api.hguofichp.cn${paths[mode]}`, options);
      const rows = parseMemes(payload);
      return { rows: rows.slice(0, MEME_PAGE_SIZE),
        fetchedAt: Date.now(), total: payload.data?.total ?? rows.length };
    };
    if (mode !== 'random') return this.cache.get(`${mode}:${keyword}:${page}`, 60000, run);
    const unique = new Map();
    // Bound requests when the source repeats results; never invent extra rows.
    for (let attempt = 0; attempt < RANDOM_COUNT + 3 && unique.size < RANDOM_COUNT; attempt++) {
      const result = await run();
      for (const row of result.rows) unique.set(row.text, row);
    }
    return { rows: [...unique.values()].slice(0, RANDOM_COUNT), fetchedAt: Date.now(), total: unique.size };
  }
}
