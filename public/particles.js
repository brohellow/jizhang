// ============================================================
// 高级背景光粒子系统（Canvas 2D）
// 升级点（参考 Cosmic Background / Bokeh Dust Drift）：
//   1. 景深分层：近/中/远 三层，大小、速度、透明度分层
//   2. 辉光粒子：径向渐变光晕（中心亮边缘淡），非纯色圆点
//   3. 散景光斑：少量大而柔和的模糊光斑，营造相机散景氛围
//   4. 鼠标视差：粒子在光标附近轻微远离（拨开感），克制不干扰
//   5. 轨迹细节：粒子带微弱尾迹（低透明度残影）
// 性能：不用 shadowBlur（极耗），用 createRadialGradient 模拟辉光
// 降级：prefers-reduced-motion 关闭 / 移动端减半 / 低内存减
// ============================================================
(function () {
  'use strict';
  if (window.__particlesInited) return;
  window.__particlesInited = true;

  if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    return;
  }

  var canvas = document.createElement('canvas');
  canvas.id = 'bg-particles';
  canvas.style.cssText = [
    'position:fixed;top:0;left:0;width:100%;height:100%;',
    'z-index:0;pointer-events:none;',
  ].join('');
  document.body.appendChild(canvas);

  var ctx = canvas.getContext('2d');
  var particles = [];   // 辉光粒子（多）
  var bokehs = [];      // 散景光斑（少）
  var W = 0, H = 0, DPR = 1;
  var rafId = null;
  var running = false;
  var lastTime = 0;
  var frameCount = 0, frameTimeSum = 0;
  var isDark = false;
  var mouse = { x: -9999, y: -9999, active: false };

  function isDarkTheme() {
    var t = localStorage.getItem('jz_theme') || 'system';
    if (t === 'dark') return true;
    if (t === 'light') return false;
    return window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
  }

  // 每层的配色（近亮远暗）
  function layerPalette() {
    if (isDark) {
      return {
        near: ['rgba(150,180,255,A)', 'rgba(130,190,255,A)'],
        mid: ['rgba(100,150,230,A)', 'rgba(140,120,220,A)'],
        far: ['rgba(70,100,180,A)', 'rgba(90,110,200,A)'],
        bokeh: ['rgba(100,140,230,A)', 'rgba(80,110,200,A)'],
      };
    }
    return {
      near: ['rgba(90,140,255,A)', 'rgba(120,170,255,A)'],
      mid: ['rgba(79,125,249,A)', 'rgba(52,199,123,A)'],
      far: ['rgba(120,160,220,A)', 'rgba(160,190,255,A)'],
      bokeh: ['rgba(79,125,249,A)', 'rgba(52,199,123,A)'],
    };
  }

  // 目标粒子数
  function targetCount() {
    var area = W * H;
    var base = area > 2000000 ? 36 : area > 900000 ? 24 : 14;
    if (window.matchMedia && window.matchMedia('(pointer: coarse)').matches) base = Math.floor(base * 0.45);
    if (navigator.deviceMemory && navigator.deviceMemory <= 2) base = Math.floor(base * 0.3);
    return Math.max(6, Math.min(50, base));
  }

  function resize() {
    DPR = Math.min(window.devicePixelRatio || 1, 2);
    W = window.innerWidth;
    H = window.innerHeight;
    canvas.width = W * DPR;
    canvas.height = H * DPR;
    canvas.style.width = W + 'px';
    canvas.style.height = H + 'px';
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    build();
  }

  function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }

  // 生成辉光粒子（分三层）
  function build() {
    var pal = layerPalette();
    particles = [];
    var n = targetCount();
    for (var i = 0; i < n; i++) {
      var roll = Math.random();
      var layer, size, speed, alpha;
      if (roll < 0.55) { // 远景：小、慢、淡
        layer = pal.far; size = 0.8 + Math.random() * 1.4; speed = 0.08 + Math.random() * 0.16; alpha = 0.15 + Math.random() * 0.2;
      } else if (roll < 0.85) { // 中景
        layer = pal.mid; size = 1.4 + Math.random() * 1.8; speed = 0.14 + Math.random() * 0.2; alpha = 0.2 + Math.random() * 0.25;
      } else { // 近景：大、快、亮
        layer = pal.near; size = 2.2 + Math.random() * 2.4; speed = 0.2 + Math.random() * 0.28; alpha = 0.28 + Math.random() * 0.3;
      }
      particles.push({
        x: Math.random() * W, y: Math.random() * H,
        r: size, alpha: alpha, baseAlpha: alpha,
        vx: (Math.random() - 0.5) * 0.12,
        vy: -speed,
        color: pick(layer),
        phase: Math.random() * Math.PI * 2,
        trail: [{ x: Math.random() * W, y: Math.random() * H }],
      });
    }
    // 散景光斑（3-6 个大而柔的光斑）
    bokehs = [];
    var bn = Math.max(2, Math.min(6, Math.floor(n * 0.15)));
    for (var j = 0; j < bn; j++) {
      bokehs.push({
        x: Math.random() * W, y: Math.random() * H,
        r: 30 + Math.random() * 70,
        alpha: 0.04 + Math.random() * 0.07,
        vx: (Math.random() - 0.5) * 0.08,
        vy: -(0.03 + Math.random() * 0.06),
        color: pick(pal.bokeh),
        phase: Math.random() * Math.PI * 2,
      });
    }
  }

  // 辉光粒子绘制：径向渐变（中心亮边缘淡）
  function drawGlow(p, breath) {
    var a = p.alpha * breath;
    if (a <= 0.01) return;
    var g = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, p.r * 3);
    g.addColorStop(0, p.color.replace('A', String(a)));
    g.addColorStop(0.4, p.color.replace('A', String(a * 0.35)));
    g.addColorStop(1, p.color.replace('A', '0'));
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(p.x, p.y, p.r * 3, 0, Math.PI * 2);
    ctx.fill();
  }

  // 散景光斑：更大更柔的径向渐变
  function drawBokeh(b, t) {
    var breath = 0.7 + 0.3 * Math.sin(t * 0.5 + b.phase);
    var a = b.alpha * breath;
    if (a <= 0.01) return;
    var g = ctx.createRadialGradient(b.x, b.y, 0, b.x, b.y, b.r);
    g.addColorStop(0, b.color.replace('A', String(a)));
    g.addColorStop(0.5, b.color.replace('A', String(a * 0.4)));
    g.addColorStop(1, b.color.replace('A', '0'));
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(b.x, b.y, b.r, 0, Math.PI * 2);
    ctx.fill();
  }

  // 鼠标排斥力（平方距离，避免开方）
  function applyMouse(p) {
    if (!mouse.active) return;
    var dx = p.x - mouse.x, dy = p.y - mouse.y;
    var d2 = dx * dx + dy * dy;
    var R = 90, R2 = R * R;
    if (d2 < R2 && d2 > 0.1) {
      var d = Math.sqrt(d2);
      var force = (1 - d / R) * 0.6;
      p.vx += (dx / d) * force * 0.06;
      p.vy += (dy / d) * force * 0.06;
    }
  }

  function frame(t) {
    if (!running) return;
    // 帧率自适应降级
    if (lastTime) {
      var dt = t - lastTime;
      frameCount++; frameTimeSum += dt;
      if (frameCount === 60) {
        var avg = frameTimeSum / 60;
        if (avg > 24 && particles.length > 8) particles.splice(0, Math.ceil(particles.length * 0.2));
        frameCount = 0; frameTimeSum = 0;
      }
    }
    lastTime = t;
    var time = t * 0.001;

    ctx.clearRect(0, 0, W, H);

    // 散景光斑（最底层氛围）
    for (var i = 0; i < bokehs.length; i++) {
      var b = bokehs[i];
      b.x += b.vx; b.y += b.vy;
      if (b.y < -b.r * 2) { b.y = H + b.r * 2; b.x = Math.random() * W; }
      if (b.x < -b.r * 2) b.x = W + b.r * 2;
      if (b.x > W + b.r * 2) b.x = -b.r * 2;
      drawBokeh(b, time);
    }

    // 辉光粒子
    for (var j = 0; j < particles.length; j++) {
      var p = particles[j];
      applyMouse(p);
      p.vx *= 0.98; // 速度阻尼（排斥后回稳）
      p.x += p.vx;
      p.y += p.vy + Math.sin(time * 1.3 + p.phase) * 0.05;
      if (p.y < -10) { p.y = H + 10; p.x = Math.random() * W; p.vx = (Math.random() - 0.5) * 0.12; }
      if (p.x < -10) p.x = W + 10;
      if (p.x > W + 10) p.x = -10;
      var breath = 0.65 + 0.35 * Math.sin(time * 1.1 + p.phase);
      drawGlow(p, breath);
    }
    rafId = requestAnimationFrame(frame);
  }

  function start() {
    if (running) return;
    running = true;
    lastTime = 0;
    rafId = requestAnimationFrame(frame);
  }
  function stop() {
    running = false;
    if (rafId) cancelAnimationFrame(rafId);
    rafId = null;
  }

  function onThemeChange() {
    isDark = isDarkTheme();
    build();
  }

  // 鼠标交互（仅桌面细指针；触摸不启用）
  if (window.matchMedia && !window.matchMedia('(pointer: coarse)').matches) {
    window.addEventListener('mousemove', function (e) {
      mouse.x = e.clientX; mouse.y = e.clientY; mouse.active = true;
    }, { passive: true });
    document.addEventListener('mouseleave', function () { mouse.active = false; });
  }

  document.addEventListener('visibilitychange', function () {
    if (document.hidden) stop(); else start();
  });
  window.addEventListener('resize', resize);
  window.addEventListener('jz-theme-change', onThemeChange);

  resize();
  start();
})();
