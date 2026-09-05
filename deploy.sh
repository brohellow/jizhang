#!/bin/bash
# 记账软件一键部署脚本
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

# 3. 重启服务
echo "[3/4] 重启服务..."
pm2 restart jizhang-api
sleep 2
echo "✓ 服务已重启"

# 4. 健康检查
echo "[4/4] 健康检查..."
if curl -s -o /dev/null -w "%{http_code}" http://localhost:3000/ | grep -q "200"; then
  echo "✓ 服务运行正常"
else
  echo "✗ 服务异常，请检查日志: pm2 logs jizhang-api"
  exit 1
fi

echo ""
echo "=== 部署完成 ==="
pm2 list | grep jizhang-api
