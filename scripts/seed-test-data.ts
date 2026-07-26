import Database from "better-sqlite3";
import path from "path";

const DB_PATH = path.join(process.cwd(), "data", "database.db");

async function seedTestData() {
  const db = new Database(DB_PATH);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");

  const now = Date.now();

  // 1. Products (Narxlar)
  const productData = [
    { code: "PRD-001", name: "Нокдаун 2,5л", unit: "dona", price: 112000 },
    { code: "PRD-002", name: "Барлос 2,5л", unit: "dona", price: 106000 },
    { code: "PRD-003", name: "Барлос 1,5л", unit: "dona", price: 80000 },
    { code: "PRD-004", name: "чешское 0,5 л", unit: "dona", price: 111000 },
    { code: "PRD-005", name: "Кружка пен 1,0 л", unit: "dona", price: 73000 },
    { code: "PRD-006", name: "макка", unit: "dona", price: 105000 },
    { code: "PRD-007", name: "Italyano", unit: "dona", price: 90000 },
    { code: "PRD-008", name: "Бочка 50", unit: "dona", price: 600000, containerType: "keg_50", containerUnitsPerItem: 1 },
    { code: "PRD-009", name: "Бочка 30", unit: "dona", price: 400000, containerType: "keg_30", containerUnitsPerItem: 1 },
  ];

  const insertProduct = db.prepare(`
    INSERT OR IGNORE INTO products (code, name, unit, price, containerType, containerUnitsPerItem, isActive, createdAt, updatedAt)
    VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?)
  `);

  for (const p of productData) {
    insertProduct.run(p.code, p.name, p.unit, p.price, p.containerType ?? null, p.containerUnitsPerItem ?? 0, now, now);
  }
  console.log(`✓ ${productData.length} ta mahsulot qo'shildi`);

  // Get actual product IDs from database
  const productRows = db.prepare("SELECT id, name FROM products").all() as Array<{ id: number; name: string }>;
  const productNameToId = new Map(productRows.map(r => [r.name.trim().toLowerCase(), r.id]));

  // 2. Agents
  const agentData = [
    { name: "Abdullayev Sardor", phone: "+998901234567" },
    { name: "Rahimov Jasur", phone: "+998902345678" },
    { name: "Toshmatov Dilshod", phone: "+998903456789" },
  ];

  const insertAgent = db.prepare(`
    INSERT OR IGNORE INTO agents (name, phone, isActive, createdAt, updatedAt)
    VALUES (?, ?, 1, ?, ?)
  `);

  const agentIds: number[] = [];
  for (const a of agentData) {
    const result = insertAgent.run(a.name, a.phone, now, now);
    agentIds.push(Number(result.lastInsertRowid));
  }
  console.log(`✓ ${agentData.length} ta agent qo'shildi`);

  // 3. Clients
  const clientData = [
    { code: "CL-001", name: "Do'stlar kafesi", agentIndex: 0, phone: "+998911111111", address: "Toshkent, Amir Temur ko'chasi 1" },
    { code: "CL-002", name: "Samarkand restorani", agentIndex: 0, phone: "+998912222222", address: "Toshkent, Buyuk Ipak Yo'li 2" },
    { code: "CL-003", name: "Buxoro pub", agentIndex: 1, phone: "+998913333333", address: "Samarqand, Registon ko'chasi 3" },
    { code: "CL-004", name: "Nur restorani", agentIndex: 1, phone: "+998914444444", address: "Samarqand, Siyob bozori 4" },
    { code: "CL-005", name: "Kapalak kafe", agentIndex: 2, phone: "+998915555555", address: "Buxoro, Al-Buxoriy ko'chasi 5" },
    { code: "CL-006", name: "Choyxona Hammasi", agentIndex: 2, phone: "+998916666666", address: "Buxoro, G'ijduvon ko'chasi 6" },
  ];

  const insertClient = db.prepare(`
    INSERT OR IGNORE INTO clients (code, name, agentId, phone, address, openingDebt, isActive, createdAt, updatedAt)
    VALUES (?, ?, ?, ?, ?, 0, 1, ?, ?)
  `);

  const clientIds: number[] = [];
  for (const c of clientData) {
    const agentId = agentIds[c.agentIndex];
    const result = insertClient.run(c.code, c.name, agentId, c.phone, c.address, now, now);
    clientIds.push(Number(result.lastInsertRowid));
  }
  console.log(`✓ ${clientData.length} ta mijoz qo'shildi`);

  // 4. Transactions (Savdolar)
  const insertTransaction = db.prepare(`
    INSERT INTO transactions (sourceKey, transactionDate, agentId, clientId, productId, productName, unit, quantity, currentPrice, salePrice, totalAmount, cashPayment, terminalPayment, clickPayment, note, source, createdBy, createdAt, updatedAt)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)
  `);

  const transactions = [
    { clientIndex: 0, productIndex: 0, quantity: 10, cashPayment: 500000, terminalPayment: 620000 },
    { clientIndex: 1, productIndex: 1, quantity: 5, cashPayment: 300000, terminalPayment: 230000 },
    { clientIndex: 2, productIndex: 2, quantity: 8, cashPayment: 400000, terminalPayment: 240000 },
    { clientIndex: 3, productIndex: 3, quantity: 3, cashPayment: 200000, terminalPayment: 133000 },
    { clientIndex: 4, productIndex: 4, quantity: 12, cashPayment: 600000, terminalPayment: 276000 },
    { clientIndex: 5, productIndex: 5, quantity: 6, cashPayment: 350000, terminalPayment: 280000 },
    { clientIndex: 0, productIndex: 6, quantity: 4, cashPayment: 200000, terminalPayment: 160000 },
    { clientIndex: 1, productIndex: 7, quantity: 2, cashPayment: 800000, terminalPayment: 400000 },
    { clientIndex: 2, productIndex: 8, quantity: 3, cashPayment: 700000, terminalPayment: 500000 },
    { clientIndex: 3, productIndex: 0, quantity: 7, cashPayment: 400000, terminalPayment: 384000 },
  ];

  // Use dates spread across recent days
  const dayMs = 86400000;

  for (let i = 0; i < transactions.length; i++) {
    const t = transactions[i];
    const product = productData[t.productIndex];
    const totalAmount = product.price * t.quantity;
    const clickPayment = totalAmount - t.cashPayment - t.terminalPayment;
    const date = new Date(now - (i * dayMs));

    insertTransaction.run(
      `manual:test-${i + 1}`,
      date.getTime(),
      agentIds[clientData[t.clientIndex].agentIndex],
      clientIds[t.clientIndex],
      productNameToId.get(product.name.trim().toLowerCase()) ?? null,
      product.name,
      product.unit,
      t.quantity.toString(),
      product.price,
      product.price,
      totalAmount,
      t.cashPayment,
      t.terminalPayment,
      Math.max(0, clickPayment),
      `Test savdo #${i + 1}`,
      "manual",
      now,
      now,
    );
  }
  console.log(`✓ ${transactions.length} ta savdo tranzaksiyasi qo'shildi`);

  // 5. Cash entries (Kassa)
  const insertCash = db.prepare(`
    INSERT INTO cash_entries (sourceKey, entryDate, type, category, agentId, description, cashAmount, terminalAmount, clickAmount, source, createdBy, createdAt, updatedAt)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)
  `);

  const cashEntries = [
    { type: "income", category: "Naqd to'lov", agentIndex: 0, description: "Do'stlar kafesidan naqd to'lov", cashAmount: 500000, terminalAmount: 0, clickAmount: 0 },
    { type: "income", category: "Terminal", agentIndex: 1, description: "Buxoro pubdan terminal to'lov", cashAmount: 0, terminalAmount: 300000, clickAmount: 0 },
    { type: "expense", category: "Ombor xarajati", agentIndex: 0, description: "Ombor ijarasi", cashAmount: 200000, terminalAmount: 0, clickAmount: 0 },
    { type: "income", category: "Click", agentIndex: 2, description: "Kapalak kafeden click to'lov", cashAmount: 0, terminalAmount: 0, clickAmount: 150000 },
    { type: "expense", category: "Transport", agentIndex: 1, description: "Yuk tashish xarajati", cashAmount: 80000, terminalAmount: 0, clickAmount: 0 },
  ];

  for (let i = 0; i < cashEntries.length; i++) {
    const c = cashEntries[i];
    insertCash.run(
      `manual:cash-${i + 1}`,
      new Date(now - (i * dayMs)).getTime(),
      c.type,
      c.category,
      agentIds[c.agentIndex],
      c.description,
      c.cashAmount,
      c.terminalAmount,
      c.clickAmount,
      "manual",
      now,
      now,
    );
  }
  console.log(`✓ ${cashEntries.length} ta kassa yozuvi qo'shildi`);

  db.close();
  console.log("\n🎉 Barcha test ma'lumotlari muvaffaqiyatli qo'shildi!");
  console.log("Endi http://localhost:3000 da tekshirishingiz mumkin.");
}

seedTestData().catch(error => {
  console.error("Seed xatosi:", error);
  process.exit(1);
});
