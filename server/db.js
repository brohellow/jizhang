import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
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

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  nickname TEXT NOT NULL DEFAULT '',
  openid TEXT UNIQUE,
  current_ledger_id INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
CREATE TABLE IF NOT EXISTS ledgers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  currency TEXT NOT NULL DEFAULT 'CNY',
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
CREATE TABLE IF NOT EXISTS categories (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('income','expense')),
  icon TEXT NOT NULL DEFAULT '📌',
  sort INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  UNIQUE(user_id, name, type)
);
CREATE TABLE IF NOT EXISTS records (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ledger_id INTEGER NOT NULL REFERENCES ledgers(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type TEXT NOT NULL CHECK (type IN ('income','expense')),
  category_id INTEGER REFERENCES categories(id) ON DELETE SET NULL,
  amount INTEGER NOT NULL CHECK (amount > 0),
  note TEXT NOT NULL DEFAULT '',
  record_date TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
CREATE INDEX IF NOT EXISTS idx_records_lookup ON records(ledger_id, record_date, type);
CREATE INDEX IF NOT EXISTS idx_records_user ON records(user_id, record_date);
CREATE INDEX IF NOT EXISTS idx_records_category ON records(category_id, record_date);
CREATE INDEX IF NOT EXISTS idx_records_type_date ON records(type, record_date);
CREATE INDEX IF NOT EXISTS idx_budgets_month ON budgets(ledger_id, month);
CREATE TABLE IF NOT EXISTS budgets (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  ledger_id INTEGER NOT NULL REFERENCES ledgers(id) ON DELETE CASCADE,
  month TEXT NOT NULL,
  category_id INTEGER REFERENCES categories(id) ON DELETE CASCADE,
  amount INTEGER NOT NULL CHECK (amount > 0),
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  UNIQUE(ledger_id, month, category_id)
);
CREATE TABLE IF NOT EXISTS work_records (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  work_date TEXT NOT NULL,
  start_time TEXT NOT NULL,
  end_time TEXT NOT NULL,
  content TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
CREATE INDEX IF NOT EXISTS idx_work_records_user ON work_records(user_id, work_date);
CREATE TABLE IF NOT EXISTS salary_config (
  user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  mode TEXT NOT NULL DEFAULT 'hourly' CHECK (mode IN ('hourly','daily')),
  hourly_rate INTEGER NOT NULL DEFAULT 3000,
  daily_rate INTEGER NOT NULL DEFAULT 25000,
  updated_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  expires_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
`);

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
  const catBudgets = { 餐饮: 80000, 交通: 30000, 购物: 50000 };
  cats.forEach(function (c) {
    if (catBudgets[c.name]) {
      db.prepare('INSERT INTO budgets (user_id, ledger_id, month, category_id, amount) VALUES (?, ?, ?, ?, ?)')
        .run(userId, ledgerId, monthStr, c.id, catBudgets[c.name]);
    }
  });
}
