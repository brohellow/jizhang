import { Router } from 'express';
import { mkdirSync, writeFileSync, existsSync } from 'node:fs';
import pathMod from 'node:path';
import { homedir } from 'node:os';
import { db } from '../db.js';
import { requireAuth } from '../auth.js';
import { todayStr, currentMonthStr } from '../util.js';
import {
  PROVIDER_PRESETS, maskKey, ensureConfigDir, getProviders,
  configPath, configTemplate, loadFileProviders,
} from '../ai-config.js';

const router = Router();
router.use(requireAuth);

ensureConfigDir();

// AI 供应商表（每用户可添加多个供应商，每个含多个模型）
db.exec(`
CREATE TABLE IF NOT EXISTS ai_providers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL DEFAULT '',
  provider TEXT NOT NULL DEFAULT 'deepseek',
  base_url TEXT NOT NULL DEFAULT '',
  api_key TEXT NOT NULL DEFAULT '',
  models TEXT NOT NULL DEFAULT '[]',
  enabled INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
`);

function dbProvidersOf(userId) {
  return db.prepare('SELECT * FROM ai_providers WHERE user_id = ? ORDER BY id').all(userId);
}

// 供应商列表（含来源：user=个人中心 / file=配置文件 / env=环境变量）
router.get('/providers', (req, res) => {
  let fileError = null;
  let list;
  try {
    list = getProviders(dbProvidersOf(req.user.id));
  } catch (err) {
    fileError = err.message;
    list = getProviders(dbProvidersOf(req.user.id).filter(() => true)).filter((p) => p.source === 'user');
    // 文件出错时退回只列用户自己的
    try { list = getProviders(dbProvidersOf(req.user.id)); } catch (e2) {
      list = dbProvidersOf(req.user.id).map(function (r) {
        let models = []; try { models = JSON.parse(r.models || '[]'); } catch (e) {}
        return { id: 'db:' + r.id, source: 'user', name: r.name, provider: r.provider, base_url: r.base_url, api_key: r.api_key, models: models, enabled: !!r.enabled };
      });
    }
  }
  res.json({
    providers: list.map(function (p) {
      return {
        id: p.id,
        source: p.source,
        name: p.name,
        provider: p.provider,
        base_url: p.base_url,
        models: p.models || [],
        enabled: p.enabled,
        api_key_set: !!p.api_key,
        api_key_masked: maskKey(p.api_key),
      };
    }),
    config_file: configPath(),
    file_error: fileError,
  });
});

