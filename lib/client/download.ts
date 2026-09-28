"use client";
/** Browser-side file downloads: CSV (Excel-friendly for Thai) and multi-tab Excel. */

export type SheetRow = Record<string, string | number | boolean | null | undefined>;

export function downloadBlob(filename: string, blob: Blob) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

function csvCell(v: SheetRow[string]): string {
  if (v === null || v === undefined) return "";
  const s = String(v);
  return /[",\r\n]/.test(s) || /^\s|\s$/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/**
 * CSV text. Starts with a byte-order mark: without it Excel opens UTF-8 files
 * as a Western code page and Thai turns into garbage.
 */
export function toCsv(rows: SheetRow[], columns?: string[]): string {
  const cols = columns ?? [...new Set(rows.flatMap((r) => Object.keys(r)))];
  const lines = [cols.map((c) => csvCell(c)).join(","), ...rows.map((r) => cols.map((c) => csvCell(r[c])).join(","))];
  return "﻿" + lines.join("\r\n") + "\r\n";
}

export function downloadCsv(filename: string, rows: SheetRow[], columns?: string[]) {
  downloadBlob(filename, new Blob([toCsv(rows, columns)], { type: "text/csv;charset=utf-8" }));
}

/** One .xlsx file with a tab per sheet. Sheet names are cut to Excel's 31-character limit. */
export async function downloadXlsx(filename: string, sheets: { name: string; rows: SheetRow[]; columns?: string[]; widths?: number[] }[]) {
  const XLSX = await import("xlsx");
  const wb = XLSX.utils.book_new();
  for (const sh of sheets) {
    const cols = sh.columns ?? [...new Set(sh.rows.flatMap((r) => Object.keys(r)))];
    const ws = XLSX.utils.json_to_sheet(
      sh.rows.map((r) => Object.fromEntries(cols.map((c) => [c, r[c] ?? ""]))),
      { header: cols },
    );
    ws["!cols"] = cols.map((c, i) => ({ wch: sh.widths?.[i] ?? Math.min(60, Math.max(10, c.length + 2)) }));
    XLSX.utils.book_append_sheet(wb, ws, sh.name.replace(/[\\/?*[\]:]/g, " ").slice(0, 31));
  }
  const out = XLSX.write(wb, { bookType: "xlsx", type: "array" }) as ArrayBuffer;
  downloadBlob(filename, new Blob([out], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }));
}

/** Safe file name part: keeps Thai and Latin letters, digits and dashes. */
export function fileSlug(s: string): string {
  return s.normalize("NFC").replace(/[^\p{L}\p{M}\p{N}]+/gu, "-").replace(/^-+|-+$/g, "").slice(0, 60) || "export";
}
