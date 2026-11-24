import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';

const vault =
  process.env.VAULT ??
  '/Users/rose/Library/CloudStorage/ProtonDrive-r.zoomer@proton.me-folder/Obsidian/ABC';

const manifest = JSON.parse(fs.readFileSync('manifest.json', 'utf8'));
const targetDir = path.join(vault, '.obsidian', 'plugins', manifest.id);

fs.mkdirSync(targetDir, { recursive: true });

const filesToDeploy = ['main.js', 'manifest.json', 'styles.css'];
let count = 0;
for (const file of filesToDeploy) {
  if (fs.existsSync(file)) {
    fs.copyFileSync(file, path.join(targetDir, file));
    count++;
  }
}
console.log(`[deploy] ✅ Deployed ${count} file(s) to ${targetDir}`);

// Trigger hot-reload if Obsidian is running
try {
  execSync('pgrep -x Obsidian', { stdio: 'ignore' });
  try {
    execSync(`obsidian plugin:reload id=${manifest.id}`, { stdio: 'inherit' });
    console.log(`[deploy] 🔄 Reloaded plugin in Obsidian: ${manifest.id}`);
  } catch (err) {
    console.warn(`[deploy] ⚠️ Failed to reload plugin via obsidian CLI:`, err.message);
  }
} catch {
  console.log(`[deploy] ℹ️ Obsidian is not running; skipping hot-reload`);
}
