#!/bin/bash
# 错误监控：5分钟内错误日志超过50条告警
COUNT=$(grep -c -i "error\|slow" /home/ubuntu/.pm2/logs/jizhang-api-error.log 2>/dev/null || echo 0)
if [ "$COUNT" -gt 50 ]; then
  echo "$(date) ERROR LOG SPIKE: $COUNT errors" >> /var/log/jizhang-errmon.log
fi
