import { loadConfig } from '../src/config.js';
import { MemeService } from '../src/memes.js';
import { DestinyService } from '../src/destiny.js';
import { LiveStats, startCollector } from '../src/live.js';
import { CardRenderer } from '../src/cards.js';
import { errorCard } from '../src/runtime.js';
const config = await loadConfig();
console.log(`Node ${process.version} / ${process.platform} ${process.arch}`);
console.log(`QQ 配置：${config.qq.appId && config.qq.appSecret ? '已填写（本检查不验证 QQ 登录、不向群里发消息）' : '未填写'}`);
let failed = false;
async function check(name, operation) {
  try { console.log(`[通过] ${name}: ${await operation()}`); }
  catch (e) { failed = true; console.log(`[失败] ${name}: ${e.message}`); }
}
await check('图片生成', async () => {
  const renderer = new CardRenderer(config.botName);
  try { const [png] = await renderer.render(errorCard('图片生成正常')); return `${png.length} 字节 PNG`; }
  finally { await renderer.close(); }
});
const memes = new MemeService();
await check('6657 热门接口', async () => `${(await memes.query('hot')).rows.length} 条结果`);
await check('6657 随机接口', async () => `${(await memes.query('random')).rows.length} 条结果`);
await check('6657 搜索接口', async () => `${(await memes.query('search', '玩机器')).rows.length} 条结果`);
const destiny = new DestinyService(config.bungie);
if (config.bungie.apiKey) await check('Bungie API', async () => `Manifest 版本 ${(await destiny.api('/Destiny2/Manifest/')).version}`);
else console.log('[未配置] Bungie API Key；命运 2 在线接口暂不能验证。');
await check('命运 2 本地数据库', async () => `${(await destiny.load()).weapons.length} 件武器`);
if (config.douyu.enabled) {
  const live = new LiveStats(config.douyu);
  const stop = await startCollector(config.douyu, live, { info() {}, warn() {} });
  await new Promise(resolve => setTimeout(resolve, 15000));
  const state = live.snapshot(); stop();
  if (state.connected) console.log(`[通过] 斗鱼弹幕连接；15 秒内采集 ${state.count} 条。无弹幕不等于未开播。`);
  else { failed = true; console.log('[失败] 斗鱼 15 秒内未连接，请检查网络，稍后重试。'); }
}
console.log('检查完成。无需向他人发送 config.json 或密钥。');
if (failed) process.exitCode = 1;
