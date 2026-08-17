const base = 'http://localhost:3000';
let pass = 0, fail = 0;
function check(name, cond, extra) {
  if (cond) { pass++; console.log('  ✅ ' + name + (extra ? '  (' + extra + ')' : '')); }
  else { fail++; console.log('  ❌ ' + name + (extra ? '  (' + extra + ')' : '')); }
}
async function call(path, opts = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (opts.token) headers['Authorization'] = 'Bearer ' + opts.token;
  const resp = await fetch(base + path, { method: opts.method || 'GET', headers, body: opts.body ? JSON.stringify(opts.body) : undefined });
  return { status: resp.status, data: await resp.json().catch(() => null) };
}

// 1. 中文用户名注册
const reg = await call('/api/auth/register', { method: 'POST', body: { username: '测试用户', password: 'test123', nickname: '测试' } });
check('中文用户名注册', reg.status === 200 && reg.data.token, 'user=' + (reg.data.user ? reg.data.user.username : ''));
check('注册即建默认账本', reg.data.user.current_ledger_id != null);

// 2. 未授权访问
const anon = await call('/api/records');
check('未登录返回 401', anon.status === 401);

// 3. 错误密码
const bad = await call('/api/auth/login', { method: 'POST', body: { username: '测试用户', password: 'wrong' } });
check('错误密码返回 401', bad.status === 401);

// 4. 微信登录未配置
const wx = await call('/api/auth/wx-login', { method: 'POST', body: { code: 'abc' } });
check('wx-login 未配置返回 503', wx.status === 503);

// 5. 新用户数据隔离
const token2 = reg.data.token;
const user2 = await call('/api/auth/me', { token: token2 });
check('新用户默认分类已生成', (await call('/api/categories', { token: token2 })).data.length >= 14);

// 6. 记录校验：分类类型不匹配
const cats2 = (await call('/api/categories', { token: token2 })).data;
const incomeCat = cats2.find(c => c.type === 'income');
const badRec = await call('/api/records', { method: 'POST', token: token2, body: { ledger_id: user2.data.ledgers[0].id, type: 'expense', category_id: incomeCat.id, amount: 10 } });
check('分类类型不匹配返回 400', badRec.status === 400);

// 7. 负数金额
const neg = await call('/api/records', { method: 'POST', token: token2, body: { ledger_id: user2.data.ledgers[0].id, type: 'expense', amount: -5 } });
check('负数金额返回 400', neg.status === 400);

// 8. 跨用户访问被拒（demo token 访问测试用户账本）
const demoLogin = await call('/api/auth/login', { method: 'POST', body: { username: 'demo', password: 'demo123' } });
const otherLedger = user2.data.ledgers[0].id;
const cross = await call('/api/records?ledger_id=' + otherLedger, { token: demoLogin.data.token });
check('跨用户账本返回 404', cross.status === 404);

// 9. 预算针对收入分类
const incBudget = await call('/api/budgets', { method: 'PUT', token: demoLogin.data.token, body: { ledger_id: demoLogin.data.user.current_ledger_id, month: '2025-01', category_id: incomeCat.id, amount: 100 } });
check('收入分类不能设预算', incBudget.status === 400);

// 10. 删除最后一个账本
const onlyLedger = user2.data.ledgers[0].id;
const delLedger = await call('/api/ledgers/' + onlyLedger, { method: 'DELETE', token: token2 });
check('最后一个账本不可删除', delLedger.status === 400);

console.log('结果: ' + pass + ' 通过, ' + fail + ' 失败');
process.exit(fail > 0 ? 1 : 0);
