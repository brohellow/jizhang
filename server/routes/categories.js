import { Router } from 'express';
import { db } from '../db.js';
import { requireAuth } from '../auth.js';

const router = Router();
router.use(requireAuth);

// ===== 分类列表缓存（5 秒，写操作时清空） =====
const catCache = new Map();
const CAT_CACHE_TTL = 5000;
function catGet(key) { const h = catCache.get(key); if (h && Date.now() - h.t < CAT_CACHE_TTL) return h.data; return null; }
function catSet(key, data) { catCache.set(key, { t: Date.now(), data }); }
function catInvalidate() { catCache.clear(); }
setInterval(function () { const n = Date.now(); for (const [k, v] of catCache) if (n - v.t >= CAT_CACHE_TTL * 2) catCache.delete(k); }, 60000).unref();

function getCategoryOr404(id, userId, res) {
  const cat = db.prepare('SELECT * FROM categories WHERE id = ? AND user_id = ?').get(id, userId);
  if (!cat) {
    res.status(404).json({ error: '分类不存在' });
    return null;
  }
  return cat;
}

// 分类列表，可按类型过滤 ?type=expense|income
router.get('/', (req, res) => {
  const ck = 'cat:' + req.user.id + ':' + (req.query.type || 'all');
  const cached = catGet(ck);
  if (cached) return res.json(cached);
  let rows;
  if (req.query.type === 'income' || req.query.type === 'expense') {
    rows = db.prepare('SELECT * FROM categories WHERE user_id = ? AND type = ? ORDER BY sort, id')
      .all(req.user.id, req.query.type);
  } else {
    rows = db.prepare('SELECT * FROM categories WHERE user_id = ? ORDER BY type, sort, id').all(req.user.id);
  }
  catSet(ck, rows);
  res.json(rows);
});

// 新增分类
router.post('/', (req, res) => {
  catInvalidate();
  const { name, type, icon } = req.body || {};
  const n = (name == null ? '' : String(name)).trim();
  if (!n) return res.status(400).json({ error: '分类名称不能为空' });
  if (type !== 'expense' && type !== 'income') return res.status(400).json({ error: '类型必须是 expense 或 income' });
  try {
    const info = db.prepare('INSERT INTO categories (user_id, name, type, icon, sort) VALUES (?, ?, ?, ?, ?)')
      .run(req.user.id, n, type, icon || '📌', 100);
    res.json(db.prepare('SELECT * FROM categories WHERE id = ?').get(Number(info.lastInsertRowid)));
  } catch (e) {
    if (String(e.message).includes('UNIQUE')) return res.status(409).json({ error: '该分类已存在' });
    throw e;
  }
});

// 重命名 / 编辑分类
router.put('/:id', (req, res) => {
  catInvalidate();
  const cat = getCategoryOr404(Number(req.params.id), req.user.id, res);
  if (!cat) return;
  const { name, icon } = req.body || {};
  const n = (name == null ? cat.name : String(name)).trim();
  if (!n) return res.status(400).json({ error: '分类名称不能为空' });
  try {
    db.prepare('UPDATE categories SET name = ?, icon = ? WHERE id = ?')
      .run(n, icon == null ? cat.icon : String(icon), cat.id);
    res.json(db.prepare('SELECT * FROM categories WHERE id = ?').get(cat.id));
  } catch (e) {
    if (String(e.message).includes('UNIQUE')) return res.status(409).json({ error: '该分类已存在' });
    throw e;
  }
});

// 删除分类（被记录使用中的不允许删除）
router.delete('/:id', (req, res) => {
  catInvalidate();
  const cat = getCategoryOr404(Number(req.params.id), req.user.id, res);
  if (!cat) return;
  const used = db.prepare('SELECT COUNT(*) AS c FROM records WHERE category_id = ? AND user_id = ?')
    .get(cat.id, req.user.id).c;
  if (used > 0) return res.status(400).json({ error: '该分类已被 ' + used + ' 条记录使用，无法删除' });
  db.prepare('DELETE FROM categories WHERE id = ?').run(cat.id);
  res.json({ ok: true });
});

export default router;
