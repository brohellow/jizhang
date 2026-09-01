import { Router } from 'express';
import { db } from '../db.js';
import { requireAuth } from '../auth.js';

const router = Router();
router.use(requireAuth);

// ============ 工时工资模块 ============

// 计算单条记录的工时（小时，保留2位小数）。支持跨天（晚班至次日凌晨）
function calcHours(start, end) {
  const sh = Number(String(start).split(':')[0]);
  const sm = Number(String(start).split(':')[1]);
  const eh = Number(String(end).split(':')[0]);
  const em = Number(String(end).split(':')[1]);
  let minutes = (eh * 60 + em) - (sh * 60 + sm);
  if (minutes <= 0) minutes += 24 * 60;
  return minutes / 60;
}

// 获取或初始化工资配置
function getConfig(userId) {
  let cfg = db.prepare('SELECT * FROM salary_config WHERE user_id = ?').get(userId);
  if (!cfg) {
    db.prepare('INSERT INTO salary_config (user_id) VALUES (?)').run(userId);
    cfg = db.prepare('SELECT * FROM salary_config WHERE user_id = ?').get(userId);
  }
  return cfg;
}

router.get('/config', (req, res) => {
  const cfg = getConfig(req.user.id);
  res.json({ mode: cfg.mode, hourly_rate: cfg.hourly_rate, daily_rate: cfg.daily_rate });
});

router.put('/config', (req, res) => {
  const b = req.body || {};
  const mode = b.mode === 'daily' ? 'daily' : 'hourly';
  const hourly_rate = Math.max(1, Math.round(Number(b.hourly_rate) || 0));
  const daily_rate = Math.max(1, Math.round(Number(b.daily_rate) || 0));
  db.prepare("UPDATE salary_config SET mode = ?, hourly_rate = ?, daily_rate = ?, updated_at = datetime('now','localtime') WHERE user_id = ?")
    .run(mode, hourly_rate, daily_rate, req.user.id);
  res.json({ ok: true });
});

router.get('/records', (req, res) => {
  const now = new Date();
  const defMonth = now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0');
  const month = /^\d{4}-\d{2}$/.test(req.query.month || '') ? req.query.month : defMonth;
  const cfg = getConfig(req.user.id);
  const rows = db.prepare(
    'SELECT id, work_date, start_time, end_time, content FROM work_records WHERE user_id = ? AND substr(work_date,1,7) = ? ORDER BY work_date DESC, id DESC'
  ).all(req.user.id, month);

  let totalHours = 0;
  let totalSalary = 0;
  const items = rows.map(function (r) {
    const hours = calcHours(r.start_time, r.end_time);
    const salary = cfg.mode === 'daily'
      ? cfg.daily_rate
      : Math.round(cfg.hourly_rate * hours);
    totalHours += hours;
    totalSalary += salary;
    return {
      id: r.id,
      work_date: r.work_date,
      start_time: r.start_time,
      end_time: r.end_time,
      content: r.content,
      hours: Math.round(hours * 100) / 100,
      salary: salary,
    };
  });

  res.json({
    month,
    mode: cfg.mode,
    hourly_rate: cfg.hourly_rate,
    daily_rate: cfg.daily_rate,
    total_hours: Math.round(totalHours * 100) / 100,
    total_salary: totalSalary,
    count: items.length,
    items,
  });
});

router.post('/records', (req, res) => {
  const b = req.body || {};
  const work_date = b.work_date;
  const start_time = b.start_time;
  const end_time = b.end_time;
  const content = String(b.content || '').trim().slice(0, 200);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(work_date || '')) return res.status(400).json({ error: '日期格式不正确' });
  if (!/^\d{1,2}:\d{2}$/.test(start_time || '') || !/^\d{1,2}:\d{2}$/.test(end_time || '')) {
    return res.status(400).json({ error: '时间格式不正确（如 09:00）' });
  }
  db.prepare('INSERT INTO work_records (user_id, work_date, start_time, end_time, content) VALUES (?, ?, ?, ?, ?)')
    .run(req.user.id, work_date, start_time, end_time, content);
  res.json({ ok: true });
});

router.delete('/records/:id', (req, res) => {
  const id = Number(req.params.id);
  const row = db.prepare('SELECT id FROM work_records WHERE id = ? AND user_id = ?').get(id, req.user.id);
  if (!row) return res.status(404).json({ error: '记录不存在' });
  db.prepare('DELETE FROM work_records WHERE id = ?').run(id);
  res.json({ ok: true });
});

export default router;
