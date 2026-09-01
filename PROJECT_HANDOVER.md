# 记账本 + 主站 项目交接文档

> 本文档用于新 AI 助手（opencode harness）接手本项目时快速了解架构、功能与历史改动。
> 生成时间：2026-08-26

---

## 一、项目概览

**项目名称**：记账本（jizhang）+ 个人主站门户

**技术栈**：
- 后端：Node.js 22+（内置 node:sqlite，零原生依赖）+ Express 4
- 前端：原生 HTML/CSS/JS（无框架），ECharts（图表）、KaTeX（LaTeX 渲染）、Canvas（粒子背景）
- 数据库：SQLite（WAL 模式），单文件 data/jizhang.db
- 进程管理：PM2
- 部署：腾讯云 124.222.195.163（Ubuntu 24.04），Nginx 反向代理

**代码位置**（本地工作目录 H:document记账软件）：
- 后端：server/（入口 server/index.js，路由 server/routes/）
- 记账本前端：public/
- 主站门户：portal/
- 数据库：data/jizhang.db（git 忽略，含真实用户数据）

**Git 仓库**：https://github.com/brohellow/jizhang.git（分支 master）

---

## 二、部署架构（重要）

### 访问路径（Nginx 路由）
- http://124.222.195.163/ → 主站门户（/opt/www/index.html）
- http://124.222.195.163/jizhang/ → 记账本（/opt/jizhang/public/）
- http://124.222.195.163/ai.html → AI 助手（独立页）
- http://124.222.195.163/wuxia.html → 江湖模拟器（AI 游戏）
- http://124.222.195.163/salary.html → 工时工资（独立页）
- http://124.222.195.163/sgs.html → 三国杀联机大厅
- /api/* → 记账本后端（:3000）
- /sgs-api/* 和 /sgs-ws/* → 三国杀游戏服务器（:8085/:8080）

### 服务器关键路径
- 主站文件：/opt/www/（index.html、ai.html、wuxia.html、salary.html、sgs.html、katex/）
- 记账本：/opt/jizhang/public/（前端）+ /opt/jizhang/server/（后端）
- 数据库：/opt/jizhang/data/jizhang.db
- AI 配置：/root/.jizhang/ai-config.json（公用 AI 供应商 key）
- Nginx 配置：/etc/nginx/sites-enabled/jizhang
- 部署脚本：/opt/jizhang/deploy.sh（git pull + pm2 restart）

### PM2 进程
- jizhang-api（记账本后端，端口 3000，最大内存 300M）
- sgs-server（三国杀游戏服务器，端口 8080/8085）
- pm2-logrotate（日志轮转）

---

## 三、后端路由清单

| 路由文件 | 前缀 | 功能 |
|---|---|---|
| auth.js | /api/auth | 登录/注册/me/登出（Bearer token 认证） |
| ledgers.js | /api/ledgers | 账本 CRUD |
| categories.js | /api/categories | 分类 CRUD |
| records.js | /api/records | 收支记录（核心，含缓存/导出） |
| budgets.js | /api/budgets | 预算 |
| stats.js | /api/stats | 统计（summary/monthly/by-category/daily 等） |
| ai.js | /api/ai | AI 对话（/chat、/providers、/public-chat 免登录） |
| sgs.js | /api/sgs | 三国杀房间代理 |
| token-stats.js | /api | token 统计同步 |
| salary.js | /api/salary | 工时工资模块 |

### 认证机制
- Bearer token，存 sessions 表，30 天过期
- token 存前端 localStorage.jz_token（所有应用共享同一 key，实现账号互通）
- 密码 scrypt 哈希 + salt

---

## 四、工时工资模块（本次新增 + 拆分）

### 模块定位
- 名称：工时工资（直观：记录工时 + 算工资）
- 独立页面：portal/salary.html（主站入口，不再内嵌记账本）
- 后端：server/routes/salary.js

### 数据库表
- work_records(id, user_id, work_date, start_time, end_time, content, created_at)
- salary_config(user_id, mode('hourly'|'daily'), hourly_rate, daily_rate, updated_at)

### 工资计算规则
- 按小时（默认）：单条工资 = 时薪 × 工时；工时 = 结束-开始，若结束≤开始则 +24h（跨天）
- 按天：单条工资 = 日薪
- 默认值：时薪 30 元/小时（存 3000 分），日薪 250 元/天（存 25000 分）
- 金额用「分」存储（整数，避免浮点误差）
- 同一天多条记录自动累加

### API 接口
- GET /api/salary/config → 获取工资配置
- PUT /api/salary/config → 更新工资配置
- GET /api/salary/records?month= → 查询某月记录+汇总
- POST /api/salary/records → 添加记录
- DELETE /api/salary/records/:id → 删除记录

### 拆分说明
工资模块最初做在记账本 tab 里，后拆分为主站独立页 salary.html（与 AI 助手、江湖模拟器一致的模式），复用记账本登录 token。

---

## 五、主站门户应用清单

| 文件 | 应用 | 说明 |
|---|---|---|
| index.html | 门户首页 | 登录/注册 + 应用卡片导航 |
| ai.html | AI 助手 | 独立 AI 对话（含模型管理、记忆、免登录公用 key） |
| wuxia.html | 江湖模拟器 | AI 驱动的武侠互动游戏（LaTeX 面板渲染） |
| salary.html | 工时工资 | 工时记录 + 工资计算 |
| sgs.html | 三国杀联机大厅 | 房间列表（免登录） |
| wuxia-data.js / wuxia-concise.js | 江湖提示词 | 完整/精简版游戏规则 |
| katex/ | KaTeX 库 | LaTeX 渲染（本地托管，含字体） |

---

## 六、记账本当前状态

### 导航 tab（4 个核心）
1. 记账（record）
2. 统计（stats）
3. 预算（budget）
4. 账本与分类（ledger）

### 已从记账本移除（剥离到主站独立页）
- AI 助手 tab → 已移 /ai.html
- 联机大厅链接 → 已移 /sgs.html
- 工时工资 tab → 已移 /salary.html
- 后端对应接口（ai/sgs/salary）全部保留，只是前端入口移到主站

---

## 七、登录与账号互通（重点）

- 主站 index.html 有登录/注册功能（复用 /api/auth/*）
- 登录成功后 token 存 localStorage.jz_token
- 同一域名下所有应用共享 localStorage，因此：
  - 主站登录 → 记账本/AI/江湖/工资自动识别登录态
  - 任一应用登录 → 其他应用同样互通
- 未登录用户可用 AI 助手（走 /api/ai/public-chat 公用 key）和联机大厅

---

## 八、AI 相关（重要背景）

### AI 供应商配置
- 文件：/root/.jizhang/ai-config.json（公用 key，所有用户可用）
- 公用供应商：SenseNova 商汤（https://token.sensenova.cn/v1）
- 可用模型：sensenova-6.8-flash-lite（其他模型已确认 404 或配额耗尽）
- 关键经验：SenseNova 是推理模型，必须加 thinking 参数 disabled 否则回复进 reasoning 字段导致 content 为空

### AI 接口
- POST /api/ai/chat（登录，带 tools 记账工具）
- POST /api/ai/public-chat（免登录，公用 key，无 tools）
- GET/POST/DELETE /api/ai/providers（供应商管理）

### 江湖模拟器特殊处理
- 完整规则 18KB 会淹没模型上下文导致记不住对话
- 解决：首次创角用完整规则，后续对话用精简规则（1KB）保证记忆连贯

---

## 九、已知坑与注意事项

1. 文件换行：public/app.js、public/index.html 用 CRLF（
），编辑时注意匹配
2. 静态资源缓存：Nginx 对 js/css 缓存 7 天，改动前端必须更新版本号（index.html 里 ?v=YYYYMMDD）
3. SenseNova 模型：必须带 thinking 参数 disabled；system 消息 content 必须是字符串（数组会报 400）
4. 金额单位：一律用「分」存储传输（整数），前端显示时 /100
5. 跨天工时：结束时间 ≤ 开始时间时 +24 小时
6. 部署流程：本地改 → git commit → push（可能需 -c http.sslBackend=openssl 或直连）→ 服务器 deploy.sh
7. GitHub 推送：用户代理 127.0.0.1:7897 不稳定时，直连或 ghfast 镜像
8. demo 账号：demo / demo123（含示例数据）

---

## 十、当前 git 状态（交接时点）

- 最新提交：70db3c1 feat: AI公用key免登录模式+独立页完善
- 本地有未提交改动（本次优化：移除 AI tab、联机大厅、工资模块拆分到主站）
- 建议：交接后先 git status 确认，再决定是否提交

---

## 十一、待办/可改进方向

- ICP 备案（域名 20111108.xyz 备案完成后可配 HTTPS）
- 工资模块可加：周/月报表、导出 CSV
- AI 助手可加：会话历史云端同步
- 江湖模拟器：完整规则分片加载优化

---

*本文档由上一任 AI 助手生成，供新 harness 快速接手。*
