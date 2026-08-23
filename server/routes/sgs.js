import { Router } from 'express';
import { requireAuth } from '../auth.js';

const router = Router();

// 游戏服务器地址（琉璃杀 server.js 的 HTTP API）
// 可用环境变量 SGS_API 覆盖；默认本机 8085（与游戏服务器同机部署）
const SGS_API = process.env.SGS_API || 'http://127.0.0.1:8085';

// 代理到游戏服务器的辅助函数
async function sgsFetch(pathname, opts) {
  opts = opts || {};
  const resp = await fetch(SGS_API + pathname, {
    method: opts.method || 'GET',
    headers: { 'Content-Type': 'application/json' },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
    signal: AbortSignal.timeout(5000),
  });
  let data = null;
  try { data = await resp.json(); } catch (e) { data = null; }
  return { status: resp.status, data };
}

// 房间列表（需登录；显示昵称=网站用户名）
router.get('/rooms', requireAuth, async (req, res) => {
  const r = await sgsFetch('/rooms');
  if (r.status !== 200 || !r.data) {
    return res.status(502).json({ error: '游戏服务器未启动或不可达' });
  }
  res.json(r.data);
});

// 创建房间（需登录；用网站用户名作为房主昵称）
router.post('/rooms', requireAuth, async (req, res) => {
  const mode = (req.body && req.body.mode) || 'identity';
  const nickname = req.user.nickname || req.user.username;
  const r = await sgsFetch('/rooms', { method: 'POST', body: { nickname, mode } });
  if (r.status !== 200 || !r.data || !r.data.ok) {
    return res.status(502).json({ error: '游戏服务器未启动或创建失败' });
  }
  // 返回：房间号 + 一键连接串（游戏内直接粘贴）
  const roomcode = r.data.roomcode;
  const connectStr = '124.222.195.163:8080 ' + (req.user.username || '') + '@' + roomcode;
  res.json({
    ok: true,
    roomcode,
    mode,
    nickname,
    connect_str: connectStr,
    host: '124.222.195.163:8080',
    tip: '在游戏「联机」界面粘贴下面整行，即可用网站账号进入该房间',
  });
});

// 房间详情
router.get('/rooms/:code', requireAuth, async (req, res) => {
  const r = await sgsFetch('/rooms/' + encodeURIComponent(req.params.code));
  if (r.status !== 200 || !r.data) {
    return res.status(404).json({ error: '房间不存在' });
  }
  res.json(r.data);
});

// 取消房间（房主取消）
router.delete('/rooms/:code', requireAuth, async (req, res) => {
  const r = await sgsFetch('/rooms/' + encodeURIComponent(req.params.code), { method: 'DELETE' });
  res.json(r.data || { ok: false });
});

export default router;
