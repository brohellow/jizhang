const api = require('../../utils/api');
const fmt = require('../../utils/format');

Page({
  data: {
    ledgers: [],
    ledgerIndex: 0,
    ledgerName: '',
    ledgerId: null,
    month: '',
    recordType: 'expense',
    cats: [],
    selectedCatId: null,
    amount: '',
    note: '',
    date: '',
    records: [],
    total: 0,
    page: 1,
    pageSize: 20,
    hasMore: false,
    editingId: null,
  },

  onLoad() {
    this.setData({ month: fmt.currentMonth(), date: fmt.today() });
  },

  money(cents) {
    return fmt.fmt(cents);
  },

  onShow() {
    var that = this;
    if (!getApp().globalData.token) {
      wx.reLaunch({ url: '/pages/login/login' });
      return;
    }
    that.loadBase();
  },

  onPullDownRefresh() {
    var that = this;
    that.loadBase().then(function () { wx.stopPullDownRefresh(); });
  },

  // 加载账本 + 分类 + 明细
  loadBase() {
    var that = this;
    return api.me().then(function (me) {
      var ledgers = me.ledgers || [];
      var curId = me.user.current_ledger_id || (ledgers[0] ? ledgers[0].id : null);
      var idx = 0;
      ledgers.forEach(function (l, i) { if (l.id === curId) idx = i; });
      that.setData({
        ledgers: ledgers,
        ledgerIndex: idx,
        ledgerName: ledgers[idx] ? ledgers[idx].name : '',
        ledgerId: curId,
      });
      return api.getCategories();
    }).then(function (cats) {
      that.setData({ cats: cats });
      that.setData({ page: 1, records: [] });
      return that.loadRecords();
    }).catch(function (err) {
      console.error('[页面错误]', err); wx.showToast({ title: err.message, icon: 'none' });
    });
  },

  loadRecords() {
    var that = this;
    var params = {
      ledger_id: that.data.ledgerId,
      page: that.data.page,
      pageSize: that.data.pageSize,
      from: that.data.month + '-01',
      to: that.data.month + '-31',
    };
    return api.getRecords(params).then(function (data) {
      var list = that.data.records.concat(data.items || []);
      that.setData({
        records: list,
        total: data.total || 0,
        hasMore: list.length < (data.total || 0),
      });
    });
  },

  loadMore() {
    var that = this;
    that.setData({ page: that.data.page + 1 });
    that.loadRecords().catch(function (err) {
      console.error('[页面错误]', err); wx.showToast({ title: err.message, icon: 'none' });
    });
  },

  onLedgerChange(e) {
    var that = this;
    var idx = Number(e.detail.value);
    var ledger = that.data.ledgers[idx];
    if (!ledger) return;
    api.activateLedger(ledger.id).then(function () {
      that.setData({
        ledgerIndex: idx,
        ledgerName: ledger.name,
        ledgerId: ledger.id,
        page: 1,
        records: [],
        editingId: null,
      });
      that.resetForm();
      return that.loadRecords();
    }).catch(function (err) {
      console.error('[页面错误]', err); wx.showToast({ title: err.message, icon: 'none' });
    });
  },

  onMonthChange(e) {
    this.setData({ month: e.detail.value, page: 1, records: [] });
    this.loadRecords().catch(function (err) {
      console.error('[页面错误]', err); wx.showToast({ title: err.message, icon: 'none' });
    });
  },

  setType(e) {
    var type = e.currentTarget.dataset.type;
    this.setData({ recordType: type, selectedCatId: null });
  },

  selectCat(e) {
    var id = Number(e.currentTarget.dataset.id);
    this.setData({ selectedCatId: this.data.selectedCatId === id ? null : id });
  },

  onAmount(e) { this.setData({ amount: e.detail.value }); },
  onNote(e) { this.setData({ note: e.detail.value }); },
  onDateChange(e) { this.setData({ date: e.detail.value }); },

  resetForm() {
    this.setData({
      editingId: null,
      selectedCatId: null,
      amount: '',
      note: '',
      date: fmt.today(),
    });
  },

  saveRecord() {
    var that = this;
    var amount = Number(that.data.amount);
    if (!that.data.ledgerId) { wx.showToast({ title: '请先创建账本', icon: 'none' }); return; }
    if (!isFinite(amount) || amount <= 0) { wx.showToast({ title: '请输入金额', icon: 'none' }); return; }
    if (!that.data.selectedCatId) { wx.showToast({ title: '请选择分类', icon: 'none' }); return; }
    var body = {
      ledger_id: that.data.ledgerId,
      type: that.data.recordType,
      category_id: that.data.selectedCatId,
      amount: amount,
      note: that.data.note,
      record_date: that.data.date,
    };
    var p = that.data.editingId
      ? api.updateRecord(that.data.editingId, body)
      : api.createRecord(body);
    p.then(function () {
      wx.showToast({ title: that.data.editingId ? '已保存' : '已记账', icon: 'success' });
      that.resetForm();
      that.setData({ page: 1, records: [] });
      return that.loadRecords();
    }).catch(function (err) {
      console.error('[页面错误]', err); wx.showToast({ title: err.message, icon: 'none' });
    });
  },

  editRecord(e) {
    var item = this.data.records[Number(e.currentTarget.dataset.index)];
    if (!item) return;
    this.setData({
      editingId: item.id,
      recordType: item.type,
      selectedCatId: item.category_id,
      amount: (item.amount / 100).toFixed(2),
      note: item.note || '',
      date: item.record_date,
    });
    wx.pageScrollTo({ scrollTop: 0, duration: 200 });
  },

  cancelEdit() {
    this.resetForm();
  },

  delRecord(e) {
    var that = this;
    var id = Number(e.currentTarget.dataset.id);
    wx.showModal({
      title: '删除',
      content: '确定删除这条记录吗？',
      success: function (res) {
        if (!res.confirm) return;
        api.deleteRecord(id).then(function () {
          wx.showToast({ title: '已删除', icon: 'success' });
          that.setData({ page: 1, records: [] });
          return that.loadRecords();
        }).catch(function (err) {
          console.error('[页面错误]', err); wx.showToast({ title: err.message, icon: 'none' });
        });
      },
    });
  },
});
