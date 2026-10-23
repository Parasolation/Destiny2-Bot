import { ROOT } from './config.js';
import path from 'node:path';
import { BungieAssets } from './bungie-assets.js';
import { renderCraftingPoster } from './crafting-poster.js';
import { renderEquipmentCard } from './equipment-cards.js';

export const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, x => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[x]);
export const dateTime = value => new Intl.DateTimeFormat('zh-CN', { timeZone: 'Asia/Shanghai', dateStyle: 'short', timeStyle: 'medium', hour12: false }).format(value ?? Date.now());

export function cardHtml(card, rows = card.rows || [], { botName = '守护者助手', page = 1, pages = 1 } = {}) {
  const e = escapeHtml;
  return `<!doctype html><html lang="zh-CN"><head><meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'">
  <style>
    *{box-sizing:border-box}body{margin:0;width:960px;background:#0c1424;color:#f3f6ff;font-family:'Microsoft YaHei','Segoe UI','Segoe UI Emoji',sans-serif}
    .card{padding:48px 48px 30px;background:radial-gradient(ellipse at 95% 0%,#1d4650 0,transparent 42%),#0c1424}
    .top{display:flex;align-items:center;justify-content:space-between;color:#a8b7d0;font-size:20px;letter-spacing:2px}.mark{width:14px;height:14px;background:#63e8c4;display:inline-block;margin-right:10px;border-radius:4px}
    .label{color:#63e8c4;border:1px solid #326c63;border-radius:20px;padding:7px 15px;font-size:17px;letter-spacing:1px}
    h1{font-size:44px;line-height:1.3;margin:28px 0 12px;overflow-wrap:anywhere;font-weight:700}.subtitle{color:#b1bed3;font-size:22px;line-height:1.6;white-space:pre-wrap}
    .stats{display:flex;gap:16px;margin:26px 0 10px}.stat{flex:1;background:#18273b;border:1px solid #29415a;padding:18px 20px;border-radius:14px}.value{font-size:30px;color:#63e8c4;font-weight:700}.key{font-size:17px;color:#a8b7d0;margin-top:6px}
    .rows{margin-top:26px;display:flex;flex-direction:column;gap:14px}.row{background:#152238;border:1px solid #263b54;border-radius:16px;padding:21px 24px;display:flex;gap:18px;break-inside:avoid}.rank{font-size:28px;min-width:35px;color:#63e8c4;font-weight:700;font-variant-numeric:tabular-nums}.body{min-width:0;flex:1}.title{font-size:24px;font-weight:700;line-height:1.5;overflow-wrap:anywhere}.text{font-size:23px;line-height:1.65;white-space:pre-wrap;overflow-wrap:anywhere}.title+.text{margin-top:8px;color:#dce5f5}.meta{margin-top:12px;font-size:17px;color:#91a8c3;line-height:1.5;white-space:pre-wrap;overflow-wrap:anywhere}
    .notice{font-size:19px;line-height:1.6;color:#f2d398;margin-top:24px;white-space:pre-wrap;overflow-wrap:anywhere}.footer{border-top:1px solid #293b51;margin-top:28px;padding-top:20px;font-size:16px;line-height:1.8;color:#8fa5c1;overflow-wrap:anywhere}.bottom{display:flex;justify-content:space-between}.demo{color:#ffd891;font-weight:bold}
    .compact .rows{gap:10px}.compact .row{padding:13px 20px}.compact .text{font-size:21px;line-height:1.5}.compact .title{font-size:22px}.compact .title+.text{margin-top:3px}.compact .meta{margin-top:6px}.compact .notice{font-size:17px}
  </style></head><body><main class="card${card.compact ? ' compact' : ''}">
    <div class="top"><span><i class="mark"></i>${e(botName)}</span><span class="label">${e(card.label || '查询结果')}</span></div>
    <h1>${e(card.title)}</h1><div class="subtitle">${e(card.subtitle || '')}</div>
    ${card.stats?.length ? `<div class="stats">${card.stats.map(s => `<div class="stat"><div class="value">${e(s.value)}</div><div class="key">${e(s.label)}</div></div>`).join('')}</div>` : ''}
    <div class="rows">${rows.map(r => `<section class="row">${r.rank != null ? `<div class="rank">${e(String(r.rank).padStart(2,'0'))}</div>` : ''}<div class="body">${r.title ? `<div class="title">${e(r.title)}</div>` : ''}<div class="text">${e(r.text)}</div>${r.meta ? `<div class="meta">${e(r.meta)}</div>` : ''}</div></section>`).join('')}</div>
    ${card.notice ? `<div class="notice">${e(card.notice)}</div>` : ''}
    <footer class="footer">${card.demo ? '<div class="demo">演示数据 · 仅展示图片样式，不代表当前真实结果</div>' : ''}<div>来源：${e(card.source || '机器人本地状态')}</div>
    <div class="bottom"><span>${e(dateTime(card.at))} · 北京时间</span><span>${page} / ${pages}</span></div></footer>
  </main></body></html>`;
}

