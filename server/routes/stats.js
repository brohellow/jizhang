import { Router } from 'express';
import { db } from '../db.js';
import { requireAuth } from '../auth.js';
import { currentMonthStr } from '../util.js';

const router = Router();
router.use(requireAuth);

// ===== 简单内存缓存（统计接口 5 秒，写操作时清空） =====
const statsCache = new Map(); // key -> { t, data }
const CACHE_TTL = 5000;
function cacheGet(key) {
  const hit = statsCache.get(key);
  if (hit && Date.now() - hit.t < CACHE_TTL) return hit.data;
  return null;
}
function cacheSet(key, data) {
  statsCache.set(key, { t: Date.now(), data });
}
function cacheInvalidate() {
  statsCache.clear();
}
export { cacheInvalidate };

const MONTH_RE = /^\d{4}-\d{2}$/;

function resolveLedger(req, res) {
  const ledgerId = req.query.ledger_id ? Number(req.query.ledger_id) : req.user.currentLedgerId;
  if (!ledgerId) {
    res.status(400).json({ error: '请先创建账本' });
    return null;
  }
  const ledger = db.prepare('SELECT id FROM ledgers WHERE id = ? AND user_id = ?').get(ledgerId, req.user.id);
  if (!ledger) {
    res.status(404).json({ error: '账本不存在' });
    return null;
  }
  return ledgerId;
}

function monthParam(req) {
  return MONTH_RE.test(req.query.month || '') ? req.query.month : currentMonthStr();
}

// 月度汇总：收入 / 支出 / 结余 / 预算
router.get('/summary', (req, res) => {
  const ledgerId = resolveLedger(req, res);
  if (!ledgerId) return;
  const month = monthParam(req);
  const ck = 'summary:' + ledgerId + ':' + month;
  const cached = cacheGet(ck);
  if (cached) return res.json(cached);
  const agg = db.prepare(`
    SELECT type, COALESCE(SUM(amount), 0) AS s, COUNT(*) AS c
    FROM records WHERE ledger_id = ? AND substr(record_date, 1, 7) = ? GROUP BY type
  `).all(ledgerId, month);
  let income = 0, expense = 0, count = 0;
  agg.forEach(function (r) {
    if (r.type === 'income') income = r.s; else expense = r.s;
    count += r.c;
  });
  const budgetRow = db.prepare('SELECT amount FROM budgets WHERE ledger_id = ? AND month = ? AND category_id IS NULL')
    .get(ledgerId, month);
  const budget = budgetRow ? budgetRow.amount : null;
  const out = {
    month,
    income,
    expense,
    net: income - expense,
    budget,
    budget_spent: expense,
    budget_pct: budget ? Math.round((expense / budget) * 1000) / 10 : null,
    record_count: count,
  };
  cacheSet(ck, out);
  res.json(out);
});

// 近 N 个月收支趋势（默认 12 个月）
router.get('/monthly', (req, res) => {
  const ledgerId = resolveLedger(req, res);
  if (!ledgerId) return;
  const months = parseInt(req.query.months, 10) || 12;
  const now = new Date();
  const agg = {};
  db.prepare(`
    SELECT substr(record_date, 1, 7) AS m, type, SUM(amount) AS s
    FROM records WHERE ledger_id = ? GROUP BY m, type
  `).all(ledgerId).forEach(function (r) {
    if (!agg[r.m]) agg[r.m] = { income: 0, expense: 0 };
    if (r.type === 'income') agg[r.m].income = r.s; else agg[r.m].expense = r.s;
  });
  const list = [];
  for (let i = months - 1; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const key = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
    const a = agg[key] || { income: 0, expense: 0 };
    list.push({ month: key, income: a.income, expense: a.expense, net: a.income - a.expense });
  }
  res.json(list);
});

