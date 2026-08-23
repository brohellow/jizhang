import { Router } from 'express';
import { db } from '../db.js';
import { requireAuth } from '../auth.js';

const router = Router();
router.use(requireAuth);

// AI 配置表（每个用户一份，存自己的供应商与 Key）
db.exec(`
CREATE TABLE IF NOT EXISTS ai_settings (
  user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  provider TEXT NOT NULL DEFAULT 'deepseek',
  base_url TEXT NOT NULL DEFAULT 'https://api.deepseek.com',
  api_key TEXT NOT NULL DEFAULT '',
  model TEXT NOT NULL DEFAULT 'deepseek-chat',
  enabled INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
`);

const PROVIDER_PRESETS = {
  deepseek: { base_url: 'https://api.deepseek.com', model: 'deepseek-chat' },
  openai: { base_url: 'https://api.openai.com/v1', model: 'gpt-4o-mini' },
  custom: { base_url: '', model: '' },
};

function maskKey(key) {
  if (!key) return '';
  if (key.length <= 8) return '****';
  return key.slice(0, 4) + '****' + key.slice(-4);
}

// 读取当前用户 AI 配置（Key 打码返回）
router.get('/settings', (req, res) => {
  const s = db.prepare('SELECT * FROM ai_settings WHERE user_id = ?').get(req.user.id);
  if (!s) {
    return res.json({
      provider: 'deepseek', base_url: 'https://api.deepseek.com', model: 'deepseek-chat',
      enabled: false, api_key_set: false, api_key_masked: '',
    });
  }
  res.json({
    provider: s.provider,
    base_url: s.base_url,
    model: s.model,
    enabled: !!s.enabled,
    api_key_set: !!s.api_key,
    api_key_masked: maskKey(s.api_key),
  });
});

// 保存 AI 配置（Key 为空表示不修改，保留原值）
router.put('/settings', (req, res) => {
  const body = req.body || {};
  const provider = (body.provider || 'deepseek').toString().trim();
  if (!PROVIDER_PRESETS[provider]) return res.status(400).json({ error: '不支持的供应商' });

  let base_url = (body.base_url || '').toString().trim().replace(/\/$/, '');
  let model = (body.model || '').toString().trim();
  let api_key = (body.api_key || '').toString().trim();

  if (provider === 'deepseek' || provider === 'openai') {
    // 预设供应商：不填 base_url/model 时用默认值
    if (!base_url) base_url = PROVIDER_PRESETS[provider].base_url;
    if (!model) model = PROVIDER_PRESETS[provider].model;
  } else if (provider === 'custom') {
    if (!base_url) return res.status(400).json({ error: '自定义接口请填写 Base URL' });
    if (!model) return res.status(400).json({ error: '请填写模型名称' });
  }

  const existing = db.prepare('SELECT * FROM ai_settings WHERE user_id = ?').get(req.user.id);
  if (existing && !api_key) {
    // 保留原 Key
    api_key = existing.api_key;
  }
  if (!api_key) return res.status(400).json({ error: '请填写 API Key' });

  const enabled = body.enabled ? 1 : 0;
  db.prepare(`
    INSERT INTO ai_settings (user_id, provider, base_url, api_key, model, enabled, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, datetime('now','localtime'))
    ON CONFLICT(user_id) DO UPDATE SET
      provider = excluded.provider,
      base_url = excluded.base_url,
      api_key = excluded.api_key,
      model = excluded.model,
      enabled = excluded.enabled,
      updated_at = excluded.updated_at
  `).run(req.user.id, provider, base_url, api_key, model, enabled);

  res.json({
    provider, base_url, model, enabled: !!enabled,
    api_key_set: true, api_key_masked: maskKey(api_key),
  });
});

