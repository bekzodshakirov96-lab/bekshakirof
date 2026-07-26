import { beforeEach, describe, expect, it, vi } from "vitest";

const xlsxMocks = vi.hoisted(() => ({
  writeFile: vi.fn(),
  bookNew: vi.fn(() => ({ SheetNames: [] as string[], Sheets: {} as Record<string, unknown> })),
  aoaToSheet: vi.fn(() => ({} as Record<string, unknown>)),
  bookAppendSheet: vi.fn(),
}));

const pdfMocks = vi.hoisted(() => ({
  addVirtualFileSystem: vi.fn(),
  download: vi.fn().mockResolvedValue(undefined),
  createPdf: vi.fn(),
}));

vi.mock("xlsx", () => ({
  utils: {
    book_new: xlsxMocks.bookNew,
    aoa_to_sheet: xlsxMocks.aoaToSheet,
    book_append_sheet: xlsxMocks.bookAppendSheet,
    encode_range: vi.fn(() => "A1:B2"),
    encode_cell: vi.fn(() => "A2"),
  },
  writeFile: xlsxMocks.writeFile,
}));

vi.mock("pdfmake/build/pdfmake", () => ({
  default: {
    addVirtualFileSystem: pdfMocks.addVirtualFileSystem,
    createPdf: pdfMocks.createPdf,
  },
}));

vi.mock("pdfmake/build/vfs_fonts", () => ({
  default: { "Roboto-Regular.ttf": "virtual-font" },
}));

import { exportReportPdf, exportReportXlsx } from "./report-export";

const options = {
  title: "Qarzdorlik hisoboti",
  fileName: "qarzdorlik hisoboti",
  columns: [
    { title: "Mijoz", value: (row: { client: string; debt: number }) => row.client },
    { title: "Qarz", value: (row: { client: string; debt: number }) => row.debt, align: "right" as const },
  ],
  rows: [{ client: "Sinov mijoz", debt: 125_000 }],
  summary: [{ label: "Jami qarz", value: 125_000 }],
  filterDescription: "Agent: Zafar",
  generatedAt: new Date("2026-07-23T10:00:00Z"),
};

describe("report export browser helpers", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    pdfMocks.createPdf.mockReturnValue({ download: pdfMocks.download });
  });

  it("creates a two-sheet XLSX workbook and downloads it", async () => {
    await exportReportXlsx(options);

    expect(xlsxMocks.bookNew).toHaveBeenCalledOnce();
    expect(xlsxMocks.bookAppendSheet).toHaveBeenCalledTimes(2);
    expect(xlsxMocks.bookAppendSheet.mock.calls.map(call => call[2])).toEqual(["Xulosa", "Ma’lumotlar"]);
    expect(xlsxMocks.writeFile).toHaveBeenCalledWith(
      expect.any(Object),
      "qarzdorlik_hisoboti.xlsx",
      { compression: true },
    );
  });

  it("creates a Unicode landscape PDF and starts the download", async () => {
    await exportReportPdf(options);

    expect(pdfMocks.addVirtualFileSystem).toHaveBeenCalledOnce();
    expect(pdfMocks.createPdf).toHaveBeenCalledOnce();
    expect(pdfMocks.createPdf.mock.calls[0]?.[0]).toMatchObject({
      pageSize: "A4",
      pageOrientation: "landscape",
      info: { title: "Qarzdorlik hisoboti" },
    });
    expect(pdfMocks.download).toHaveBeenCalledWith("qarzdorlik_hisoboti.pdf");
  });
});
