// ============================================================
// 集中配置：统一读取环境变量
// 各模块 import { config } 而非各自读 process.env，便于管理
// ============================================================
const env = process.env || {};

export const config = {
  port: Number(env.PORT) || 3000,
  dbPath: env.DB_PATH || '', // 空则由 db.js 用默认路径
  tokenSyncKey: env.TOKEN_SYNC_KEY || '',
  rateLimitWhitelist: env.JZ_RATE_LIMIT_WHITELIST || '',
  wxAppid: env.WX_APPID || '',
  wxSecret: env.WX_SECRET || '',
  sgsApi: env.SGS_API || 'http://127.0.0.1:8085',
  aiApiKey: env.JZ_AI_API_KEY || '',
  aiProvider: env.JZ_AI_PROVIDER || 'deepseek',
  aiBaseUrl: env.JZ_AI_BASE_URL || '',
  aiModel: env.JZ_AI_MODEL || '',
  aiEnabled: env.JZ_AI_ENABLED === undefined ? true : ['1', 'true', 'yes', 'on'].includes(String(env.JZ_AI_ENABLED).toLowerCase()),
};
