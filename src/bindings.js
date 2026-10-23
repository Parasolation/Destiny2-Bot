import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile, rename } from 'node:fs/promises';
import path from 'node:path';
import { DATA } from './config.js';
import { UserError } from './http.js';

// QQ group member identifiers and C2C identifiers need not share a namespace.
export function bindingKey(target, senderId, appId = '') {
  if (!target || !['group', 'c2c'].includes(target.scope) || !senderId || !target.targetId) return null;
  return createHash('sha256').update(JSON.stringify([appId, target.scope, target.targetId, senderId])).digest('hex');
}

export class BindingStore {
  constructor(directory = DATA) {
    this.directory = directory; this.file = path.join(directory, 'bindings.json');
    this.rows = new Map(); this.tail = Promise.resolve(); this.ready = null;
  }
  load() {
    this.ready ||= (async () => {
      let raw;
      try { raw = await readFile(this.file, 'utf8'); }
      catch (e) { if (e.code === 'ENOENT') return; throw e; }
      try {
        const data = JSON.parse(raw);
        if (data.version !== 1 || !data.bindings || typeof data.bindings !== 'object' || Array.isArray(data.bindings)) throw new Error();
        for (const [key, row] of Object.entries(data.bindings)) {
          if (!/^[a-f0-9]{64}$/.test(key) || !/^\d+$/.test(row.membershipId) || ![1, 2, 3, 5, 6].includes(row.membershipType) || typeof row.displayName !== 'string') throw new Error();
          this.rows.set(key, row);
        }
      } catch { throw new Error('绑定文件格式异常，请检查 data/bindings.json；已保留原文件。'); }
    })();
    return this.ready;
  }
  requireKey(key) {
    if (!/^[a-f0-9]{64}$/.test(key || '')) throw new UserError('无法确认当前发送者，请在 QQ 群里 @机器人使用绑定和个人查询。');
  }
  async get(key) { this.requireKey(key); await this.load(); await this.tail.catch(() => {}); return this.rows.get(key); }
  set(key, value) {
    this.requireKey(key);
    const task = this.tail.catch(() => {}).then(async () => {
      await this.load();
      const next = new Map(this.rows);
      if (value) next.set(key, { membershipId: String(value.membershipId), membershipType: value.membershipType, displayName: value.displayName, boundAt: Date.now() });
      else next.delete(key);
      await mkdir(this.directory, { recursive: true });
      await writeFile(this.file + '.tmp', JSON.stringify({ version: 1, bindings: Object.fromEntries(next) }, null, 2) + '\n', { mode: 0o600 });
      await rename(this.file + '.tmp', this.file);
      this.rows = next;
    });
    this.tail = task; return task;
  }
}
