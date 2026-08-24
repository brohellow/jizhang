import { Router } from 'express';
import { db } from '../db.js';
import { requireAuth } from '../auth.js';
import { todayStr, yuanToCents } from '../util.js';

const router = Router();
router.use(requireAuth);

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function checkLedger(ledgerId, userId, res) {
  const ledger = db.prepare('SELECT id FROM ledgers WHERE id = ? AND user_id = ?').get(ledgerId, userId);
  if (!ledger) {
    res.status(404).json({ error: '账本不存在' });
    return false;
  }
  return true;
}

// 校验并规范化一笔记录，返回 { cents, categoryId, date, type, note, ledgerId } 或 null(已响应错误)
function validateRecord(b, userId, res) {
  const ledgerId = Number(b.ledger_id || null) || null;
  if (!ledgerId) {
    res.status(400).json({ error: '请先创建账本' });
    return null;
  }
  if (!checkLedger(ledgerId, userId, res)) return null;
  const type = b.type;
  if (type !== 'expense' && type !== 'income') {
    res.status(400).json({ error: '类型必须是 expense 或 income' });
    return null;
  }
  const amount = Number(b.amount);
  if (!isFinite(amount) || amount <= 0) {
    res.status(400).json({ error: '金额必须大于 0' });
    return null;
  }
  const date = DATE_RE.test(b.record_date || '') ? b.record_date : todayStr();
  let categoryId = null;
  if (b.category_id) {
    const cat = db.prepare('SELECT id, type FROM categories WHERE id = ? AND user_id = ?').get(Number(b.category_id), userId);
    if (!cat) {
      res.status(400).json({ error: '分类不存在' });
      return null;
    }
    if (cat.type !== type) {
      res.status(400).json({ error: '分类类型与记录类型不一致' });
      return null;
    }
    categoryId = cat.id;
  }
  return { ledgerId, type, cents: yuanToCents(amount), categoryId, date, note: String(b.note || '').trim() };
}

function rowWithCategory(id) {
  return db.prepare(`
    SELECT r.*, c.name AS category_name, c.icon AS category_icon
    FROM records r LEFT JOIN categories c ON c.id = r.category_id
    WHERE r.id = ?
  `).get(id);
}

// CSV 导出（与列表相同的筛选条件，导出全部匹配记录）
router.get('/export', (req, res) => {
  const ledgerId = req.query.ledger_id ? Number(req.query.ledger_id) : req.user.currentLedgerId;
  if (!ledgerId) return res.status(400).json({ error: '请先创建账本' });
  if (!checkLedger(ledgerId, req.user.id, res)) return;

  const where = ['r.ledger_id = ?'];
  const params = [ledgerId];
  if (req.query.type === 'expense' || req.query.type === 'income') {
    where.push('r.type = ?');
    params.push(req.query.type);
  }
  if (req.query.category_id) {
    where.push('r.category_id = ?');
    params.push(Number(req.query.category_id));
  }
  if (req.query.from) {
    where.push('r.record_date >= ?');
    params.push(req.query.from);
  }
  if (req.query.to) {
    where.push('r.record_date <= ?');
    params.push(req.query.to);
  }
  if (req.query.keyword) {
    var kw = String(req.query.keyword).replace(/[%_\\]/g, function (m) { return '\\' + m; });
    where.push("r.note LIKE ? ESCAPE '\\'");
    params.push('%' + kw + '%');
  }
  const whereSql = 'WHERE ' + where.join(' AND ');
  const rows = db.prepare(`
    SELECT r.record_date, r.type, r.amount, r.note, c.name AS category_name, l.name AS ledger_name
    FROM records r
    LEFT JOIN categories c ON c.id = r.category_id
    LEFT JOIN ledgers l ON l.id = r.ledger_id
    ` + whereSql + ' ORDER BY r.record_date ASC, r.id ASC LIMIT 50000')
    .all(...params);

  const esc = (v) => {
    const s = String(v == null ? '' : v);
    return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  };
  const lines = ['\uFEFF日期,类型,金额(元),分类,备注,账本'];
  rows.forEach((r) => {
    lines.push([
      esc(r.record_date),
      esc(r.type === 'expense' ? '支出' : '收入'),
      (r.amount / 100).toFixed(2),
      esc(r.category_name || ''),
      esc(r.note || ''),
      esc(r.ledger_name || ''),
    ].join(','));
  });
  const stamp = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="jizhang-' + stamp + '.csv"');
  res.send(lines.join('\n'));
});

