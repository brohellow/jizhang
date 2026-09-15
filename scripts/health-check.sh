#!/bin/bash
# 服务健康检查：jizhang-api 挂掉时自动拉起
if ! curl -sf http://127.0.0.1:3000/api/health -o /dev/null 2>/dev/null; then
  echo "$(date) jizhang-api DOWN, restarting" >> /var/log/jizhang-health.log
  cd /opt/jizhang && su ubuntu -c "pm2 restart jizhang-api" >/dev/null 2>&1
fi
if ! curl -sf http://127.0.0.1:8085/rooms -o /dev/null 2>/dev/null; then
  echo "$(date) sgs-server DOWN, restarting" >> /var/log/jizhang-health.log
  cd /opt/sgs && su ubuntu -c "pm2 restart sgs-server" >/dev/null 2>&1
fi
