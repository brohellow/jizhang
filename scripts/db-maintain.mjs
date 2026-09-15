import { DatabaseSync } from "node:sqlite";
const db = new DatabaseSync("/opt/jizhang/data/jizhang.db");
db.exec("PRAGMA wal_checkpoint(TRUNCATE);");
db.exec("ANALYZE;");
db.close();
console.log("db maintain ok " + new Date().toISOString());
