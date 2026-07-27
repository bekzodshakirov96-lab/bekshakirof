import { localizePdfDocument } from "@/lib/languageStorage";
import type { Content, TableCell, TDocumentDefinitions } from "pdfmake/interfaces";

function formatDate(value: Date | number) {
  const date = value instanceof Date ? value : new Date(value);
  return date.toLocaleDateString("uz-UZ", { year: "numeric", month: "2-digit", day: "2-digit" });
}

function safeFileName(value: string) {
  return value.trim().replace(/[\\/:*?"<>|]+/g, "-").replace(/\s+/g, "_").slice(0, 120);
}

const operationLabels: Record<string, string> = {
  tara_sent: "Bo'sh tara yuborildi",
  filled_received: "To'la keg qabul qilindi",
  brak_returned: "Brak qaytarildi",
  brak_replaced: "Brak o'rniga keg keldi",
};

export type FactoryStatementProductRow = {
  productId: number;
  productName: string;
  openingTaraPending: number;
  openingBrakPending: number;
  closingTaraPending: number;
  closingBrakPending: number;
};

export type FactoryStatementLedgerRow = {
  operationDate: Date;
  operationType: string;
  productName: string | null;
  quantity: number;
  note: string | null;
  taraPendingAfter: number;
  brakPendingAfter: number;
};

export type FactoryAktSverkaOptions = {
  periodLabel: string;
  products: FactoryStatementProductRow[];
  ledger: FactoryStatementLedgerRow[];
  generatedAt: number;
};

export async function exportFactoryAktSverkaPdf(options: FactoryAktSverkaOptions) {
  const [{ default: pdfMake }, { default: vfs }] = await Promise.all([
    import("pdfmake/build/pdfmake"),
    import("pdfmake/build/vfs_fonts"),
  ]);
  pdfMake.addVirtualFileSystem(vfs);

  const summaryBody: TableCell[][] = [
    [
      { text: "KEG turi", style: "tableHeader" },
      { text: "Davr boshida — tara", style: "tableHeader", alignment: "right" },
      { text: "Davr oxirida — tara", style: "tableHeader", alignment: "right" },
      { text: "Davr boshida — brak", style: "tableHeader", alignment: "right" },
      { text: "Davr oxirida — brak", style: "tableHeader", alignment: "right" },
    ],
    ...options.products.map(row => [
      { text: row.productName },
      { text: `${row.openingTaraPending} dona`, alignment: "right" },
      { text: `${row.closingTaraPending} dona`, alignment: "right", bold: true },
      { text: `${row.openingBrakPending} dona`, alignment: "right" },
      { text: `${row.closingBrakPending} dona`, alignment: "right", bold: true },
    ] as TableCell[]),
  ];

  const ledgerBody: TableCell[][] = [
    [
      { text: "Sana", style: "tableHeader" },
      { text: "Turi", style: "tableHeader" },
      { text: "KEG", style: "tableHeader" },
      { text: "Miqdor", style: "tableHeader", alignment: "right" },
      { text: "Tara qoldiq", style: "tableHeader", alignment: "right" },
      { text: "Brak qoldiq", style: "tableHeader", alignment: "right" },
      { text: "Izoh", style: "tableHeader" },
    ],
    ...options.ledger.map(row => [
      { text: formatDate(row.operationDate) },
      { text: operationLabels[row.operationType] ?? row.operationType },
      { text: row.productName ?? "—" },
      { text: `${row.quantity} dona`, alignment: "right" },
      { text: `${row.taraPendingAfter} dona`, alignment: "right" },
      { text: `${row.brakPendingAfter} dona`, alignment: "right" },
      { text: row.note ?? "—", fontSize: 7.5, color: "#64748B" },
    ] as TableCell[]),
  ];
  if (options.ledger.length === 0) {
    ledgerBody.push([{ text: "Bu davrda operatsiya bo'lmagan", colSpan: 7, alignment: "center", color: "#94A3B8", italics: true }, {}, {}, {}, {}, {}, {}]);
  }

  const documentDefinition: TDocumentDefinitions = {
    pageSize: "A4",
    pageMargins: [32, 36, 32, 40],
    defaultStyle: { font: "Roboto", fontSize: 9, color: "#1E293B" },
    info: { title: "Zavod bilan Akt sverka", author: "Distribyutsiya Moliyaviy Tizimi", subject: "Zavod bilan hisob-kitob tasdiqlash akti" },
    footer: (currentPage, pageCount) => ({
      columns: [
        { text: "Distribyutsiya Moliyaviy Tizimi", color: "#94A3B8", margin: [32, 0, 0, 0], fontSize: 7 },
        { text: `${currentPage} / ${pageCount}`, alignment: "right", color: "#64748B", margin: [0, 0, 32, 0], fontSize: 7 },
      ],
    }),
    content: [
      { text: "ZAVOD BILAN AKT SVERKA", style: "title" },
      { text: "Tara/KEG almashinuvi va brak evazi bo'yicha o'zaro hisob-kitobni tasdiqlash akti", color: "#64748B", margin: [0, 0, 0, 4] },
      { text: `Davr: ${options.periodLabel}`, color: "#64748B", margin: [0, 0, 0, 14] },

      { text: "Xulosa", style: "sectionTitle", margin: [0, 0, 0, 6] },
      {
        table: { headerRows: 1, widths: ["*", "auto", "auto", "auto", "auto"], body: summaryBody },
        layout: {
          fillColor: (rowIndex: number) => (rowIndex === 0 ? "#0F766E" : rowIndex % 2 === 0 ? "#F8FAFC" : null),
          hLineColor: () => "#E2E8F0",
          vLineColor: () => "#E2E8F0",
          paddingLeft: () => 6, paddingRight: () => 6, paddingTop: () => 4, paddingBottom: () => 4,
        },
        margin: [0, 0, 0, 16],
      },

      { text: "Operatsiyalar tarixi", style: "sectionTitle", margin: [0, 0, 0, 6] },
      {
        table: { headerRows: 1, widths: ["auto", "auto", "auto", "auto", "auto", "auto", "*"], body: ledgerBody },
        layout: {
          fillColor: (rowIndex: number) => (rowIndex === 0 ? "#0F766E" : rowIndex % 2 === 0 ? "#F8FAFC" : null),
          hLineColor: () => "#E2E8F0",
          vLineColor: () => "#E2E8F0",
          paddingLeft: () => 6, paddingRight: () => 6, paddingTop: () => 4, paddingBottom: () => 4,
        },
      },

      {
        margin: [0, 40, 0, 0],
        columns: [
          { width: "*", stack: [{ text: "Distribyutor (Nokdaun mchj):", fontSize: 9 }, { text: "_______________________  /  ___.___.______", margin: [0, 28, 0, 0], fontSize: 9 }] },
          { width: "*", stack: [{ text: "Zavod:", fontSize: 9 }, { text: "_______________________  /  ___.___.______", margin: [0, 28, 0, 0], fontSize: 9 }] },
        ],
      },
      { text: `Hujjat yaratilgan: ${formatDate(options.generatedAt)}`, color: "#94A3B8", fontSize: 7, margin: [0, 20, 0, 0] },
    ] as Content[],
    styles: {
      title: { fontSize: 18, bold: true, color: "#0F172A" },
      sectionTitle: { fontSize: 10, bold: true, color: "#0F766E" },
      tableHeader: { bold: true, color: "#FFFFFF", fontSize: 8.5 },
    },
  };

  await pdfMake.createPdf(localizePdfDocument(documentDefinition)).download(`${safeFileName("Zavod_Akt_sverka")}.pdf`);
}
