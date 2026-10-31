import assert from 'node:assert/strict';
import test from 'node:test';
import { CardRenderer, cardHtml } from '../src/cards.js';
import { parseCommand, queryCard } from '../src/commands.js';
import { UserError } from '../src/http.js';
import { MemeService } from '../src/memes.js';

const hotPath = '/machine/hotBarrageOf24H';
const weekPath = '/machine/hotBarrageOf7Day';

function ranking(prefix, length) {
  return Array.from({ length }, (_, index) => ({
    id: index + 1,
    barrage: `${prefix}第${index + 1}名`,
    cnt: length - index,
  }));
}

function fixtures({ hotUnavailable = false, connected = true } = {}) {
  const hot = ranking('日榜', 10);
  const week = ranking('周榜', 50);
  const live = ranking('实时', 20);
  // A single phrase can rank differently on the daily, weekly and live boards.
  hot[0].barrage = week[30].barrage = live[4].barrage = '三个榜都出现 <&>';
  const requests = [];
  const memes = new MemeService({
    streamRequest: async () => { throw new Error('offline fixture'); },
    request: async url => {
      const path = new URL(url).pathname;
      requests.push(path);
      if (path === weekPath) return { code: 200, data: week };
      if (path !== hotPath) throw new Error('test provider offline');
      if (hotUnavailable) throw new Error('test provider offline');
      return { code: 200, data: hot };
    },
  });
  const services = {
    memes,
    config: { douyu: { roomId: '6657', windowMinutes: 5 } },
    live: { snapshot: () => ({
      connected, state: connected ? '采集中' : '连接中断，等待重连',
      start: 0, at: 300000, complete: true, count: 53, users: 40,
      rows: live.map(({ barrage, cnt }) => ({ text: barrage, count: cnt, users: cnt })),
    }) },
  };
  return { hot, week, live, services, requests };
}

test('all is an unpaged meme command including the QQ mention and optional 6657 prefix', () => {
  for (const input of ['all', 'ALL', '6657 all', '<@!123> /6657 AlL']) {
    assert.deepEqual(parseCommand(input), { type: 'meme', mode: 'all', keyword: '', page: 1 });
  }
  assert.throws(() => parseCommand('all 第2页'), UserError);
  assert.throws(() => parseCommand('all 多余参数'), UserError);
});

test('all combines complete ranked lists, sharing the website data with paged commands', async () => {
  const { hot, week, live, services, requests } = fixtures();
  // Warm the weekly cache through the single-board command. Its page must not limit all.
  const page = await queryCard(parseCommand('周榜 第2页'), services);
  assert.deepEqual(page.rows.map(row => row.text), week.slice(20, 40).map(row => row.barrage));
  const all = await queryCard(parseCommand('all'), services);
  assert.equal(all.layout, 'barrage-poster');
  const coreBoards = [all.sections[0], all.sections[1], all.sections.at(-1)];
  const expectedLists = [hot, week, live];
  for (const [i, board] of coreBoards.entries()) {
    assert.deepEqual(board.rows.map(row => [row.rank, row.text]),
      expectedLists[i].map((item, index) => [index + 1, item.barrage]));
  }
  const html = cardHtml(all);
  assert.ok(html.indexOf('日榜第10名') >= 0);
  assert.ok(html.indexOf('周榜第50名') > html.indexOf('日榜第10名'));
  assert.ok(html.indexOf('实时第20名') > html.indexOf('周榜第50名'));
  assert.equal(html.split('三个榜都出现 &lt;&amp;&gt;').length - 1, 3);
  assert.equal(requests.filter(path => path === hotPath).length, 1);
  assert.equal(requests.filter(path => path === weekPath).length, 1);
});

test('a failed website board and disconnected live room leave the other complete ranking available', async () => {
  const { services, week } = fixtures({ hotUnavailable: true, connected: false });
  const { sections } = await queryCard(parseCommand('6657 all'), services);
  const [daily, weekly] = sections;
  const live = sections.at(-1);
  assert.ok(daily.rows.length && daily.rows.every(row => row.rank == null && row.text));
  assert.deepEqual(weekly.rows.map(row => row.text), week.map(row => row.barrage));
  assert.ok(live.rows.every(row => row.rank == null));
  assert.match(live.rows.map(row => row.text).join(' '), /连接中断/);
});

test('an oversized multi-board report reflows into one image with its last entry intact', async () => {
  const sections = Array.from({ length: 8 }, (_, i) => ({
    title: `榜 ${i + 1}`,
    rows: Array.from({ length: 20 }, (_, j) => ({ rank: j + 1, text: '自动换行的长弹幕'.repeat(18) + ` 尾部${i}-${j}` })),
  }));
  const card = { layout: 'barrage-poster', compact: true, title: '汇总', sections };
  const renderer = new CardRenderer('测试');
  await renderer.init();
  // Bound the regression where injecting a style after load stalled the no-JavaScript page.
  const deadline = setTimeout(() => renderer.browser.close().catch(() => {}), 20000);
  try {
    const page = await renderer.browser.newPage({ viewport: { width: 960, height: 1800 } });
    await page.setContent(cardHtml(card));
    assert.ok((await page.locator('.card').boundingBox()).height > 16000);
    const images = await renderer.render(card);
    assert.equal(images.length, 1);
    const height = await page.evaluate(async encoded => {
      const pixels = Uint8Array.from(atob(encoded), c => c.charCodeAt(0));
      const bitmap = await createImageBitmap(new Blob([pixels]));
      const height = bitmap.height;
      bitmap.close();
      return height;
    }, images[0].toString('base64'));
    assert.ok(height <= 16000);
    let coversWholeCard = false;
    for (const zoom of [0.8, 0.6]) {
      await page.setContent(cardHtml(card, undefined, { zoom }));
      if (Math.abs((await page.locator('.card').boundingBox()).height - height) <= 1) {
        coversWholeCard = true;
        break;
      }
    }
    assert.ok(coversWholeCard);
    assert.equal(await page.locator('.board .row .text').last().textContent(), sections.at(-1).rows.at(-1).text);
  } finally {
    clearTimeout(deadline);
    await renderer.close();
  }
});
