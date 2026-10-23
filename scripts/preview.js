import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { loadConfig, OUTPUT } from '../src/config.js';
import { CardRenderer } from '../src/cards.js';
import { helpCard, liveCard, craftingCard } from '../src/commands.js';
import { errorCard } from '../src/runtime.js';
const config = await loadConfig(); const renderer = new CardRenderer(config.botName);
try {
  await mkdir(OUTPUT, { recursive: true }); await renderer.init();
  const at = Date.now();
  const cards = {
    help: helpCard(),
    'crafting-demo': { ...craftingCard({ player: { displayName: '演示守护者#1234' }, at, unlocked: 8, locked: 11, unknown: 1, total: 20,
      rows: Array.from({ length: 20 }, (_, i) => ({ name: `示例武器 ${i + 1}`, known: i !== 19, unlocked: i >= 11 && i < 19,
        progress: i === 19 ? null : i >= 11 ? 5 : i % 5, target: i === 19 ? null : 5 })) }, { filter: '', page: 1 }), demo: true, source: '本地图样进度样式演示' },
    'live-demo': { ...liveCard({ connected: true, state: '采集中', count: 1248, users: 316, at, start: at - 300000, complete: true,
      rows: [{ text: '这波配合太漂亮了！', users: 86, count: 132 }, { text: '先别急，残局还有机会', users: 51, count: 74 }, { text: '今天这个手感可以', users: 39, count: 58 },
        { text: '好枪！这一下真的关键', users: 28, count: 42 }] }, config.douyu), demo: true },
    error: errorCard('数据源暂时无法连接，请稍后重试。'),
    'long-text-demo': { title: '长内容与特殊字符测试', label: '排版测试', demo: true, source: '本地测试数据',
      rows: Array.from({ length: 8 }, (_, i) => ({ rank: i + 1, text: '中文换行、emoji 😀🔥与 <script>alert(1)</script> 应显示为普通文本。'.repeat(5), meta: '安全转义 · 长图自动分页' })) },
  };
  for (const [name, card] of Object.entries(cards)) {
    const images = await renderer.render(card);
    for (let i = 0; i < images.length; i++) await writeFile(path.join(OUTPUT, `${name}-${i + 1}.png`), images[i]);
    console.log(`${name}: ${images.length} 张 PNG`);
  }
  console.log(`图片已保存到 ${OUTPUT}`);
} catch (e) { console.error(e.message); process.exitCode = 1; }
finally { await renderer.close(); }
