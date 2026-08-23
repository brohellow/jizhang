// ============================================================
// AI 配置模块（独立于主程序，用户可在配置文件中直接修改）
//
// 支持多供应商、多模型：
//   每个"供应商" = { name, provider, base_url, api_key, models[], enabled }
//   供应商来源（合并后全部可用）：
//     1. 数据库  用户自己在「个人中心 → AI 设置」添加（每用户独立，优先）
//     2. 全局文件 ~/.jizhang/ai-config.json 中的 providers 数组
//     3. 环境变量 JZ_AI_*（作为单个附加供应商，部署注入用）
//
// 用户目录（跨平台）：
//   Windows: C:\Users\<用户名>\.jizhang\
//   Linux/macOS: ~/.jizhang/
// ============================================================
import { homedir } from 'node:os';
import path from 'node:path';
import fs from 'node:fs';

export const PROVIDER_PRESETS = {
  deepseek: { base_url: 'https://api.deepseek.com', models: ['deepseek-chat', 'deepseek-reasoner'] },
  openai: { base_url: 'https://api.openai.com/v1', models: ['gpt-4o-mini', 'gpt-4o'] },
  custom: { base_url: '', models: [] },
};

export function configDir() {
  return path.join(homedir(), '.jizhang');
}
export function configPath() {
  return path.join(configDir(), 'ai-config.json');
}
export function examplePath() {
  return path.join(configDir(), 'ai-config.example.json');
}

// 配置文件模板（多供应商结构）
export function configTemplate() {
  return {
    _comment: [
      '记账本 AI 配置模板（全局默认，所有用户可用）。复制为 ai-config.json 后修改。',
      'providers 数组里可配置多个供应商，每个支持多个模型。',
      'provider: deepseek | openai | custom',
      'api_key: 在平台申请（DeepSeek: https://platform.deepseek.com）',
      'models: 该供应商可用的模型列表（填完整模型名，如 deepseek-chat / gpt-4o-mini）',
      'base_url 留空时使用预设默认值。',
      '用户也可在网页「个人中心 → AI 设置」里添加自己的供应商（存数据库，仅自己可见）。',
    ].join('\n'),
    providers: [
      {
        name: 'DeepSeek',
        provider: 'deepseek',
        base_url: '',
        api_key: 'sk-在此填入你的APIKey',
        models: ['deepseek-chat', 'deepseek-reasoner'],
        enabled: true,
      },
    ],
  };
}

// 首次运行：创建目录 + 示例模板（不覆盖已有）
export function ensureConfigDir() {
  try {
    fs.mkdirSync(configDir(), { recursive: true });
    if (!fs.existsSync(configPath()) && !fs.existsSync(examplePath())) {
      fs.writeFileSync(examplePath(), JSON.stringify(configTemplate(), null, 2), 'utf-8');
    }
  } catch (err) {
    console.error('[ai-config] 无法创建配置目录: ' + err.message);
  }
}

const PLACEHOLDER_KEY = 'sk-在此填入你的APIKey';

// 规范化一个供应商对象（补默认值、校验）
export function normalizeProvider(p) {
  if (!p || typeof p !== 'object') return null;
  const provider = (p.provider || 'custom').toString().trim();
  if (!PROVIDER_PRESETS[provider]) return null;
  let base_url = (p.base_url || '').toString().trim().replace(/\/$/, '');
  let models = Array.isArray(p.models)
    ? p.models.map(function (m) { return String(m).trim(); }).filter(Boolean)
    : [];
  if (!base_url) base_url = PROVIDER_PRESETS[provider].base_url;
  if (models.length === 0) models = PROVIDER_PRESETS[provider].models.slice();
  let api_key = (p.api_key || '').toString().trim();
  if (api_key === PLACEHOLDER_KEY) api_key = '';
  return {
    name: (p.name || provider).toString().trim() || provider,
    provider: provider,
    base_url: base_url,
    api_key: api_key,
    models: models,
    enabled: p.enabled !== false,
  };
}

// 读取全局配置文件中的供应商列表（兼容旧版单供应商格式）
export function loadFileProviders() {
  const p = configPath();
  if (!fs.existsSync(p)) return [];
  let raw;
  try {
    raw = fs.readFileSync(p, 'utf-8');
  } catch (err) {
    throw new Error('无法读取配置文件 ' + p + '：' + err.message);
  }
  let data;
  try {
    data = JSON.parse(raw);
  } catch (err) {
    throw new Error('配置文件 ' + p + ' 格式错误（JSON 解析失败）：' + err.message);
  }
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    throw new Error('配置文件 ' + p + ' 内容无效：应为 JSON 对象');
  }
  const list = [];
  // 新版：providers 数组
  if (Array.isArray(data.providers)) {
    data.providers.forEach(function (pr) {
      const n = normalizeProvider(pr);
      if (n) list.push(n);
    });
  } else if (data.provider) {
    // 旧版单供应商格式兼容
    const n = normalizeProvider(data);
    if (n) list.push(n);
  }
  return list;
}

// 环境变量作为单个附加供应商（优先级最高）
export function loadEnvProvider() {
  const env = process.env || {};
  if (!env.JZ_AI_API_KEY) return null;
  return normalizeProvider({
    name: '环境变量',
    provider: env.JZ_AI_PROVIDER || 'deepseek',
    base_url: env.JZ_AI_BASE_URL || '',
    api_key: env.JZ_AI_API_KEY,
    models: env.JZ_AI_MODEL ? [env.JZ_AI_MODEL] : undefined,
    enabled: env.JZ_AI_ENABLED === undefined ? true : ['1', 'true', 'yes', 'on'].includes(String(env.JZ_AI_ENABLED).toLowerCase()),
  });
}

// 合并所有供应商：数据库（用户私有，由调用方传入）+ 文件（全局）+ 环境变量
// dbProviders: [{id, name, provider, base_url, api_key, models(json), enabled}]
export function getProviders(dbProviders) {
  const out = [];
  // 1. 数据库（用户自己的）
  (dbProviders || []).forEach(function (r) {
    let models = [];
    try { models = JSON.parse(r.models || '[]'); } catch (e) { models = []; }
    const n = normalizeProvider({
      name: r.name, provider: r.provider, base_url: r.base_url,
      api_key: r.api_key, models: models, enabled: !!r.enabled,
    });
    if (n) out.push(Object.assign({ id: 'db:' + r.id, source: 'user' }, n));
  });
  // 2. 全局文件
  let fileProviders = [];
  try { fileProviders = loadFileProviders(); } catch (err) {
    // 文件错误向上抛，由路由层处理
    throw err;
  }
  fileProviders.forEach(function (n, i) {
    out.push(Object.assign({ id: 'file:' + i, source: 'file' }, n));
  });
  // 3. 环境变量
  const envP = loadEnvProvider();
  if (envP) out.push(Object.assign({ id: 'env', source: 'env' }, envP));
  return out;
}

// 打码 Key
export function maskKey(key) {
  if (!key) return '';
  if (key.length <= 8) return '****';
  return key.slice(0, 4) + '****' + key.slice(-4);
}
