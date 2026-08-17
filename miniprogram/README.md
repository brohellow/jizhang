# 📱 记账本微信小程序

对接后端：**http://20111108.xyz**（Node.js + Express + SQLite，代码在上级目录）。

## 快速开始

### 1. 导入微信开发者工具

1. 打开微信开发者工具 → 点「**导入项目**」（不是新建）
2. 目录选择本文件夹：`H:\document\记账软件\miniprogram`
3. **AppID**：填你自己的小程序 AppID（在 `project.config.json` 里替换 `wxREPLACE_WITH_YOUR_APPID`，或在工具里直接改）
4. 点击「确定」

> 之所以用「导入」而不是「新建」：`app.json` 等全部文件已由本项目生成，导入即用。

### 2. 关闭域名校验（开发调试必须）

菜单「详情 → 本地设置」→ 勾选：
**「不校验合法域名、web-view（业务域名）、TLS 版本以及 HTTPS 证书」**

（`project.config.json` 已带 `"urlCheck": false`，但工具里仍建议手动确认一次）

### 3. 登录方式

小程序默认走**微信一键登录**（`wx.login` → 后端 `/api/auth/wx-login`）。
后端未配置 AppSecret 时会自动提示，此时可用**账号密码登录**（demo / demo123 或已注册账号）。

### 4. 真机预览

- 预览二维码用「开发版」打开
- 手机上点右上角「···」→ 打开**调试**模式（否则 HTTP 请求会被微信拦截）
- 自用场景无需备案、无需 HTTPS

## 服务器需要做的一件事：配置微信登录

微信一键登录需要后端用你的 AppID/AppSecret 换 openid，在服务器执行：

```bash
# 1. 登录服务器，在 /opt/jizhang 下设置环境变量并重启 PM2
cd /opt/jizhang
pm2 delete jizhang-api
WX_APPID=你的AppID WX_SECRET=你的AppSecret pm2 start server/index.js --name jizhang-api
pm2 save
```

> AppSecret 获取：微信公众平台 → 小程序后台 → 开发 → 开发管理 → 开发设置 → AppSecret（生成后只显示一次，注意保存）。
> 若不想开微信登录，跳过这步即可，小程序会自动退回账号密码登录。

## 后端地址如何修改

所有请求都走 `utils/config.js` 里的 `BASE_URL`，以后备案上 HTTPS 后改成：

```js
BASE_URL: 'https://你的域名'
```

同时记得在微信公众平台「开发 → 开发管理 → 开发设置 → 服务器域名」把 HTTPS 域名加入 request 合法域名。

## 项目结构

```
miniprogram/
├── app.js / app.json / app.wxss     # 全局
├── project.config.json              # 工具配置（urlCheck: false）
├── sitemap.json
├── utils/
│   ├── config.js                    # 后端地址
│   ├── api.js                       # 全部接口封装（Token 自动携带）
│   ├── format.js                    # 金额/日期
│   └── charts.js                    # Canvas 图表（柱状/环形，零依赖）
└── pages/
    ├── login/                       # 登录（微信一键 + 账号密码兜底）
    ├── records/                     # 记账（账本/分类/明细/编辑删除）
    ├── stats/                       # 统计（汇总 + 趋势 + 分类占比）
    ├── budget/                      # 预算（总预算 + 分类预算）
    └── profile/                     # 我的（账本/分类管理、退出）
```

## 更新流程

小程序代码在 `H:\document\记账软件\miniprogram`，改完在开发者工具里点「编译/预览」即可，**不需要部署到服务器**（小程序是本地编译上传的）。
