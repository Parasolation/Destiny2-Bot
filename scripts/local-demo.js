import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { loadConfig, OUTPUT } from '../src/config.js';
import { CardRenderer } from '../src/cards.js';
import { parseCommand, queryCard } from '../src/commands.js';
import { MemeService } from '../src/memes.js';
import { DestinyService } from '../src/destiny.js';
import { LiveStats, startCollector } from '../src/live.js';

// Run a query locally and render exactly the same card used by the QQ handler.
// No QQ credentials, no outbound QQ messages.
const config = await loadConfig();
const input = process.argv.slice(2).join(' ') || '6657 热门';
const command = parseCommand(input);
const live = new LiveStats(config.douyu);
const services = { config, live, memes: new MemeService(), destiny: new DestinyService(config.bungie) };
const renderer = new CardRenderer(config.botName);
let stop;
try {
  await mkdir(OUTPUT, { recursive: true });
  let card;
  if (command.mode === 'live' && process.env.BOT_USE_SAVED_SAMPLE === '1') {
    card = { ...JSON.parse(await readFile(path.join(OUTPUT, 'live-check.json'), 'utf8')), layout: 'barrage-poster' };
  } else {
    if (command.type === 'meme' && ['live', 'all'].includes(command.mode) && config.douyu.enabled) {
      stop = await startCollector(config.douyu, live);
      console.log('正在采集 30 秒直播弹幕……');
      await new Promise(resolve => setTimeout(resolve, 30000));
    }
    if (!config.douyu.enabled) live.setDisconnected('实时采集已关闭');
    card = await queryCard(command, services);
  }
  const name = command.type === 'meme' ? `actual-${command.mode}` : `actual-${command.type}`;
  const images = await renderer.render(card);
  for (let i = 0; i < images.length; i++) {
    const file = path.join(OUTPUT, `${name}-${i + 1}.${images[i][0] === 255 ? 'jpg' : 'png'}`);
    await writeFile(file, images[i]); console.log(file);
  }
} catch (e) { console.error(e.message); process.exitCode = 1; }
finally { stop?.(); await renderer.close(); }
