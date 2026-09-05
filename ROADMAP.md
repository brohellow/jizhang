# 记账本项目演进与改造路线图

> 生成时间：2026-09-03。基于对仓库全部后端源码（server/ 16 文件）、前端结构、测试脚本与数据库实测的逐行审查。
> 所有问题均给出文件与行号；两个 P0 推断已在本地用 node:sqlite 实测复现。

---

## 0. 前提与假设

- 部署形态不变：单机 + PM2 单进程 + SQLite 单文件，不引入外部数据库/缓存。
- 技术栈不变：Node 22（node:sqlite）+ Express 4 + 原生前端。不引入框架迁移类大改。
- 服务器（124.222.195.163）数据库与本地 data/jizhang.db 结构同源（老版 salary_config 只有 9 列——本地已实测）。
- 工资模块的"个税/节假日"计算以中国大陆口径为准。

---

## 1. 整体架构

### 1.1 当前架构（实测）

```
浏览器（public/ 记账本 · portal/ 主站5页）   微信小程序（miniprogram/，未联调）
                    │  localStorage.jz_token 共享登录态
                    ▼
              Nginx（静态 + 反代 :3000，js/css 缓存 7 天）
                    ▼
        Express 单进程（server/index.js）
          ├─ 中间件：json(512kb) / 慢请求日志 / 安全头 / 3 级限流
          ├─ routes/ 10 个路由文件 ── 每个直接持 db 单例写 SQL
          │     ├─ auth ledgers categories records budgets stats
          │     ├─ ai（含公用免登录 /public-chat + 江湖存档 + Bing/汇率工具）
          │     ├─ salary（配置 + 工时 + 个税 + CSV）
          │     └─ sgs（代理游戏服） token-stats（JSON 文件存储）
          ├─ db.js：schema + 种子数据 + 密码哈希（唯一数据层）
          └─ 外部依赖：LLM API / 微信 jscode2session / Bing / er-api / SGS 游戏服
                    ▼
           SQLite（WAL，data/jizhang.db）
```

### 1.2 目标架构（不推翻，只明确边界）

```
client 层    public/ · portal/ · miniprogram/     —— 只调 /api，不持有业务规则
edge 层      Nginx                                 —— 静态缓存、HTTPS（待备案）、gzip
api 层       Express
  ├─ middleware/   auth、rate-limit、安全头、慢日志、统一错误（现状已具备，保留）
  ├─ routes/       HTTP 适配层：参数校验 + 调用 domain + 响应，不直接写 SQL
  ├─ domain/       纯函数模块：salary-calc.js（工时/加班/个税）、record-validator.js
  │                —— 无 Express 依赖，可被 scripts/ 单测直接 import
  └─ data/         db.js（连接 + PRAGMA + 全量 schema + user_version 迁移）
                   repositories 可选（当前 SQL 量小，不强制）
依赖方向     routes → domain → data，禁止反向；schema 只允许出现在 data 层
```

### 1.3 差距清单

| # | 差距 | 现状位置 | 严重度 |
|---|---|---|---|
| G1 | schema 创建分散在两处 | db.js（主）+ routes/ai.js:136/157（wuxia_saves、ai_providers） | 中 |
| G2 | 无迁移机制，靠"ALTER try/catch 等幂"裸奔 | db.js:109-113（且已漏 6 列，见 P0-3） | 高 |
| G3 | 工资计算（工时/加班/个税）混在路由里，无法单测 | routes/salary.js 全部 | 高 |
| G4 | 配置读取散落：SGS_API/SYNC_KEY/WX_* 各自读 env | sgs.js:8、token-stats.js:14、auth.js:130 | 低 |
| G5 | 无构建/发布环节：前端版本号手工维护 | public/index.html:13/306/307（?v=20260826） | 中 |
| G6 | salary 模块金额用浮点元，破坏全项目「分」约定 | routes/salary.js 计算与响应 | 中 |

---

## 2. 阶段划分

### P0 —— 稳定性、缺陷与风险（目标：消灭已证实的 bug 与出血点）

