import { Router } from 'express';
import { db, hashPassword, verifyPassword, createSession, seedCategoriesForUser, createDefaultLedger } from '../db.js';
import { requireAuth } from '../auth.js';

const router = Router();

function publicUser(u) {
  return { id: u.id, username: u.username, nickname: u.nickname, current_ledger_id: u.current_ledger_id };
}

function buildUserPayload(userId) {
  const u = db.prepare('SELECT * FROM users WHERE id = ?').get(userId);
  return publicUser(u);
}

// 注册
router.post('/register', (req, res) => {
  const { username, password, nickname } = req.body || {};
  if (!username || !password) return res.status(400).json({ error: '用户名和密码不能为空' });
  if (!/^[\w\u4e00-\u9fa5]{2,32}$/.test(username)) {
    return res.status(400).json({ error: '用户名需为 2-32 位字母、数字、下划线或中文' });
  }
  if (password.length < 6) return res.status(400).json({ error: '密码至少 6 位' });
  const exists = db.prepare('SELECT id FROM users WHERE username = ?').get(username);
  if (exists) return res.status(409).json({ error: '用户名已存在' });

  const info = db.prepare('INSERT INTO users (username, password_hash, nickname) VALUES (?, ?, ?)')
    .run(username, hashPassword(password), nickname || username);
  const userId = Number(info.lastInsertRowid);
  seedCategoriesForUser(userId);
  const ledgerId = createDefaultLedger(userId, '我的账本');
  db.prepare('UPDATE users SET current_ledger_id = ? WHERE id = ?').run(ledgerId, userId);
  const token = createSession(userId);
  res.json({ token, user: buildUserPayload(userId) });
});

// 登录
router.post('/login', (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password) return res.status(400).json({ error: '用户名和密码不能为空' });
  const u = db.prepare('SELECT * FROM users WHERE username = ?').get(username);
  if (!u || !verifyPassword(password, u.password_hash)) {
    return res.status(401).json({ error: '用户名或密码错误' });
  }
  const token = createSession(u.id);
  res.json({ token, user: publicUser(u) });
});

// 当前用户信息 + 账本列表
router.get('/me', requireAuth, (req, res) => {
  const ledgers = db.prepare('SELECT * FROM ledgers WHERE user_id = ? ORDER BY id').all(req.user.id);
  res.json({ user: { id: req.user.id, username: req.user.username, nickname: req.user.nickname, current_ledger_id: req.user.currentLedgerId }, ledgers });
});

// 退出登录
router.post('/logout', requireAuth, (req, res) => {
  db.prepare('DELETE FROM sessions WHERE token = ?').run(req.token);
  res.json({ ok: true });
});

// 微信小程序登录：wx.login 的 code -> openid（服务端需配置 WX_APPID / WX_SECRET 环境变量）
router.post('/wx-login', async (req, res) => {
  try {
    const { code } = req.body || {};
    if (!code) return res.status(400).json({ error: '缺少 code' });
    const appid = process.env.WX_APPID;
    const secret = process.env.WX_SECRET;
    if (!appid || !secret) {
      return res.status(503).json({ error: '服务端未配置 WX_APPID / WX_SECRET，无法微信登录' });
    }
    const url = 'https://api.weixin.qq.com/sns/jscode2session?appid=' + appid +
      '&secret=' + secret + '&js_code=' + encodeURIComponent(code) + '&grant_type=authorization_code';
    const resp = await fetch(url);
    const data = await resp.json();
    if (data.errcode) return res.status(400).json({ error: '微信登录失败: ' + (data.errmsg || data.errcode) });
    const openid = data.openid;
    let user = db.prepare('SELECT * FROM users WHERE openid = ?').get(openid);
    let isNew = false;
    if (!user) {
      // 首次微信登录：自动创建账号
      const username = 'wx_' + openid.slice(-10);
      const info = db.prepare('INSERT INTO users (username, password_hash, nickname, openid) VALUES (?, ?, ?, ?)')
        .run(username, hashPassword(newToken()), '微信用户', openid);
      const userId = Number(info.lastInsertRowid);
      seedCategoriesForUser(userId);
      const ledgerId = createDefaultLedger(userId, '我的账本');
      db.prepare('UPDATE users SET current_ledger_id = ? WHERE id = ?').run(ledgerId, userId);
      user = db.prepare('SELECT * FROM users WHERE id = ?').get(userId);
      isNew = true;
    }
    const token = createSession(user.id);
    res.json({ token, user: publicUser(user), is_new: isNew });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: '微信登录失败' });
  }
});

export default router;
