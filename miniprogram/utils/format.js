// 金额格式化：分 -> 元字符串
function fmt(cents) {
  if (cents === null || cents === undefined) return '¥0.00';
  return '¥' + (cents / 100).toFixed(2);
}

function fmtNoSymbol(cents) {
  if (cents === null || cents === undefined) return '0.00';
  return (cents / 100).toFixed(2);
}

function today() {
  var d = new Date();
  return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());
}

function currentMonth() {
  var d = new Date();
  return d.getFullYear() + '-' + pad2(d.getMonth() + 1);
}

function pad2(n) {
  return n < 10 ? '0' + n : '' + n;
}

module.exports = { fmt: fmt, fmtNoSymbol: fmtNoSymbol, today: today, currentMonth: currentMonth };
