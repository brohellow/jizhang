# 后端拆分说明（记账本主后端 + 3 个独立后端）

> 目标：把 AI 助手/江湖模拟器、工时工资、三国杀大厅从记账本后端中独立出来，各自独立进程、独立端口、可独立部署重启，不再共用记账本后端。

## 一、拆分后的架构

```
浏览器 / 微信小程序
        │  （localStorage.jz_token 共享登录态）
        ▼
   Nginx（静态 + 反代）
        │
        ├─ /api/ai/*     → 3001  jizhang-ai      （AI 助手 + 江湖模拟器）
        ├─ /api/salary/* → 3002  jizhang-salary  （工时工资）
        ├─ /api/sgs/*    → 3003  jizhang-sgs     （三国杀大厅）
        └─ /api/*        → 3000  jizhang-api     （记账本主后端）
```

| 进程 | 目录 | 入口 | 端口 | 职责 |
|---|---|---|---|---|
| jizhang-api | server/ | server/index.js | 3000 | 登录/注册、账本、分类、收支记录、预算、统计、token-stats |
| jizhang-ai | server-ai/ | server-ai/index.js | 3001 | AI 对话、供应商管理、会话同步、江湖模拟器存档 |
| jizhang-salary | server-salary/ | server-salary/index.js | 3002 | 工时记录、工资配置、个税累计预扣、报表、CSV 导出 |
| jizhang-sgs | server-sgs/ | server-sgs/index.js | 3003 | 三国杀房间代理（转发到游戏服 8085） |

## 二、共享模块（不重复实现）

各后端通过相对路径导入 server/ 下的共享模块，**不复制代码**：

- server/db.js —— 唯一数据层（SQLite + schema + 迁移 + 密码哈希 + session）
- server/auth.js —— Bearer token 认证中间件（校验 sessions 表）
- server/config.js —— 集中配置（端口、API 地址等）
- server/rate-limit.js —— 限流中间件
- server/util.js —— 通用工具（日期、金额转换）
- server/ai-config.js —— AI 供应商配置（仅 AI 后端使用）

**关键点**：所有后端共用同一个 SQLite 数据库 data/jizhang.db（通过 DB_PATH 或默认路径），因此登录态（sessions 表）在所有应用间天然互通。

## 三、AI 后端的跨后端通信

AI 后端的记账工具（add_record / query_summary / query_month_total）**不再直连记账表**，改为通过 HTTP 调用主后端 API：

- POST /api/records —— 记账
- GET /api/stats/by-category —— 按分类汇总
- GET /api/stats/summary —— 月度汇总
- GET /api/categories —— 分类列表（buildContext 用）
- GET /api/records —— 最近记录（buildContext 用）

配置项：JZ_JIZHANG_API（默认 http://127.0.0.1:3000），在 ecosystem.config.example.cjs 中已设置。

> 设计意图：AI 后端不持有记账业务的 SQL 逻辑，记账数据只经主后端一个入口写入，保证缓存失效、权限校验、金额「分」单位等规则集中在主后端。

## 四、新增/修改的文件

### 新增
- server-ai/index.js —— AI 后端入口
- server-ai/routes/ai.js —— AI 路由（由原 server/routes/ai.js 复制改造）
- server-salary/index.js —— 工资后端入口
- server-salary/routes/salary.js —— 工资路由（由原 server/routes/salary.js 复制，仅改 import 路径）
- server-sgs/index.js —— 三国杀后端入口
- server-sgs/routes/sgs.js —— 三国杀路由（由原 server/routes/sgs.js 复制，仅改 import 路径）
- ecosystem.config.example.cjs —— PM2 四进程配置
- deploy/nginx.conf —— Nginx 路由分流参考配置
- BACKEND_SPLIT.md —— 本文档

### 修改
- server/index.js —— 移除 ai/sgs/salary 路由挂载与 public-chat 限流
- server/config.js —— 新增 aiPort/salaryPort/sgsPort/jizhangApi 配置
- package.json —— 新增 start:ai / start:salary / start:sgs / start:all 脚本
- deploy.sh —— 改为重启 4 个后端进程 + 逐端口健康检查

### 已删除（拆分收尾）
- server/routes/ai.js、server/routes/salary.js、server/routes/sgs.js 已删除。它们不再被主后端 index.js 引用，且与 server-ai/server-salary/server-sgs 下的新文件重复（其中 ai.js 已出现 119 行分叉），保留只会造成误改。

## 五、本地启动

```bash
# 方式一：分别启动
npm run start          # 主后端 3000
npm run start:ai       # AI 后端 3001
npm run start:salary   # 工资后端 3002
npm run start:sgs      # 三国杀后端 3003

# 方式二：一次性启动全部（前台并行）
npm run start:all
```

## 六、生产部署（PM2）

```bash
# 首次：注册全部进程
pm2 start ecosystem.config.example.cjs
pm2 save

# 后续：一键部署
./deploy.sh

# 单独重启某个后端（互不影响）
pm2 restart jizhang-ai
```

## 七、注意事项 / 已知约束

1. **共享 SQLite**：4 个进程打开同一个 data/jizhang.db。SQLite WAL 模式下多进程读安全、单写串行，本应用单用户量级足够。若后续并发上升，可考虑按模块拆库（工资库 / AI 库独立），或引入 Redis 做缓存与会话（用户已提出，作为后续方向）。
2. **迁移竞态**：4 个进程启动时都会执行 db.js 的迁移，幂等（IF NOT EXISTS + _migrations 表唯一约束），小概率竞态下多余进程回滚重试即可，无害。
3. **Nginx 顺序**：/api/ai/、/api/salary/、/api/sgs/ 必须放在 /api/ 之前，否则会全落到主后端。
4. **前端无需改动**：ai.html / wuxia.html / salary.html / sgs.html 仍调用原 /api/ai/*、/api/salary/*、/api/sgs/* 路径，由 Nginx 分流到对应端口，前端零改动。
5. **原路由文件已删除**：server/routes/ai.js、server/routes/salary.js、server/routes/sgs.js 已随本次收尾删除，主后端不再引用；如需查阅历史版本可用 git log。

## 八、后续可优化方向

- 按模块独立数据库文件（salary 独立 salary.db，AI 独立 ai.db），真正数据隔离。
- 引入 Redis：缓存统计结果、会话、AI 供应商列表（替代内存 Map）。
- AI 后端与主后端之间改为内网鉴权（服务间 token），避免依赖用户 token 透传。
- 各后端独立 package.json / 独立依赖，缩小镜像体积。