// 某月分类占比
router.get('/by-category', (req, res) => {
  const ledgerId = resolveLedger(req, res);
  if (!ledgerId) return;
  const month = monthParam(req);
  const type = req.query.type === 'income' ? 'income' : 'expense';
  const rows = db.prepare(`
    SELECT c.id AS category_id, c.name AS category_name, c.icon AS category_icon, SUM(r.amount) AS amount
    FROM records r LEFT JOIN categories c ON c.id = r.category_id
    WHERE r.ledger_id = ? AND r.type = ? AND substr(r.record_date, 1, 7) = ?
    GROUP BY r.category_id ORDER BY amount DESC
  `).all(ledgerId, type, month);
  const total = rows.reduce(function (s, r) { return s + r.amount; }, 0);
  res.json(rows.map(function (r) {
    return {
      category_id: r.category_id,
      category_name: r.category_name,
      category_icon: r.category_icon,
      amount: r.amount,
      pct: total > 0 ? Math.round((r.amount / total) * 1000) / 10 : 0,
    };
  }));
});

// 某月每日收支
router.get('/daily', (req, res) => {
  const ledgerId = resolveLedger(req, res);
  if (!ledgerId) return;
  const month = monthParam(req);
  const y = Number(month.slice(0, 4));
  const m = Number(month.slice(5, 7));
  const days = new Date(y, m, 0).getDate();
  const agg = {};
  db.prepare(`
    SELECT record_date, type, SUM(amount) AS s
    FROM records WHERE ledger_id = ? AND substr(record_date, 1, 7) = ?
    GROUP BY record_date, type
  `).all(ledgerId, month).forEach(function (r) {
    if (!agg[r.record_date]) agg[r.record_date] = { income: 0, expense: 0 };
    if (r.type === 'income') agg[r.record_date].income = r.s; else agg[r.record_date].expense = r.s;
  });
  const list = [];
  for (let d = 1; d <= days; d++) {
    const key = month + '-' + String(d).padStart(2, '0');
    const a = agg[key] || { income: 0, expense: 0 };
    list.push({ day: key, income: a.income, expense: a.expense });
  }
  res.json(list);
});

// ============ 玩法扩展：月度账单故事数据（供 AI 生成账单信） ============
router.get('/story-data', (req, res) => {
  const ledgerId = resolveLedger(req, res);
  if (!ledgerId) return;
  const month = monthParam(req);
  const y = Number(month.slice(0, 4));
  const m = Number(month.slice(5, 7));
  const daysInMonth = new Date(y, m, 0).getDate();

  const agg = db.prepare('SELECT type, COALESCE(SUM(amount),0) s, COUNT(*) c FROM records WHERE ledger_id = ? AND substr(record_date,1,7) = ? GROUP BY type')
    .all(ledgerId, month);
  let income = 0, expense = 0, count = 0;
  agg.forEach(r2 => { if (r2.type === 'income') income = r2.s; else expense = r2.s; count += r2.c; });

  const catRows = db.prepare(`
    SELECT COALESCE(c.name, '其他') name, COALESCE(c.icon,'📦') icon, SUM(r.amount) amount, COUNT(*) c
    FROM records r LEFT JOIN categories c ON c.id = r.category_id
    WHERE r.ledger_id = ? AND r.type = 'expense' AND substr(r.record_date,1,7) = ?
    GROUP BY r.category_id ORDER BY amount DESC LIMIT 6
  `).all(ledgerId, month);

  const daily = db.prepare(`
    SELECT record_date, SUM(amount) s FROM records
    WHERE ledger_id = ? AND type = 'expense' AND substr(record_date,1,7) = ?
    GROUP BY record_date ORDER BY s DESC LIMIT 1
  `).get(ledgerId, month);

  const most = db.prepare(`
    SELECT r.record_date, r.amount, r.note, COALESCE(c.name,'其他') cname, COALESCE(c.icon,'📦') icon
    FROM records r LEFT JOIN categories c ON c.id = r.category_id
    WHERE r.ledger_id = ? AND r.type = 'expense' AND substr(r.record_date,1,7) = ?
    ORDER BY r.amount DESC LIMIT 1
  `).get(ledgerId, month);

  const avgDaily = daysInMonth > 0 ? Math.round(expense / daysInMonth) : 0;
  const spendDays = db.prepare('SELECT COUNT(DISTINCT record_date) c FROM records WHERE ledger_id = ? AND type = ? AND substr(record_date,1,7) = ?')
    .get(ledgerId, 'expense', month).c;

  res.json({
    month,
    income, expense, record_count: count,
    avg_daily_expense: avgDaily,
    spend_days: spendDays,
    total_days: daysInMonth,
    top_categories: catRows.map(r3 => ({ name: r3.name, icon: r3.icon, amount: r3.amount, count: r3.c })),
    peak_day: daily ? { date: daily.record_date, amount: daily.s } : null,
    most_expense: most ? { date: most.record_date, amount: most.amount, note: most.note, category: most.cname, icon: most.icon } : null,
  });
});

