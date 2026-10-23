import { mkdir, open, readFile, writeFile, unlink, readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { QQBot } from '@tencent-connect/qqbot-nodejs';
import { loadConfig, DATA, ROOT } from './config.js';
import { CardRenderer, dateTime } from './cards.js';
import { MemeService } from './memes.js';
import { DestinyService } from './destiny.js';
import { LiveStats, startCollector } from './live.js';
import { Admission, createMessageHandler, errorCard } from './runtime.js';

let renderer, bot, stopCollector, lock, lockOwned = false;
const lockPath = path.join(DATA, 'bot.lock');
const logs = path.join(ROOT, 'logs');
const log = (level, message) => {
  const line = `[${dateTime(Date.now())}] ${level} ${message}`;
  console.log(line);
  const day = new Date().toISOString().slice(0, 10);
  writeFile(path.join(logs, `${day}.log`), line + '\n', { flag: 'a' }).catch(() => {});
};
const logger = { info: msg => log('INFO', msg), warn: msg => log('WARN', msg), error: msg => log('ERROR', msg) };

async function acquireLock() {
  try { lock = await open(lockPath, 'wx'); }
  catch (e) {
    if (e.code !== 'EEXIST') throw e;
    let pid;
    try { pid = Number(await readFile(lockPath, 'utf8')); } catch {}
    if (!Number.isInteger(pid) || pid <= 0) throw new Error('运行锁文件异常，请确认没有其他机器人窗口，再删除 data/bot.lock。');
    try { process.kill(pid, 0); throw new Error('机器人已经在运行，请使用现有窗口。'); }
    catch (err) { if (err.code !== 'ESRCH') throw err; }
    await unlink(lockPath); lock = await open(lockPath, 'wx');
  }
  lockOwned = true; await lock.writeFile(String(process.pid));
}

async function cleanup() {
  stopCollector?.(); bot?.stop(); await renderer?.close();
  if (lockOwned) { await lock?.close(); await unlink(lockPath).catch(() => {}); lockOwned = false; }
}

try {
  const config = await loadConfig({ requireQQ: true });
  await mkdir(DATA, { recursive: true }); await mkdir(logs, { recursive: true });
  await acquireLock();
  for (const name of await readdir(logs)) {
    if (/^\d{4}-\d{2}-\d{2}\.log$/.test(name) && Date.now() - (await stat(path.join(logs, name))).mtimeMs > 14 * 86400000) await unlink(path.join(logs, name));
  }
  renderer = new CardRenderer(config.botName); await renderer.init();
  const fallbackImages = {
    cooldown: await renderer.render(errorCard(`请间隔 ${config.limits.perUserCooldownSeconds} 秒再查询。`)),
    busy: await renderer.render(errorCard('当前查询较多，请稍后再试。')),
    error: await renderer.render(errorCard('图片排版暂时失败，请稍后再试或重启机器人。')),
  };
  const live = new LiveStats(config.douyu);
  const services = { config, live, memes: new MemeService(), destiny: new DestinyService(config.bungie) };
  bot = new QQBot({ appId: config.qq.appId, appSecret: config.qq.appSecret, transport: 'websocket', markdownSupport: false,
    // Restrict subscriptions to group @ messages and C2C; do not request unrelated guild events.
    intents: 1 << 25,
    logger: { info() {}, warn() {}, error() {} },
  });
  const admission = new Admission({ cooldownSeconds: config.limits.perUserCooldownSeconds, maxPending: config.limits.maxPendingQueries });
  const handler = createMessageHandler({ bot, renderer, services, admission, fallbackImages, logger });
  const active = new Set();
  bot.on('message', (ctx, msg) => {
    if (shuttingDown) return;
    const job = handler(ctx, msg); active.add(job); job.finally(() => active.delete(job));
  });
  bot.on('ready', () => logger.info('QQ 已连接。请在测试群 @机器人，发送「帮助」。'));
  bot.on('resumed', () => logger.info('QQ 连接已恢复。'));
  let lastNetworkLog = 0;
  bot.on('error', () => { if (Date.now() - lastNetworkLog > 60000) { logger.warn('QQ 网络请求失败，SDK 正在重试。'); lastNetworkLog = Date.now(); } });
  bot.on('disconnected', data => logger.warn(`QQ 连接中断（${data.code}）。${data.willReconnect ? '正在重连。' : '需要检查平台状态。'}`));
  stopCollector = await startCollector(config.douyu, live, logger);
  let shuttingDown = false;
  const shutdown = () => { if (shuttingDown) return; shuttingDown = true; logger.info('正在停止……'); stopCollector(); bot.stop(); };
  process.once('SIGINT', shutdown); process.once('SIGTERM', shutdown);
  logger.info('启动完成，正在连接 QQ；请保持此窗口打开，并关闭系统睡眠。');
  try { await bot.start(); }
  finally { shuttingDown = true; stopCollector(); await Promise.allSettled([...active]); }
} catch (e) {
  // Never log SDK bodies, request headers, AppSecret, or access tokens.
  const isStartup = !bot;
  console.error(isStartup ? e.message : `QQ 运行结束${e.code ? `（${e.code}）` : ''}。请检查凭证、沙箱/上线状态、平台 IP 白名单与网络。`);
  process.exitCode = 1;
} finally { await cleanup(); }
