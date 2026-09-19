#!/bin/bash
# 记账软件一键部署脚本（后端已拆分 4 个独立进程）
# 用法: ./deploy.sh

set -e  # 遇到错误立即退出

echo "=== 开始部署 ==="

# 1. 拉取最新代码
echo "[1/4] 拉取最新代码..."
cd /opt/jizhang
git fetch origin
git reset --hard origin/master
echo "✓ 代码已更新到 $(git log --oneline -1)"

# 2. 安装依赖（如果 package.json 有变化）
echo "[2/4] 检查依赖..."
if git diff HEAD@{1} HEAD --name-only | grep -q "package.json\|package-lock.json"; then
  echo "  依赖有变化，执行 npm ci..."
  npm ci
  echo "✓ 依赖已更新"
else
  echo "  依赖无变化，跳过"
fi

# 3. 重启全部后端进程（主 + AI + 工资 + 三国杀，幂等）
echo "[3/4] 重启服务..."
mkdir -p logs

# 已存在则重启，否则首次启动
restart_or_start() {
  local name="$1" script="$2"
  if pm2 describe "$name" >/dev/null 2>&1; then
    pm2 restart "$name" --update-env
  else
    pm2 start "$script" --name "$name" --max-memory-restart 300M
  fi
}

restart_or_start jizhang-api    server/index.js
restart_or_start jizhang-ai     server-ai/index.js
restart_or_start jizhang-salary server-salary/index.js
restart_or_start jizhang-sgs    server-sgs/index.js

sleep 2
echo "✓ 服务已重启"

# 4. 健康检查（逐个端口）
echo "[4/4] 健康检查..."
check_port() {
  local name="$1" port="$2"
  local code
  code=$(curl -s -o /dev/null -w "%{http_code}" "http://localhost:${port}/api/health")
  if [ "$code" = "200" ]; then
    echo "  ✓ ${name} (端口 ${port}) 正常"
  else
    echo "  ✗ ${name} (端口 ${port}) 异常 (HTTP ${code})，检查日志: pm2 logs ${name}"
    return 1
  fi
}

ok=1
check_port jizhang-api 3000 || ok=0
check_port jizhang-ai 3001 || ok=0
check_port jizhang-salary 3002 || ok=0
check_port jizhang-sgs 3003 || ok=0

if [ "$ok" = "0" ]; then
  echo "✗ 部分服务异常，请检查 pm2 logs"
  exit 1
fi

echo ""
echo "=== 部署完成 ==="
pm2 list | grep -E "jizhang-(api|ai|salary|sgs)"
