// 前端版本号自动 bump：把所有 ?v=YYYYMMDD 替换为当天日期
// 用法: node scripts/bump-version.mjs（部署前执行，防 nginx 缓存旧资源）
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.join(__dirname, '..');

const now = new Date();
const pad = (n) => String(n).padStart(2, '0');
const stamp = now.getFullYear() + pad(now.getMonth() + 1) + pad(now.getDate());

// 收集 public/ 与 portal/ 下所有 html
const targets = [];
for (const dir of ['public', 'portal']) {
  const d = path.join(rootDir, dir);
  for (const f of readdirSync(d)) {
    if (f.endsWith('.html')) targets.push(path.join(d, f));
  }
}

let changed = 0;
for (const f of targets) {
  const s = readFileSync(f, 'utf8');
  const s2 = s.replace(/\?v=\d{8}/g, '?v=' + stamp);
  if (s2 !== s) {
    writeFileSync(f, s2);
    changed++;
    console.log('bump: ' + path.relative(rootDir, f) + ' -> ?v=' + stamp);
  }
}
console.log('完成：更新 ' + changed + ' 个文件，版本号 ?v=' + stamp);
