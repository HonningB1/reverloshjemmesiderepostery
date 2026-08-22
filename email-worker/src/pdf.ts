import { extractText, getDocumentProxy } from "unpdf";

export type PdfExtraction = { sha256: string; text: string; extractionStatus: "EXTRACTED" | "NO_TEXT" | "TOO_LARGE" | "INVALID_PDF" | "FAILED"; issue: string | null; pages: number | null };
export const MAX_PDF_BYTES = 2_000_000;
export const MAX_PDF_TEXT_CHARS = 40_000;
export const MAX_PDF_PAGES = 12;
const EXTRACTION_TIMEOUT_MS = 3_500;

async function digest(bytes: Uint8Array) { const source = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer; const value = await crypto.subtle.digest("SHA-256", source); return [...new Uint8Array(value)].map((item) => item.toString(16).padStart(2, "0")).join(""); }
function timed<T>(promise: Promise<T>) { return Promise.race([promise, new Promise<T>((_, reject) => setTimeout(() => reject(new Error("PDF_TIMEOUT")), EXTRACTION_TIMEOUT_MS))]); }
export async function extractPdfText(bytes: Uint8Array): Promise<PdfExtraction> {
  const sha256 = await digest(bytes); if (bytes.byteLength > MAX_PDF_BYTES) return { sha256, text: "", extractionStatus: "TOO_LARGE", issue: "PDF_TOO_LARGE", pages: null };
  if (new TextDecoder().decode(bytes.slice(0, 5)) !== "%PDF-") return { sha256, text: "", extractionStatus: "INVALID_PDF", issue: "INVALID_PDF_SIGNATURE", pages: null };
  try {
    const pdf = await timed(getDocumentProxy(bytes, { maxImageSize: 16_777_216 })); if (pdf.numPages > MAX_PDF_PAGES) { await pdf.cleanup(); return { sha256, text: "", extractionStatus: "TOO_LARGE", issue: "PDF_TOO_MANY_PAGES", pages: pdf.numPages }; }
    const result = await timed(extractText(pdf, { mergePages: true })); await pdf.cleanup(); const text = String(result.text).split("\0").join(" ").trim().slice(0, MAX_PDF_TEXT_CHARS);
    return text ? { sha256, text, extractionStatus: "EXTRACTED", issue: null, pages: result.totalPages } : { sha256, text: "", extractionStatus: "NO_TEXT", issue: "PDF_NO_TEXT_LAYER", pages: result.totalPages };
  } catch (error) { return { sha256, text: "", extractionStatus: "FAILED", issue: error instanceof Error && error.message === "PDF_TIMEOUT" ? "PDF_EXTRACTION_TIMEOUT" : "PDF_TEXT_EXTRACTION_FAILED", pages: null }; }
}
