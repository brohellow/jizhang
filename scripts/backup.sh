#!/bin/bash
# 数据库自动备份脚本
# 保留策略：最近 7 天 + 每月 1 号保留 6 个月

set -e

BACKUP_DIR="/opt/jizhang/backups"
DB_FILE="/opt/jizhang/data/jizhang.db"
DATE=$(date +%Y%m%d-%H%M%S)
BACKUP_FILE="$BACKUP_DIR/jizhang-$DATE.db"

# 创建备份目录
mkdir -p "$BACKUP_DIR"

# 使用 VACUUM INTO 备份（比 cp 更安全，避免 WAL 文件不一致）
echo "[$(date)] 开始备份..."
sqlite3 "$DB_FILE" "VACUUM INTO '$BACKUP_FILE'"
echo "[$(date)] 备份完成: $BACKUP_FILE"

# 保留策略：删除 7 天前的备份（但保留每月 1 号的）
find "$BACKUP_DIR" -name "jizhang-*.db" -type f | while read file; do
  # 提取日期（格式：jizhang-YYYYMMDD-HHMMSS.db）
  filename=$(basename "$file")
  filedate=$(echo "$filename" | grep -oP '\d{8}' | head -1)
  
  if [ -z "$filedate" ]; then
    continue
  fi
  
  # 计算文件日期距今天数
  file_ts=$(date -d "$filedate" +%s 2>/dev/null || echo 0)
  now_ts=$(date +%s)
  days_diff=$(( (now_ts - file_ts) / 86400 ))
  
  # 提取日（DD）
  day=$(echo "$filedate" | cut -c7-8)
  
  # 如果是每月 1 号，保留 180 天；否则保留 7 天
  if [ "$day" = "01" ]; then
    if [ $days_diff -gt 180 ]; then
      echo "[$(date)] 删除旧备份（超过 180 天）: $filename"
      rm -f "$file"
    fi
  else
    if [ $days_diff -gt 7 ]; then
      echo "[$(date)] 删除旧备份（超过 7 天）: $filename"
      rm -f "$file"
    fi
  fi
done

echo "[$(date)] 备份清理完成"
ls -lh "$BACKUP_DIR" | tail -5
