import test from 'node:test';
import assert from 'node:assert/strict';
import { fetchHeatwallSection } from '../src/meme-hotwall.js';

const responseInit = { headers: { 'Content-Type': 'text/event-stream; charset=utf-8' } };

test('heatwall reads one public snapshot across chunk boundaries and closes the live connection', async () => {
  const bytes = Buffer.from(': heartbeat\r\n\r\nevent: event\r\ndata: {"barrage":"忽略实时事件"}\r\n\r\nevent: snapshot\r\ndata: {"items":[\r\ndata: {"barrage":"测试梗","count":3},{"barrage":"第二条","count":1}]}\r\n\r\n');
  let cancelled = false;
  let signal;
  const section = await fetchHeatwallSection(async (url, options) => {
    assert.equal(url, 'https://api.hguofichp.cn/machine/hotwall/stream');
    assert.deepEqual(options.headers, { Accept: 'text/event-stream' });
    assert.equal(options.credentials, 'omit');
    signal = options.signal;
    let offset = 0;
    return new Response(new ReadableStream({
      pull(controller) {
        if (offset < bytes.length) controller.enqueue(bytes.subarray(offset, ++offset));
      },
      cancel() { cancelled = true; },
    }), responseInit);
  });
  assert.deepEqual(section.rows.map(r => [r.rank, r.text]), [[1, '测试梗'], [2, '第二条']]);
  assert.equal(section.rows[0].meta, '站内热度 3');
  assert.ok(cancelled && signal.aborted);
});

test('heatwall distinguishes a valid empty snapshot from a denied, broken, or oversized stream', async () => {
  const stream = frame => async () => new Response(frame, responseInit);
  const empty = await fetchHeatwallSection(stream('event:snapshot\ndata:{"items":[]}\n\n'));
  assert.match(empty.subtitle, /0 条/);
  await assert.rejects(fetchHeatwallSection(async () => new Response(null, { status: 403 })), /HTTP 403/);
  await assert.rejects(fetchHeatwallSection(stream('event:event\ndata:{}\n\n')), /尚未取得/);
  await assert.rejects(fetchHeatwallSection(stream('event:snapshot\ndata:{}\n\n')), /格式异常/);
  await assert.rejects(fetchHeatwallSection(stream('x'.repeat(512 * 1024 + 1))), /读取上限/);
});

test('heatwall cancels a stalled reader at the snapshot deadline', async () => {
  let cancelled = false;
  const request = async () => new Response(new ReadableStream({ cancel() { cancelled = true; } }), responseInit);
  await assert.rejects(fetchHeatwallSection(request, { timeoutMs: 15 }), /超时/);
  assert.ok(cancelled);
});
