// 纯工具函数（无状态依赖），以普通 <script> 在 app.js 之前加载
// 函数挂在全局，app.js 的 IIFE 可直接调用
function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
  });
}
function pad2(n) { return n < 10 ? '0' + n : '' + n; }
function todayStr() {
  var d = new Date();
  return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());
}
function currentMonthStr() {
  var d = new Date();
  return d.getFullYear() + '-' + pad2(d.getMonth() + 1);
}
function monthLabel(m) {
  if (!m) return '';
  return m.slice(0, 4) + '年' + Number(m.slice(5)) + '月';
}
function debounce(fn, ms) {
  var t = null;
  return function () {
    clearTimeout(t);
    t = setTimeout(fn, ms);
  };
}
