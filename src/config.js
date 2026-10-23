import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

export const ROOT = fileURLToPath(new URL('../', import.meta.url));
export const DATA = path.join(ROOT, 'data');
export const OUTPUT = path.join(ROOT, 'output');

export function validateConfig(c, { requireQQ = false } = {}) {
  if (!c || typeof c !== 'object') throw new Error('config.json 必须是 JSON 对象。');
  c.botName = String(c.botName || '守护者助手').slice(0, 30);
  c.qq ??= {};
  c.bungie ??= {};
  c.douyu = { enabled: true, roomId: '6657', windowMinutes: 5, topN: 20, blockedWords: [], ...c.douyu };
  c.limits = { perUserCooldownSeconds: 10, maxPendingQueries: 8, ...c.limits };
  for (const [value, min, max, label] of [
    [c.douyu.windowMinutes, 1, 30, 'windowMinutes'],
    [c.douyu.topN, 1, 30, 'topN'],
    [c.limits.perUserCooldownSeconds, 1, 300, 'perUserCooldownSeconds'],
    [c.limits.maxPendingQueries, 1, 20, 'maxPendingQueries'],
  ]) if (!Number.isInteger(value) || value < min || value > max) throw new Error(`${label} 必须是 ${min}–${max} 的整数。`);
  if (!/^\d+$/.test(String(c.douyu.roomId))) throw new Error('roomId 必须是数字房间号。');
  if (!Array.isArray(c.douyu.blockedWords) || c.douyu.blockedWords.some(x => typeof x !== 'string')) throw new Error('blockedWords 必须是字符串数组。');
  c.qq.allowedGroupIds ??= [];
  if (!Array.isArray(c.qq.allowedGroupIds) || c.qq.allowedGroupIds.some(x => typeof x !== 'string')) throw new Error('allowedGroupIds 必须是字符串数组。');
  if (typeof c.douyu.enabled !== 'boolean') throw new Error('douyu.enabled 必须是 true 或 false。');
  c.bungie.language ||= 'zh-chs';
  if (!['zh-chs', 'zh-cht', 'en'].includes(c.bungie.language)) throw new Error('language 支持 zh-chs / zh-cht / en。');
  if (requireQQ && (!c.qq.appId || !c.qq.appSecret)) throw new Error('请先在 config.json 中填写 QQ AppID 和 AppSecret。密钥只填写在笔记本上，不要发到群里。');
  return c;
}

export async function loadConfig(options = {}) {
  let raw;
  try { raw = await readFile(path.join(ROOT, 'config.json'), 'utf8'); }
  catch (e) {
    if (e.code !== 'ENOENT') throw e;
    if (options.requireQQ) throw new Error('缺少 config.json，请先运行 02-configure.cmd。');
    raw = await readFile(path.join(ROOT, 'config.example.json'), 'utf8');
  }
  let c;
  try { c = JSON.parse(raw.replace(/^\uFEFF/, '')); }
  catch { throw new Error('config.json 格式错误。请检查双引号、逗号，不能添加注释。'); }
  return validateConfig(c, options);
}
