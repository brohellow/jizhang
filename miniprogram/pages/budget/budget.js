const api = require('../../utils/api');
const fmt = require('../../utils/format');

Page({
  data: {
    month: '',
    monthLabel: '',
    overall: null,
    overallPct: 0,
    overallClass: '',
    overallInput: '',
    items: [],
    expenseCats: [],
    catIndex: 0,
    catAmount: '',
  },

  onLoad() {
    this.setData({ month: fmt.currentMonth() });
  },

  onShow() {
    var that = this;
    if (!getApp().globalData.token) {
      wx.reLaunch({ url: '/pages/login/login' });
      return;
    }
    that.refresh();
  },

  onMonthChange(e) {
    this.setData({ month: e.detail.value });
    this.refresh();
  },

  refresh() {
    var that = this;
    api.me().then(function (me) {
      var curId = me.user.current_ledger_id || (me.ledgers[0] ? me.ledgers[0].id : null);
      if (!curId) {
        that.setData({ overall: null, items: [] });
        wx.showToast({ title: '请先创建账本', icon: 'none' });
        return null;
      }
      var month = that.data.month;
      that.setData({ monthLabel: month.slice(0, 4) + '年' + Number(month.slice(5)) + '月' });
      return api.getBudgets(curId, month);
    }).then(function (data) {
      if (!data) return;
      var overall = data.overall;
      var items = (data.items || []).map(function (it) {
        var pct = it.amount > 0 ? Math.round((it.spent / it.amount) * 100) : 0;
        var cls = pct > 100 ? 'over' : (pct > 80 ? 'warn' : '');
        return {
          id: it.id,
          category_id: it.category_id,
          category_icon: it.category_icon || '📌',
          category_name: it.category_name,
          amountText: fmt.fmtNoSymbol(it.amount),
          spentText: fmt.fmtNoSymbol(it.spent),
          pct: pct,
          cls: cls,
          amount: it.amount,
        };
      });
      if (overall) {
        var pct = overall.amount > 0 ? Math.round((overall.spent / overall.amount) * 100) : 0;
        var cls = pct > 100 ? 'over' : (pct > 80 ? 'warn' : '');
        that.setData({
          overall: {
            id: overall.id,
            amountText: fmt.fmtNoSymbol(overall.amount),
            spentText: fmt.fmtNoSymbol(overall.spent),
            remainingText: fmt.fmtNoSymbol(Math.max(0, overall.remaining)),
            overText: fmt.fmtNoSymbol(Math.max(0, -overall.remaining)),
            remaining: overall.remaining,
            pct: pct,
          },
          overallPct: Math.min(100, pct),
          overallClass: cls,
          overallInput: '',
        });
      } else {
        that.setData({ overall: null });
      }
      that.setData({ items: items });
    }).then(function () {
      return api.getCategories('expense');
    }).then(function (cats) {
      that.setData({ expenseCats: cats });
    }).catch(function (err) {
      console.error('[页面错误]', err); wx.showToast({ title: err.message, icon: 'none' });
    });
  },

  onOverallInput(e) { this.setData({ overallInput: e.detail.value }); },
  onCatAmount(e) { this.setData({ catAmount: e.detail.value }); },
  onCatChange(e) { this.setData({ catIndex: Number(e.detail.value) }); },

  saveOverall() {
    var that = this;
    var amount = Number(that.data.overallInput);
    if (!isFinite(amount) || amount <= 0) { wx.showToast({ title: '请输入预算金额', icon: 'none' }); return; }
    api.me().then(function (me) {
      var ledgerId = me.user.current_ledger_id || (me.ledgers[0] ? me.ledgers[0].id : null);
      return api.saveBudget({ ledger_id: ledgerId, month: that.data.month, amount: amount });
    }).then(function () {
      wx.showToast({ title: '已保存', icon: 'success' });
      that.refresh();
    }).catch(function (err) {
      console.error('[页面错误]', err); wx.showToast({ title: err.message, icon: 'none' });
    });
  },

  editOverall() {
    var that = this;
    wx.showModal({
      title: '调整总预算',
      editable: true,
      placeholderText: '金额（元）',
      content: '',
      success: function (res) {
        if (!res.confirm) return;
        var amount = Number(res.content);
        if (!isFinite(amount) || amount <= 0) { wx.showToast({ title: '金额无效', icon: 'none' }); return; }
        api.me().then(function (me) {
          var ledgerId = me.user.current_ledger_id || (me.ledgers[0] ? me.ledgers[0].id : null);
          return api.saveBudget({ ledger_id: ledgerId, month: that.data.month, amount: amount });
        }).then(function () {
          wx.showToast({ title: '已保存', icon: 'success' });
          that.refresh();
        }).catch(function (err) {
          console.error('[页面错误]', err); wx.showToast({ title: err.message, icon: 'none' });
        });
      },
    });
  },

  addItem() {
    var that = this;
    var cat = that.data.expenseCats[that.data.catIndex];
    var amount = Number(that.data.catAmount);
    if (!cat) { wx.showToast({ title: '请选择分类', icon: 'none' }); return; }
    if (!isFinite(amount) || amount <= 0) { wx.showToast({ title: '请输入金额', icon: 'none' }); return; }
    api.me().then(function (me) {
      var ledgerId = me.user.current_ledger_id || (me.ledgers[0] ? me.ledgers[0].id : null);
      return api.saveBudget({ ledger_id: ledgerId, month: that.data.month, category_id: cat.id, amount: amount });
    }).then(function () {
      wx.showToast({ title: '已添加', icon: 'success' });
      that.setData({ catAmount: '' });
      that.refresh();
    }).catch(function (err) {
      console.error('[页面错误]', err); wx.showToast({ title: err.message, icon: 'none' });
    });
  },

  editItem(e) {
    var that = this;
    var id = Number(e.currentTarget.dataset.id);
    var catId = Number(e.currentTarget.dataset.cat);
    var curAmount = e.currentTarget.dataset.amount;
    wx.showModal({
      title: '调整分类预算',
      editable: true,
      placeholderText: '金额（元）',
      content: (Number(curAmount) / 100).toFixed(2),
      success: function (res) {
        if (!res.confirm) return;
        var amount = Number(res.content);
        if (!isFinite(amount) || amount <= 0) { wx.showToast({ title: '金额无效', icon: 'none' }); return; }
        api.me().then(function (me) {
          var ledgerId = me.user.current_ledger_id || (me.ledgers[0] ? me.ledgers[0].id : null);
          return api.saveBudget({ ledger_id: ledgerId, month: that.data.month, category_id: catId, amount: amount });
        }).then(function () {
          wx.showToast({ title: '已保存', icon: 'success' });
          that.refresh();
        }).catch(function (err) {
          console.error('[页面错误]', err); wx.showToast({ title: err.message, icon: 'none' });
        });
      },
    });
  },

  delBudget(e) {
    var that = this;
    var id = Number(e.currentTarget.dataset.id);
    wx.showModal({
      title: '删除预算',
      content: '确定删除吗？',
      success: function (res) {
        if (!res.confirm) return;
        api.deleteBudget(id).then(function () {
          wx.showToast({ title: '已删除', icon: 'success' });
          that.refresh();
        }).catch(function (err) {
          console.error('[页面错误]', err); wx.showToast({ title: err.message, icon: 'none' });
        });
      },
    });
  },
});
