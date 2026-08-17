import { Router } from 'express';
import { db } from '../db.js';
import { requireAuth } from '../auth.js';
import { currentMonthStr, yuanToCents } from '../util.js';

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

// 某月预算：总额预算(overall) + 分类预算列表(含已花/剩余)
router.get('/', (req, res) => {
  const ledgerId = resolveLedger(req, res);
  if (!ledgerId) return;
  const month = MONTH_RE.test(req.query.month || '') ? req.query.month : currentMonthStr();

  const totalExpense = db.prepare(`
    SELECT COALESCE(SUM(amount), 0) AS s FROM records
    WHERE ledger_id = ? AND type = 'expense' AND substr(record_date, 1, 7) = ?
  `).get(ledgerId, month).s;

  const rows = db.prepare(`
    SELECT b.id, b.month, b.category_id, b.amount, c.name AS category_name, c.icon AS category_icon
    FROM budgets b LEFT JOIN categories c ON c.id = b.category_id
    WHERE b.user_id = ? AND b.ledger_id = ? AND b.month = ?
    ORDER BY (b.category_id IS NULL) DESC, b.id
  `).all(req.user.id, ledgerId, month);

  let overall = null;
  const items = [];
  rows.forEach(function (r) {
    if (r.category_id === null) {
      overall = { id: r.id, amount: r.amount, spent: totalExpense, remaining: r.amount - totalExpense };
    } else {
      const spent = db.prepare(`
        SELECT COALESCE(SUM(amount), 0) AS s FROM records
        WHERE ledger_id = ? AND category_id = ? AND type = 'expense' AND substr(record_date, 1, 7) = ?
      `).get(ledgerId, r.category_id, month).s;
      items.push({
        id: r.id,
        category_id: r.category_id,
        category_name: r.category_name,
        category_icon: r.category_icon,
        amount: r.amount,
        spent,
        remaining: r.amount - spent,
      });
    }
  });
  res.json({ month, overall, items });
});

// 设置/更新预算（upsert）：overall 传 category_id 为空，分类预算传 category_id
router.put('/', (req, res) => {
  const b = req.body || {};
  const ledgerId = Number(b.ledger_id || null) || null;
  if (!ledgerId) return res.status(400).json({ error: '请先创建账本' });
  const ledger = db.prepare('SELECT id FROM ledgers WHERE id = ? AND user_id = ?').get(ledgerId, req.user.id);
  if (!ledger) return res.status(404).json({ error: '账本不存在' });

  const month = MONTH_RE.test(b.month || '') ? b.month : currentMonthStr();
  const amount = Number(b.amount);
  if (!isFinite(amount) || amount <= 0) return res.status(400).json({ error: '预算金额必须大于 0' });
  const cents = yuanToCents(amount);

  let categoryId = null;
  if (b.category_id) {
    const cat = db.prepare("SELECT id, type FROM categories WHERE id = ? AND user_id = ?").get(Number(b.category_id), req.user.id);
    if (!cat) return res.status(400).json({ error: '分类不存在' });
    if (cat.type !== 'expense') return res.status(400).json({ error: '预算只能针对支出分类' });
    categoryId = cat.id;
  }

  const existing = db.prepare('SELECT id FROM budgets WHERE ledger_id = ? AND month = ? AND category_id IS ?')
    .get(ledgerId, month, categoryId);
  if (existing) {
    db.prepare('UPDATE budgets SET amount = ? WHERE id = ?').run(cents, existing.id);
    return res.json(db.prepare('SELECT * FROM budgets WHERE id = ?').get(existing.id));
  }
  const info = db.prepare('INSERT INTO budgets (user_id, ledger_id, month, category_id, amount) VALUES (?, ?, ?, ?, ?)')
    .run(req.user.id, ledgerId, month, categoryId, cents);
  res.json(db.prepare('SELECT * FROM budgets WHERE id = ?').get(Number(info.lastInsertRowid)));
});

// 删除预算
router.delete('/:id', (req, res) => {
  const id = Number(req.params.id);
  const row = db.prepare('SELECT * FROM budgets WHERE id = ? AND user_id = ?').get(id, req.user.id);
  if (!row) return res.status(404).json({ error: '预算不存在' });
  db.prepare('DELETE FROM budgets WHERE id = ?').run(id);
  res.json({ ok: true });
});

export default router;
