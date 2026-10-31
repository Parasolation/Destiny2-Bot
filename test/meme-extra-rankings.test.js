import assert from 'node:assert/strict';
import test from 'node:test';
import { fetchExtraRanking } from '../src/meme-extra-rankings.js';

test('stale rankings show the requested score and retain reported totals', async () => {
  const request = async url => {
    assert.match(url, /\/stale\/(?:hot|rank)\?pageNum=1&pageSize=20$/);
    return { code: 200, data: { total: 37, list: Array.from({ length: 21 }, (_, i) => ({
      barrage: `弹幕${i + 1}`, hotScore: 6.25, staleScore: 12.5, voteCnt: 0,
    })) } };
  };
  const hot = await fetchExtraRanking('staleHot', request);
  const all = await fetchExtraRanking('stale', request);
  assert.equal(hot.rows.length, 20);
  assert.equal(hot.rows.at(-1).rank, 20);
  assert.match(all.subtitle, /37/);
  assert.match(hot.rows[0].meta, /实时热度 6\.25/);
  assert.match(all.rows[0].meta, /烂度评分 12\.5/);
  assert.match(all.rows[0].meta, /投票数 0/);
});

test('arena uses the weekly ranked results and keeps a legitimate empty list', async () => {
  const section = await fetchExtraRanking('arena', async () => ({
    code: 200, data: { weekStart: '2026-10-26', weekEnd: '2026-11-01', matches: [{ barrageA: '今日对决' }],
      weekRank: [{ barrageText: '本周上榜', totalVotes: 8 }] },
  }));
  assert.equal(section.rows[0].text, '本周上榜');
  assert.match(section.rows[0].meta, /8/);
  assert.match(section.subtitle, /2026-10-26/);
  const empty = await fetchExtraRanking('arena', async () => ({ code: 200, data: { weekRank: [] } }));
  assert.deepEqual(empty.rows, []);
  await assert.rejects(fetchExtraRanking('arena', async () => ({ code: 200, data: {} })));
});

test('annual nominations never replace published rankings; archive is dated and uses official ranks', async () => {
  const section = await fetchExtraRanking('annual', async url => {
    if (url.includes('/loadTop20')) return { code: 200, data: { list: [{ barrage: '提名' }] } };
    assert.match(url, /memeTop20_2025\.json$/);
    return [{ rank: 2, content: '年度获奖', award: '奖项' }];
  });
  assert.match(section.subtitle, /2025 年已发布存档/);
  assert.deepEqual(section.rows, [{ rank: 2, text: '年度获奖', meta: '奖项' }]);
  const final = await fetchExtraRanking('annual', async () => ({ code: 200, data: { Top20List: [{ barrage: '已公布' }] } }));
  assert.equal(final.rows[0].text, '已公布');
  await assert.rejects(fetchExtraRanking('annual', async () => { throw new Error('offline'); }));
});