- **覆盖范围**：2 个已实测复现的崩溃/500、1 个编码损坏、1 个资损风险、3 个工资计算错误。
- **验收标准**：
  1. 删掉 data/jizhang.db 后全新启动成功，且 smoke-test 全绿；
  2. 老库（缺 6 列）上 `PUT /api/salary/config` 返回 200；
  3. 同一 IP 第 31 次/小时调 `/api/ai/public-chat` 返回 429；
  4. 个税用例：1-3 月各收入 8000 元，3 月个税 ≠ 单月独立计算值（验证累计预扣）；2026-02-17（春节）判节假日、2026-01-28 不判；
  5. `standard_hours=6` 时日工时 7h 的加班 = 1h。
- **预估工作量**：2.5–3 人天。

### P1 —— 可维护性与性能（目标：改代码不再踩坑）

- **覆盖范围**：缓存一致性、schema 集中 + 迁移机制、失效的性能 SQL、密钥兜底、发布自动化、测试补齐、金额单位统一。
- **验收标准**：
  1. AI 记账后立即 `GET /api/records` 可见新记录（不等缓存 TTL）；
  2. `grep -rn "CREATE TABLE" server/` 只命中 db.js 与 migrations；
  3. 修改 app.js 后无需手工改 `?v=`（脚本自动 bump）；
  4. 新增 salary-test.mjs 全绿（含老库缺列兼容场景）；注册流程中断无半成品用户；
  5. salary 接口金额字段全部为整数分，前端展示正常。
- **预估工作量**：5–6 人天。

### P2 —— 能力扩展（目标：按产品优先级插拔）

- **覆盖范围**：微信小程序联调、HTTPS/备案、AI 会话云端同步、工资报表、多币种、前端模块化。
- **验收标准**：按特性单独定义（见第 3 节 P2 各项）。
- **预估工作量**：每项 2–5 人天，总计 15–20 人天，按优先级取。

---

## 3. 细分改造项

### P0 阶段（7 项）

---

**P0-1 修复 db.js 索引先于表创建（全新部署必崩）**

- 文件：`server/db.js:62`（`CREATE INDEX idx_budgets_month ON budgets(...)` 位于 63 行 `CREATE TABLE budgets` 之前）
- 原因：同一 `db.exec` 顺序执行，索引引用的表尚不存在 → 空库启动抛 `no such table: budgets`。**已实测复现**。
- 改前/改后：索引语句移到 budgets 表 CREATE 之后即可；现有库因 `IF NOT EXISTS` 幂等无任何影响。
- 依赖：无。兼容：完全兼容。回滚：git revert。

**P0-2 修复 db.js 编码损坏与失效的 PRAGMA**

- 文件：`server/db.js:15-17`、`:42`、`:168`、`:171`
- 现状：文件被 GBK 编辑器污染——注释乱码（`鎬ц兘`）；第 17 行四条语句挤在一行，后三条 `db.exec(...)` 被前一条的行内注释吞掉 → `cache_size=16MB`、`temp_store=MEMORY`、`wal_autocheckpoint` **从未生效**；默认分类 icon 是乱码 `'馃搶'`；demo 昵称 `'婕旂ず璐﹀彿'`（演示账号）、`'婕旂ず璐︽湰'`（演示账本）乱码。
- 改法：四条 PRAGMA 各自独立成行；乱码注释重写或删除；icon 改 `'📦'`；demo 昵称/账本名改回中文，并加一段一次性修正：`UPDATE users SET nickname='演示账号' WHERE username='demo' AND nickname LIKE '婕%'`（对已被污染的存量库）。
- 依赖：无。兼容：PRAGMA 即时生效，正向影响。回滚：git revert。

**P0-3 补齐 salary_config 六列迁移（老库保存配置必 500）**

