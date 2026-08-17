// 模拟小程序端 API 调用流程（与 miniprogram/utils/api.js 完全一致）
const base = 'http://localhost:3000';
let token = '';
function request(path, method, data) {
  return new Promise((resolve, reject) => {
    fetch(base + path, {
      method: method || 'GET',
      headers: { 'Content-Type': 'application/json', 'Authorization': token ? 'Bearer ' + token : '' },
      body: data ? JSON.stringify(data) : undefined,
    }).then(async (r) => {
      const j = await r.json().catch(() => null);
      if (r.status === 401) return reject(new Error('401'));
      if (r.status >= 200 && r.status < 300) return resolve(j);
      reject(new Error((j && j.error) || r.status));
    }).catch((e) => reject(new Error('net: ' + e.message)));
  });
}
let pass = 0, fail = 0;
const check = (n, c, x) => { if (c) { pass++; console.log('  ✅ ' + n + (x ? ' (' + x + ')' : '')); } else { fail++; console.log('  ❌ ' + n + (x ? ' (' + x + ')' : '')); } };

// 1. wx-login：本地未配 WX_APPID -> 503（小程序端会走账号密码兜底）
const wx = await request('/api/auth/wx-login', 'POST', { code: 'fake' }).catch(e => ({ err: e.message }));
check('wx-login 未配置返回 503（兜底路径）', wx && wx.err && String(wx.err).includes('WX_APPID'));

// 2. 手动登录（兜底）
const login = await request('/api/auth/login', 'POST', { username: 'demo', password: 'demo123' });
token = login.token;
check('登录拿 token', !!token);
const user = login.user;

// 3. me()
const me = await request('/api/auth/me');
check('me() 返回 user+ledgers', me.user && Array.isArray(me.ledgers) && me.ledgers.length > 0, 'ledgers=' + me.ledgers.length);
const ledgerId = me.user.current_ledger_id || me.ledgers[0].id;

// 4. getCategories()
const cats = await request('/api/categories');
check('getCategories 返回分类', Array.isArray(cats) && cats.length >= 14, 'cats=' + cats.length);
const expCat = cats.find(c => c.type === 'expense');

// 5. getRecords（小程序参数：ledger_id/page/pageSize/from/to）
const month = new Date();
const m = month.getFullYear() + '-' + String(month.getMonth() + 1).padStart(2, '0');
const recs = await request('/api/records?' + ['ledger_id=' + ledgerId, 'page=1', 'pageSize=20', 'from=' + m + '-01', 'to=' + m + '-31'].join('&'));
check('getRecords 返回分页列表', recs.total > 0 && recs.items.length > 0 && recs.items[0].category_name !== undefined, 'total=' + recs.total);

// 6. 新增记录（小程序表单提交）
const r1 = await request('/api/records', 'POST', { ledger_id: ledgerId, type: 'expense', category_id: expCat.id, amount: 88.8, note: '小程序模拟', record_date: '2026-08-17' });
check('createRecord', r1.id && r1.amount === 8880);
await request('/api/records/' + r1.id, 'DELETE');

// 7. 统计接口
const summary = await request('/api/stats/summary?ledger_id=' + ledgerId + '&month=' + m);
const monthly = await request('/api/stats/monthly?ledger_id=' + ledgerId + '&months=12');
const byCat = await request('/api/stats/by-category?ledger_id=' + ledgerId + '&month=' + m + '&type=expense');
check('summary 形状', summary.income !== undefined && summary.expense !== undefined && summary.budget_pct !== undefined);
check('monthly 12 条', monthly.length === 12);
check('byCategory 含 pct/yuan 所需字段', byCat.length > 0 && byCat[0].pct > 0);

// 8. 预算
const budgets = await request('/api/budgets?ledger_id=' + ledgerId + '&month=' + m);
check('getBudgets 返回 overall+items', budgets.overall !== null && Array.isArray(budgets.items), 'items=' + budgets.items.length);
await request('/api/budgets', 'PUT', { ledger_id: ledgerId, month: m, amount: 6666 });
const budgets2 = await request('/api/budgets?ledger_id=' + ledgerId + '&month=' + m);
check('saveBudget upsert 生效', budgets2.overall.amount === 666600);

console.log('结果: ' + pass + ' 通过, ' + fail + ' 失败');
process.exit(fail > 0 ? 1 : 0);
