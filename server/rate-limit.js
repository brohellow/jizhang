// ============================================================
// 轻量限流中间件（零依赖，内存实现）
// 用途：防恶意注册、防暴力破解密码、防接口刷爆
//
// 用法：
//   import { rateLimit, loginThrottle } from './rate-limit.js';
//   app.use('/api/auth/register', rateLimit({ windowMs: 3600_000, max: 5 }));
//   app.use('/api/auth/login', rateLimit({ windowMs: 600_000, max: 20 }));
//
// 说明：
//   - 按客户端 IP + 可选 key 维度计数（如登录限流可按 账号+IP 组合）
//   - 内存存储：进程重启后清零（本应用单进程 PM2，够用）
//   - 返回 429 + JSON 错误，带 Retry-After 头
// ============================================================

// 存储：Map<key, { count, resetAt }>
const buckets = new Map();

// 定期清理过期桶，防止内存无限增长
const CLEANUP_INTERVAL = 10 * 60 * 1000; // 10 分钟
setInterval(function () {
  const now = Date.now();
  for (const [k, v] of buckets) {
    if (v.resetAt <= now) buckets.delete(k);
  }
}, CLEANUP_INTERVAL).unref();

/**
 * 创建限流中间件
 * @param {object} opts
 * @param {number} opts.windowMs - 时间窗口（毫秒）
 * @param {number} opts.max - 窗口内最大次数
 * @param {string} [opts.message] - 超限时的提示文案
 * @param {function} [opts.keyFn] - 自定义维度 key（默认用 IP）
 */
export function rateLimit(opts) {
  const windowMs = opts.windowMs || 60000;
  const max = opts.max || 10;
  const message = opts.message || '请求过于频繁，请稍后再试';
  const keyFn = opts.keyFn || function (req) {
    return req.ip || req.socket.remoteAddress || 'unknown';
  };

  return function (req, res, next) {
    const key = String(keyFn(req));
    const now = Date.now();
    let bucket = buckets.get(key);
    if (!bucket || bucket.resetAt <= now) {
      bucket = { count: 0, resetAt: now + windowMs };
      buckets.set(key, bucket);
    }
    bucket.count++;
    const remaining = Math.max(0, max - bucket.count);
    res.setHeader('X-RateLimit-Limit', String(max));
    res.setHeader('X-RateLimit-Remaining', String(remaining));
    res.setHeader('X-RateLimit-Reset', String(Math.ceil(bucket.resetAt / 1000)));

    if (bucket.count > max) {
      const retryAfter = Math.ceil((bucket.resetAt - now) / 1000);
      res.setHeader('Retry-After', String(retryAfter));
      return res.status(429).json({ error: message, retry_after: retryAfter });
    }
    next();
  };
}

// 登录专用限流：按「账号 + IP」组合计数，错 5 次锁 15 分钟（防暴力破解）
export function loginThrottle() {
  const attempts = new Map(); // key: username|ip -> { count, lockUntil }

  return function (req, res, next) {
    const username = String((req.body && req.body.username) || '').toLowerCase();
    const ip = req.ip || req.socket.remoteAddress || 'unknown';
    const key = (username || 'anon') + '|' + ip;
    const now = Date.now();
    const entry = attempts.get(key);

    if (entry && entry.lockUntil > now) {
      const retryAfter = Math.ceil((entry.lockUntil - now) / 1000);
      res.setHeader('Retry-After', String(retryAfter));
      return res.status(429).json({ error: '尝试次数过多，请 ' + Math.ceil(retryAfter / 60) + ' 分钟后再试', retry_after: retryAfter });
    }

    // 记录"原始请求"进来（供成功后清计数 / 失败后累加）
    req.loginAttemptKey = key;
    req.loginAttemptsMap = attempts;

    // 清理过期（简单做：超 1 小时的删掉）
    if (attempts.size > 5000) {
      for (const [k, v] of attempts) {
        if (v.lockUntil <= now && v.count === 0) attempts.delete(k);
      }
    }
    next();
  };
}

// 供 auth 路由调用：登录成功后清零，失败后累加并可能锁定
export function recordLoginFailure(key, attemptsMap, maxAttempts, lockMs) {
  const now = Date.now();
  const entry = attemptsMap.get(key) || { count: 0, lockUntil: 0 };
  entry.count++;
  if (entry.count >= (maxAttempts || 5)) {
    entry.lockUntil = now + (lockMs || 15 * 60 * 1000);
    entry.count = 0;
  }
  attemptsMap.set(key, entry);
}

export function clearLoginAttempts(key, attemptsMap) {
  attemptsMap.delete(key);
}