- 文件：`server/db.js:109-113`（ALTER 兼容块）
- 现状：CREATE TABLE 已含 `tax_threshold/social_security/housing_fund/other_deduction/standard_hours/holidays` 六列，但 ALTER 兼容块只补了 4 列；老库（本地已实测缺列）上 `PUT /api/salary/config` 抛 `no such column: tax_threshold` → 500。**已实测复现**。
- 改法：按现有 try/catch 幂等模式补 6 条 ALTER（含各自 DEFAULT 值）。
- 依赖：无。兼容：幂等，新列已存在则跳过。回滚：无需回滚（多出的列无害）。

**P0-4 public-chat 增加专用限流与输入约束（资损风险）**

- 文件：`server/index.js:75` 挂载点、`server/routes/ai.js:52-121`
- 原因：`POST /api/ai/public-chat` 免登录、用服务器公用 key、接受任意 `system_prompt`，仅受全局 300 次/分钟/IP 约束——脚本可日调数十万次烧穿 LLM 额度。
- 改法：① index.js 加 `app.use('/api/ai/public-chat', rateLimit({ windowMs: 3600_000, max: 30 }))`；② message 截断 2000 字符、history 每条截断 2000 字符、system_prompt 截断 8000 字符；③ max_tokens 1024 保留。
- 依赖：无。兼容：正常用户无感，高频匿名调用方收 429。回滚：删除中间件一行。

**P0-5 修正个税计算（现为伪累计预扣）**

- 文件：`server/routes/salary.js:220-262`（calcTax/calcTaxBracket）、`:299`、`:380`
- 现状三宗罪：① 调用处 `calcTax(totalGrossSalary, monthNum, totalGrossSalary)` 把**当月收入当累计收入**，prevCumulative 恒为 0，退化为单月计税；② calcTax 内部 `brackets` 数组是死代码（从未使用）；③ 起征点硬编码 5000，无视 `cfg.tax_threshold`。
- 改法：查询当年 1 月至目标月全部 work_records，逐月算 gross 累加得 cumulativeIncome，按累计预扣公式：本月应扣 = 累计应纳税所得额×税率−速算扣除数−已预扣税额；起征点改用 cfg.tax_threshold；删除死代码。
- 依赖：与 P0-6 同函数，建议同改。兼容：计算结果变化（更正确），前端文案建议加"按累计预扣法估算"。回滚：git revert。
- 备选（降级方案）：若不想做跨月累计，改为"按月简易估算"并在 UI 明确标注口径——避免给出看似精确的错数。

**P0-6 standard_hours 配置接入（当前是死字段）**

- 文件：`server/routes/salary.js:88`（`const standardHours = 8`）、`:134`、`:154`
- 改法：统一改用 `Number(cfg.standard_hours) || 8`；db.js 默认值已是 8，行为不变仅可配置。
- 依赖：P0-3（列要存在）。回滚：git revert。

**P0-7 节假日判断去年份硬编码**

- 文件：`server/routes/salary.js:36-43`
- 现状：`springFestival = ['01-28'...'02-06']` 是 **2025 年**春节；2026 年春节为 02-17，今年全部误判（2 倍/3 倍加班费算错）。
- 改法：删除硬编码春节数组；固定假日保留；浮动假日完全交给 `cfg.holidays`（配置页已支持），并在 salary.html 配置区提示"请按当年国务院放假安排填写"。
- 依赖：无。兼容：行为修正。回滚：git revert。

---

### P1 阶段（10 项）

**P1-1 AI 记账后缓存未失效** — `routes/ai.js:434`（runTool add_record）：成功后调用 stats.js 的 `cacheInvalidate()` 与 records.js 的 recInvalidate（需将后者导出）。改前 AI 记账后 3-5 秒内列表/统计为旧数据；改后立即一致。兼容：无破坏。

**P1-2 schema 集中 + user_version 迁移机制** — `routes/ai.js:136/157` 两处 CREATE TABLE 移入 db.js；引入 `PRAGMA user_version` + migrations 数组（每版一组语句，启动时按序补执行）。P0-3 的 ALTER 块改写为第 1 号 migration。兼容：幂等。回滚：revert。

