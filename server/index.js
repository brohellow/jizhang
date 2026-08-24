import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ensureDemoUser } from './db.js';
import { rateLimit, loginThrottle } from './rate-limit.js';
import authRoutes from './routes/auth.js';
import ledgerRoutes from './routes/ledgers.js';
import categoryRoutes from './routes/categories.js';
import recordRoutes from './routes/records.js';
import budgetRoutes from './routes/budgets.js';
import statsRoutes from './routes/stats.js';
import aiRoutes from './routes/ai.js';
import sgsRoutes from './routes/sgs.js';
import tokenStatsRoutes from './routes/token-stats.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();

app.use(express.json());

// ===== 安全响应头 =====
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('X-XSS-Protection', '1; mode=block');
  next();
});

// ===== 安全限流（防恶意注册 / 暴力破解 / 刷接口） =====
// 注册：每 IP 每小时最多 10 次
app.use('/api/auth/register', rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 10,
  message: '注册过于频繁，请 1 小时后再试',
}));
// 登录：每 IP 每 15 分钟最多 30 次 + 账号级失败锁定（错 5 次锁 15 分钟）
app.use('/api/auth/login', loginThrottle());
app.use('/api/auth/login', rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 30,
  message: '登录尝试过于频繁，请 15 分钟后再试',
}));
// 发短信/其他敏感接口预留（暂无）
// 全局 API：每 IP 每分钟 300 次（宽松，防刷爆）
app.use('/api', rateLimit({
  windowMs: 60 * 1000,
  max: 300,
  message: '请求过于频繁，请稍后再试',
}));

app.use('/api/auth', authRoutes);
app.use('/api/ledgers', ledgerRoutes);
app.use('/api/categories', categoryRoutes);
app.use('/api/records', recordRoutes);
app.use('/api/budgets', budgetRoutes);
app.use('/api/stats', statsRoutes);
app.use('/api/ai', aiRoutes);
app.use('/api/sgs', sgsRoutes);
app.use('/api', tokenStatsRoutes);

// 静态前端
app.use(express.static(path.join(__dirname, '..', 'public')));

// 未匹配的 API 路径
app.use('/api', (req, res) => {
  res.status(404).json({ error: '接口不存在: ' + req.method + ' ' + req.path });
});

// 统一错误处理
app.use((err, req, res, next) => {
  if (err && err.type === 'entity.parse.failed') {
    return res.status(400).json({ error: '请求体不是合法 JSON' });
  }
  console.error(err);
  res.status(500).json({ error: '服务器内部错误' });
});

// 首次启动时创建演示账号（demo / demo123）
ensureDemoUser();

const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log('记账服务已启动: http://localhost:' + port);
  console.log('演示账号: demo / demo123');
});