// 添加供应商（存数据库，仅当前用户可见）
router.post('/providers', (req, res) => {
  const b = req.body || {};
  const provider = (b.provider || 'deepseek').toString().trim();
  if (!PROVIDER_PRESETS[provider]) return res.status(400).json({ error: '不支持的供应商类型' });
  const base_url = (b.base_url || '').toString().trim().replace(/\/$/, '') || PROVIDER_PRESETS[provider].base_url;
  const models = Array.isArray(b.models)
    ? b.models.map(String).map(function (s) { return s.trim(); }).filter(Boolean)
    : (b.model ? [String(b.model).trim()] : []);
  if (models.length === 0 && PROVIDER_PRESETS[provider].models.length) {
    models.push(PROVIDER_PRESETS[provider].models[0]);
  }
  if (models.length === 0) return res.status(400).json({ error: '请填写至少一个模型名称' });
  const api_key = (b.api_key || '').toString().trim();
  if (!api_key) return res.status(400).json({ error: '请填写 API Key' });
  const name = (b.name || '').toString().trim() || provider;

  const info = db.prepare(`
    INSERT INTO ai_providers (user_id, name, provider, base_url, api_key, models, enabled)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(req.user.id, name, provider, base_url, api_key, JSON.stringify(models), b.enabled === false ? 0 : 1);

  res.json({
    id: 'db:' + info.lastInsertRowid, source: 'user', name: name, provider: provider,
    base_url: base_url, models: models, enabled: b.enabled !== false,
    api_key_set: true, api_key_masked: maskKey(api_key),
  });
});

// 编辑供应商（Key 留空保留原值）
router.put('/providers/:id', (req, res) => {
  const id = Number(req.params.id);
  const row = db.prepare('SELECT * FROM ai_providers WHERE id = ? AND user_id = ?').get(id, req.user.id);
  if (!row) return res.status(404).json({ error: '供应商不存在' });
  const b = req.body || {};
  const provider = (b.provider || row.provider).toString().trim();
  if (!PROVIDER_PRESETS[provider]) return res.status(400).json({ error: '不支持的供应商类型' });
  const base_url = (b.base_url !== undefined ? (b.base_url || '').toString().trim() : row.base_url).replace(/\/$/, '') || PROVIDER_PRESETS[provider].base_url;
  let models = row.models;
  if (Array.isArray(b.models)) {
    models = b.models.map(String).map(function (s) { return s.trim(); }).filter(Boolean);
  }
  if (models.length === 0) return res.status(400).json({ error: '请填写至少一个模型名称' });
  const api_key = (b.api_key || '').toString().trim() || row.api_key;
  const name = (b.name || '').toString().trim() || row.name;

  db.prepare(`
    UPDATE ai_providers SET name = ?, provider = ?, base_url = ?, api_key = ?, models = ?, enabled = ?
    WHERE id = ? AND user_id = ?
  `).run(name, provider, base_url, api_key, JSON.stringify(models), b.enabled === false ? 0 : 1, id, req.user.id);

  res.json({
    id: 'db:' + id, source: 'user', name: name, provider: provider,
    base_url: base_url, models: models, enabled: b.enabled !== false,
    api_key_set: true, api_key_masked: maskKey(api_key),
  });
});

// 删除供应商
router.delete('/providers/:id', (req, res) => {
  const id = Number(req.params.id);
  const info = db.prepare('DELETE FROM ai_providers WHERE id = ? AND user_id = ?').run(id, req.user.id);
  if (info.changes === 0) return res.status(404).json({ error: '供应商不存在' });
  res.json({ ok: true });
});

// 生成配置文件模板
router.post('/settings/template', (req, res) => {
  const dir = pathMod.join(homedir(), '.jizhang');
  const example = pathMod.join(dir, 'ai-config.example.json');
  const target = pathMod.join(dir, 'ai-config.json');
  try {
    mkdirSync(dir, { recursive: true });
    if (!existsSync(example)) writeFileSync(example, JSON.stringify(configTemplate(), null, 2), 'utf-8');
    if (!existsSync(target)) writeFileSync(target, JSON.stringify(configTemplate(), null, 2), 'utf-8');
    res.json({ ok: true, example: example, target: target, message: '模板已生成：' + target });
  } catch (err) {
    res.status(500).json({ error: '无法生成模板: ' + err.message });
  }
});

// ============ 对话 ============

function buildContext(userId, ledgerId) {
  const cats = db.prepare('SELECT id, name, type FROM categories WHERE user_id = ? ORDER BY type, sort').all(userId);
  const records = db.prepare(`
    SELECT r.record_date, r.type, r.amount, r.note, c.name AS category_name
    FROM records r LEFT JOIN categories c ON c.id = r.category_id
    WHERE r.ledger_id = ? ORDER BY r.record_date DESC, r.id DESC LIMIT 50
  `).all(ledgerId);
  return {
    today: todayStr(),
    categories: cats.map(function (c) { return c.type + ':' + c.name; }),
    recent_records: records.map(function (r) {
      return (r.record_date || '') + ' ' + (r.type === 'expense' ? '支出' : '收入') + ' ' + (r.amount / 100).toFixed(2) + '元 ' + (r.category_name || '未分类') + (r.note ? ' (' + r.note + ')' : '');
    }),
  };
}

function runTool(toolName, args) {
  const ledgerId = Number(args.ledger_id) || null;
  const userId = args.user_id;
  if (toolName === 'add_record') {
    const type = args.type === 'income' ? 'income' : 'expense';
    const amountCents = Math.round(Number(args.amount) * 100);
    if (!(amountCents > 0)) return { error: '金额无效' };
    let cat = null;
    if (args.category_name) {
      cat = db.prepare('SELECT id FROM categories WHERE user_id = ? AND name = ? AND type = ?')
        .get(userId, args.category_name.trim(), type);
    }
    const ledger = db.prepare('SELECT id FROM ledgers WHERE id = ? AND user_id = ?').get(ledgerId, userId);
    if (!ledger) return { error: '账本不存在' };
    // 日期校验：格式合法且不早于 2000 年、不晚于今天+1 天，否则用本地今天
    const today = todayStr();
    let date = today;
    if (typeof args.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(args.date)) {
      const cand = args.date;
      const todayNum = Number(today.replace(/-/g, ''));
      const candNum = Number(cand.replace(/-/g, ''));
      if (candNum >= 20000101 && candNum <= todayNum + 1) date = cand;
    }
    const info = db.prepare(`
      INSERT INTO records (ledger_id, user_id, type, category_id, amount, note, record_date)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(ledgerId, userId, type, cat ? cat.id : null, amountCents, (args.note || '').trim(), date);
    return { ok: true, record_id: Number(info.lastInsertRowid), type: type, amount_yuan: (amountCents / 100).toFixed(2), category: args.category_name || null, date: date };
  }
  if (toolName === 'query_summary') {
    const month = args.month || currentMonthStr();
    const rows = db.prepare(`
      SELECT c.name AS category, SUM(r.amount) AS total
      FROM records r LEFT JOIN categories c ON c.id = r.category_id
      WHERE r.ledger_id = ? AND r.type = ? AND substr(r.record_date, 1, 7) = ?
      GROUP BY c.name ORDER BY total DESC
    `).all(ledgerId, args.type === 'income' ? 'income' : 'expense', month);
    return rows.map(function (r) { return (r.category || '未分类') + ': ' + (r.total / 100).toFixed(2) + '元'; });
  }
  if (toolName === 'query_month_total') {
    const month = args.month || currentMonthStr();
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

// AI 对话：body = { message, ledger_id?, provider_id?, model? }
router.post('/chat', async (req, res) => {
  const message = (req.body && req.body.message || '').toString().trim();
  if (!message) return res.status(400).json({ error: '请输入内容' });
  const ledgerId = Number(req.body.ledger_id) || req.user.currentLedgerId;

  // 选出目标供应商
  let providers;
  try {
    providers = getProviders(dbProvidersOf(req.user.id));
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }
  const enabled = providers.filter(function (p) { return p.enabled; });
  if (enabled.length === 0) {
    return res.status(400).json({ error: '没有可用的 AI 供应商：请先在「个人中心 → AI 设置」添加供应商并填写 Key，或配置 ' + configPath() });
  }
  const reqProviderId = req.body.provider_id ? String(req.body.provider_id) : null;
  let target = reqProviderId
    ? enabled.find(function (p) { return String(p.id) === reqProviderId; })
    : enabled[0];
  if (!target) {
    return res.status(400).json({ error: '指定的供应商不可用，请重新选择' });
  }
  // 选模型
  const models = target.models && target.models.length ? target.models : [''];
  let model = req.body.model ? String(req.body.model) : models[0];
  if (models.indexOf(model) < 0 && models[0] !== '') {
    // 允许任意模型名（用户可能填了自定义模型），但优先匹配列表
    model = String(req.body.model) || models[0];
  }

  const ctx = buildContext(req.user.id, ledgerId);
  const system = [
    '你是「记账本」的 AI 助手，帮助用户记账和查询分析。',
    '今天（本地日期，唯一正确）: ' + ctx.today,
    '你所在时区是中国标准时间（UTC+8）。你的训练数据中的日期一律无效。',
    '可用分类（类型:名称）: ' + ctx.categories.join('，'),
    '最近 50 条记录:',
    (ctx.recent_records.length ? ctx.recent_records.join('\n') : '（暂无记录）'),
    '',
    '规则:',
    '1. 用户描述一笔消费/收入时，用 add_record 工具记账（金额单位元，可小数）。',
    '2. 记账的 date 参数：如果用户明确说了日期（如"昨天""前天""3号"），按今天推算；否则必须用今天（' + ctx.today + '）。绝不允许编造其他日期。',
    '3. 用户询问某月消费时，用 query_summary 或 query_month_total 查询后回答。',
    '4. 分类必须从可用分类中选择，没有合适分类就用「其他」。',
    '5. 回答用简体中文，简洁自然。',
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

  const url = (target.base_url || '').replace(/\/$/, '') + '/chat/completions';
  try {
    const body = {
      model: model,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: message },
      ],
      tools: tools,
      tool_choice: 'auto',
      temperature: 0.3,
      stream: false,
    };
    const headers = { 'Content-Type': 'application/json', Authorization: 'Bearer ' + target.api_key };
    const resp = await fetch(url, { method: 'POST', headers: headers, body: JSON.stringify(body) });
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

      const second = await fetch(url, {
        method: 'POST',
        headers: headers,
        body: JSON.stringify({
          model: model,
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
      return res.json({ reply: (reply && reply.content) || '已完成', tool_results: toolResults, provider: target.name, model: model });
    }

    res.json({ reply: (msg && msg.content) || '（无回复）', tool_results: [], provider: target.name, model: model });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'AI 调用失败: ' + err.message });
  }
});

export default router;
