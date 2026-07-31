import { createHash } from "node:crypto";
import { and, eq, isNull, sql } from "drizzle-orm";
import * as XLSX from "xlsx";
import {
  agents,
  cashEntries,
  clients,
  containerMovements,
  importHistory,
  products,
  transactions,
} from "../drizzle/schema";
import { getDb } from "./db";
import {
  containerLabel,
  normalizeContainerType,
  pairContainerCandidates,
} from "./containerAccounting";
import { storagePut } from "./storage";

type CellValue = string | number | boolean | Date | null | undefined;
type SheetRows = CellValue[][];

export type ParsedAgent = {
  name: string;
  phone: string | null;
  note: string | null;
};

export type ParsedClient = {
  code: string;
  name: string;
  agentName: string | null;
  phone: string | null;
  address: string | null;
  clientType: "keg" | "savdo" | null;
  openingDebt: number;
};

export type ParsedProduct = {
  code: string;
  name: string;
  unit: string;
  price: number;
};

export type ParsedTransaction = {
  sourceKey: string;
  transactionDate: Date;
  agentName: string | null;
  clientName: string | null;
  productName: string;
  unit: string;
  quantity: string;
  currentPrice: number;
  salePrice: number;
  totalAmount: number;
  cashPayment: number;
  terminalPayment: number;
  clickPayment: number;
  note: string | null;
};

export type ParsedCashEntry = {
  sourceKey: string;
  entryDate: Date;
  type: "income" | "expense";
  category: string;
  agentName: string | null;
  description: string | null;
  cashAmount: number;
  terminalAmount: number;
  clickAmount: number;
};

export type ParsedContainerMovement = {
  sourceKey: string;
  movementDate: Date;
  agentName: string | null;
  clientName: string | null;
  containerType: string;
  movementType: "issued" | "returned";
  quantity: number;
  note: string | null;
};

export type ParsedWorkbook = {
  agents: ParsedAgent[];
  clients: ParsedClient[];
  products: ParsedProduct[];
  transactions: ParsedTransaction[];
  cashEntries: ParsedCashEntry[];
  containerMovements: ParsedContainerMovement[];
  skippedRows: number;
  errors: string[];
};

export type ImportWorkbookResult = {
  importId: number;
  addedRows: number;
  updatedRows: number;
  skippedRows: number;
  errorRows: number;
  details: {
    agents: number;
    clients: number;
    products: number;
    transactions: number;
    cashEntries: number;
    containerMovements: number;
  };
};

function text(value: CellValue): string {
  if (value === null || value === undefined) return "";
  return String(value).replace(/\s+/g, " ").trim();
}

function nullableText(value: CellValue): string | null {
  const normalized = text(value);
  return normalized || null;
}

function numeric(value: CellValue): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  const normalized = text(value).replace(/\s/g, "").replace(/,/g, ".");
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : 0;
}

function money(value: CellValue): number {
  return Math.round(Math.max(0, numeric(value)));
}