// ============ 玩法扩展：周报盲盒数据 ============
router.get('/weekly-review', (req, res) => {
  const ledgerId = resolveLedger(req, res);
  if (!ledgerId) return;
  const now = new Date();
  const day = now.getDay() || 7;
  const monday = new Date(now); monday.setDate(now.getDate() - day + 1);
  const sunday = new Date(monday); sunday.setDate(monday.getDate() + 6);
  function ds(d) { return d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2,'0') + '-' + String(d.getDate()).padStart(2,'0'); }
  const from = ds(monday), to = ds(sunday);

  const totalRow = db.prepare('SELECT COALESCE(SUM(amount),0) s FROM records WHERE ledger_id = ? AND type = ? AND record_date >= ? AND record_date <= ?')
    .get(ledgerId, 'expense', from, to);
  const most = db.prepare(`
    SELECT r.record_date, r.amount, r.note, COALESCE(c.name,'其他') cname, COALESCE(c.icon,'📦') icon
    FROM records r LEFT JOIN categories c ON c.id = r.category_id
    WHERE r.ledger_id = ? AND r.type = 'expense' AND r.record_date >= ? AND r.record_date <= ?
    ORDER BY r.amount DESC LIMIT 1
  `).get(ledgerId, from, to);
  const cheapest = db.prepare(`
    SELECT r.record_date, r.amount, r.note, COALESCE(c.name,'其他') cname
    FROM records r LEFT JOIN categories c ON c.id = r.category_id
    WHERE r.ledger_id = ? AND r.type = 'expense' AND r.amount > 0 AND r.record_date >= ? AND r.record_date <= ?
    ORDER BY r.amount ASC LIMIT 1
  `).get(ledgerId, from, to);
  const peak = db.prepare(`
    SELECT record_date, SUM(amount) s FROM records
    WHERE ledger_id = ? AND type = 'expense' AND record_date >= ? AND record_date <= ?
    GROUP BY record_date ORDER BY s DESC LIMIT 1
  `).get(ledgerId, from, to);
  const topCat = db.prepare(`
    SELECT COALESCE(c.name,'其他') name, COALESCE(c.icon,'📦') icon, COUNT(*) c, SUM(r.amount) amount
    FROM records r LEFT JOIN categories c ON c.id = r.category_id
    WHERE r.ledger_id = ? AND r.type = 'expense' AND r.record_date >= ? AND r.record_date <= ?
    GROUP BY r.category_id ORDER BY c DESC LIMIT 1
  `).get(ledgerId, from, to);
  const cnt = db.prepare('SELECT COUNT(*) c FROM records WHERE ledger_id = ? AND type = ? AND record_date >= ? AND record_date <= ?')
    .get(ledgerId, 'expense', from, to).c;

  res.json({
    week: from + '~' + to,
    total_expense: totalRow.s,
    record_count: cnt,
    most: most ? { date: most.record_date, amount: most.amount, note: most.note, category: most.cname, icon: most.icon } : null,
    cheapest: cheapest ? { date: cheapest.record_date, amount: cheapest.amount, note: cheapest.note, category: cheapest.cname } : null,
    peak_day: peak ? { date: peak.record_date, amount: peak.s } : null,
    top_category: topCat ? { name: topCat.name, icon: topCat.icon, count: topCat.c, amount: topCat.amount } : null,
  });
});

export default router;
