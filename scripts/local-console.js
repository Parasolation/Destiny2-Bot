import readline from 'node:readline/promises';
import { stdin, stdout } from 'node:process';
import { spawn } from 'node:child_process';

const rl = readline.createInterface({ input: stdin, output: stdout });
console.log('本机预览：输入与 QQ 群相同的指令，图片保存到 output。此模式不向 QQ 发消息。');
console.log('示例：帮助 / 6657 热门 / 6657 实时（采集 30 秒） / 武器 名称');
console.log('输入 exit 退出。');
try {
  for (;;) {
    const input = (await rl.question('\n指令 > ')).trim();
    if (/^(exit|退出)$/i.test(input)) break;
    if (!input) continue;
    await new Promise(resolve => {
      // Shell-free argument passing: commands are data, never executable shell text.
      const child = spawn(process.execPath, ['scripts/local-demo.js', input], { stdio: 'inherit', windowsHide: true });
      child.on('error', err => { console.error(err.message); resolve(); });
      child.on('exit', resolve);
    });
  }
} finally { rl.close(); }
