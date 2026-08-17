const api = require('../../utils/api');
const fmt = require('../../utils/format');
const charts = require('../../utils/charts');

var PIE_COLORS = ['#3b82f6', '#16a34a', '#f59e0b', '#dc2626', '#8b5cf6', '#06b6d4', '#ec4899', '#84cc16', '#f97316'];

Page({
  data: {
    month: '',
    monthLabel: '',
    incomeText: '--',
    expenseText: '--',
    netText: '--',
    countText: '--',
    budgetText: '--',
    budgetOver: false,
    pieItems: [],
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
    var app = getApp();
    var ledgerId = app.globalData.user ? app.globalData.user.current_ledger_id : null;
    // 从账本列表确认当前账本
    api.me().then(function (me) {
      var curId = me.user.current_ledger_id || (me.ledgers[0] ? me.ledgers[0].id : null);
      if (!curId) {
        that.setData({ budgetText: '请先创建账本' });
        return null;
      }
      var month = that.data.month;
      var label = month.slice(0, 4) + '年' + Number(month.slice(5)) + '月';
      that.setData({ monthLabel: label });
      return Promise.all([
        api.summary(curId, month),
        api.monthly(curId, 12),
        api.byCategory(curId, month, 'expense'),
      ]);
    }).then(function (results) {
      if (!results) return;
      var summary = results[0];
      var monthly = results[1];
      var byCat = results[2];
      that.setData({
        incomeText: fmt.fmt(summary.income),
        expenseText: fmt.fmt(summary.expense),
        netText: fmt.fmt(summary.net),
        countText: summary.record_count + ' 笔',
        budgetText: summary.budget ? (fmt.fmt(summary.budget_spent) + ' / ' + fmt.fmt(summary.budget) + '（' + (summary.budget_pct || 0) + '%）') : '未设置',
        budgetOver: summary.budget_pct > 100,
      });
      // 趋势柱状图
      var labels = monthly.map(function (m) { return m.month.slice(2); });
      charts.drawBarChart(that, '#trendCanvas', [
        { name: '收入', data: monthly.map(function (m) { return m.income; }), color: '#16a34a' },
        { name: '支出', data: monthly.map(function (m) { return m.expense; }), color: '#dc2626' },
      ], labels);
      // 分类环形图
      var items = byCat.map(function (c) {
        return { category_id: c.category_id, category_icon: c.category_icon, category_name: c.category_name, pct: c.pct, yuan: (c.amount / 100).toFixed(2), value: c.amount };
      });
      charts.drawDonutChart(that, '#pieCanvas', items, PIE_COLORS);
      that.setData({
        pieItems: items.map(function (it, i) {
          it.color = PIE_COLORS[i % PIE_COLORS.length];
          return it;
        }),
      });
    }).catch(function (err) {
      console.error('[页面错误]', err); wx.showToast({ title: err.message, icon: 'none' });
    });
  },
});
