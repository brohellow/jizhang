import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import crypto from 'node:crypto';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dataDir = path.join(__dirname, '..', 'data');
mkdirSync(dataDir, { recursive: true });

export const db = new DatabaseSync(path.join(dataDir, 'jizhang.db'));

db.exec('PRAGMA journal_mode = WAL;');
db.exec('PRAGMA foreign_keys = ON;');
// ===== 性能 PRAGMA =====
db.exec('PRAGMA busy_timeout = 5000;');        // 写锁等待 5 秒，避免 SQLITE_BUSY
db.exec('PRAGMA synchronous = NORMAL;');        // WAL 下 NORMAL 足够安全且更快
db.exec('PRAGMA cache_size = -16000;');         // 16MB 页缓存
db.exec('PRAGMA temp_store = MEMORY;');         // 临时表/排序走内存
db.exec('PRAGMA wal_autocheckpoint = 1000;');   // WAL 自动检查点

// ===== Migration 机制 =====
// 创建 _migrations 表记录已执行的 migration
db.exec(`
  CREATE TABLE IF NOT EXISTS _migrations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE,
    executed_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
  );
`);

// 执行所有未跑过的 migration
function runMigrations() {
  const migrationsDir = path.join(__dirname, 'migrations');
  const files = readdirSync(migrationsDir)
    .filter(f => f.endsWith('.sql'))
    .sort(); // 按文件名排序，保证顺序执行

  const executed = new Set(
    db.prepare('SELECT name FROM _migrations').all().map(r => r.name)
  );

  for (const file of files) {
    if (executed.has(file)) continue;

    console.log(`[migration] 执行 ${file}...`);
    const sql = readFileSync(path.join(migrationsDir, file), 'utf8');

    // 在事务中执行 migration
    db.exec('BEGIN');
    try {
      db.exec(sql);
      db.prepare('INSERT INTO _migrations (name) VALUES (?)').run(file);
      db.exec('COMMIT');
      console.log(`[migration] ${file} 完成`);
    } catch (err) {
      db.exec('ROLLBACK');
      console.error(`[migration] ${file} 失败:`, err.message);
      throw err;
    }
  }
}

runMigrations();

// ===== 兼容旧表：salary_config 补充时段字段（幂等，移到 exec 外） =====
// 这些 ALTER TABLE 已经在 001_init.sql 中包含，这里保留是为了兼容旧库
try { db.exec("ALTER TABLE salary_config ADD COLUMN work_start TEXT NOT NULL DEFAULT '09:00'"); } catch (e) {}
try { db.exec("ALTER TABLE salary_config ADD COLUMN work_end TEXT NOT NULL DEFAULT '18:00'"); } catch (e) {}
try { db.exec("ALTER TABLE salary_config ADD COLUMN break_start TEXT"); } catch (e) {}
try { db.exec("ALTER TABLE salary_config ADD COLUMN break_end TEXT"); } catch (e) {}

export function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(String(password), salt, 64).toString('hex');
  return salt + ':' + hash;
}

export function verifyPassword(password, stored) {
  try {
    const parts = String(stored).split(':');
    if (parts.length !== 2) return false;
    const calc = crypto.scryptSync(String(password), parts[0], 64);
    const orig = Buffer.from(parts[1], 'hex');
    return calc.length === orig.length && crypto.timingSafeEqual(calc, orig);
  } catch {
    return false;
  }
}

export function newToken() {
  return crypto.randomBytes(32).toString('hex');
}

export function createSession(userId) {
  const token = newToken();
  const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
  db.prepare('INSERT INTO sessions (token, user_id, expires_at) VALUES (?, ?, ?)').run(token, userId, expiresAt);
  return token;
}

export const DEFAULT_CATEGORIES = [
  ['expense', '餐饮', '🍜'], ['expense', '交通', '🚌'], ['expense', '购物', '🛍️'],
  ['expense', '居住', '🏠'], ['expense', '娱乐', '🎮'], ['expense', '医疗', '💊'],
  ['expense', '教育', '📚'], ['expense', '人情', '🎁'], ['expense', '其他', '📦'],
  ['income', '工资', '💼'], ['income', '奖金', '🎉'], ['income', '理财', '💰'],
  ['income', '兼职', '🧑‍💻'], ['income', '其他', '📦'],
];

