import { Router } from 'express';
import { db } from '../db.js';
import { requireAuth } from '../auth.js';

const router = Router();
router.use(requireAuth);

function getLedgerOr404(id, userId, res) {
  const ledger = db.prepare('SELECT * FROM ledgers WHERE id = ? AND user_id = ?').get(id, userId);
  if (!ledger) {
    res.status(404).json({ error: '账本不存在' });
    return null;
  }
  return ledger;
}

// 账本列表（含记录数）
router.get('/', (req, res) => {
  const ledgers = db.prepare(`
    SELECT l.*, (SELECT COUNT(*) FROM records r WHERE r.ledger_id = l.id) AS record_count
    FROM ledgers l WHERE l.user_id = ? ORDER BY l.id
  `).all(req.user.id);
  res.json(ledgers);
});

// 新建账本
router.post('/', (req, res) => {
  const name = (req.body && req.body.name != null ? String(req.body.name) : '').trim();
  if (!name) return res.status(400).json({ error: '账本名称不能为空' });
  const info = db.prepare('INSERT INTO ledgers (user_id, name, description, currency) VALUES (?, ?, ?, ?)')
    .run(req.user.id, name, req.body.description || '', req.body.currency || 'CNY');
  const ledger = db.prepare('SELECT * FROM ledgers WHERE id = ?').get(Number(info.lastInsertRowid));
  res.json(ledger);
});

// 重命名 / 编辑账本
router.put('/:id', (req, res) => {
  const ledger = getLedgerOr404(Number(req.params.id), req.user.id, res);
  if (!ledger) return;
  const name = (req.body && req.body.name != null ? String(req.body.name) : '').trim();
  if (!name) return res.status(400).json({ error: '账本名称不能为空' });
  db.prepare('UPDATE ledgers SET name = ?, description = ?, currency = ? WHERE id = ?')
    .run(name, req.body.description || '', req.body.currency || ledger.currency, ledger.id);
  res.json(db.prepare('SELECT * FROM ledgers WHERE id = ?').get(ledger.id));
});

// 删除账本（至少保留一个；级联删除其记录与预算）
router.delete('/:id', (req, res) => {
  const ledger = getLedgerOr404(Number(req.params.id), req.user.id, res);
  if (!ledger) return;
  const count = db.prepare('SELECT COUNT(*) AS c FROM ledgers WHERE user_id = ?').get(req.user.id).c;
  if (count <= 1) return res.status(400).json({ error: '至少保留一个账本' });
  db.prepare('DELETE FROM ledgers WHERE id = ?').run(ledger.id);
  const cur = db.prepare('SELECT current_ledger_id FROM users WHERE id = ?').get(req.user.id).current_ledger_id;
  if (cur === ledger.id) {
    const first = db.prepare('SELECT id FROM ledgers WHERE user_id = ? ORDER BY id LIMIT 1').get(req.user.id);
    db.prepare('UPDATE users SET current_ledger_id = ? WHERE id = ?').run(first.id, req.user.id);
  }
  res.json({ ok: true });
});

// 切换当前账本
router.post('/:id/activate', (req, res) => {
  const ledger = getLedgerOr404(Number(req.params.id), req.user.id, res);
  if (!ledger) return;
  db.prepare('UPDATE users SET current_ledger_id = ? WHERE id = ?').run(ledger.id, req.user.id);
  res.json({ ok: true });
});

export default router;
