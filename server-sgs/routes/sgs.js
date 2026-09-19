import { Router } from 'express';
import { requireAuth } from '../../server/auth.js';
import { config } from '../../server/config.js';

const router = Router();

const SGS_API = config.sgsApi;

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

router.get('/rooms', requireAuth, async (req, res) => {
  const r = await sgsFetch('/rooms');
  if (r.status !== 200 || !r.data) {
    return res.status(502).json({ error: '游戏服务器未启动或不可达' });
  }
  res.json(r.data);
});

router.post('/rooms', requireAuth, async (req, res) => {
  const mode = (req.body && req.body.mode) || 'identity';
  const nickname = req.user.nickname || req.user.username;
  const r = await sgsFetch('/rooms', { method: 'POST', body: { nickname, mode } });
  if (r.status !== 200 || !r.data || !r.data.ok) {
    return res.status(502).json({ error: '游戏服务器未启动或创建失败' });
  }
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

router.get('/rooms/:code', requireAuth, async (req, res) => {
  const r = await sgsFetch('/rooms/' + encodeURIComponent(req.params.code));
  if (r.status !== 200 || !r.data) {
    return res.status(404).json({ error: '房间不存在' });
  }
  res.json(r.data);
});

router.delete('/rooms/:code', requireAuth, async (req, res) => {
  const r = await sgsFetch('/rooms/' + encodeURIComponent(req.params.code), { method: 'DELETE' });
  res.json(r.data || { ok: false });
});

export default router;
