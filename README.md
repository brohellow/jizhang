# 📒 记账本（jizhang-app）

一个**前后端分离**的记账软件：多账本、预算管理、统计报表。
先在本地运行验证，之后可部署到自己的服务器，前端可无缝替换为**微信小程序**（后端已是 REST API，并预留了微信登录接口）。

## 功能

- **多账本**：家庭、生意、旅行等互不干扰，一键切换，顶部 ✏️ 快速重命名
- **基础记账**：收入/支出、分类（自带默认分类、可自定义）、备注、日期，支持编辑/删除/搜索/筛选/分页
- **预算管理**：按月设置总预算和分类预算，进度条实时提示（>80% 变黄，超支变红）
- **统计报表**：月度汇总、近 12 个月收支趋势、月度分类占比、每日收支，ECharts 图表
- **账号系统**：注册/登录（scrypt 加密 + Bearer Token），数据按用户隔离
- **个人中心**：查看资料、修改昵称、修改密码（改密后强制重新登录）
- **CSV 导出**：按筛选条件一键导出账目为 CSV（Excel 可开，带中文表头）
- **AI 助手**：对话式智能记账（"今天午饭 25 块"→ 自动入账）、财务问答、消费分析；支持自定义供应商（DeepSeek / OpenAI / 兼容接口）与 API Key，配置可存个人中心或独立配置文件
- **微信登录**：预留 `POST /api/auth/wx-login`，配置环境变量后即可对接小程序 `wx.login`
- **手机端适配**：响应式界面，手机浏览器可直接使用（顶栏紧凑、筛选两列、分类大按钮）

## 技术栈

| 层 | 技术 |
|---|---|
| 后端 | Node.js ≥ 22.5（**内置 node:sqlite，零原生依赖**）+ Express |
| 数据库 | SQLite（WAL 模式，单文件，位于 `data/jizhang.db`） |
| 前端 | 原生 HTML/CSS/JS + ECharts（本地 vendor，离线可用） |
| 认证 | scrypt 密码哈希 + 随机 Token 会话（30 天有效） |

## 快速开始（本地）

```bash
npm install          # 安装 express
npm start            # 启动，默认 http://localhost:3000
# 或 npm run dev（文件变更自动重启）
```

浏览器打开 <http://localhost:3000>。

**演示账号**：`demo / demo123`（自带近 6 个月示例数据和本月预算）。
也可以直接注册新账号。

> 金额统一用「分」(整数) 存储和传输，避免浮点误差；前端展示时转为元。

## 目录结构

```
├── server/                  # 后端
│   ├── index.js             # Express 入口（静态前端 + API + 错误处理）
│   ├── db.js                # SQLite schema、种子数据、密码哈希、演示数据
│   ├── auth.js              # Bearer Token 认证中间件
│   ├── ai-config.js         # AI 配置模块（~/.jizhang/ai-config.json + 环境变量覆盖）
│   ├── util.js              # 日期/金额工具
│   └── routes/              # auth / ledgers / categories / records / budgets / stats / ai
├── public/                  # Web 前端（本地试用版，之后由小程序替代）
│   ├── index.html
│   ├── style.css
│   ├── app.js
│   └── vendor/echarts.min.js
├── scripts/
│   ├── smoke-test.mjs           # 核心 API 冒烟测试
│   ├── edge-test.mjs            # 边界/权限测试
│   ├── miniprogram-flow-test.mjs # 小程序端 API 流程模拟测试
│   └── backup-db.mjs            # 数据库一致性快照备份
├── miniprogram/             # 微信小程序端（导入微信开发者工具即可用）
│   ├── app.json / app.js / app.wxss
│   ├── project.config.json
│   ├── utils/               # config(后端地址) / api / format / charts
│   └── pages/               # login / records / stats / budget / profile
├── data/                    # SQLite 数据文件（自动创建，已 gitignore）
├── backups/                 # 数据库备份（自动创建，已 gitignore）
└── package.json
```

## API 文档

