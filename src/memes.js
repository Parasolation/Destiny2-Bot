import { CachedRequests, jsonRequest, UserError } from './http.js';

export const MEME_PAGE_SIZE = 20;
export const RANDOM_COUNT = 5;

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
  constructor({ request = jsonRequest } = {}) { this.request = request; this.cache = new CachedRequests(); }
  async query(mode, keyword = '', page = 1) {
    const paths = { hot: '/machine/hotBarrageOf24H', week: '/machine/hotBarrageOf7Day', random: '/machine/getRandOne', search: '/machine/pageSearch' };
    if (!paths[mode]) throw new UserError('未知的 6657 查询。');
    const run = async () => {
      const options = mode === 'search' ? {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ barrage: keyword, pageNum: page, pageSize: MEME_PAGE_SIZE, sort: 0 }),
      } : {};
      // Do not impersonate the website with its dpahjdoiaw attribution header.
      const payload = await this.request(`https://api.hguofichp.cn${paths[mode]}`, options);
      const rows = parseMemes(payload);
      return { rows: mode === 'hot' || mode === 'week' ? rows.slice((page - 1) * MEME_PAGE_SIZE, page * MEME_PAGE_SIZE) : rows.slice(0, MEME_PAGE_SIZE),
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
