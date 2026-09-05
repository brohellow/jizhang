import { test, before, after } from 'node:test';
import assert from 'node:assert';
import { spawn } from 'node:child_process';
import { rmSync } from 'node:fs';

let server;
let baseUrl;
let authToken;
let testUserId;
let testLedgerId;

before(async () => {
  // 使用临时数据库
  const testDbPath = `data/test-${Date.now()}.db`;
  process.env.DB_PATH = testDbPath;

  // 启动服务器
  server = spawn('node', ['server/index.js'], {
    env: { ...process.env, PORT: 3001 },
    stdio: 'pipe'
  });

  // 等待服务器启动
  await new Promise((resolve, reject) => {
    let output = '';
    server.stdout.on('data', (data) => {
      output += data.toString();
      if (output.includes('记账服务已启动')) {
        resolve();
      }
    });
    server.stderr.on('data', (data) => {
      console.error('服务器错误:', data.toString());
    });
    setTimeout(() => reject(new Error('服务器启动超时')), 10000);
  });

  baseUrl = 'http://localhost:3001';
});

after(async () => {
  if (server) {
    server.kill();
    await new Promise(resolve => server.on('close', resolve));
  }
  // 清理测试数据库
  if (process.env.DB_PATH) {
    try { rmSync(process.env.DB_PATH); } catch (e) {}
  }
});

// 辅助函数：发送请求
async function request(method, path, body = null, token = null) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers['Authorization'] = `Bearer ${token}`;

  const res = await fetch(`${baseUrl}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : null
  });

  const data = await res.json();
  return { status: res.status, data };
}

test('注册新用户', async () => {
  const { status, data } = await request('POST', '/api/auth/register', {
    username: 'testuser',
    password: 'test123456',
    nickname: '测试用户'
  });

  assert.strictEqual(status, 200);
  assert.ok(data.token);
  assert.strictEqual(data.user.username, 'testuser');
  assert.strictEqual(data.user.nickname, '测试用户');

  authToken = data.token;
  testUserId = data.user.id;
  testLedgerId = data.user.current_ledger_id;
});

test('重复注册相同用户名应失败', async () => {
  const { status, data } = await request('POST', '/api/auth/register', {
    username: 'testuser',
    password: 'test123456'
  });

  assert.strictEqual(status, 409);
  assert.ok(data.error.includes('已存在'));
});

test('登录', async () => {
  const { status, data } = await request('POST', '/api/auth/login', {
    username: 'testuser',
    password: 'test123456'
  });

  assert.strictEqual(status, 200);
  assert.ok(data.token);
  assert.strictEqual(data.user.username, 'testuser');
});

test('错误密码登录应失败', async () => {
  const { status, data } = await request('POST', '/api/auth/login', {
    username: 'testuser',
    password: 'wrongpassword'
  });

  assert.strictEqual(status, 401);
  assert.ok(data.error);
});

test('获取用户信息', async () => {
  const { status, data } = await request('GET', '/api/auth/me', null, authToken);

  assert.strictEqual(status, 200);
  assert.strictEqual(data.user.username, 'testuser');
});

test('未登录访问受保护接口应失败', async () => {
  const { status, data } = await request('GET', '/api/records');

  assert.strictEqual(status, 401);
  assert.ok(data.error.includes('未登录'));
});

test('创建记账记录', async () => {
  // 先查询分类列表获取真实的分类 ID
  const catRes = await request('GET', `/api/categories?ledger_id=${testLedgerId}`, null, authToken);
  const expenseCat = catRes.data.find(c => c.type === 'expense');

  const { status, data } = await request('POST', '/api/records', {
    ledger_id: testLedgerId,
    type: 'expense',
    category_id: expenseCat.id,
    amount: 50, // 50 元
    note: '测试支出',
    record_date: '2025-01-15'
  }, authToken);

  assert.strictEqual(status, 200);
  assert.ok(data.id);
  assert.strictEqual(data.amount, 5000); // 5000 分 = 50 元
  assert.strictEqual(data.note, '测试支出');
});

test('创建记录时金额必须大于 0', async () => {
  const catRes = await request('GET', `/api/categories?ledger_id=${testLedgerId}`, null, authToken);
  const expenseCat = catRes.data.find(c => c.type === 'expense');

  const { status, data } = await request('POST', '/api/records', {
    ledger_id: testLedgerId,
    type: 'expense',
    category_id: expenseCat.id,
    amount: -100,
    record_date: '2025-01-15'
  }, authToken);

  assert.strictEqual(status, 400);
  assert.ok(data.error.includes('金额'));
});

test('获取记录列表', async () => {
  const { status, data } = await request('GET', `/api/records?ledger_id=${testLedgerId}`, null, authToken);

  assert.strictEqual(status, 200);
  assert.ok(Array.isArray(data.items));
  assert.ok(data.items.length > 0);
});

test('更新记账记录', async () => {
  // 先查询分类
  const catRes = await request('GET', `/api/categories?ledger_id=${testLedgerId}`, null, authToken);
  const incomeCat = catRes.data.find(c => c.type === 'income');

  // 先创建一条记录
  const createRes = await request('POST', '/api/records', {
    ledger_id: testLedgerId,
    type: 'income',
    category_id: incomeCat.id,
    amount: 100, // 100 元
    note: '原始备注',
    record_date: '2025-01-16'
  }, authToken);

  const recordId = createRes.data.id;

  // 更新记录（需要传完整字段）
  const { status, data } = await request('PUT', `/api/records/${recordId}`, {
    ledger_id: testLedgerId,
    type: 'income',
    category_id: incomeCat.id,
    amount: 200, // 200 元
    note: '更新后的备注',
    record_date: '2025-01-16'
  }, authToken);

  assert.strictEqual(status, 200);
  assert.strictEqual(data.amount, 20000); // 20000 分 = 200 元
  assert.strictEqual(data.note, '更新后的备注');
});

test('删除记账记录', async () => {
  const catRes = await request('GET', `/api/categories?ledger_id=${testLedgerId}`, null, authToken);
  const expenseCat = catRes.data.find(c => c.type === 'expense');

  // 先创建一条记录
  const createRes = await request('POST', '/api/records', {
    ledger_id: testLedgerId,
    type: 'expense',
    category_id: expenseCat.id,
    amount: 1000,
    record_date: '2025-01-17'
  }, authToken);

  const recordId = createRes.data.id;

  // 删除记录
  const { status } = await request('DELETE', `/api/records/${recordId}`, null, authToken);

  assert.strictEqual(status, 200);

  // 验证已删除
  const getRes = await request('GET', `/api/records/${recordId}`, null, authToken);
  assert.strictEqual(getRes.status, 404);
});

test('获取统计数据', async () => {
  const { status, data } = await request('GET', `/api/stats/summary?ledger_id=${testLedgerId}`, null, authToken);

  assert.strictEqual(status, 200);
  assert.ok(typeof data.income === 'number');
  assert.ok(typeof data.expense === 'number');
  assert.ok(typeof data.net === 'number');
});

console.log('\n✅ 所有测试完成\n');