所有接口前缀 `/api`，除登录注册外需请求头 `Authorization: Bearer <token>`。
请求/响应均为 JSON，金额单位为**分**。

### 认证 auth

| 方法 | 路径 | 说明 |
|---|---|---|
| POST | `/auth/register` | 注册 `{username, password, nickname?}` → `{token, user}` |
| POST | `/auth/login` | 登录 `{username, password}` → `{token, user}` |
| POST | `/auth/wx-login` | 微信登录 `{code}` → `{token, user, is_new}`（需配置 WX_APPID/WX_SECRET） |
| GET | `/auth/me` | 当前用户信息（含 created_at）+ 账本列表 |
| PUT | `/auth/me` | 修改昵称 `{nickname}` |
| PUT | `/auth/password` | 修改密码 `{old_password, new_password}`（成功后清除该用户所有会话，强制重新登录） |
| POST | `/auth/logout` | 退出 |

### 账本 ledgers

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/ledgers` | 账本列表（含记录数） |
| POST | `/ledgers` | 新建 `{name, description?, currency?}` |
| PUT | `/ledgers/:id` | 重命名/编辑 |
| DELETE | `/ledgers/:id` | 删除（至少保留一个，级联删记录/预算） |
| POST | `/ledgers/:id/activate` | 设为当前账本 |

### 分类 categories

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/categories?type=expense\|income` | 分类列表 |
| POST | `/categories` | 新增 `{name, type, icon?}` |
| PUT | `/categories/:id` | 改名/换图标 |
| DELETE | `/categories/:id` | 删除（被记录使用的不可删） |

### 记账 records

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/records` | 列表。参数：`ledger_id? type? category_id? from? to? keyword? page? pageSize?` |
| GET | `/records/export` | 导出 CSV（参数同列表，返回 `text/csv` 附件，最多 5 万条）。网页版「明细」筛选栏有「导出 CSV」按钮 |
| POST | `/records` | 新增 `{ledger_id?, type, category_id?, amount(元), note?, record_date?}` |
| PUT | `/records/:id` | 编辑 |
| DELETE | `/records/:id` | 删除 |

### 预算 budgets

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/budgets?ledger_id=&month=YYYY-MM` | 总预算 + 分类预算（含已花/剩余） |
| PUT | `/budgets` | 设置/更新 `{ledger_id?, month, category_id?(空=总预算), amount}` |
| DELETE | `/budgets/:id` | 删除 |

### 统计 stats（均支持 `?ledger_id=&month=`）

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/stats/summary` | 月度收入/支出/结余/预算进度 |
| GET | `/stats/monthly?months=12` | 近 N 个月趋势 |
| GET | `/stats/by-category?type=expense` | 分类占比（含 pct） |
| GET | `/stats/daily` | 每日收支 |

### AI 助手 ai

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/ai/settings` | 读取 AI 配置（Key 打码；含来源 source：user=个人中心 / file=配置文件 / default=默认） |
| PUT | `/ai/settings` | 保存 AI 配置 `{provider, base_url?, model?, api_key?, enabled}`（api_key 留空=不修改） |
| POST | `/ai/settings/template` | 在用户目录生成配置文件模板 |
| POST | `/ai/chat` | AI 对话 `{message, ledger_id?}` → `{reply, tool_results}`（自动记账/查询） |

**AI 配置模块化**：配置来源按优先级 环境变量 > 个人中心(数据库) > 全局文件 > 内置默认。

