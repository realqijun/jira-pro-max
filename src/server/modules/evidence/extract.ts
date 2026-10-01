import type { UploadedFile } from "./service";

const DEFAULT_MAX_CHARS = 100_000;

export const PDF = "application/pdf";
export const DOCX = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
export const XLSX = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

/** One spreadsheet cell as CSV: dates as YYYY-MM-DD, quoted when it holds a comma, quote or line break. */
function csvCell(value: unknown): string {
  if (value === null || value === undefined) return "";
  const text = value instanceof Date ? value.toISOString().slice(0, 10) : String(value);
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

async function convert(file: UploadedFile): Promise<string | null> {
  if (file.type.startsWith("text/")) return file.bytes.toString("utf-8");
  if (file.type === PDF) {
    const { extractText, getDocumentProxy } = await import("unpdf");
    const { text } = await extractText(await getDocumentProxy(new Uint8Array(file.bytes)), { mergePages: true });
    return text;
  }
  if (file.type === DOCX) {
    const mammoth = await import("mammoth");
    return (await mammoth.extractRawText({ buffer: file.bytes })).value;
  }
  if (file.type === XLSX) {
    const { default: readXlsxFile } = await import("read-excel-file/node");
    const sheets = await readXlsxFile(file.bytes);
    return sheets
      .map(({ sheet, data }) => [`## ${sheet}`, ...data.map((row) => row.map(csvCell).join(","))].join("\n"))
      .join("\n\n");
  }
  return null;
}

/**
 * Plain text of an uploaded file, converted in-process: text files as UTF-8, PDF through `unpdf`,
 * Word through `mammoth`, Excel through `read-excel-file` (one `## Sheet` block of CSV rows per
 * sheet). Null when the type has no converter, the file has no text layer (a scan), or parsing
 * fails - never throws, because extraction must not fail an upload. This is what runs where the
 * `markitdown` CLI is not installed, which includes a default Vercel deployment.
 */
export async function fileToTextInProcess(file: UploadedFile): Promise<string | null> {
  try {
    const text = (await convert(file))?.trim();
    if (!text) return null;
    return text.slice(0, Number(process.env.EVIDENCE_EXTRACT_MAX_CHARS) || DEFAULT_MAX_CHARS);
  } catch (e) {
    console.error(`[evidence] in-process text extraction failed for ${file.name} (${file.type})`, e);
    return null;
  }
}
