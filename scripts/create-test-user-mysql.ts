import "dotenv/config";
import mysql from "mysql2/promise";
import bcrypt from "bcryptjs";

async function createTestUser() {
  const pool = await mysql.createPool({
    uri: process.env.DATABASE_URL,
    waitForConnections: true,
    connectionLimit: 1,
  });

  // Check if user exists
  const [existing] = await pool.execute("SELECT id FROM users WHERE email = ?", ["ceo@nokdaun.uz"]);
  if ((existing as any[]).length > 0) {
    console.log("User already exists!");
    console.log("Login: ceo@nokdaun.uz");
    console.log("Password: admin123");
    await pool.end();
    return;
  }

  // Hash password
  const passwordHash = await bcrypt.hash("admin123", 10);

  // Insert test user
  const now = new Date();
  await pool.execute(
    "INSERT INTO users (name, email, passwordHash, role, createdAt, updatedAt, lastSignedIn) VALUES (?, ?, ?, ?, ?, ?, ?)",
    ["CEO", "ceo@nokdaun.uz", passwordHash, "admin", now, now, now]
  );

  console.log("User created successfully!");
  console.log("Login: ceo@nokdaun.uz");
  console.log("Password: admin123");

  await pool.end();
}

createTestUser().catch(error => {
  console.error("Error:", error.message);
  process.exit(1);
});