// 获取 AI 可用的账本上下文（分类 + 最近记录摘要，供对话工具使用）
function buildContext(userId, ledgerId) {
  const cats = db.prepare('SELECT id, name, type FROM categories WHERE user_id = ? ORDER BY type, sort').all(userId);
  const records = db.prepare(`
    SELECT r.record_date, r.type, r.amount, r.note, c.name AS category_name
    FROM records r LEFT JOIN categories c ON c.id = r.category_id
    WHERE r.ledger_id = ? ORDER BY r.record_date DESC, r.id DESC LIMIT 50
  `).all(ledgerId);
  return {
    today: new Date().toISOString().slice(0, 10),
    categories: cats.map(function (c) { return c.type + ':' + c.name; }),
    recent_records: records.map(function (r) {
      return (r.record_date || '') + ' ' + (r.type === 'expense' ? '支出' : '收入') + ' ' + (r.amount / 100).toFixed(2) + '元 ' + (r.category_name || '未分类') + (r.note ? ' (' + r.note + ')' : '');
    }),
  };
}

// 执行记账工具
function runTool(toolName, args) {
  const ledgerId = Number(args.ledger_id) || null;
  const userId = args.user_id;
  if (toolName === 'add_record') {
    const type = args.type === 'income' ? 'income' : 'expense';
    const amountCents = Math.round(Number(args.amount) * 100);
    if (!(amountCents > 0)) return { error: '金额无效' };
    // 查找或创建分类
    let cat = null;
    if (args.category_name) {
      cat = db.prepare('SELECT id FROM categories WHERE user_id = ? AND name = ? AND type = ?')
        .get(userId, args.category_name.trim(), type);
    }
    const ledger = db.prepare('SELECT id FROM ledgers WHERE id = ? AND user_id = ?').get(ledgerId, userId);
    if (!ledger) return { error: '账本不存在' };
    const date = /^\d{4}-\d{2}-\d{2}$/.test(args.date) ? args.date : new Date().toISOString().slice(0, 10);
    const info = db.prepare(`
      INSERT INTO records (ledger_id, user_id, type, category_id, amount, note, record_date)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(ledgerId, userId, type, cat ? cat.id : null, amountCents, (args.note || '').trim(), date);
    return { ok: true, record_id: Number(info.lastInsertRowid), type: type, amount_yuan: (amountCents / 100).toFixed(2), category: args.category_name || null, date: date };
  }
  if (toolName === 'query_summary') {
    const month = args.month || new Date().toISOString().slice(0, 7);
    const rows = db.prepare(`
      SELECT c.name AS category, SUM(r.amount) AS total
      FROM records r LEFT JOIN categories c ON c.id = r.category_id
      WHERE r.ledger_id = ? AND r.type = ? AND substr(r.record_date, 1, 7) = ?
      GROUP BY c.name ORDER BY total DESC
    `).all(ledgerId, args.type === 'income' ? 'income' : 'expense', month);
    return rows.map(function (r) { return (r.category || '未分类') + ': ' + (r.total / 100).toFixed(2) + '元'; });
  }
  if (toolName === 'query_month_total') {
    const month = args.month || new Date().toISOString().slice(0, 7);
    const row = db.prepare(`
      SELECT
        COALESCE(SUM(CASE WHEN type = 'expense' THEN amount END), 0) AS expense,
        COALESCE(SUM(CASE WHEN type = 'income' THEN amount END), 0) AS income
      FROM records WHERE ledger_id = ? AND substr(record_date, 1, 7) = ?
    `).get(ledgerId, month);
    return { month: month, expense_yuan: (row.expense / 100).toFixed(2), income_yuan: (row.income / 100).toFixed(2) };
  }
  return { error: '未知工具' };
}

// AI 对话
router.post('/chat', async (req, res) => {
  const s = db.prepare('SELECT * FROM ai_settings WHERE user_id = ?').get(req.user.id);
  if (!s || !s.api_key || !s.enabled) {
    return res.status(400).json({ error: '请先在「个人中心 → AI 设置」中填写 API Key 并开启' });
  }
  const message = (req.body && req.body.message || '').toString().trim();
  if (!message) return res.status(400).json({ error: '请输入内容' });
  const ledgerId = Number(req.body.ledger_id) || req.user.currentLedgerId;

  const ctx = buildContext(req.user.id, ledgerId);
  const system = [
    '你是「记账本」的 AI 助手，帮助用户记账和查询分析。',
    '当前日期: ' + ctx.today,
    '可用分类（类型:名称）: ' + ctx.categories.join('，'),
    '最近 50 条记录:',
    (ctx.recent_records.length ? ctx.recent_records.join('\n') : '（暂无记录）'),
    '',
    '规则:',
    '1. 用户描述一笔消费/收入时，用 add_record 工具记账（金额单位元，可小数；date 格式 YYYY-MM-DD，不明确就用今天）。',
    '2. 用户询问某月消费时，用 query_summary 或 query_month_total 查询后回答。',
    '3. 分类必须从可用分类中选择，没有合适分类就用「其他」。',
    '4. 回答用简体中文，简洁自然。',
  ].join('\n');

  const tools = [
    {
      type: 'function',
      function: {
        name: 'add_record',
        description: '记一笔账（支出或收入）',
        parameters: {
          type: 'object',
          properties: {
            type: { type: 'string', enum: ['expense', 'income'], description: 'expense=支出, income=收入' },
            amount: { type: 'number', description: '金额，单位元，可带小数' },
            category_name: { type: 'string', description: '分类名称，从可用分类中选择' },
            note: { type: 'string', description: '备注，没有就填空字符串' },
            date: { type: 'string', description: '日期 YYYY-MM-DD，默认今天' },
          },
          required: ['type', 'amount'],
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'query_summary',
        description: '查询某月按分类汇总的支出或收入',
        parameters: {
          type: 'object',
          properties: {
            month: { type: 'string', description: '月份 YYYY-MM，默认本月' },
            type: { type: 'string', enum: ['expense', 'income'], description: 'expense=支出, income=收入' },
          },
          required: ['type'],
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'query_month_total',
        description: '查询某月的总支出和总收入',
        parameters: {
          type: 'object',
          properties: {
            month: { type: 'string', description: '月份 YYYY-MM，默认本月' },
          },
        },
      },
    },
  ];

  const url = (s.base_url || '').replace(/\/$/, '') + '/chat/completions';
  try {
    const body = {
      model: s.model,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: message },
      ],
      tools: tools,
      tool_choice: 'auto',
      temperature: 0.3,
      stream: false,
    };
    const resp = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + s.api_key },
      body: JSON.stringify(body),
    });
    if (!resp.ok) {
      const txt = await resp.text().catch(function () { return ''; });
      return res.status(502).json({ error: 'AI 接口调用失败 (' + resp.status + '): ' + txt.slice(0, 300) });
    }
    const data = await resp.json();
    const choice = data.choices && data.choices[0];
    const msg = choice && choice.message;

    let toolResults = [];
    if (msg && msg.tool_calls && msg.tool_calls.length) {
      const call = msg.tool_calls[0];
      let parsed;
      try { parsed = JSON.parse(call.function.arguments || '{}'); } catch (e) { parsed = {}; }
      parsed.user_id = req.user.id;
      parsed.ledger_id = ledgerId;
      const result = runTool(call.function.name, parsed);
      toolResults.push({ name: call.function.name, result: result });

      // 把工具结果回传，让 AI 生成最终回答
      const second = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + s.api_key },
        body: JSON.stringify({
          model: s.model,
          messages: [
            { role: 'system', content: system },
            { role: 'user', content: message },
            { role: 'assistant', content: null, tool_calls: [call] },
            { role: 'tool', tool_call_id: call.id, content: JSON.stringify(result) },
          ],
          temperature: 0.3,
          stream: false,
        }),
      });
      const data2 = await second.json();
      const reply = data2.choices && data2.choices[0] && data2.choices[0].message;
      return res.json({ reply: (reply && reply.content) || '已完成', tool_results: toolResults });
    }

    res.json({ reply: (msg && msg.content) || '（无回复）', tool_results: [] });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'AI 调用失败: ' + err.message });
  }
});

export default router;
