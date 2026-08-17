// 数据库自动备份脚本（一致性快照，保留最近 N 份）
// 用法: node scripts/backup-db.mjs          （备份到 ../backups/）
// 环境变量 JZ_BACKUP_KEEP 控制保留份数（默认 14）
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, readdirSync, unlinkSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.join(__dirname, '..');
const dbPath = path.join(rootDir, 'data', 'jizhang.db');
const backupDir = path.join(rootDir, 'backups');
const keep = Number(process.env.JZ_BACKUP_KEEP || 14);

mkdirSync(backupDir, { recursive: true });
const ts = new Date();
const pad = (n) => String(n).padStart(2, '0');
const stamp = ts.getFullYear() + pad(ts.getMonth() + 1) + pad(ts.getDate()) + '-' + pad(ts.getHours()) + pad(ts.getMinutes()) + pad(ts.getSeconds());
const out = path.join(backupDir, 'jizhang-' + stamp + '.db');

try {
  const db = new DatabaseSync(dbPath);
  db.exec("VACUUM INTO '" + out.replace(/'/g, "''") + "'");
  db.close();
  console.log('备份完成: ' + out);
} catch (err) {
  console.error('备份失败: ' + err.message);
  process.exit(1);
}

const files = readdirSync(backupDir)
  .filter((f) => f.startsWith('jizhang-') && f.endsWith('.db'))
  .map((f) => path.join(backupDir, f))
  .sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs);
for (let i = keep; i < files.length; i++) {
  unlinkSync(files[i]);
  console.log('清理过期备份: ' + files[i]);
}
console.log('当前保留备份数: ' + Math.min(files.length, keep));
