import express from 'express';
import { db } from '../server/db.js';
import { config } from '../server/config.js';
import { rateLimit } from '../server/rate-limit.js';
import sgsRoutes from './routes/sgs.js';

const app = express();
app.use(express.json({ limit: '512kb' }));

// 安全响应头
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('Referrer-Policy', 'no-referrer');
  next();
});

// 全局 API 限流
app.use('/api', rateLimit({ windowMs: 60 * 1000, max: 300, message: '请求过于频繁，请稍后再试' }));

app.use('/api/sgs', sgsRoutes);

// 健康检查
app.get('/api/health', (req, res) => {
  try {
    db.prepare('SELECT 1').get();
    res.json({ ok: true, service: 'sgs-backend', db: 'ok', time: new Date().toISOString() });
  } catch (e) {
    res.status(500).json({ ok: false, service: 'sgs-backend', error: e.message });
  }
});

// 未匹配的 API
app.use('/api', (req, res) => {
  res.status(404).json({ error: '接口不存在: ' + req.method + ' ' + req.path });
});

// 统一错误处理
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: '服务器内部错误' });
});

const port = config.sgsPort;
const server = app.listen(port, () => {
  console.log('三国杀后端已启动: http://localhost:' + port);
});

// 优雅停机
function shutdown(signal) {
  console.log('[shutdown] 收到 ' + signal);
  server.close(() => {
    try { db.close(); } catch (e) {}
    process.exit(0);
  });
  setTimeout(() => { process.exit(1); }, 10000).unref();
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