export function seedCategoriesForUser(userId) {
  const stmt = db.prepare('INSERT INTO categories (user_id, name, type, icon, sort) VALUES (?, ?, ?, ?, ?)');
  DEFAULT_CATEGORIES.forEach(function (c, i) {
    stmt.run(userId, c[1], c[0], c[2], i);
  });
}

export function createDefaultLedger(userId, name) {
  const info = db.prepare('INSERT INTO ledgers (user_id, name) VALUES (?, ?)').run(userId, name);
  return Number(info.lastInsertRowid);
}

export function ensureDemoUser() {
  const existing = db.prepare('SELECT id FROM users WHERE username = ?').get('demo');
  if (existing) return;
  const info = db.prepare('INSERT INTO users (username, password_hash, nickname) VALUES (?, ?, ?)')
    .run('demo', hashPassword('demo123'), '演示账号');
  const userId = Number(info.lastInsertRowid);
  seedCategoriesForUser(userId);
  const ledgerId = createDefaultLedger(userId, '演示账本');
  db.prepare('UPDATE users SET current_ledger_id = ? WHERE id = ?').run(ledgerId, userId);
  seedDemoRecords(userId, ledgerId);
  seedDemoBudgets(userId, ledgerId);
}

function seedDemoRecords(userId, ledgerId) {
  const cats = db.prepare('SELECT id, name, type FROM categories WHERE user_id = ?').all(userId);
  const byName = {};
  cats.forEach(function (c) { byName[c.name] = c; });
  const now = new Date();
  const ins = db.prepare(
    'INSERT INTO records (ledger_id, user_id, type, category_id, amount, note, record_date) VALUES (?, ?, ?, ?, ?, ?, ?)'
  );
  // 过去 5 个月 + 本月，每月生成一批示例数据
  for (let m = 5; m >= 0; m--) {
    const d = new Date(now.getFullYear(), now.getMonth() - m, 1);
    const monthStr = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
    const specs = [
      ['餐饮', 22 + Math.floor(Math.random() * 14)],
      ['交通', 10 + Math.floor(Math.random() * 8)],
      ['购物', 3 + Math.floor(Math.random() * 4)],
      ['娱乐', 2 + Math.floor(Math.random() * 3)],
      ['居住', 1],
    ];
    specs.forEach(function (s) {
      const cat = byName[s[0]];
      for (let i = 0; i < s[1]; i++) {
        const day = 1 + Math.floor(Math.random() * 27);
        const dateStr = monthStr + '-' + String(day).padStart(2, '0');
        const amount = s[0] === '居住'
          ? 180000 + Math.floor(Math.random() * 40000)
          : 500 + Math.floor(Math.random() * 950) * 10; // 5 ~ 99.5 元
        ins.run(ledgerId, userId, 'expense', cat.id, amount, '', dateStr);
      }
    });
    ins.run(ledgerId, userId, 'income', byName['工资'].id, 800000, '工资', monthStr + '-10');
    ins.run(ledgerId, userId, 'income', byName['理财'].id, 20000 + Math.floor(Math.random() * 30000), '', monthStr + '-20');
  }
}

function seedDemoBudgets(userId, ledgerId) {
  const now = new Date();
  const monthStr = now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0');
  const cats = db.prepare("SELECT id, name FROM categories WHERE user_id = ? AND type = 'expense'").all(userId);
  db.prepare('INSERT INTO budgets (user_id, ledger_id, month, category_id, amount) VALUES (?, ?, ?, NULL, ?)')
    .run(userId, ledgerId, monthStr, 500000); // 本月总预算 5000 元
  const catBudgets = { '餐饮': 80000, '交通': 30000, '购物': 50000 };
  cats.forEach(function (c) {
    if (catBudgets[c.name]) {
      db.prepare('INSERT INTO budgets (user_id, ledger_id, month, category_id, amount) VALUES (?, ?, ?, ?, ?)')
        .run(userId, ledgerId, monthStr, c.id, catBudgets[c.name]);
    }
  });
}
