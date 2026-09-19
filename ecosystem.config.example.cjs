// PM2 多后端进程配置（后端拆分后 4 个独立进程）
// 用法：
//   启动全部：  pm2 start ecosystem.config.cjs
//   单独重启：  pm2 restart jizhang-ai
//   查看状态：  pm2 status
module.exports = {
  apps: [
    {
      name: 'jizhang-api',
      script: 'server/index.js',
      instances: 1,
      exec_mode: 'fork',
      max_memory_restart: '300M',
      env: { PORT: 3000 },
      out_file: './logs/jizhang-api.out.log',
      error_file: './logs/jizhang-api.err.log',
      merge_logs: true,
      time: true,
    },
    {
      name: 'jizhang-ai',
      script: 'server-ai/index.js',
      instances: 1,
      exec_mode: 'fork',
      max_memory_restart: '300M',
      env: { AI_PORT: 3001, JZ_JIZHANG_API: 'http://127.0.0.1:3000' },
      out_file: './logs/jizhang-ai.out.log',
      error_file: './logs/jizhang-ai.err.log',
      merge_logs: true,
      time: true,
    },
    {
      name: 'jizhang-salary',
      script: 'server-salary/index.js',
      instances: 1,
      exec_mode: 'fork',
      max_memory_restart: '300M',
      env: { SALARY_PORT: 3002 },
      out_file: './logs/jizhang-salary.out.log',
      error_file: './logs/jizhang-salary.err.log',
      merge_logs: true,
      time: true,
    },
    {
      name: 'jizhang-sgs',
      script: 'server-sgs/index.js',
      instances: 1,
      exec_mode: 'fork',
      max_memory_restart: '300M',
      env: { SGS_PORT: 3003 },
      out_file: './logs/jizhang-sgs.out.log',
      error_file: './logs/jizhang-sgs.err.log',
      merge_logs: true,
      time: true,
    },
  ],
};
