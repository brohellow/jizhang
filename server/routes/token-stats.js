import { Router } from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const router = Router();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// 数据存储：data/token-stats.json（data/ 已在 .gitignore，git 不碰）
const DATA_FILE = path.join(__dirname, '..', '..', 'data', 'token-stats.json');
const HISTORY_FILE = path.join(__dirname, '..', '..', 'data', 'token-stats-history.jsonl');

// 同步密钥（与本地小工具约定，防止任何人乱 POST）
const SYNC_KEY = process.env.TOKEN_SYNC_KEY || 'dsh-token-sync-default';

function ensureDataDir() {
  fs.mkdirSync(path.dirname(DATA_FILE), { recursive: true });
}

function readCurrent() {
  try {
    return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
  } catch (e) {
    return null;
  }
}

/**
 * 接收本地小工具的 Token 统计同步
 * 请求头: X-Sync-Key: <密钥>
 * 请求体: { generated_at, total, today, trend, sessions, host }
 */
router.post('/token-sync', (req, res) => {
  const key = req.headers['x-sync-key'] || '';
  if (key !== SYNC_KEY) {
    return res.status(401).json({ ok: false, error: '同步密钥不正确' });
  }
  const data = req.body;
  if (!data || typeof data !== 'object' || !data.total) {
    return res.status(400).json({ ok: false, error: '数据格式不正确' });
  }
  ensureDataDir();
  // 写入当前快照
  const snapshot = {
    synced_at: Date.now(),
    ...data,
    host: data.host || 'unknown',
  };
  fs.writeFileSync(DATA_FILE, JSON.stringify(snapshot, null, 2));
  // 追加历史（只保留近 7 天，按小时去重）
  try {
    const hour = Math.floor(Date.now() / 3600000);
    let rawHistory = '';
    try { rawHistory = fs.readFileSync(HISTORY_FILE, 'utf8'); } catch (e) { rawHistory = ''; }
    const history = rawHistory.split('\n').filter(Boolean)
      .map((l) => { try { return JSON.parse(l); } catch (e) { return null; } })
      .filter((x) => x && x._hour !== undefined && x._hour > hour - 24 * 7);
    history.push({
      _hour: hour,
      _ts: Date.now(),
      total_tokens: data.total.total_tokens,
      cache_tokens: data.total.cache_tokens || 0,
      input_tokens: data.total.input_tokens,
      output_tokens: data.total.output_tokens,
      requests: data.total.requests,
      today_total: data.today ? data.today.total_tokens : 0,
    });
    // 每小时只留最后一个点
    const byHour = new Map();
    history.forEach((h) => byHour.set(h._hour, h));
    fs.writeFileSync(HISTORY_FILE, [...byHour.values()].map((h) => JSON.stringify(h)).join('\n'));
  } catch (e) {}
  res.json({ ok: true, synced_at: snapshot.synced_at });
});

/**
 * 查询最新 Token 统计
 * 公开只读（面板仅展示聚合数据，无敏感内容）
 */
router.get('/token-stats', (req, res) => {
  const current = readCurrent();
  if (!current) {
    return res.status(404).json({ ok: false, error: '暂无数据，等待同步' });
  }
  // 读取历史
  let history = [];
  try {
    history = fs.readFileSync(HISTORY_FILE, 'utf8').split('\n').filter(Boolean)
      .map((l) => { try { return JSON.parse(l); } catch (e) { return null; } })
      .filter(Boolean);
  } catch (e) {}
  res.json({ ok: true, current, history });
});

export default router;
