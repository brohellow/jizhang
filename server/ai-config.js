// ============================================================
// AI 配置模块（独立于主程序，用户可在配置文件中直接修改）
//
// 配置来源（优先级从高到低）：
//   1. 环境变量   JZ_AI_PROVIDER / JZ_AI_BASE_URL / JZ_AI_MODEL / JZ_AI_API_KEY / JZ_AI_ENABLED
//   2. 数据库     每用户在「个人中心 → AI 设置」里保存的配置（覆盖全局文件）
//   3. 全局文件   ~/.jizhang/ai-config.json （用户目录下，可直接编辑）
//   4. 内置默认   见 DEFAULT_CONFIG
//
// 用户目录（跨平台）：
//   Windows: C:\Users\<用户名>\.jizhang\
//   Linux/macOS: ~/.jizhang/
// ============================================================
import { homedir } from 'node:os';
import path from 'node:path';
import fs from 'node:fs';

export const DEFAULT_CONFIG = {
  provider: 'deepseek',
  base_url: 'https://api.deepseek.com',
  model: 'deepseek-chat',
  api_key: '',
  enabled: false,
};

export const PROVIDER_PRESETS = {
  deepseek: { base_url: 'https://api.deepseek.com', model: 'deepseek-chat' },
  openai: { base_url: 'https://api.openai.com/v1', model: 'gpt-4o-mini' },
  custom: { base_url: '', model: '' },
};

// 配置文件路径：~/.jizhang/ai-config.json
export function configDir() {
  return path.join(homedir(), '.jizhang');
}
export function configPath() {
  return path.join(configDir(), 'ai-config.json');
}
export function examplePath() {
  return path.join(configDir(), 'ai-config.example.json');
}

// 配置文件模板（含说明注释，用 JSON 附 _comment 字段展示）
export function configTemplate() {
  return {
    _comment: [
      '记账本 AI 配置模板。复制为 ai-config.json 后修改。',
      'provider: deepseek | openai | custom',
      'api_key: 在平台申请（DeepSeek: https://platform.deepseek.com）',
      'base_url/model 留空时使用预设默认值。',
      '此文件是全局默认配置；个人中心保存的配置会覆盖它。',
    ].join('\n'),
    provider: 'deepseek',
    base_url: '',
    model: '',
    api_key: 'sk-在此填入你的APIKey',
    enabled: true,
  };
}

// 首次运行：若用户目录不存在则创建，并写入示例模板（不覆盖已有文件）
export function ensureConfigDir() {
  try {
    fs.mkdirSync(configDir(), { recursive: true });
    if (!fs.existsSync(configPath()) && !fs.existsSync(examplePath())) {
      fs.writeFileSync(examplePath(), JSON.stringify(configTemplate(), null, 2), 'utf-8');
    }
  } catch (err) {
    // 目录创建失败不阻断主流程，只是无法用文件配置
    console.error('[ai-config] 无法创建配置目录: ' + err.message);
  }
}

// 读取全局配置文件。文件不存在返回 null；格式错误抛出可读错误。
export function loadGlobalConfig() {
  const p = configPath();
  if (!fs.existsSync(p)) return null;
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
  const provider = (data.provider || 'deepseek').toString().trim();
  if (!PROVIDER_PRESETS[provider]) {
    throw new Error('配置文件 ' + p + ' 中 provider 不受支持："' + provider + '"（可选：deepseek / openai / custom）');
  }
  let base_url = (data.base_url || '').toString().trim().replace(/\/$/, '');
  let model = (data.model || '').toString().trim();
  let api_key = (data.api_key || '').toString().trim();
  if (!base_url) base_url = PROVIDER_PRESETS[provider].base_url;
  if (!model) model = PROVIDER_PRESETS[provider].model;
  if (api_key === 'sk-在此填入你的APIKey') api_key = ''; // 模板占位符视为未填
  return {
    provider: provider,
    base_url: base_url,
    model: model,
    api_key: api_key,
    enabled: data.enabled !== false,
  };
}

// 读取环境变量覆盖（优先级最高，用于部署注入）
export function loadEnvOverrides() {
  const env = process.env || {};
  const out = {};
  if (env.JZ_AI_PROVIDER) out.provider = env.JZ_AI_PROVIDER;
  if (env.JZ_AI_BASE_URL) out.base_url = env.JZ_AI_BASE_URL.replace(/\/$/, '');
  if (env.JZ_AI_MODEL) out.model = env.JZ_AI_MODEL;
  if (env.JZ_AI_API_KEY) out.api_key = env.JZ_AI_API_KEY;
  if (env.JZ_AI_ENABLED !== undefined) out.enabled = ['1', 'true', 'yes', 'on'].includes(String(env.JZ_AI_ENABLED).toLowerCase());
  return out;
}

// 合并：默认 < 全局文件 < 环境变量（数据库覆盖由调用方叠加）
export function mergeConfig() {
  let cfg = Object.assign({}, DEFAULT_CONFIG);
  const fileCfg = loadGlobalConfig();
  if (fileCfg) Object.assign(cfg, fileCfg);
  Object.assign(cfg, loadEnvOverrides());
  return cfg;
}

// 打码 Key
export function maskKey(key) {
  if (!key) return '';
  if (key.length <= 8) return '****';
  return key.slice(0, 4) + '****' + key.slice(-4);
}
