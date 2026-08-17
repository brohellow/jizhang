const api = require('../../utils/api');
const config = require('../../utils/config');

Page({
  data: {
    manual: false,
    username: '',
    password: '',
    hint: '',
    hintType: '',
    baseUrl: config.BASE_URL,
  },

  onLoad() {
    var app = getApp();
    if (app.globalData.token) {
      wx.reLaunch({ url: '/pages/records/records' });
      return;
    }
    // 自动尝试微信一键登录
    this.doWxLogin();
  },

  toggleManual() {
    this.setData({ manual: !this.data.manual, hint: '', hintType: '' });
  },

  onUsername(e) { this.setData({ username: e.detail.value }); },
  onPassword(e) { this.setData({ password: e.detail.value }); },

  showHint(msg, type) {
    this.setData({ hint: msg, hintType: type || 'error' });
  },

  doWxLogin() {
    var that = this;
    that.showHint('正在微信登录…', 'ok');
    wx.login({
      success: function (res) {
        if (!res.code) {
          that.showHint('获取微信登录凭证失败');
          return;
        }
        api.wxLogin(res.code).then(function (data) {
          var app = getApp();
          app.setAuth(data.token, data.user);
          wx.showToast({ title: data.is_new ? '已自动创建账号' : '登录成功', icon: 'success' });
          setTimeout(function () {
            wx.reLaunch({ url: '/pages/records/records' });
          }, 400);
        }).catch(function (err) {
          console.error('[页面错误]', err);
          that.showHint(err.message + '，请使用账号密码登录');
        });
      },
      fail: function () {
        that.showHint('wx.login 失败，请使用账号密码登录');
      },
    });
  },

  doManualLogin() {
    var that = this;
    var username = that.data.username.trim();
    var password = that.data.password;
    if (!username || !password) {
      that.showHint('请输入用户名和密码');
      return;
    }
    api.login(username, password).then(function (data) {
      var app = getApp();
      app.setAuth(data.token, data.user);
      wx.showToast({ title: '登录成功', icon: 'success' });
      setTimeout(function () {
        wx.reLaunch({ url: '/pages/records/records' });
      }, 400);
    }).catch(function (err) {
      console.error('[页面错误]', err);
      that.showHint(err.message);
    });
  },
});
