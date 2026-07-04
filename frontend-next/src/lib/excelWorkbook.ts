import ExcelJS from "exceljs";

type SheetSpec = {
  name: string;
  rows: Array<Array<string | number | boolean | null | undefined>>;
  widths?: number[];
};

function cellToValue(cell: ExcelJS.Cell) {
  const value = cell.value;
  if (value == null) return "";
  if (typeof value === "object") {
    if ("text" in value && value.text != null) return value.text;
    if ("hyperlink" in value && value.hyperlink != null) return value.hyperlink;
    if ("richText" in value && Array.isArray(value.richText)) {
      return value.richText.map((part) => part.text || "").join("");
    }
    if ("result" in value && value.result != null) return value.result;
  }
  return value as string | number | boolean;
}

export async function downloadWorkbook(fileName: string, sheets: SheetSpec[]) {
  const workbook = new ExcelJS.Workbook();
  sheets.forEach((sheet) => {
    const worksheet = workbook.addWorksheet(sheet.name);
    sheet.rows.forEach((row) => worksheet.addRow(row));
    if (sheet.widths?.length) {
      worksheet.columns = sheet.widths.map((width) => ({ width }));
    }
  });
  const buffer = await workbook.xlsx.writeBuffer();
  const blob = new Blob([buffer], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

export async function readFirstWorksheetRows(file: File) {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(await file.arrayBuffer());
  const worksheet = workbook.worksheets[0];
  if (!worksheet) return [];
  const rows: Array<Array<string | number | boolean>> = [];
  worksheet.eachRow({ includeEmpty: false }, (row) => {
    const values: Array<string | number | boolean> = [];
    for (let index = 1; index <= worksheet.columnCount; index += 1) {
      values.push(cellToValue(row.getCell(index)) as string | number | boolean);
    }
    rows.push(values);
  });
  return rows;
}

export async function readFirstWorksheetObjects(file: File) {
  const rows = await readFirstWorksheetRows(file);
  if (!rows.length) return [];
  const headers = rows[0].map((cell) => String(cell || "").trim());
  return rows.slice(1)
    .filter((row) => row.some((cell) => String(cell ?? "").trim() !== ""))
    .map((row) => headers.reduce<Record<string, string | number | boolean>>((record, header, index) => {
      if (header) record[header] = row[index] ?? "";
      return record;
    }, {}));
}
