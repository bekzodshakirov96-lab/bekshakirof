import Database from "better-sqlite3";
import bcrypt from "bcryptjs";
import path from "path";

const DB_PATH = path.join(process.cwd(), "data", "database.db");

async function createTestUser() {
  const db = new Database(DB_PATH);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");

  // Check if user exists
  const existing = db.prepare("SELECT id FROM users WHERE email = ?").get("admin@test.com");
  if (existing) {
    console.log("Test user already exists!");
    console.log("Login: admin@test.com");
    console.log("Password: admin123");
    db.close();
    return;
  }

  // Hash password
  const passwordHash = await bcrypt.hash("admin123", 10);

  // Insert test user
  const now = Date.now();
  db.prepare(`
    INSERT INTO users (name, email, passwordHash, role, createdAt, updatedAt, lastSignedIn)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run("Admin Test", "admin@test.com", passwordHash, "admin", now, now, now);

  console.log("Test user created successfully!");
  console.log("Login: admin@test.com");
  console.log("Password: admin123");

  db.close();
}

createTestUser().catch(console.error);
