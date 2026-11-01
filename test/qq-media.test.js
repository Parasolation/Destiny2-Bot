import assert from 'node:assert/strict';
import test from 'node:test';
import { sendQQImage } from '../src/qq-media.js';
import { Admission, createMessageHandler } from '../src/runtime.js';
import { QQBot } from '@tencent-connect/qqbot-nodejs';

test('the installed SDK sends the validated media as a passive group reply on the wire', async t => {
  const originalFetch = globalThis.fetch, requests = [];
  t.after(() => { globalThis.fetch = originalFetch; });
  globalThis.fetch = async (url, opts) => {
    const body = JSON.parse(opts.body);
    if (String(url).includes('getAppAccessToken')) return Response.json({ access_token: 'test-token', expires_in: 7200 });
    requests.push({ url: String(url), body });
    return Response.json(String(url).endsWith('/files') ? { file_info: 'test-reference', ttl: 0 } : { id: 'reply-id' });
  };
  const bot = new QQBot({ appId: 'test-app', appSecret: 'test-secret', logger: { info() {}, error() {} } });
  await sendQQImage(bot, { scope: 'group', targetId: 'test-group', msgId: 'inbound-id' }, { buffer: Buffer.from('image') });
  assert.equal(requests.length, 2);
  assert.ok(requests[0].url.endsWith('/v2/groups/test-group/files'));
  assert.deepEqual(requests[0].body, { file_type: 1, srv_send_msg: false, file_data: Buffer.from('image').toString('base64') });
  assert.ok(requests[1].url.endsWith('/v2/groups/test-group/messages'));
  const { msg_seq, ...payload } = requests[1].body;
  assert.ok(Number.isSafeInteger(msg_seq) && msg_seq >= 0 && msg_seq < 65536);
  assert.deepEqual(payload, { msg_id: 'inbound-id', msg_type: 7, content: ' ', media: { file_info: 'test-reference' } });
});

test('media upload and send preserve the passive reply and include required nonempty content', async () => {
  const target = { scope: 'group', targetId: 'group', msgId: 'trigger' }, buffer = Buffer.from('image');
  const calls = [];
  const result = await sendQQImage({
    uploadMedia: async opts => { calls.push(opts); return { file_info: 'media-reference' }; },
    send: async opts => { calls.push(opts); return { id: 'private-message-id' }; },
  }, target, { buffer });
  assert.deepEqual(calls[0], { target, buffer, fileType: 1, srvSendMsg: false });
  assert.deepEqual(calls[1], { target, msgType: 7, content: ' ', media: { file_info: 'media-reference' } });
  assert.match(result.receipt, /^[a-f0-9]{12}$/);
  assert.ok(!JSON.stringify(result).includes('private-message-id'));
});

test('HTTP-success-shaped business errors and missing upload references never attempt a send', async () => {
  for (const upload of [undefined, {}, { code: 850027, message: 'sensitive-response' }, { code: '850027', file_info: 'bad' }]) {
    let sends = 0;
    await assert.rejects(sendQQImage({ uploadMedia: async () => upload, send: async () => { sends++; } }, {}, { buffer: Buffer.alloc(1) }), e => {
      assert.equal(e.stage, '图片上传');
      assert.ok(!e.message.includes('sensitive-response'));
      return true;
    });
    assert.equal(sends, 0);
  }
});

test('missing message IDs and business errors are logged as failures and release admission', async () => {
  for (const reply of [undefined, {}, { code: 304083, message: 'private-token' }, { code: 5, id: 'must-not-count' }]) {
    const logs = [], gate = new Admission();
    const handler = createMessageHandler({
      bot: { uploadMedia: async () => ({ file_info: 'secret-file-info' }), send: async () => reply },
      renderer: { render: async () => [Buffer.from('image')] },
      services: { config: { qq: { allowedGroupIds: [] } } }, admission: gate, fallbackImages: {},
      logger: { info: x => logs.push(x), error: x => logs.push(x) },
    });
    await handler(null, { content: '帮助', senderId: 'user', replyTarget: { scope: 'group', targetId: 'group', msgId: 'trigger' } });
    assert.ok(logs.some(x => x.includes('回复失败')));
    assert.ok(!logs.some(x => /成功|已返回图片消息回执|private-token|secret-file-info/.test(x)));
    assert.equal(gate.pending, 0);
  }
});
