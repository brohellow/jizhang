# 记账本项目 · 本次会话全部改动记录

> 记录时间：2026-09-15
> 项目：记账本（jizhang）+ 主站门户 + 三国杀联机
> GitHub：github.com/brohellow/jizhang（分支 master）
> 服务器：124.222.195.163（/opt/jizhang、/opt/www、/opt/sgs）

---

## 一、基础设施与工作流搭建

### 1. 三端同步工作流（本机 ↔ GitHub ↔ 服务器）
- 架构：本机写代码 → push GitHub → 服务器 deploy.sh 拉取部署
- 本机 ↔ GitHub：因直连 github.com 被墙，改用 SSH over 443（ssh.github.com:443），生成 ed25519 密钥并配置 ~/.ssh/config
- GitHub ↔ 服务器：走 ghfast.top 镜像加速
- 本机 ↔ 服务器：仅 SSH 命令操作，不直接同步代码

### 2. 服务器运维修复
- 修复 /opt/jizhang/node_modules 和 package-lock.json 的 root 属主问题（导致 npm ci 报 EACCES）
- 修复 /opt/jizhang/backups 目录 root 属主问题（导致手动备份失败）
- 排查「只读数据库」告警（2026-09-12 03:22 临时问题，已自愈，确认后端读写正常）

---

## 二、Bug 修复（非策划案项）

### 1. 手机端记账备注框错位（13234ed）
- 问题：手机端聚焦「备注」输入框时，页面自动上滑看不到输入内容
- 根因：记账表单卡片 position: sticky 在单列布局（≤860px）仍生效
- 修复：单列布局下取消 sticky

### 2. salary.html 乱码（5cd5d38）
- 问题：工资页标题、文案全部乱码（GBK/UTF-8 双重编码）
- 根因：历史提交 e2573eb「修复编码问题」反而把文件搞坏
- 修复：反向解码 + 手动修复 20+ 处中文文案

### 3. 工资汇总金额显示缩小 100 倍（4cd46cd）
- 问题：汇总金额显示为实际值的 1/100
- 根因：后端返回「元」，前端 fmtMoney 却 ÷100 当「分」
- 修复：汇总字段改为直接展示元；顺带修 fmtMoney 里漏网的「楼」乱码（应为 ¥）

### 4. 工资页空白（4b25e26）【本次最后修复】
- 问题：手机端点进工资页完全空白
- 根因：salary.html 存在孤儿重复代码块 + 丢失引号的断字符串 + 大括号不匹配，导致 JS 语法错误
- 修复：删除 2 段孤儿渲染块 + 删除重复保存块 + 补断字符串 + 重建收尾括号（净删约 60 行损坏代码）

---

## 三、P0 阶段（稳定性，commit 2ca1e4c）

| 编号 | 内容 | 文件 |
|---|---|---|
| P0-3 | 补齐 salary_config 六列迁移（tax/social/housing/other/standard_hours/holidays） | db.js |
| P0-4 | public-chat 专用限流（1h/30次/IP）+ 输入截断 | index.js + ai.js |
| P0-5 | 个税改为真累计预扣法（查全年累计 + 起征点接配置 + 删死代码） | salary.js |
| P0-6 | standard_hours 死字段接入配置 | salary.js |
| P0-7 | 移除春节硬编码日期（交给 cfg.holidays） | salary.js |

注：P0-1（索引顺序）、P0-2（PRAGMA/编码）经核查已在此前的 migration 重构中修复。

---

## 四、P1 阶段（可维护性，4 个 commit）

### commit f77f524
| 编号 | 内容 |
|---|---|
| P1-1 | AI 记账后缓存失效（records.js 导出 recInvalidate + ai.js 调用） |
| P1-4 | 江湖存档限额（key ≤64 + data ≤256KB） |
| P1-5 | AI 第二轮 fetch + 汇率超时补全 |
| P1-6 | stats/monthly 加缓存 + 范围下界走索引 |
| P1-8 | 注册流程事务化（BEGIN/COMMIT） |

### commit a33de61
- P1-10：优雅停机（SIGTERM/SIGINT → server.close → db.close）
- P1-7：前端版本号自动化脚本（scripts/bump-version.mjs + npm run bump）

### commit 8269562
- P1-3：token-stats 移除默认密钥（未配置则禁用同步）
- P1-2：schema 集中（wuxia_saves、ai_providers 从 ai.js 移入 db.js）

### commit c017d60
- P1-12：配置集中（新建 server/config.js，7 文件 env 读取统一）

注：P1-9（salary 金额统一为分）仅做了最小安全修复（修显示 bug），完整 API 契约变更因高风险未做。P1-11（临时文件）核查后已是完成态。

---

## 五、P2 阶段（能力扩展，5 个 commit）

| 编号 | commit | 内容 |
|---|---|---|
| P2-4 | 35a4bd8 | 工资跨月报表（/api/salary/report 接口 + 前端近12月汇总）+ 修 salary-summary 乱码 |
| P2-3 | 87ef709 | AI 会话云端同步后端（ai_conversations 表 + 5 个 CRUD 接口） |
| P2-3 | 1f609bd | AI 会话云端同步前端（保存/列表/加载/删除按钮） |
| P2-5 | c10fc0d | 多币种（金额按账本币种显示符号） |
| P2-6 | 0b30e93 | 前端模块化第一步（抽纯工具函数到 public/js/utils.js） |

---

## 六、未完成项（诚实说明）

1. P2-6 完整版：ES Modules 拆分 app.js（高风险重构，只做了第一步 utils.js）
2. P1-9 完整版：salary 金额统一为分（破坏性 API 变更，只做了最小修复）
3. P2-1 小程序联调、P2-2 HTTPS/备案：需 ICP 备案（等待期）+ 微信公众平台账号，代码侧已就绪

---

## 七、Git 提交清单（15 个 commit）

1. 1550c86 - chore: 添加 deploy.sh 和 backup.sh 可执行权限
2. 13234ed - fix: 手机端取消记账表单 sticky，修复聚焦备注输入框时页面错位
3. 5cd5d38 - fix: 修复 salary.html 乱码（GBK/UTF-8 双重编码）
4. 2ca1e4c - fix(P0): 数据库补列迁移/限流/个税累计/标准工时/春节日期 5 项稳定性修复
5. f77f524 - fix(P1): AI记账缓存失效/存档限额/AI超时/统计缓存索引/注册事务 5 项
6. a33de61 - feat(P1): 优雅停机 + 前端版本号自动化脚本
7. 8269562 - fix(P1): token-stats移除默认密钥 + schema集中到db.js
8. 4cd46cd - fix(P1): 修复工资汇总金额显示缩小100倍 + fmtMoney乱码
9. c017d60 - refactor(P1): 配置集中到 config.js（env 读取统一管理）
10. 35a4bd8 - feat(P2): 工资跨月报表接口+前端汇总 + 修salary-summary乱码
11. 87ef709 - feat(P2): AI会话云端同步后端（表+CRUD接口）
12. 1f609bd - feat(P2): AI会话云端同步前端（保存/列表/加载/删除）
13. c10fc0d - feat(P2): 多币种支持（金额按账本币种显示符号）
14. 0b30e93 - refactor(P2): 前端模块化第一步——抽纯工具函数到 utils.js
15. 4b25e26 - fix: 修复工资页空白——删除孤儿重复块/断字符串/括号不平衡

---

## 八、当前状态

- GitHub：4b25e26，master 分支干净
- 服务器：服务运行正常，健康检查通过
- 测试：npm test 12/12 通过（每次改动后均验证）
- 前端版本号：?v=20260915

