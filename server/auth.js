import { db } from './db.js';

// Bearer Token 认证中间件
export function requireAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) {
    return res.status(401).json({ error: '未登录' });
  }
  const row = db.prepare(`
    SELECT s.user_id, s.expires_at, u.username, u.nickname, u.current_ledger_id
    FROM sessions s JOIN users u ON u.id = s.user_id
    WHERE s.token = ?
  `).get(token);
  if (!row) {
    return res.status(401).json({ error: '登录已失效，请重新登录' });
  }
  if (new Date(row.expires_at).getTime() < Date.now()) {
    db.prepare('DELETE FROM sessions WHERE token = ?').run(token);
    return res.status(401).json({ error: '登录已过期，请重新登录' });
  }
  req.user = {
    id: row.user_id,
    username: row.username,
    nickname: row.nickname,
    currentLedgerId: row.current_ledger_id,
  };
  req.token = token;
  next();
}