**P1-3 移除 token-stats 默认密钥** — `routes/token-stats.js:14`：`SYNC_KEY || 'dsh-token-sync-default'` 兜底等于无密钥，任何人可 POST 覆盖面板数据。改为未配置时 POST 返回 503。**破坏性高（运维向）**：须先在服务器 `pm2` 环境配 `TOKEN_SYNC_KEY` 再上线，否则本地小工具同步中断。

**P1-4 save-state 存档限额** — `routes/ai.js:20-36`：限制 `JSON.stringify(data).length ≤ 256KB`、key 长度 ≤ 64 且字符白名单。防止任意 key × 512KB 灌爆 SQLite。兼容：正常存档（KB 级）无感。

**P1-5 AI 外部调用超时补全** — `routes/ai.js:674`（第二轮 tool 结果 fetch 无 AbortController，上游挂起则请求挂死，补 90s 超时）；`:384`（`fetch(..., {timeout: 8000})` 在 Node 无效，改 `signal: AbortSignal.timeout(8000)`）。

**P1-6 stats/monthly 缓存与索引友好化** — `routes/stats.js:90-111`：该接口无缓存（其余均有）且 `substr(record_date,1,7)` 全表 GROUP BY。改法：按 months 参数推算 `record_date >= 下界` 走 `idx_records_lookup`，加 5s 缓存。数据量达十万级时从 O(n) 降为 O(近N月)。

**P1-7 前端版本号自动化** — 新增 `scripts/bump-version.mjs`：扫描 public/index.html、portal/*.html，把所有 `?v=` 替换为当天 `?v=YYYYMMDD[-HHmm]`；npm script `"bump": "node scripts/bump-version.mjs"`，部署前执行。消灭交接文档第 2 条已知坑。验收：grep 全部 html 版本号一致。

**P1-8 注册事务化** — `routes/auth.js:41-46`：INSERT user → 种子分类 → 默认账本 → 回写 current_ledger_id 四步包进 `BEGIN/COMMIT`，失败 ROLLBACK。改前中途失败留无分类的半成品账号；改后原子。兼容：无。

**P1-9 salary 金额统一为「分」** — `routes/salary.js` 全部计算与响应 + `portal/salary.html` 展示层：内部用整数分（工时×时薪按每条记录四舍五入到分，消除浮点累加），响应字段（`*_salary`、`hourly_rate` 等）由浮点元改整数分，前端 /100 展示。**破坏性高**：API 契约变化，前后端必须同批上线。依赖：建议在 P0-5/6/7 之后做（同文件，避免冲突）。回滚：前后端一起 revert。

**P1-10 优雅停机 + 测试补齐** — `server/index.js`：`SIGTERM/SIGINT` → `server.close()` → `db.close()`（PM2 reload 不再硬切 WAL）。新增 `scripts/salary-test.mjs`：覆盖 config GET/PUT（含缺列老库场景）、records CRUD、export、加班/节假日用例；smoke-test 补注册边界与登录锁定用例。

**P1-11 临时文件清理与提交** — 删除 `tmp-check-db.js`、`tmp-check-salary.js`、`tmp-salary-upload.js`（已确认与 routes/salary.js 逐字节相同，diff=0）；`tmp-nginx.conf` 若是目标配置则移入 `deploy/nginx.conf` 纳入版本管理，否则删除。随 P0 修复一起提交。

**P1-12 配置集中** — 新增 `server/config.js` 统一读取 env（PORT/WX_*/SGS_API/TOKEN_SYNC_KEY/JZ_*），各模块 import 而非各自读 `process.env`。兼容：无行为变化。

---

### P2 阶段（6 项，按建议优先级排序）

