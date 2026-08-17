// API 封装：统一处理 Token、401、错误提示
const config = require('./config');
const fmtUtil = require('./format');

function request(path, method, data) {
  return new Promise(function (resolve, reject) {
    var app = getApp();
    var header = { 'Content-Type': 'application/json' };
    if (app.globalData.token) header['Authorization'] = 'Bearer ' + app.globalData.token;
    wx.request({
      url: config.BASE_URL + path,
      method: method || 'GET',
      data: data || {},
      header: header,
      success: function (res) {
        if (res.statusCode === 401) {
          app.clearAuth();
          wx.reLaunch({ url: '/pages/login/login' });
          reject(new Error((res.data && res.data.error) || '登录已失效'));
          return;
        }
        if (res.statusCode >= 200 && res.statusCode < 300) {
          resolve(res.data);
        } else {
          console.error('[API错误]', method, path, res.statusCode, res.data);
          reject(new Error((res.data && res.data.error) || ('请求失败 ' + res.statusCode)));
        }
      },
      fail: function (err) {
        console.error('[API网络错误]', method, path, err.errMsg);
        reject(new Error('网络错误：' + (err.errMsg || '无法连接服务器')));
      },
    });
  });
}

function qs(obj) {
  var parts = [];
  Object.keys(obj).forEach(function (k) {
    var v = obj[k];
    if (v !== undefined && v !== null && v !== '') {
      parts.push(encodeURIComponent(k) + '=' + encodeURIComponent(v));
    }
  });
  return parts.join('&');
}

module.exports = {
  // 认证
  wxLogin: function (code) { return request('/api/auth/wx-login', 'POST', { code: code }); },
  login: function (username, password) { return request('/api/auth/login', 'POST', { username: username, password: password }); },
  me: function () { return request('/api/auth/me'); },
  logout: function () { return request('/api/auth/logout', 'POST'); },
  // 账本
  getLedgers: function () { return request('/api/ledgers'); },
  createLedger: function (name) { return request('/api/ledgers', 'POST', { name: name }); },
  renameLedger: function (id, name) { return request('/api/ledgers/' + id, 'PUT', { name: name }); },
  deleteLedger: function (id) { return request('/api/ledgers/' + id, 'DELETE'); },
  activateLedger: function (id) { return request('/api/ledgers/' + id + '/activate', 'POST'); },
  // 分类
  getCategories: function (type) { return request('/api/categories' + (type ? '?type=' + type : '')); },
  createCategory: function (name, type, icon) { return request('/api/categories', 'POST', { name: name, type: type, icon: icon }); },
  renameCategory: function (id, name, icon) { return request('/api/categories/' + id, 'PUT', { name: name, icon: icon }); },
  deleteCategory: function (id) { return request('/api/categories/' + id, 'DELETE'); },
  // 记账
  getRecords: function (params) { return request('/api/records?' + qs(params)); },
  createRecord: function (d) { return request('/api/records', 'POST', d); },
  updateRecord: function (id, d) { return request('/api/records/' + id, 'PUT', d); },
  deleteRecord: function (id) { return request('/api/records/' + id, 'DELETE'); },
  // 预算
  getBudgets: function (ledgerId, month) { return request('/api/budgets?ledger_id=' + ledgerId + '&month=' + month); },
  saveBudget: function (d) { return request('/api/budgets', 'PUT', d); },
  deleteBudget: function (id) { return request('/api/budgets/' + id, 'DELETE'); },
  // 统计
  summary: function (ledgerId, month) { return request('/api/stats/summary?ledger_id=' + ledgerId + '&month=' + month); },
  monthly: function (ledgerId, months) { return request('/api/stats/monthly?ledger_id=' + ledgerId + '&months=' + (months || 12)); },
  byCategory: function (ledgerId, month, type) { return request('/api/stats/by-category?ledger_id=' + ledgerId + '&month=' + month + '&type=' + (type || 'expense')); },
  daily: function (ledgerId, month) { return request('/api/stats/daily?ledger_id=' + ledgerId + '&month=' + month); },
  fmt: fmtUtil.fmt,
};