- **全局配置文件**：`~/.jizhang/ai-config.json`（Windows: `C:\Users\<用户名>\.jizhang\`；pm2 以 root 运行则为 `/root/.jizhang/`），首次启动自动生成 `ai-config.example.json` 模板。修改后重启生效。
- **环境变量**：`JZ_AI_PROVIDER` / `JZ_AI_BASE_URL` / `JZ_AI_MODEL` / `JZ_AI_API_KEY` / `JZ_AI_ENABLED`（优先级最高，适合部署注入）
- **个人中心**：网页「个人中心 → AI 设置」保存的配置会覆盖全局文件（每用户独立）
- 支持供应商：`deepseek`（默认）、`openai`、`custom`（任何 OpenAI 兼容接口，需填 base_url + model）

配置文件示例：

```json
{
  "provider": "deepseek",
  "base_url": "",
  "model": "",
  "api_key": "sk-在此填入你的APIKey",
  "enabled": true
}
```

> base_url/model 留空时使用预设默认值（deepseek→`https://api.deepseek.com`/`deepseek-chat`；openai→`https://api.openai.com/v1`/`gpt-4o-mini`）。
> 配置为 JSON 格式错误时，接口会返回带路径和原因的清晰报错，不影响其他功能。

## 微信小程序对接

后端已按小程序习惯设计，直接调用即可：

1. **登录**：小程序端 `wx.login()` 拿 code → 调 `POST /api/auth/wx-login`，服务端用 `WX_APPID`/`WX_SECRET` 换 openid，首次登录自动建账号和默认分类/账本。
2. **配置**：部署时设置环境变量 `WX_APPID`、`WX_SECRET`（微信公众平台 → 开发管理 → 开发设置）。
3. **域名**：小程序 request 域名必须是 **HTTPS + 已备案** 的域名，在公众平台「开发设置 → 服务器域名」里添加。
4. **Token**：接口返回的 token 存小程序 `wx.setStorageSync`，请求头带 `Authorization: Bearer <token>`。
5. 其余业务接口与上表一致（金额单位分）。

## 部署到服务器

以 Ubuntu + nginx + PM2 为例：

```bash
# 1. 服务器装 Node ≥ 22（自带 sqlite）
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt-get install -y nodejs

# 2. 上传代码（或 git clone）并安装
cd /opt/jizhang-app
npm install

# 3. 用 PM2 常驻运行
npm install -g pm2
WX_APPID=xxx WX_SECRET=xxx PORT=3000 pm2 start server/index.js --name jizhang
pm2 save && pm2 startup

# 4. Nginx 反向代理 + HTTPS（certbot 一键签发证书）
#    server { server_name jizhang.example.com; location / { proxy_pass http://127.0.0.1:3000; ... } }
sudo apt-get install -y nginx certbot python3-certbot-nginx
sudo certbot --nginx -d jizhang.example.com
```

- 数据文件在 `data/jizhang.db`（WAL 模式，单文件）。

### AI 配置（可选）

不配置则 AI 助手不可用，其他功能不受影响。两种方式：

```bash
# 方式一：服务器上直接写配置文件（推荐）
sudo mkdir -p /root/.jizhang
sudo nano /root/.jizhang/ai-config.json   # 参考 ai-config.example.json
sudo pm2 restart jizhang-api

# 方式二：环境变量注入（适合部署脚本）
JZ_AI_PROVIDER=deepseek JZ_AI_API_KEY=sk-xxx JZ_AI_ENABLED=1 pm2 restart jizhang-api
```

也可以让用户登录后在网页「个人中心 → AI 设置」里填（存数据库，每用户独立）。

### 数据自动备份

内置一致性快照备份脚本（`VACUUM INTO`，不会产生损坏备份），默认保留最近 14 份：

```bash
node scripts/backup-db.mjs   # 备份到 backups/，可设 JZ_BACKUP_KEEP 控制保留份数
```

服务器上配置每天凌晨 2:30 自动备份：

```bash
(crontab -l 2>/dev/null; echo "30 2 * * * /usr/bin/node /opt/jizhang/scripts/backup-db.mjs >> /opt/jizhang/backups/backup.log 2>&1") | crontab -
```

恢复：用任意一份备份文件替换 `data/jizhang.db` 后 `pm2 restart jizhang-api` 即可。

- 生产环境建议加一层限流（如 `express-rate-limit`）防止暴力登录。

## 测试

```bash
node scripts/smoke-test.mjs    # 核心链路：登录/账本/分类/记账/统计/预算
node scripts/edge-test.mjs     # 边界与权限：中文用户名/跨用户/校验失败分支
```
