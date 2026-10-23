import { parseCommand, queryCard } from './commands.js';
import { UserError } from './http.js';
import { bindingKey } from './bindings.js';

export class Admission {
  constructor({ cooldownSeconds = 10, maxPending = 8, clock = Date.now } = {}) {
    Object.assign(this, { cooldownSeconds, maxPending, clock });
    this.seen = new Map(); this.users = new Map(); this.pending = 0;
  }
  enter(messageId, userKey) {
    const now = this.clock();
    for (const [k, time] of this.seen) if (now - time > 3600000) this.seen.delete(k);
    for (const [k, value] of this.users) if (now - value.at >= this.cooldownSeconds * 1000) this.users.delete(k);
    if (!messageId || this.seen.has(messageId)) return 'duplicate';
    this.seen.set(messageId, now);
    while (this.seen.size > 10000) this.seen.delete(this.seen.keys().next().value);
    const prior = this.users.get(userKey);
    if (prior) { if (prior.warned) return 'silent'; prior.warned = true; return 'cooldown'; }
    this.users.set(userKey, { at: now, warned: false });
    while (this.users.size > 5000) this.users.delete(this.users.keys().next().value);
    if (this.pending >= this.maxPending) return 'busy';
    this.pending++; return 'ok';
  }
  leave() { this.pending = Math.max(0, this.pending - 1); }
}

export function errorCard(message) {
  return { title: '这次查询暂未完成', label: '查询提示', rows: [{ text: message }], source: '机器人本地提示' };
}

export function createMessageHandler({ bot, renderer, services, admission, fallbackImages, logger }) {
  return async (_ctx, msg) => {
    const target = msg.replyTarget;
    if (!target || !['group', 'c2c'].includes(target.scope) || !target.msgId) return;
    const allowed = services.config.qq.allowedGroupIds;
    if (target.scope === 'group' && allowed.length && !allowed.includes(target.targetId)) return;
    const decision = admission.enter(`${target.scope}:${target.targetId}:${target.msgId}`, `${target.scope}:${target.targetId}:${msg.senderId}`);
    if (decision === 'duplicate' || decision === 'silent') return;
    try {
      let images;
      if (decision !== 'ok') images = fallbackImages[decision];
      else {
        let card;
        try { card = await queryCard(parseCommand(msg.content), services, { userKey: bindingKey(target, msg.senderId, services.config.qq.appId) }); }
        catch (e) {
          if (!(e instanceof UserError)) logger.error('查询发生内部错误，请运行连接检查。');
          card = errorCard(e instanceof UserError ? e.message : '查询遇到了暂时的问题，请稍后重试。');
        }
        try { images = await renderer.render(card); }
        catch { logger.error('图片排版失败。'); images = fallbackImages.error; }
      }
      // At most three native media messages, always tied to the triggering message.
      for (const buffer of images.slice(0, 3)) await bot.sendImage(target, { buffer });
      logger.info?.(`QQ 图片回复成功（${Math.min(images.length, 3)} 张）。`);
    } catch (e) {
      logger.error(`QQ 图片发送失败${Number.isFinite(e.bizCode) ? `，错误码 ${e.bizCode}` : ''}。检查机器人权限、网络和上传额度。`);
    } finally { if (decision === 'ok') admission.leave(); }
  };
}
