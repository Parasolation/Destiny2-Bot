import assert from 'node:assert/strict';
import test from 'node:test';
import { CardRenderer, cardHtml } from '../src/cards.js';
import { parseCommand, queryCard } from '../src/commands.js';
import { Admission, createMessageHandler } from '../src/runtime.js';

test('website lists and the live ranking use the single-image layout', async () => {
  const services = {
    memes: { query: async () => ({ rows: [], fetchedAt: 0, total: 0 }) },
    live: { snapshot: () => ({ connected: true, rows: [], start: 0, at: 1000 }) },
    config: { douyu: { roomId: '6657', windowMinutes: 5 } },
  };
  for (const command of ['热门', '周榜', '搜索 测试', '随机', '实时']) {
    const card = await queryCard(parseCommand(command), services);
    assert.equal(card.layout, 'barrage-poster', command);
  }
});

test('a 20-entry barrage page sends one full-height image including the final long entry', async t => {
  const rows = Array.from({ length: 20 }, (_, i) => ({
    text: `第${i + 1}条 ${'弹幕自动换行 <&> '.repeat(i === 19 ? 210 : 25)}末尾${i + 1}`,
    copies: 100 - i,
    id: String(i + 1),
  }));
  const services = {
    memes: { query: async () => ({ rows, fetchedAt: 1000, total: 60 }) },
    config: { qq: { allowedGroupIds: [] } },
  };
  const renderer = new CardRenderer('测试');
  t.after(() => renderer.close());
  const sent = [];
  const handler = createMessageHandler({
    bot: { sendImage: (target, payload) => sent.push({ target, payload }) },
    renderer, services, admission: new Admission(),
    fallbackImages: { error: [Buffer.from('render error')] },
    logger: { error: message => assert.fail(message) },
  });
  const target = { scope: 'group', targetId: 'test-group', msgId: 'original' };
  const content = '周榜 第2页';
  await handler(null, { replyTarget: target, content, senderId: 'sender' });
  assert.equal(sent.length, 1);
  assert.equal(sent[0].target, target);
  const bytes = sent[0].payload.buffer;
  assert.ok(Buffer.isBuffer(bytes) && bytes.length <= 4_500_000);

  const card = await queryCard(parseCommand(content), services);
  const page = await renderer.browser.newPage({ viewport: { width: 960, height: 1800 } });
  await page.setContent(cardHtml(card, card.rows, { botName: '测试' }));
  assert.deepEqual(await page.locator('.row .text').allTextContents(), rows.map(row => row.text));
  assert.equal(await page.locator('.row .rank').last().textContent(), '40');

  // Compare the delivered raster against the entire unpaginated DOM, including its footer.
  const encoded = bytes.toString('base64');
  const imageHeight = await page.evaluate(async base64 => {
    const pixels = Uint8Array.from(atob(base64), c => c.charCodeAt(0));
    const bitmap = await createImageBitmap(new Blob([pixels]));
    const height = bitmap.height;
    bitmap.close();
    return height;
  }, encoded);
  const { height } = await page.locator('.card').boundingBox();
  assert.ok(height > 1800);
  assert.ok(Math.abs(imageHeight - height) <= 1, `sent ${imageHeight}px for a ${height}px result`);
});
