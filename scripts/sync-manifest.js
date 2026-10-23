import { loadConfig } from '../src/config.js';
import { DestinyService } from '../src/destiny.js';
try { const config = await loadConfig(); await new DestinyService(config.bungie).sync(); }
catch (e) { console.error(e.message); process.exitCode = 1; }
