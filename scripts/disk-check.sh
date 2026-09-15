#!/bin/bash
# 磁盘使用率监控：超过85%记告警日志
USAGE=$(df / | tail -1 | awk "{print \$5}" | tr -d %)
if [ "$USAGE" -gt 85 ]; then
  echo "$(date) WARN disk usage ${USAGE}%" >> /var/log/jizhang-disk.log
fi
