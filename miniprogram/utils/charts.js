// 轻量 Canvas 图表（无第三方依赖）
// drawBarChart(that, selector, series, labels)
//   series: [{ name, data: [cents...], color }]
// drawDonutChart(that, selector, items, colors)
//   items: [{ name, value(cents) }]

function setupCanvas(that, selector, callback) {
  var query = wx.createSelectorQuery().in(that);
  query.select(selector).fields({ node: true, size: true }).exec(function (res) {
    if (!res || !res[0] || !res[0].node) return;
    var canvas = res[0].node;
    var ctx = canvas.getContext('2d');
    var info = wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync();
    var dpr = (info && info.pixelRatio) || 2;
    var w = res[0].width;
    var h = res[0].height;
    canvas.width = w * dpr;
    canvas.height = h * dpr;
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, w, h);
    callback(ctx, w, h);
  });
}

function axisLabel(cents) {
  var yuan = Math.round(cents / 100);
  if (yuan >= 10000) return (yuan / 10000).toFixed(1) + '万';
  return '' + yuan;
}

function drawBarChart(that, selector, series, labels) {
  setupCanvas(that, selector, function (ctx, w, h) {
    var padL = 44, padB = 26, padT = 16, padR = 8;
    var chartW = w - padL - padR;
    var chartH = h - padT - padB;
    var max = 0;
    series.forEach(function (s) {
      s.data.forEach(function (v) { if (v > max) max = v; });
    });
    if (max === 0) max = 1;
    var groupW = chartW / labels.length;
    var barW = Math.min(14, (groupW * 0.72) / series.length);
    ctx.font = '10px sans-serif';
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    for (var i = 0; i <= 4; i++) {
      var y = padT + chartH - (chartH * i / 4);
      ctx.strokeStyle = '#eef2f7';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(padL, y);
      ctx.lineTo(w - padR, y);
      ctx.stroke();
      ctx.fillStyle = '#8a94a6';
      ctx.fillText(axisLabel(max * i / 4), padL - 6, y);
    }
    for (var li = 0; li < labels.length; li++) {
      series.forEach(function (s, si) {
        var v = s.data[li] || 0;
        var bh = (v / max) * chartH;
        var x = padL + li * groupW + (groupW - barW * series.length) / 2 + si * barW;
        ctx.fillStyle = s.color;
        ctx.fillRect(x, padT + chartH - bh, barW - 1, bh);
      });
      ctx.fillStyle = '#8a94a6';
      ctx.textAlign = 'center';
      ctx.fillText(labels[li], padL + li * groupW + groupW / 2, h - 10);
    }
  });
}

function drawDonutChart(that, selector, items, colors) {
  setupCanvas(that, selector, function (ctx, w, h) {
    var cx = w / 2;
    var cy = h / 2 - 8;
    var r = Math.min(w, h) / 2 - 20;
    var total = 0;
    items.forEach(function (it) { total += it.value; });
    ctx.textAlign = 'center';
    if (total <= 0) {
      ctx.fillStyle = '#8a94a6';
      ctx.font = '12px sans-serif';
      ctx.fillText('暂无数据', cx, cy);
      return;
    }
    var start = -Math.PI / 2;
    items.forEach(function (it, i) {
      var angle = (it.value / total) * Math.PI * 2;
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.arc(cx, cy, r, start, start + angle);
      ctx.closePath();
      ctx.fillStyle = colors[i % colors.length];
      ctx.fill();
      start += angle;
    });
    ctx.beginPath();
    ctx.arc(cx, cy, r * 0.6, 0, Math.PI * 2);
    ctx.fillStyle = '#ffffff';
    ctx.fill();
    ctx.fillStyle = '#1f2937';
    ctx.font = 'bold 18px sans-serif';
    ctx.textBaseline = 'alphabetic';
    ctx.fillText('¥' + (total / 100).toFixed(0), cx, cy);
    ctx.fillStyle = '#8a94a6';
    ctx.font = '10px sans-serif';
    ctx.fillText('总支出', cx, cy + 20);
  });
}

module.exports = { drawBarChart: drawBarChart, drawDonutChart: drawDonutChart };
