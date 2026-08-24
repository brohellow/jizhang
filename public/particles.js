// ============================================================
// 背景粒子系统（Canvas）
// - 氛围点缀：柔和光点缓慢上浮 + 轻微漂移
// - 性能降级：低性能/移动端自动减少或关闭
// - 尊重系统"减少动态效果"（prefers-reduced-motion）
// - pointer-events:none，不遮挡任何交互
// ============================================================
(function () {
  'use strict';
  if (window.__particlesInited) return;
  window.__particlesInited = true;

  // 系统减少动态效果 → 直接关闭
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
  var particles = [];
  var W = 0, H = 0, DPR = 1;
  var rafId = null;
  var running = false;
  var lastTime = 0;
  var frameCount = 0;
  var frameTimeSum = 0;
  var isDark = false;

  // 计算目标粒子数量（按屏幕面积 + 设备性能）
  function targetCount() {
    var area = W * H;
    var base = area > 2000000 ? 42 : area > 900000 ? 30 : 18;
    // 移动端降级（触摸屏）
    if (window.matchMedia && window.matchMedia('(pointer: coarse)').matches) {
      base = Math.floor(base * 0.45);
    }
    // 低内存设备降级
    if (navigator.deviceMemory && navigator.deviceMemory <= 2) {
      base = Math.floor(base * 0.3);
    }
    return Math.max(6, Math.min(60, base));
  }

  function isDarkTheme() {
    var t = localStorage.getItem('jz_theme') || 'system';
    if (t === 'dark') return true;
    if (t === 'light') return false;
    return window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
  }

  function colors() {
    return isDark
      ? ['rgba(109,155,255,ALPHA)', 'rgba(120,180,255,ALPHA)', 'rgba(160,140,220,ALPHA)']
      : ['rgba(79,125,249,ALPHA)', 'rgba(120,160,255,ALPHA)', 'rgba(52,199,123,ALPHA)'];
  }

  function resize() {
    DPR = Math.min(window.devicePixelRatio || 1, 2); // 限制 DPR 避免高负荷
    W = window.innerWidth;
    H = window.innerHeight;
    canvas.width = W * DPR;
    canvas.height = H * DPR;
    canvas.style.width = W + 'px';
    canvas.style.height = H + 'px';
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    spawn(targetCount());
  }

  function spawn(n) {
    var cols = colors();
    particles = [];
    for (var i = 0; i < n; i++) {
      particles.push(makeParticle(cols));
    }
  }

  function makeParticle(cols) {
    var speedY = 0.12 + Math.random() * 0.25;   // 上浮速度（克制）
    var speedX = (Math.random() - 0.5) * 0.12;  // 轻微横漂
    return {
      x: Math.random() * W,
      y: Math.random() * H,
      r: 1 + Math.random() * 2.2,               // 小光点
      alpha: 0.08 + Math.random() * 0.2,        // 低透明度
      speedY: speedY,
      speedX: speedX,
      color: cols[Math.floor(Math.random() * cols.length)],
      phase: Math.random() * Math.PI * 2,       // 呼吸相位
    };
  }

  function frame(t) {
    if (!running) return;
    // 帧率自适应：若持续掉帧则逐步减少粒子
    if (lastTime) {
      var dt = t - lastTime;
      frameCount++;
      frameTimeSum += dt;
      if (frameCount === 60) {
        var avg = frameTimeSum / 60;
        if (avg > 24 && particles.length > 8) { // 平均低于 40fps 才减
          particles.splice(0, Math.ceil(particles.length * 0.2));
        }
        frameCount = 0;
        frameTimeSum = 0;
      }
    }
    lastTime = t;

    ctx.clearRect(0, 0, W, H);
    var time = t * 0.001;
    for (var i = 0; i < particles.length; i++) {
      var p = particles[i];
      p.y -= p.speedY;
      p.x += p.speedX + Math.sin(time + p.phase) * 0.06;
      // 呼吸闪烁
      var breath = 0.6 + 0.4 * Math.sin(time * 1.2 + p.phase);
      // 越界回底部（柔和循环）
      if (p.y < -8) { p.y = H + 8; p.x = Math.random() * W; }
      if (p.x < -8) p.x = W + 8;
      if (p.x > W + 8) p.x = -8;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
      ctx.fillStyle = p.color.replace('ALPHA', String((p.alpha * breath).toFixed(3)));
      ctx.fill();
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
    // 重新生成粒子颜色
    var n = particles.length;
    var cols = colors();
    for (var i = 0; i < n; i++) {
      particles[i].color = cols[Math.floor(Math.random() * cols.length)];
    }
  }

  // 页面可见性：后台暂停（省电/防泄漏）
  document.addEventListener('visibilitychange', function () {
    if (document.hidden) stop();
    else start();
  });

  window.addEventListener('resize', function () {
    resize();
    if (running) { /* resize 后继续 */ }
  });

  // 主题切换（自定义事件，由 app.js 触发）
  window.addEventListener('jz-theme-change', onThemeChange);

  resize();
  start();
})();
