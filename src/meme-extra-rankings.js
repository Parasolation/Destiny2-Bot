import { jsonRequest, UserError } from './http.js';
import { fetchHeatwallSection } from './meme-hotwall.js';

const API = 'https://api.hguofichp.cn/machine';
const ARCHIVE_YEAR = 2025;
const ARCHIVE_URL = `https://sb6657oss.wishao.fun/memeTop20_${ARCHIVE_YEAR}.json`;
const STALE_LIMIT = 20;

export const EXTRA_RANKINGS = [
  { mode: 'stale', title: '烂度总榜' },
  { mode: 'staleHot', title: '烂度实时热榜' },
  { mode: 'arena', title: '烂梗擂台 · 本周得票榜' },
  { mode: 'hotwall', title: '站点热度墙 · 近 5 分钟' },
  { mode: 'annual', title: '年度 TOP20' },
];

function list(value) {
  if (!Array.isArray(value)) throw new UserError('榜单接口未返回可识别的列表。');
  return value;
}

function entry(text, rank, meta) {
  if (typeof text !== 'string' || !text.trim()) throw new UserError('榜单接口缺少弹幕内容。');
  return { rank, text, meta };
}

function metric(label, value) {
  return Number.isFinite(value)
    ? `${label} ${value.toLocaleString('zh-CN', { maximumFractionDigits: 2 })}`
    : null;
}

async function apiData(request, path) {
  const response = await request(API + path, { timeout: 8000, maxBytes: 2_000_000 });
  if (response?.code !== 200) throw new UserError('网站未能提供这一榜单。');
  return response.data;
}

async function staleSection(mode, title, request) {
  const isHot = mode === 'staleHot';
  const path = isHot ? '/stale/hot' : '/stale/rank';
  const data = await apiData(request, `${path}?pageNum=1&pageSize=${STALE_LIMIT}`);
  const rows = list(data?.list).slice(0, STALE_LIMIT).map((item, index) => {
    const metrics = [
      isHot ? metric('实时热度', item.hotScore) : metric('烂度评分', item.staleScore),
      metric('投票数', item.voteCnt),
    ];
    return entry(item.barrage, index + 1, metrics.filter(Boolean).join(' · '));
  });
  const total = Number.isInteger(data.total) && data.total >= rows.length ? ` · 共 ${data.total} 条` : '';
  return { title, subtitle: `显示前 ${STALE_LIMIT} 名 · 本次 ${rows.length} 条${total}`, rows };
}

async function arenaSection(title, request) {
  const data = await apiData(request, '/arena/current');
  const rows = list(data?.weekRank).map((item, index) =>
    entry(item.barrage || item.barrageText, index + 1, metric('总得票', item.totalVotes)));
  const dates = data.weekStart && data.weekEnd ? `${data.weekStart} 至 ${data.weekEnd} · ` : '';
  return { title, subtitle: `${dates}按本周对决得票排序 · ${rows.length} 条`, rows };
}

async function annualSection(title, request) {
  try {
    const data = await apiData(request, '/hotTop20/loadTop20?pageNum=1&pageSize=20');
    // Other phases return a nomination list. Only Top20List represents final results.
    const final = list(data?.Top20List);
    if (!final.length) throw new UserError('年度评选暂未公布最终榜单。');
    const rows = final.map((item, index) => entry(item.barrage, index + 1, item.awards || ''));
    return { title, subtitle: `官网年度评选已公布结果 · ${rows.length} 条`, rows };
  } catch {
    const archive = list(await request(ARCHIVE_URL, { timeout: 6500, maxBytes: 1_000_000 }));
    if (!archive.length) throw new UserError('年度存档暂不可用。');
    const rows = archive.map(item => {
      if (!Number.isInteger(item.rank) || item.rank < 1) throw new UserError('年度存档缺少名次。');
      return entry(item.content, item.rank, item.award || '');
    });
    return { title, subtitle: `${ARCHIVE_YEAR} 年已发布存档 · ${rows.length} 条`, rows };
  }
}

export async function fetchExtraRanking(mode, request = jsonRequest, streamRequest = fetch) {
  const ranking = EXTRA_RANKINGS.find(item => item.mode === mode);
  if (!ranking) throw new UserError('未知的 6657 榜单。');
  switch (mode) {
    case 'stale':
    case 'staleHot': return staleSection(mode, ranking.title, request);
    case 'arena': return arenaSection(ranking.title, request);
    case 'hotwall': return fetchHeatwallSection(streamRequest);
    case 'annual': return annualSection(ranking.title, request);
  }
}
