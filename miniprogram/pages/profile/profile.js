const api = require('../../utils/api');
const config = require('../../utils/config');

Page({
  data: {
    nickname: '',
    username: '',
    ledgers: [],
    currentLedgerId: null,
    newLedger: '',
    expenseCats: [],
    incomeCats: [],
    catTypes: ['支出', '收入'],
    catTypeIndex: 0,
    newCat: '',
    newCatIcon: '',
    baseUrl: config.BASE_URL,
  },

  onShow() {
    var that = this;
    if (!getApp().globalData.token) {
      wx.reLaunch({ url: '/pages/login/login' });
      return;
    }
    that.refresh();
  },

  refresh() {
    var that = this;
    api.me().then(function (me) {
      that.setData({
        nickname: me.user.nickname || me.user.username,
        username: me.user.username,
        ledgers: me.ledgers || [],
        currentLedgerId: me.user.current_ledger_id || (me.ledgers && me.ledgers[0] ? me.ledgers[0].id : null),
      });
      return api.getCategories();
    }).then(function (cats) {
      var expense = [], income = [];
      (cats || []).forEach(function (c) {
        if (c.type === 'expense') expense.push(c); else income.push(c);
      });
      that.setData({ expenseCats: expense, incomeCats: income });
    }).catch(function (err) {
      console.error('[页面错误]', err); wx.showToast({ title: err.message, icon: 'none' });
    });
  },

  logout() {
    var that = this;
    api.logout().catch(function () {});
    getApp().clearAuth();
    wx.reLaunch({ url: '/pages/login/login' });
  },

  onNewLedger(e) { this.setData({ newLedger: e.detail.value }); },
  onNewCat(e) { this.setData({ newCat: e.detail.value }); },
  onNewCatIcon(e) { this.setData({ newCatIcon: e.detail.value }); },
  onCatTypeChange(e) { this.setData({ catTypeIndex: Number(e.detail.value) }); },

  createLedger() {
    var that = this;
    var name = that.data.newLedger.trim();
    if (!name) { wx.showToast({ title: '请输入账本名称', icon: 'none' }); return; }
    api.createLedger(name).then(function (l) {
      that.setData({ newLedger: '' });
      return api.activateLedger(l.id);
    }).then(function () {
      wx.showToast({ title: '已创建并切换', icon: 'success' });
      that.refresh();
    }).catch(function (err) {
      console.error('[页面错误]', err); wx.showToast({ title: err.message, icon: 'none' });
    });
  },

  activateLedger(e) {
    var that = this;
    api.activateLedger(Number(e.currentTarget.dataset.id)).then(function () {
      wx.showToast({ title: '已切换', icon: 'success' });
      that.refresh();
    }).catch(function (err) {
      console.error('[页面错误]', err); wx.showToast({ title: err.message, icon: 'none' });
    });
  },

  renameLedger(e) {
    var that = this;
    var id = Number(e.currentTarget.dataset.id);
    var name = e.currentTarget.dataset.name;
    wx.showModal({
      title: '重命名账本',
      editable: true,
      placeholderText: '账本名称',
      content: name,
      success: function (res) {
        if (!res.confirm) return;
        var n = (res.content || '').trim();
        if (!n) return;
        api.renameLedger(id, n).then(function () {
          wx.showToast({ title: '已保存', icon: 'success' });
          that.refresh();
        }).catch(function (err) {
          console.error('[页面错误]', err); wx.showToast({ title: err.message, icon: 'none' });
        });
      },
    });
  },

  deleteLedger(e) {
    var that = this;
    var id = Number(e.currentTarget.dataset.id);
    wx.showModal({
      title: '删除账本',
      content: '将删除该账本所有记录和预算，确定？',
      success: function (res) {
        if (!res.confirm) return;
        api.deleteLedger(id).then(function () {
          wx.showToast({ title: '已删除', icon: 'success' });
          that.refresh();
        }).catch(function (err) {
          console.error('[页面错误]', err); wx.showToast({ title: err.message, icon: 'none' });
        });
      },
    });
  },

  createCat() {
    var that = this;
    var name = that.data.newCat.trim();
    if (!name) { wx.showToast({ title: '请输入分类名称', icon: 'none' }); return; }
    var type = that.data.catTypeIndex === 0 ? 'expense' : 'income';
    api.createCategory(name, type, that.data.newCatIcon.trim() || '📌').then(function () {
      that.setData({ newCat: '', newCatIcon: '' });
      wx.showToast({ title: '已添加', icon: 'success' });
      that.refresh();
    }).catch(function (err) {
      console.error('[页面错误]', err); wx.showToast({ title: err.message, icon: 'none' });
    });
  },

  renameCat(e) {
    var that = this;
    var id = Number(e.currentTarget.dataset.id);
    var name = e.currentTarget.dataset.name;
    var icon = e.currentTarget.dataset.icon || '';
    wx.showModal({
      title: '重命名分类',
      editable: true,
      placeholderText: '分类名称',
      content: name,
      success: function (res) {
        if (!res.confirm) return;
        var n = (res.content || '').trim();
        if (!n) return;
        api.renameCategory(id, n, icon).then(function () {
          wx.showToast({ title: '已保存', icon: 'success' });
          that.refresh();
        }).catch(function (err) {
          console.error('[页面错误]', err); wx.showToast({ title: err.message, icon: 'none' });
        });
      },
    });
  },

  deleteCat(e) {
    var that = this;
    var id = Number(e.currentTarget.dataset.id);
    wx.showModal({
      title: '删除分类',
      content: '被记录使用的分类无法删除',
      success: function (res) {
        if (!res.confirm) return;
        api.deleteCategory(id).then(function () {
          wx.showToast({ title: '已删除', icon: 'success' });
          that.refresh();
        }).catch(function (err) {
          console.error('[页面错误]', err); wx.showToast({ title: err.message, icon: 'none' });
        });
      },
    });
  },
});
