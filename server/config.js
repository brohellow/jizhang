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
  // 跨后端通信：AI 后端调用记账本主后端 API（记账工具、分类查询等）
  jizhangApi: env.JZ_JIZHANG_API || 'http://127.0.0.1:3000',
  // 各后端端口（独立进程，可独立部署）
  aiPort: Number(env.AI_PORT) || 3001,
  salaryPort: Number(env.SALARY_PORT) || 3002,
  sgsPort: Number(env.SGS_PORT) || 3003,
};