| # | 项 | 内容 | 验收 | 工作量 |
|---|---|---|---|---|
| P2-1 | 微信小程序联调 | 服务器配 WX_APPID/WX_SECRET；公众平台加 request 域名；miniprogram/utils/config.js 指向生产；真机验证 wx-login → 建号 → 记账 → 统计 | 真机全流程通过 | 3 天 |
| P2-2 | HTTPS + 备案 | 20111108.xyz 完成 ICP 备案 → tmp-nginx.conf 转正 deploy/nginx.conf → certbot 签证书 → 全站跳转 HTTPS | https 访问 + 小程序域名合规 | 2 天（不含备案等待） |
| P2-3 | AI 会话云端同步 | 新表 ai_conversations(user_id, title, messages JSON, updated_at) + 列表/读取/删除接口；前端断线恢复会话 | 换设备可见历史会话 | 3 天 |
| P2-4 | 工资报表 | /api/salary/report?from&to 跨月汇总（周/月视图）+ salary.html 图表（复用 ECharts） | 跨月数据与逐月之和一致 | 2 天 |
| P2-5 | 多币种启用 | ledgers.currency 字段已存在未使用：记账页显示币种符号、统计页按币种分组、接已有汇率工具换算参考值 | 双币种账本互不影响 | 4 天 |
| P2-6 | 前端模块化 | app.js（2488 行单 IIFE）拆为 ES Modules（api/state/views），不引构建工具，原生 module 加载 | 功能回归全绿 | 5 天（可选，收益中等） |

---

## 4. 风险与约束

| 改动 | 破坏性 | 影响面 | 回滚策略 |
|---|---|---|---|
| P0-1 索引顺序 | ★ 无 | 仅全新部署 | git revert |
| P0-2 PRAGMA/乱码 | ★ 低 | 性能参数生效（正向）；存量 demo 昵称需一次性 UPDATE | revert；数据修正可重复执行 |
| P0-3 salary 补列 | ★ 无 | ALTER 幂等 | 无需回滚（SQLite 加列无害） |
| P0-4 限流 | ★★ 中 | 高频匿名 AI 调用方收 429 | 调阈值或删中间件一行，秒级恢复 |
| P0-5 个税 | ★★ 中 | 用户可见数字变化（修正向）；若选降级方案则仅文案变化 | revert + 前端口径说明 |
| P0-6/7 工时/节假日 | ★ 低 | 加班费金额变化（修正向） | revert |
| P1-1 缓存失效 | ★ 无 | 写后多读一次库 | revert |
| P1-2 迁移机制 | ★ 低 | 启动时多一次 user_version 检查 | revert |
| P1-3 密钥兜底移除 | ★★★ 高（运维） | 服务器未配 TOKEN_SYNC_KEY 则同步中断 | 先配环境变量再上线；pm2 restart 即恢复 |
| P1-9 金额单位 | ★★★ 高 | API 契约变化，前端/小程序同改 | 前后端同批 revert；上线前本地全链路回归 |
| P2 各项 | ★ 低 | 均为新增能力 | 不启用/不发布即可 |

**全局约束**：
- SQLite 单文件 + 单进程：所有迁移必须幂等且向后兼容（只加不删）；任何 DROP/RENAME 类变更走"备份→离线迁移→验证→切换"流程，`scripts/backup-db.mjs` 先跑。
- 每次上线前固定动作：`node scripts/backup-db.mjs`（服务器）→ 本地 smoke-test 全绿 → `npm run bump` → 部署 → 线上 smoke-test。
- 金额对外契约以「分」为唯一标准（P1-9 后 salary 模块归队）。

---

## 5. 需要你补充/确认的信息

1. **tmp-nginx.conf** 是否就是目标 Nginx 配置？20111108.xyz 备案进度如何？（决定 P2-2 排期）
2. 服务器 pm2 环境里**是否已配 TOKEN_SYNC_KEY**？（决定 P1-3 能否直接上）
3. 工资模块产品决策：**周末工作**是全天 2 倍、还是仅超标准工时部分 2 倍（现状后者，与劳动法惯例不符）？
4. 个税选**真累计预扣**（推荐）还是**按月简易估算+口径标注**？
5. demo 账号昵称乱码是否已污染线上数据，需要顺手修正吗？
6. 小程序（P2-1）是否为下一阶段最高优先级？