export class CardRenderer {
  constructor(botName, { assets = new BungieAssets() } = {}) { this.botName = botName; this.assets = assets; this.tail = Promise.resolve(); this.browser = null; }
  async init() {
    process.env.PLAYWRIGHT_BROWSERS_PATH ||= path.join(ROOT, '.local-browsers');
    const { chromium } = await import('playwright');
    this.browser = await chromium.launch({ headless: true });
  }
  render(card) {
    const task = this.tail.catch(() => {}).then(() => this.renderNow(card));
    this.tail = task; return task;
  }
  async renderNow(card) {
    if (!this.browser?.isConnected()) await this.init();
    if (card.layout === 'crafting-poster') return renderCraftingPoster(this.browser, card, this.assets, this.botName);
    if (['weapon-detail','perk-detail'].includes(card.layout)) return renderEquipmentCard(this.browser,card,this.assets,this.botName);
    const context = await this.browser.newContext({ viewport: { width: 960, height: 1800 }, deviceScaleFactor: 1, javaScriptEnabled: false });
    await context.route('**/*', route => route.abort());
    const page = await context.newPage();
    page.setDefaultTimeout(10000);
    try {
      const rows = (card.rows || []).flatMap(row => {
        const chars = Array.from(String(row.text || '').slice(0, 2000));
        if (!chars.length) return [row];
        const pieces = [];
        for (let i = 0; i < chars.length; i += 260) pieces.push({ ...row, text: chars.slice(i, i + 260).join(''),
          title: i ? `${row.title || '内容'}（续）` : row.title, rank: i ? undefined : row.rank });
        return pieces;
      });
      const groups = []; let current = [];
      for (const row of rows) {
        const candidate = [...current, row];
        await page.setContent(cardHtml(card, candidate, { botName: this.botName }), { waitUntil: 'load' });
        const box = await page.locator('.card').boundingBox();
        if (box.height > 1800 && current.length) { groups.push(current); current = [row]; }
        else current = candidate;
      }
      if (current.length || !groups.length) groups.push(current);
      const display = groups.slice(0, 3); const images = [];
      for (let i = 0; i < display.length; i++) {
        const finalCard = groups.length > 3 ? { ...card, notice: `${card.notice || ''}\n本次内容较长，仅展示前三张。请缩小关键词或查询下一页。` } : card;
        await page.setContent(cardHtml(finalCard, display[i], { botName: this.botName, page: i + 1, pages: display.length }), { waitUntil: 'load' });
        const png = await page.locator('.card').screenshot({ type: 'png', animations: 'disabled' });
        if (png.length > 4_500_000) throw new Error('生成的图片超过发送大小限制。');
        images.push(png);
      }
      return images;
    } finally { await context.close(); }
  }
  async close() { await this.tail.catch(() => {}); await this.browser?.close(); }
}
