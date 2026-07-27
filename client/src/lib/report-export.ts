import { localizeExportText } from "@/lib/languageStorage";
import type { Content, TableCell, TDocumentDefinitions } from "pdfmake/interfaces";

export type ReportValue = string | number | boolean | null | undefined;

export type ReportColumn<Row> = {
  title: string;
  value: (row: Row) => ReportValue;
  width?: number | "auto" | "*";
  align?: "left" | "center" | "right";
  numberFormat?: string;
};

export type ReportSummaryItem = {
  label: string;
  value: ReportValue;
  numberFormat?: string;
};

export type ReportExportOptions<Row> = {
  title: string;
  fileName: string;
  columns: ReportColumn<Row>[];
  rows: Row[];
  summary?: ReportSummaryItem[];
  filterDescription?: string;
  generatedAt?: number | Date;
};

const integerFormat = "#,##0";

function safeFileName(value: string) {
  return value
    .trim()
    .replace(/[\\/:*?"<>|]+/g, "-")
    .replace(/\s+/g, "_")
    .slice(0, 120);
}

function generatedDate(value?: number | Date) {
  const date = value instanceof Date ? value : new Date(value ?? Date.now());
  return date.toLocaleString("uz-UZ", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** Hujjat matni ekrandagi bilan bir xil alifboda bo'lishi uchun (lotin/kirill). */
const L = localizeExportText;

function displayValue(value: ReportValue) {
  if (value === null || value === undefined || value === "") return "—";
  if (typeof value === "boolean") return L(value ? "Ha" : "Yo‘q");
  return L(value);
}

function pdfValue(value: ReportValue) {
  const displayed = displayValue(value);
  if (typeof displayed === "number") return displayed.toLocaleString("uz-UZ");
  return String(displayed);
}

export async function exportReportXlsx<Row>(options: ReportExportOptions<Row>) {
  const XLSX = await import("xlsx");
  const workbook = XLSX.utils.book_new();
  const summaryRows: ReportValue[][] = [
    [L("Hisobot"), L(options.title)],
    [L("Yaratilgan vaqt"), generatedDate(options.generatedAt)],
    [L("Qo‘llangan filterlar"), L(options.filterDescription || "Barcha yozuvlar")],
    [L("Yozuvlar soni"), options.rows.length],
  ];

  if (options.summary?.length) {
    summaryRows.push([], [L("Ko‘rsatkich"), L("Qiymat")]);
    options.summary.forEach(item => summaryRows.push([L(item.label), displayValue(item.value)]));
  }

  const summarySheet = XLSX.utils.aoa_to_sheet(summaryRows);
  summarySheet["!cols"] = [{ wch: 28 }, { wch: 42 }];
  XLSX.utils.book_append_sheet(workbook, summarySheet, L("Xulosa"));

  const dataRows = [
    options.columns.map(column => L(column.title)),
    ...options.rows.map(row => options.columns.map(column => displayValue(column.value(row)))),
  ];
  const dataSheet = XLSX.utils.aoa_to_sheet(dataRows);
  dataSheet["!cols"] = options.columns.map(column => ({
    wch: typeof column.width === "number" ? column.width : Math.max(12, Math.min(32, column.title.length + 5)),
  }));
  if (options.columns.length > 0 && dataRows.length > 1) {
    dataSheet["!autofilter"] = {
      ref: XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: dataRows.length - 1, c: options.columns.length - 1 } }),
    };
  }
  (dataSheet as typeof dataSheet & { "!freeze"?: unknown })["!freeze"] = { xSplit: 0, ySplit: 1 };

  options.rows.forEach((row, rowIndex) => {
    options.columns.forEach((column, columnIndex) => {
      const value = column.value(row);
      const address = XLSX.utils.encode_cell({ r: rowIndex + 1, c: columnIndex });
      const cell = dataSheet[address];
      if (cell && typeof value === "number") cell.z = column.numberFormat ?? integerFormat;
    });
  });

  XLSX.utils.book_append_sheet(workbook, dataSheet, L("Ma’lumotlar"));
  XLSX.writeFile(workbook, `${safeFileName(options.fileName)}.xlsx`, { compression: true });
}

export async function exportReportPdf<Row>(options: ReportExportOptions<Row>) {
  const [{ default: pdfMake }, { default: vfs }] = await Promise.all([
    import("pdfmake/build/pdfmake"),
    import("pdfmake/build/vfs_fonts"),
  ]);
  pdfMake.addVirtualFileSystem(vfs);

  const summaryContent: Content[] = options.summary?.length
    ? [
        {
          columns: options.summary.map(item => ({
            width: "*",
            stack: [
              { text: L(item.label), color: "#64748B", fontSize: 8 },
              { text: pdfValue(item.value), color: "#0F172A", bold: true, fontSize: 11, margin: [0, 3, 0, 0] },
            ],
            fillColor: "#F8FAFC",
            margin: [8, 7, 8, 7],
          })),
          columnGap: 6,
          margin: [0, 0, 0, 12],
        },
      ]
    : [];

  const headerRow: TableCell[] = options.columns.map(column => ({
    text: L(column.title),
    style: "tableHeader",
    alignment: column.align ?? "left",
  }));
  const body: TableCell[][] = [
    headerRow,
    ...options.rows.map(row =>
      options.columns.map(column => ({
        text: pdfValue(column.value(row)),
        alignment: column.align ?? (typeof column.value(row) === "number" ? "right" : "left"),
        color: "#1E293B",
      })),
    ),
  ];

  const documentDefinition: TDocumentDefinitions = {
    pageSize: "A4",
    pageOrientation: "landscape",
    pageMargins: [24, 30, 24, 34],
    defaultStyle: { font: "Roboto", fontSize: 7.5, color: "#1E293B" },
    info: {
      title: L(options.title),
      author: L("Distribyutsiya Moliyaviy Tizimi"),
      subject: L(options.title),
    },
    footer: (currentPage, pageCount) => ({
      columns: [
        { text: L("Distribyutsiya Moliyaviy Tizimi"), color: "#94A3B8", margin: [24, 0, 0, 0] },
        { text: `${currentPage} / ${pageCount}`, alignment: "right", color: "#64748B", margin: [0, 0, 24, 0] },
      ],
      fontSize: 7,
    }),
    content: [
      { text: L(options.title), style: "title" },
      {
        columns: [
          { text: `${L("Yaratilgan")}: ${generatedDate(options.generatedAt)}`, color: "#64748B" },
          { text: `${L("Filterlar")}: ${L(options.filterDescription || "Barcha yozuvlar")}`, color: "#64748B", alignment: "right" },
        ],
        margin: [0, 4, 0, 14],
      },
      ...summaryContent,
      {
        table: {
          headerRows: 1,
          widths: options.columns.map(column => column.width ?? "*"),
          body,
        },
        layout: {
          fillColor: rowIndex => (rowIndex === 0 ? "#0F766E" : rowIndex % 2 === 0 ? "#F8FAFC" : null),
          hLineColor: () => "#E2E8F0",
          vLineColor: () => "#E2E8F0",
          paddingLeft: () => 5,
          paddingRight: () => 5,
          paddingTop: () => 4,
          paddingBottom: () => 4,
        },
      },
    ],
    styles: {
      title: { fontSize: 17, bold: true, color: "#0F172A" },
      tableHeader: { bold: true, color: "#FFFFFF", fontSize: 7.5 },
    },
  };

  await pdfMake.createPdf(documentDefinition).download(`${safeFileName(options.fileName)}.pdf`);
}
