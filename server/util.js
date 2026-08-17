// 通用小工具
export function todayStr() {
  const d = new Date();
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}

export function currentMonthStr() {
  const d = new Date();
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
}

export function yuanToCents(n) {
  return Math.round(Number(n) * 100);
}

// 金额统一用「分」(integer cents) 存储与传输，避免浮点误差
export function centsToYuan(c) {
  return (c / 100).toFixed(2);
}
