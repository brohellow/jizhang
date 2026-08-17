import { Router } from 'express';
import { db } from '../db.js';
import { requireAuth } from '../auth.js';
import { currentMonthStr } from '../util.js';

const router = Router();
router.use(requireAuth);

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
  res.json({
    month,
    income,
    expense,
    net: income - expense,
    budget,
    budget_spent: expense,
    budget_pct: budget ? Math.round((expense / budget) * 1000) / 10 : null,
    record_count: count,
  });
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

export default router;
