import Database from "better-sqlite3";
import path from "path";

const DB_PATH = path.join(process.cwd(), "data", "database.db");
const db = new Database(DB_PATH);
db.pragma("foreign_keys = OFF");

db.exec("DELETE FROM container_movements");
db.exec("DELETE FROM transactions");
db.exec("DELETE FROM cash_entries");
db.exec("DELETE FROM agent_taking_entries");
db.exec("DELETE FROM agent_cash_submissions");
db.exec("DELETE FROM import_history");
db.exec("DELETE FROM kassa_daily_actuals");
db.exec("DELETE FROM clients");
db.exec("DELETE FROM agents");
db.exec("DELETE FROM products");

db.pragma("foreign_keys = ON");
db.close();
console.log("Barcha ma'lumotlar tozalandi (foydalanuvchilar saqlandi)");
