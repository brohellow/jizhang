// 记账本小程序 - 全局逻辑
App({
  globalData: {
    baseUrl: 'http://20111108.xyz', // 后端地址（开发版需勾选「不校验合法域名」）
    token: '',
    user: null,
  },

  onLaunch() {
    this.globalData.token = wx.getStorageSync('jz_token') || '';
    this.globalData.user = wx.getStorageSync('jz_user') || null;
  },

  setAuth(token, user) {
    this.globalData.token = token;
    this.globalData.user = user;
    wx.setStorageSync('jz_token', token);
    wx.setStorageSync('jz_user', user);
  },

  clearAuth() {
    this.globalData.token = '';
    this.globalData.user = null;
    wx.removeStorageSync('jz_token');
    wx.removeStorageSync('jz_user');
  },

  // 全局错误捕获：异常会以红色显示在 Console 并带堆栈
  onError(err) {
    console.error('[全局错误]', err);
  },
});
