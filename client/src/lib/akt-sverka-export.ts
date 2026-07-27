import { localizePdfDocument } from "@/lib/languageStorage";
import type { Content, TableCell, TDocumentDefinitions } from "pdfmake/interfaces";

function money(value: number) {
  return `${value.toLocaleString("uz-UZ")} so‘m`;
}

function formatDate(value: Date | number) {
  const date = value instanceof Date ? value : new Date(value);
  return date.toLocaleDateString("uz-UZ", { year: "numeric", month: "2-digit", day: "2-digit" });
}

function safeFileName(value: string) {
  return value.trim().replace(/[\\/:*?"<>|]+/g, "-").replace(/\s+/g, "_").slice(0, 120);
}

export type AktSverkaClient = {
  code: string;
  name: string;
  phone: string | null;
  address: string | null;
  agentName: string | null;
};

export type AktSverkaLedgerRow = {
  transactionDate: Date;
  productName: string;
  quantity: string;
  unit: string;
  totalAmount: number;
  paid: number;
  balanceAfter: number;
};

export type AktSverkaContainerRow = {
  movementDate: Date;
  containerType: string;
  movementType: "issued" | "returned";
  quantity: number;
  keg30After: number;
  keg50After: number;
};

export type AktSverkaOptions = {
  client: AktSverkaClient;
  periodLabel: string;
  openingBalance: number;
  ledger: AktSverkaLedgerRow[];
  closingBalance: number;
  openingContainer: { keg30: number; keg50: number };
  containerLedger: AktSverkaContainerRow[];
  closingContainer: { keg30: number; keg50: number };
  generatedAt: number;
};

function containerLabel(value: string) {
  if (value === "keg_30") return "KEG 30";
  if (value === "keg_50") return "KEG 50";
  return value;
}

export async function exportAktSverkaPdf(options: AktSverkaOptions) {
  const [{ default: pdfMake }, { default: vfs }] = await Promise.all([
    import("pdfmake/build/pdfmake"),
    import("pdfmake/build/vfs_fonts"),
  ]);
  pdfMake.addVirtualFileSystem(vfs);

  const ledgerBody: TableCell[][] = [
    [
      { text: "Sana", style: "tableHeader" },
      { text: "Mahsulot", style: "tableHeader" },
      { text: "Miqdor", style: "tableHeader", alignment: "right" },
      { text: "Summa", style: "tableHeader", alignment: "right" },
      { text: "To‘langan", style: "tableHeader", alignment: "right" },
      { text: "Qoldiq", style: "tableHeader", alignment: "right" },
    ],
    [
      { text: "", colSpan: 5, border: [false, false, false, true] }, {}, {}, {}, {},
      { text: money(options.openingBalance), bold: true, alignment: "right", border: [false, false, false, true] },
    ],
    ...options.ledger.map(row => [
      { text: formatDate(row.transactionDate) },
      { text: row.productName },
      { text: `${Number(row.quantity).toLocaleString("uz-UZ")} ${row.unit}`, alignment: "right" },
      { text: money(row.totalAmount), alignment: "right" },
      { text: money(row.paid), alignment: "right" },
      { text: money(row.balanceAfter), alignment: "right", bold: true },
    ] as TableCell[]),
  ];
  if (options.ledger.length === 0) {
    ledgerBody.push([{ text: "Bu davrda operatsiya bo‘lmagan", colSpan: 6, alignment: "center", color: "#94A3B8", italics: true }, {}, {}, {}, {}, {}]);
  }

  const containerContent: Content[] = options.containerLedger.length
    ? [
        { text: "Tara (KEG) harakati", style: "sectionTitle", margin: [0, 16, 0, 6] },
        {
          table: {
            headerRows: 1,
            widths: ["auto", "auto", "auto", "auto", "*", "*"],
            body: [
              [
                { text: "Sana", style: "tableHeader" },
                { text: "Tara turi", style: "tableHeader" },
                { text: "Harakat", style: "tableHeader" },
                { text: "Miqdor", style: "tableHeader", alignment: "right" },
                { text: "KEG 30 qoldiq", style: "tableHeader", alignment: "right" },
                { text: "KEG 50 qoldiq", style: "tableHeader", alignment: "right" },
              ],
              ...options.containerLedger.map(row => [
                { text: formatDate(row.movementDate) },
                { text: containerLabel(row.containerType) },
                { text: row.movementType === "issued" ? "Berildi" : "Qaytdi" },
                { text: String(row.quantity), alignment: "right" },
                { text: String(row.keg30After), alignment: "right" },
                { text: String(row.keg50After), alignment: "right" },
              ]),
            ] as TableCell[][],
          },
          layout: {
            fillColor: (rowIndex: number) => (rowIndex === 0 ? "#0F766E" : rowIndex % 2 === 0 ? "#F8FAFC" : null),
            hLineColor: () => "#E2E8F0",
            vLineColor: () => "#E2E8F0",
            paddingLeft: () => 6, paddingRight: () => 6, paddingTop: () => 4, paddingBottom: () => 4,
          },
        },
        {
          columns: [
            { text: `Davr boshida: KEG 30 — ${options.openingContainer.keg30}, KEG 50 — ${options.openingContainer.keg50}`, color: "#64748B", fontSize: 8 },
            { text: `Davr oxirida: KEG 30 — ${options.closingContainer.keg30}, KEG 50 — ${options.closingContainer.keg50}`, color: "#0F172A", bold: true, fontSize: 8, alignment: "right" },
          ],
          margin: [0, 6, 0, 0],
        },
      ]
    : [];

  const documentDefinition: TDocumentDefinitions = {
    pageSize: "A4",
    pageMargins: [32, 36, 32, 40],
    defaultStyle: { font: "Roboto", fontSize: 9, color: "#1E293B" },
    info: { title: `Akt sverka — ${options.client.name}`, author: "Distribyutsiya Moliyaviy Tizimi", subject: "Hisob-kitob tasdiqlash akti" },
    footer: (currentPage, pageCount) => ({
      columns: [
        { text: "Distribyutsiya Moliyaviy Tizimi", color: "#94A3B8", margin: [32, 0, 0, 0], fontSize: 7 },
        { text: `${currentPage} / ${pageCount}`, alignment: "right", color: "#64748B", margin: [0, 0, 32, 0], fontSize: 7 },
      ],
    }),
    content: [
      { text: "AKT SVERKA", style: "title" },
      { text: "O‘zaro hisob-kitoblarni tasdiqlash akti", color: "#64748B", margin: [0, 0, 0, 4] },
      { text: `Davr: ${options.periodLabel}`, color: "#64748B", margin: [0, 0, 0, 14] },

      {
        columns: [
          {
            width: "*",
            stack: [
              { text: "Mijoz", style: "sectionTitle" },
              { text: `${options.client.name} (${options.client.code})`, bold: true, margin: [0, 2, 0, 0] },
              options.client.phone ? { text: `Tel: ${options.client.phone}`, color: "#64748B", fontSize: 8 } : null,
              options.client.address ? { text: options.client.address, color: "#64748B", fontSize: 8 } : null,
              options.client.agentName ? { text: `Agent: ${options.client.agentName}`, color: "#64748B", fontSize: 8, margin: [0, 2, 0, 0] } : null,
            ].filter(Boolean) as Content[],
          },
          {
            width: "*",
            stack: [
              { text: "Xulosa", style: "sectionTitle" },
              { text: `Davr boshidagi qoldiq: ${money(options.openingBalance)}`, margin: [0, 2, 0, 0], fontSize: 8, color: "#64748B" },
              { text: `Davr oxiridagi qoldiq: ${money(options.closingBalance)}`, bold: true, margin: [2, 4, 0, 0] },
            ],
          },
        ],
        margin: [0, 0, 0, 16],
      },

      { text: "Savdo va to‘lovlar", style: "sectionTitle", margin: [0, 0, 0, 6] },
      {
        table: { headerRows: 2, widths: ["auto", "*", "auto", "auto", "auto", "auto"], body: ledgerBody },
        layout: {
          fillColor: (rowIndex: number) => (rowIndex === 0 ? "#0F766E" : rowIndex > 1 && rowIndex % 2 === 0 ? "#F8FAFC" : null),
          hLineColor: () => "#E2E8F0",
          vLineColor: () => "#E2E8F0",
          paddingLeft: () => 6, paddingRight: () => 6, paddingTop: () => 4, paddingBottom: () => 4,
        },
      },

      ...containerContent,

      {
        margin: [0, 40, 0, 0],
        columns: [
          { width: "*", stack: [{ text: "Yetkazib beruvchi (Nokdaun mchj):", fontSize: 9 }, { text: "_______________________  /  ___.___.______", margin: [0, 28, 0, 0], fontSize: 9 }] },
          { width: "*", stack: [{ text: "Mijoz:", fontSize: 9 }, { text: "_______________________  /  ___.___.______", margin: [0, 28, 0, 0], fontSize: 9 }] },
        ],
      },
      { text: `Hujjat yaratilgan: ${formatDate(options.generatedAt)}`, color: "#94A3B8", fontSize: 7, margin: [0, 20, 0, 0] },
    ],
    styles: {
      title: { fontSize: 18, bold: true, color: "#0F172A" },
      sectionTitle: { fontSize: 10, bold: true, color: "#0F766E" },
      tableHeader: { bold: true, color: "#FFFFFF", fontSize: 8.5 },
    },
  };

  await pdfMake.createPdf(localizePdfDocument(documentDefinition)).download(`${safeFileName(`Akt_sverka_${options.client.name}`)}.pdf`);
}