function dateValue(value: CellValue): Date | null {
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value;
  if (typeof value === "number" && value > 20_000) {
    const parsed = XLSX.SSF.parse_date_code(value);
    if (parsed) {
      return new Date(Date.UTC(parsed.y, parsed.m - 1, parsed.d, parsed.H, parsed.M, Math.floor(parsed.S)));
    }
  }
  const normalized = text(value);
  if (!normalized) return null;
  const parsed = new Date(normalized);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function keyPart(value: CellValue): string {
  return text(value).toLocaleLowerCase("uz-Latn");
}

function clientTypeValue(value: CellValue): "keg" | "savdo" | null {
  const normalized = keyPart(value);
  if (normalized === "keg") return "keg";
  if (normalized === "savdo" || normalized === "sotuv") return "savdo";
  return null;
}

function hashKey(prefix: string, parts: CellValue[]): string {
  const hash = createHash("sha256")
    .update(parts.map(keyPart).join("|"))
    .digest("hex")
    .slice(0, 30);
  return `${prefix}:${hash}`;
}

function numberedSourceKey(prefix: string, rowNumber: CellValue, date: Date, fallback: CellValue[]) {
  const number = text(rowNumber);
  if (number) return `${prefix}:${date.getUTCFullYear()}:${number}`;
  return hashKey(prefix, fallback);
}

function sheetRows(workbook: XLSX.WorkBook, sheetName: string): SheetRows {
  const sheet = workbook.Sheets[sheetName];
  if (!sheet) return [];
  return XLSX.utils.sheet_to_json<CellValue[]>(sheet, {
    header: 1,
    defval: null,
    raw: true,
  }) as SheetRows;
}

function dedupeBy<T>(items: T[], getKey: (item: T) => string): T[] {
  const result = new Map<string, T>();
  for (const item of items) result.set(getKey(item), item);
  return Array.from(result.values());
}

export function parseDistributionWorkbook(buffer: Buffer | Uint8Array): ParsedWorkbook {
  const workbook = XLSX.read(buffer, { type: "buffer", cellDates: true });
  const result: ParsedWorkbook = {
    agents: [],
    clients: [],
    products: [],
    transactions: [],
    cashEntries: [],
    containerMovements: [],
    skippedRows: 0,
    errors: [],
  };

  const agentSheetRows = sheetRows(workbook, "Agentlar");
  for (let index = 2; index < agentSheetRows.length; index += 1) {
    const row: CellValue[] = agentSheetRows[index] ?? [];
    const name = text(row[1]);
    if (!name) {
      if (row.slice(1).some(value => text(value))) result.skippedRows += 1;
      continue;
    }
    result.agents.push({ name, phone: nullableText(row[2]), note: nullableText(row[3]) });
  }

  const clientSheetRows = sheetRows(workbook, "Mijozlar");
  for (let index = 2; index < clientSheetRows.length; index += 1) {
    const row: CellValue[] = clientSheetRows[index] ?? [];
    const code = text(row[1]);
    const name = text(row[2]);
    if (!code || !name) {
      if (row.slice(1).some(value => text(value))) result.skippedRows += 1;
      continue;
    }
    result.clients.push({
      code,
      name,
      agentName: nullableText(row[3]),
      phone: nullableText(row[4]),
      address: nullableText(row[5]),
      clientType: clientTypeValue(row[7]),
      openingDebt: money(row[6]),
    });
  }

  const productSheetRows = sheetRows(workbook, "Tovarlar");
  for (let index = 2; index < productSheetRows.length; index += 1) {
    const row: CellValue[] = productSheetRows[index] ?? [];
    const code = text(row[1]);
    const name = text(row[2]);
    if (!code || !name) {
      if (row.slice(1).some(value => text(value))) result.skippedRows += 1;
      continue;
    }
    result.products.push({
      code,
      name,
      unit: text(row[3]) || "dona",
      price: money(row[4]),
    });
  }

  const transactionSheetRows = sheetRows(workbook, "Tovar_berish");
  for (let index = 2; index < transactionSheetRows.length; index += 1) {
    const row: CellValue[] = transactionSheetRows[index] ?? [];
    const transactionDate = dateValue(row[1]);
    const clientName = nullableText(row[3]);
    const productName = text(row[5]);
    const hasPayment = money(row[11]) + money(row[12]) > 0;
    if (!transactionDate || !clientName || (!productName && !hasPayment)) {
      if (row.slice(1, 14).some(value => text(value))) result.skippedRows += 1;
      continue;
    }
    const salePrice = money(row[9]);
    const quantity = numeric(row[7]);
    const total = money(row[10]) || Math.round(quantity * salePrice);
    result.transactions.push({
      sourceKey: numberedSourceKey("excel:transaction", row[0], transactionDate, [
        row[1], row[2], row[3], row[5], row[7], row[10],
      ]),
      transactionDate,
      agentName: nullableText(row[2]),
      clientName,
      productName: productName || "To‘lov",
      unit: text(row[6]) || "-",
      quantity: quantity.toFixed(3),
      currentPrice: money(row[8]),
      salePrice,
      totalAmount: total,
      cashPayment: money(row[11]),
      terminalPayment: money(row[12]),
      clickPayment: 0,
      note: nullableText(row[13]),
    });
  }

  const cashSheetRows = sheetRows(workbook, "Kassa");
  for (let index = 5; index < cashSheetRows.length; index += 1) {
    const row: CellValue[] = cashSheetRows[index] ?? [];
    const entryDate = dateValue(row[1]);
    const typeText = keyPart(row[2]);
    if (!entryDate || (typeText !== "kirim" && typeText !== "chiqim")) {
      if (row.slice(0, 16).some(value => text(value)) && row[1]) result.skippedRows += 1;
      continue;
    }
    result.cashEntries.push({
      sourceKey: numberedSourceKey("excel:cash", row[0], entryDate, [
        row[1], row[2], row[3], row[4], row[6], row[7], row[8],
      ]),
      entryDate,
      type: typeText === "kirim" ? "income" : "expense",
      category: text(row[3]) || "Boshqa",
      agentName: nullableText(row[4]),
      description: nullableText(row[5]),
      cashAmount: money(row[6]),
      terminalAmount: money(row[7]),
      clickAmount: money(row[8]),
    });
  }

  const containerSheetRows = sheetRows(workbook, "Tara_harakati");
  for (let index = 2; index < containerSheetRows.length; index += 1) {
    const row: CellValue[] = containerSheetRows[index] ?? [];
    const movementDate = dateValue(row[1]);
    const movementText = keyPart(row[5]);
    const containerType = text(row[4]);
    if (!movementDate || !containerType || !["berildi", "qaytarildi"].includes(movementText)) {
      if (row.slice(1, 8).some(value => text(value))) result.skippedRows += 1;
      continue;
    }
    result.containerMovements.push({
      sourceKey: numberedSourceKey("excel:container", row[0], movementDate, [
        row[1], row[2], row[3], row[4], row[5], row[6],
      ]),
      movementDate,
      agentName: nullableText(row[2]),
      clientName: nullableText(row[3]),
      containerType,
      movementType: movementText === "berildi" ? "issued" : "returned",
      quantity: Math.max(0, Math.round(numeric(row[6]))),
      note: nullableText(row[7]),
    });
  }

  result.agents = dedupeBy(result.agents, item => keyPart(item.name));
  result.clients = dedupeBy(result.clients, item => keyPart(item.code));
  result.products = dedupeBy(result.products, item => keyPart(item.code));
  result.transactions = dedupeBy(result.transactions, item => item.sourceKey);
  result.cashEntries = dedupeBy(result.cashEntries, item => item.sourceKey);
  result.containerMovements = dedupeBy(result.containerMovements, item => item.sourceKey);

  return result;
}

function safeFileName(fileName: string) {
  return fileName.replace(/[^a-zA-Z0-9._-]+/g, "-").slice(0, 180) || "hisobot.xlsm";
}

export async function importDistributionWorkbook(options: {
  buffer: Buffer;
  fileName: string;
  userId?: number | null;
  storeFile?: boolean;
}): Promise<ImportWorkbookResult> {
  const db = await getDb();
  if (!db) throw new Error("Ma’lumotlar bazasiga ulanish mavjud emas.");

  const [createdImport] = await db
    .insert(importHistory)
    .values({
      fileName: options.fileName,
      importedBy: options.userId ?? null,
      status: "processing",
    })
    .$returningId();
  const importId = createdImport.id;

  try {
    const parsed = parseDistributionWorkbook(options.buffer);
    let fileKey: string | null = null;
    let fileUrl: string | null = null;

    if (options.storeFile !== false) {
      const stored = await storagePut(
        `imports/${new Date().toISOString().slice(0, 10)}/${safeFileName(options.fileName)}`,
        options.buffer,
        "application/vnd.ms-excel.sheet.macroEnabled.12",
      );
      fileKey = stored.key;
      fileUrl = stored.url;
    }

    let addedRows = 0;
    let updatedRows = 0;

    await db.transaction(async tx => {
      const existingAgentNames = new Set(
        (await tx.select({ name: agents.name }).from(agents)).map(item => keyPart(item.name)),
      );
      const agentCandidates = new Map<string, ParsedAgent>();
      for (const item of parsed.agents) agentCandidates.set(keyPart(item.name), item);
      for (const name of [
        ...parsed.clients.map(item => item.agentName),
        ...parsed.transactions.map(item => item.agentName),
        ...parsed.cashEntries.map(item => item.agentName),
        ...parsed.containerMovements.map(item => item.agentName),
      ]) {
        if (name && !agentCandidates.has(keyPart(name))) {
          agentCandidates.set(keyPart(name), { name, phone: null, note: null });
        }
      }

      for (const item of Array.from(agentCandidates.values())) {
        if (existingAgentNames.has(keyPart(item.name))) updatedRows += 1;
        else addedRows += 1;
        await tx
          .insert(agents)
          .values(item)
          .onDuplicateKeyUpdate({ set: { phone: item.phone, note: item.note, isActive: true } });
      }

      const agentRows = await tx.select({ id: agents.id, name: agents.name }).from(agents);
      const agentMap = new Map(agentRows.map(item => [keyPart(item.name), item.id]));

      const existingClientCodes = new Set(
        (await tx.select({ code: clients.code }).from(clients)).map(item => keyPart(item.code)),
      );
      for (const item of parsed.clients) {
        if (existingClientCodes.has(keyPart(item.code))) updatedRows += 1;
        else addedRows += 1;
        await tx
          .insert(clients)
          .values({
            code: item.code,
            name: item.name,
            agentId: item.agentName ? agentMap.get(keyPart(item.agentName)) ?? null : null,
            phone: item.phone,
            address: item.address,
            clientType: item.clientType,
            openingDebt: item.openingDebt,
          })
          .onDuplicateKeyUpdate({
            set: {
              name: item.name,
              agentId: item.agentName ? agentMap.get(keyPart(item.agentName)) ?? null : null,
              phone: item.phone,
              address: item.address,
              clientType: item.clientType,
              openingDebt: item.openingDebt,
              isActive: true,
            },
          });
      }

      const existingProductCodes = new Set(
        (await tx.select({ code: products.code }).from(products)).map(item => keyPart(item.code)),
      );
      for (const item of parsed.products) {
        if (existingProductCodes.has(keyPart(item.code))) updatedRows += 1;
        else addedRows += 1;
        await tx
          .insert(products)
          .values({
            ...item,
            containerType: normalizeContainerType(item.name),
            containerUnitsPerItem: normalizeContainerType(item.name) ? 1 : 0,
          })
          .onDuplicateKeyUpdate({
            set: {
              name: item.name,
              unit: item.unit,
              price: item.price,
              containerType: normalizeContainerType(item.name),
              containerUnitsPerItem: normalizeContainerType(item.name) ? 1 : 0,
              isActive: true,
            },
          });
      }

      const clientRows = await tx.select({ id: clients.id, name: clients.name }).from(clients);
      const clientMap = new Map(clientRows.map(item => [keyPart(item.name), item.id]));
      let productRows = await tx
        .select({ id: products.id, code: products.code, name: products.name, containerType: products.containerType })
        .from(products);
      const knownCodes = new Set(productRows.map(item => keyPart(item.code)));
      const knownProductNames = new Set(productRows.map(item => keyPart(item.name)));
      const knownContainerTypes = new Set(productRows.map(item => item.containerType).filter(Boolean));

      for (const item of parsed.transactions) {
        const containerType = normalizeContainerType(item.productName);
        if (!containerType || knownProductNames.has(keyPart(item.productName)) || knownContainerTypes.has(containerType)) {
          continue;
        }
        const baseCode = containerType === "keg_30" ? "TARA-KEG30" : "TARA-KEG50";
        let code = baseCode;
        let suffix = 2;
        while (knownCodes.has(keyPart(code))) {
          code = `${baseCode}-${suffix}`;
          suffix += 1;
        }
        await tx.insert(products).values({
          code,
          name: item.productName,
          unit: item.unit || "KEG",
          price: item.currentPrice,
          containerType,
          containerUnitsPerItem: 1,
          isActive: true,
        });
        knownCodes.add(keyPart(code));
        knownProductNames.add(keyPart(item.productName));
        knownContainerTypes.add(containerType);
      }

      productRows = await tx
        .select({ id: products.id, code: products.code, name: products.name, containerType: products.containerType })
        .from(products);
      const productMap = new Map(productRows.map(item => [keyPart(item.name), item.id]));
      const containerProductMap = new Map(
        productRows.filter(item => item.containerType).map(item => [item.containerType!, item.id]),
      );
      const productIdForName = (name: string): number | null => {
        const exactId = productMap.get(keyPart(name));
        if (exactId) return exactId;
        const containerType = normalizeContainerType(name);
        return containerType ? containerProductMap.get(containerType) ?? null : null;
      };

      const existingTransactionKeys = new Set(
        (await tx.select({ key: transactions.sourceKey }).from(transactions)).map(item => item.key),
      );
      for (const item of parsed.transactions) {
        if (existingTransactionKeys.has(item.sourceKey)) updatedRows += 1;
        else addedRows += 1;
        await tx
          .insert(transactions)
          .values({
            ...item,
            agentId: item.agentName ? agentMap.get(keyPart(item.agentName)) ?? null : null,
            clientId: item.clientName ? clientMap.get(keyPart(item.clientName)) ?? null : null,
            productId: productIdForName(item.productName),
            source: "excel",
            createdBy: options.userId ?? null,
          })
          .onDuplicateKeyUpdate({
            set: {
              transactionDate: item.transactionDate,
              agentId: item.agentName ? agentMap.get(keyPart(item.agentName)) ?? null : null,
              clientId: item.clientName ? clientMap.get(keyPart(item.clientName)) ?? null : null,
              productId: productIdForName(item.productName),
              productName: item.productName,
              unit: item.unit,
              quantity: item.quantity,
              currentPrice: item.currentPrice,
              salePrice: item.salePrice,
              totalAmount: item.totalAmount,
              cashPayment: item.cashPayment,
              terminalPayment: item.terminalPayment,
              clickPayment: item.clickPayment,
              note: item.note,
            },
          });
      }

      const existingCashKeys = new Set(
        (await tx.select({ key: cashEntries.sourceKey }).from(cashEntries)).map(item => item.key),
      );
      for (const item of parsed.cashEntries) {
        if (existingCashKeys.has(item.sourceKey)) updatedRows += 1;
        else addedRows += 1;
        await tx
          .insert(cashEntries)
          .values({
            ...item,
            agentId: item.agentName ? agentMap.get(keyPart(item.agentName)) ?? null : null,
            source: "excel",
            createdBy: options.userId ?? null,
          })
          .onDuplicateKeyUpdate({
            set: {
              entryDate: item.entryDate,
              type: item.type,
              category: item.category,
              agentId: item.agentName ? agentMap.get(keyPart(item.agentName)) ?? null : null,
              description: item.description,
              cashAmount: item.cashAmount,
              terminalAmount: item.terminalAmount,
              clickAmount: item.clickAmount,
            },
          });
      }

      const existingContainerKeys = new Set(
        (await tx.select({ key: containerMovements.sourceKey }).from(containerMovements)).map(
          item => item.key,
        ),
      );
      for (const item of parsed.containerMovements) {
        if (existingContainerKeys.has(item.sourceKey)) updatedRows += 1;
        else addedRows += 1;
        await tx
          .insert(containerMovements)
          .values({
            ...item,
            agentId: item.agentName ? agentMap.get(keyPart(item.agentName)) ?? null : null,
            clientId: item.clientName ? clientMap.get(keyPart(item.clientName)) ?? null : null,
            source: "excel",
            createdBy: options.userId ?? null,
          })
          .onDuplicateKeyUpdate({
            set: {
              movementDate: item.movementDate,
              agentId: item.agentName ? agentMap.get(keyPart(item.agentName)) ?? null : null,
              clientId: item.clientName ? clientMap.get(keyPart(item.clientName)) ?? null : null,
              containerType: item.containerType,
              movementType: item.movementType,
              quantity: item.quantity,
              note: item.note,
            },
          });
      }

      const transactionCandidates = [];
      for (const item of parsed.transactions) {
        const containerType = normalizeContainerType(item.productName);
        if (!containerType) continue;
        const clientId = item.clientName ? clientMap.get(keyPart(item.clientName)) ?? null : null;
        if (!clientId) continue;
        const [transactionRow] = await tx
          .select({ id: transactions.id })
          .from(transactions)
          .where(eq(transactions.sourceKey, item.sourceKey))
          .limit(1);
        if (!transactionRow) continue;
        // `containerType` has historically been stored both as the raw enum ("keg_30") and
        // as the display label ("KEG 30") depending on which code path wrote the row, so
        // match on the normalized type rather than the raw stored string.
        const linkedRows = await tx
          .select({ id: containerMovements.id, containerType: containerMovements.containerType })
          .from(containerMovements)
          .where(
            and(
              eq(containerMovements.transactionId, transactionRow.id),
              eq(containerMovements.movementType, "issued"),
            ),
          );
        const alreadyLinked = linkedRows.some(row => normalizeContainerType(row.containerType) === containerType);
        if (alreadyLinked) continue;

        const quantity = Number(item.quantity);
        if (!Number.isInteger(quantity) || quantity <= 0) {
          throw new Error(`${item.productName} uchun KEG miqdori musbat butun son bo‘lishi kerak.`);
        }
        transactionCandidates.push({
          id: transactionRow.id,
          sourceKey: item.sourceKey,
          date: item.transactionDate,
          agentId: item.agentName ? agentMap.get(keyPart(item.agentName)) ?? null : null,
          clientId,
          containerType,
          quantity,
        });
      }

      const explicitRows = await tx
        .select({
          id: containerMovements.id,
          sourceKey: containerMovements.sourceKey,
          movementDate: containerMovements.movementDate,
          agentId: containerMovements.agentId,
          clientId: containerMovements.clientId,
          containerType: containerMovements.containerType,
          quantity: containerMovements.quantity,
        })
        .from(containerMovements)
        .where(
          and(
            eq(containerMovements.movementType, "issued"),
            isNull(containerMovements.transactionId),
          ),
        );
      const explicitCandidates = explicitRows.flatMap(item => {
        const containerType = normalizeContainerType(item.containerType);
        if (!containerType || !item.clientId) return [];
        return [
          {
            id: item.id,
            sourceKey: item.sourceKey,
            date: item.movementDate,
            agentId: item.agentId,
            clientId: item.clientId,
            containerType,
            quantity: item.quantity,
          },
        ];
      });
      const pairing = pairContainerCandidates(transactionCandidates, explicitCandidates);

      for (const pair of pairing.pairs) {
        await tx
          .update(containerMovements)
          .set({ transactionId: pair.transaction.id })
          .where(eq(containerMovements.id, pair.movement.id));
      }

      for (const candidate of pairing.unmatchedTransactions) {
        const ambiguousExplicit = pairing.unmatchedMovements.some(
          movement =>
            movement.date.toISOString().slice(0, 10) === candidate.date.toISOString().slice(0, 10) &&
            movement.clientId === candidate.clientId &&
            movement.containerType === candidate.containerType &&
            movement.quantity === candidate.quantity,
        );
        if (ambiguousExplicit) {
          parsed.errors.push(
            `${candidate.sourceKey}: agenti mos kelmagan explicit tara yozuvi bor; avtomatik tara yaratilmadi.`,
          );
          continue;
        }
          await tx.insert(containerMovements).values({
            sourceKey: `auto:transaction:${candidate.id}:issued:${candidate.containerType}`,
            movementDate: candidate.date,
            transactionId: candidate.id,
            agentId: candidate.agentId,
            clientId: candidate.clientId,
            containerType: containerLabel(candidate.containerType),
            movementType: "issued",
            quantity: candidate.quantity,
            note: "Excel KEG savdosidan avtomatik berildi",
            source: "excel",
            isAutomatic: true,
            createdBy: options.userId ?? null,
          });
      }
    });

    const details = {
      agents: parsed.agents.length,
      clients: parsed.clients.length,
      products: parsed.products.length,
      transactions: parsed.transactions.length,
      cashEntries: parsed.cashEntries.length,
      containerMovements: parsed.containerMovements.length,
    };

    await db
      .update(importHistory)
      .set({
        fileKey,
        fileUrl,
        status: "completed",
        addedRows,
        updatedRows,
        skippedRows: parsed.skippedRows,
        errorRows: parsed.errors.length,
        details: JSON.stringify({ ...details, errors: parsed.errors.slice(0, 20) }),
        completedAt: new Date(),
      })
      .where(eq(importHistory.id, importId));

    return {
      importId,
      addedRows,
      updatedRows,
      skippedRows: parsed.skippedRows,
      errorRows: parsed.errors.length,
      details,
    };
  } catch (error) {
    await db
      .update(importHistory)
      .set({
        status: "failed",
        errorRows: 1,
        details: error instanceof Error ? error.message : "Noma’lum import xatosi",
        completedAt: new Date(),
      })
      .where(eq(importHistory.id, importId));
    throw error;
  }
}
