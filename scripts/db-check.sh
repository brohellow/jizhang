#!/bin/bash
# 数据库完整性检查
RESULT=$(/usr/bin/node -e "const{DatabaseSync}=require(\"node:sqlite\");const db=new DatabaseSync(\"/opt/jizhang/data/jizhang.db\");const r=db.prepare(\"PRAGMA integrity_check\").get();console.log(r.integrity_check);db.close()" 2>/dev/null)
if [ "$RESULT" != "ok" ]; then
  echo "$(date) DB INTEGRITY FAIL: $RESULT" >> /var/log/jizhang-dbcheck.log
fi
