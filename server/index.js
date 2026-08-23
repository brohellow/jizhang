import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ensureDemoUser } from './db.js';
import authRoutes from './routes/auth.js';
import ledgerRoutes from './routes/ledgers.js';
import categoryRoutes from './routes/categories.js';
import recordRoutes from './routes/records.js';
import budgetRoutes from './routes/budgets.js';
import statsRoutes from './routes/stats.js';
import aiRoutes from './routes/ai.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();

app.use(express.json());

app.use('/api/auth', authRoutes);
app.use('/api/ledgers', ledgerRoutes);
app.use('/api/categories', categoryRoutes);
app.use('/api/records', recordRoutes);
app.use('/api/budgets', budgetRoutes);
app.use('/api/stats', statsRoutes);
app.use('/api/ai', aiRoutes);

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
