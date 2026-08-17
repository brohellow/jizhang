// 冒烟测试：验证核心 API 全链路（登录/账本/分类/记账/预算/统计）
// 用法: node scripts/smoke-test.mjs [baseUrl]  默认 http://localhost:3000
const base = process.argv[2] || 'http://localhost:3000';
let token = '';
let ledgerId = null;

async function api(path, opts = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers['Authorization'] = 'Bearer ' + token;
  const resp = await fetch(base + path, { method: opts.method || 'GET', headers, body: opts.body ? JSON.stringify(opts.body) : undefined });
  const data = await resp.json().catch(() => null);
  if (!resp.ok) throw new Error(path + ' -> ' + resp.status + ' ' + JSON.stringify(data));
  return data;
}

let pass = 0, fail = 0;
function check(name, cond, extra) {
  if (cond) { pass++; console.log('  ✅ ' + name + (extra ? '  (' + extra + ')' : '')); }
  else { fail++; console.log('  ❌ ' + name + (extra ? '  (' + extra + ')' : '')); }
}

// 1. 登录
console.log('== 登录 ==');
const login = await api('/api/auth/login', { method: 'POST', body: { username: 'demo', password: 'demo123' } });
token = login.token;
check('demo 登录', !!token);

// 2. 用户信息
console.log('== 用户/账本 ==');
const me = await api('/api/auth/me');
check('获取用户与账本', me.ledgers && me.ledgers.length > 0, '账本数=' + me.ledgers.length);
ledgerId = me.ledgers[0].id;

// 3. 分类
console.log('== 分类 ==');
const cats = await api('/api/categories');
const expenseCats = cats.filter(c => c.type === 'expense');
check('默认支出分类 >= 5', expenseCats.length >= 5, '支出=' + expenseCats.length);
const newCat = await api('/api/categories', { method: 'POST', body: { name: '测试分类', type: 'expense', icon: '🧪' } });
check('新增分类', !!newCat.id);

// 4. 记账
console.log('== 记账 ==');
const today = new Date();
const dateStr = today.getFullYear() + '-' + String(today.getMonth() + 1).padStart(2, '0') + '-' + String(today.getDate()).padStart(2, '0');
const r1 = await api('/api/records', { method: 'POST', body: { ledger_id: ledgerId, type: 'expense', category_id: expenseCats[0].id, amount: 12.5, note: '冒烟测试', record_date: dateStr } });
check('新增支出记录', r1.id && r1.amount === 1250, '金额(分)=' + r1.amount);
const r2 = await api('/api/records', { method: 'POST', body: { ledger_id: ledgerId, type: 'income', category_id: cats.find(c => c.type === 'income').id, amount: 5000, record_date: dateStr } });
check('新增收入记录', !!r2.id);
const updated = await api('/api/records/' + r1.id, { method: 'PUT', body: { ledger_id: ledgerId, type: 'expense', category_id: expenseCats[1].id, amount: 99.99, note: '改过了', record_date: dateStr } });
check('编辑记录', updated.amount === 9999);
const list = await api('/api/records?ledger_id=' + ledgerId + '&pageSize=5');
check('记录列表分页', list.items.length >= 2 && list.total >= 2, 'total=' + list.total);

// 5. 统计
console.log('== 统计 ==');
const summary = await api('/api/stats/summary?ledger_id=' + ledgerId);
check('月度汇总', summary.income > 0 && summary.expense > 0, '收入=' + summary.income / 100 + ' 支出=' + summary.expense / 100);
const monthly = await api('/api/stats/monthly?ledger_id=' + ledgerId + '&months=6');
check('近 6 个月趋势', monthly.length === 6);
const byCat = await api('/api/stats/by-category?ledger_id=' + ledgerId + '&type=expense');
check('分类占比', byCat.length > 0 && byCat[0].pct > 0);
const daily = await api('/api/stats/daily?ledger_id=' + ledgerId);
check('每日收支', daily.length >= 28, '天数=' + daily.length);

// 6. 预算
console.log('== 预算 ==');
const monthStr = dateStr.slice(0, 7);
await api('/api/budgets', { method: 'PUT', body: { ledger_id: ledgerId, month: monthStr, amount: 3000 } });
await api('/api/budgets', { method: 'PUT', body: { ledger_id: ledgerId, month: monthStr, category_id: expenseCats[0].id, amount: 800 } });
const budgets = await api('/api/budgets?ledger_id=' + ledgerId + '&month=' + monthStr);
check('总体预算 + 分类预算', budgets.overall && budgets.items.length >= 1, '总体=' + budgets.overall.amount / 100 + ' 分类数=' + budgets.items.length);

// 7. 删除测试数据
console.log('== 清理 ==');
await api('/api/records/' + r1.id, { method: 'DELETE' });
await api('/api/records/' + r2.id, { method: 'DELETE' });
check('删除测试记录', true);
await api('/api/categories/' + newCat.id, { method: 'DELETE' });
check('删除测试分类', true);

console.log('');
console.log('结果: ' + pass + ' 通过, ' + fail + ' 失败');
if (fail > 0) process.exit(1);