// 记录列表（分页 + 多条件筛选）
router.get('/', (req, res) => {
  const ledgerId = req.query.ledger_id ? Number(req.query.ledger_id) : req.user.currentLedgerId;
  if (!ledgerId) return res.json({ total: 0, page: 1, pageSize: 20, items: [] });
  if (!checkLedger(ledgerId, req.user.id, res)) return;

  const where = ['r.ledger_id = ?'];
  const params = [ledgerId];
  if (req.query.type === 'expense' || req.query.type === 'income') {
    where.push('r.type = ?');
    params.push(req.query.type);
  }
  if (req.query.category_id) {
    where.push('r.category_id = ?');
    params.push(Number(req.query.category_id));
  }
  if (req.query.from) {
    where.push('r.record_date >= ?');
    params.push(req.query.from);
  }
  if (req.query.to) {
    where.push('r.record_date <= ?');
    params.push(req.query.to);
  }
  if (req.query.keyword) {
    var kw = String(req.query.keyword).replace(/[%_\\]/g, function (m) { return '\\' + m; });
    where.push("r.note LIKE ? ESCAPE '\\'");
    params.push('%' + kw + '%');
  }
  const whereSql = 'WHERE ' + where.join(' AND ');
  const total = db.prepare('SELECT COUNT(*) AS c FROM records r ' + whereSql).get(...params).c;
  const page = Math.max(1, parseInt(req.query.page, 10) || 1);
  const pageSize = Math.min(100, Math.max(1, parseInt(req.query.pageSize, 10) || 20));
  const items = db.prepare(`
    SELECT r.*, c.name AS category_name, c.icon AS category_icon
    FROM records r LEFT JOIN categories c ON c.id = r.category_id
    ` + whereSql + ' ORDER BY r.record_date DESC, r.id DESC LIMIT ? OFFSET ?')
    .all(...params, pageSize, (page - 1) * pageSize);
  res.json({ total, page, pageSize, items });
});

// 新增记录
router.post('/', (req, res) => {
  const v = validateRecord(req.body || {}, req.user.id, res);
  if (!v) return;
  const info = db.prepare(`
    INSERT INTO records (ledger_id, user_id, type, category_id, amount, note, record_date)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(v.ledgerId, req.user.id, v.type, v.categoryId, v.cents, v.note, v.date);
  res.json(rowWithCategory(Number(info.lastInsertRowid)));
});

// 编辑记录
router.put('/:id', (req, res) => {
  const id = Number(req.params.id);
  const old = db.prepare('SELECT * FROM records WHERE id = ? AND user_id = ?').get(id, req.user.id);
  if (!old) return res.status(404).json({ error: '记录不存在' });
  const v = validateRecord(req.body || {}, req.user.id, res);
  if (!v) return;
  db.prepare(`
    UPDATE records SET ledger_id = ?, type = ?, category_id = ?, amount = ?, note = ?, record_date = ?
    WHERE id = ?
  `).run(v.ledgerId, v.type, v.categoryId, v.cents, v.note, v.date, id);
  res.json(rowWithCategory(id));
});

// 删除记录
router.delete('/:id', (req, res) => {
  const id = Number(req.params.id);
  const old = db.prepare('SELECT * FROM records WHERE id = ? AND user_id = ?').get(id, req.user.id);
  if (!old) return res.status(404).json({ error: '记录不存在' });
  db.prepare('DELETE FROM records WHERE id = ?').run(id);
  res.json({ ok: true });
});

export default router;
