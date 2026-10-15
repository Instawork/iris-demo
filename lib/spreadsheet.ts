import { readSheet } from "read-excel-file/browser"

import { parseCsv, specsFor } from "@/lib/csv"
import type { PersonaKind, UploadType } from "@/lib/types"

const CSV_TYPES = new Set(["text/csv", "application/csv"])

const pad = (n: number) => String(n).padStart(2, "0")

/** Excel stores a clock time as a date in 1899. Everything else is a calendar date. */
function cellText(value: unknown) {
  if (value == null) return ""
  if (value instanceof Date) {
    if (value.getFullYear() < 1901) return `${pad(value.getHours())}:${pad(value.getMinutes())}`
    return `${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(value.getDate())}`
  }
  return String(value)
}

function csvField(value: string) {
  return /[",\n]/.test(value) ? `"${value.replaceAll('"', '""')}"` : value
}

export const isSpreadsheetFile = (file: File) => {
  const name = file.name.toLowerCase()
  return name.endsWith(".csv") || name.endsWith(".xlsx") || name.endsWith(".xls") || CSV_TYPES.has(file.type)
}

export async function spreadsheetToCsv(file: File) {
  const lower = file.name.toLowerCase()
  if (lower.endsWith(".csv") || CSV_TYPES.has(file.type)) return file.text()
  if (!lower.endsWith(".xlsx")) throw new Error("Save this as .xlsx or .csv. The older .xls format isn't supported.")
  const rows = await readSheet(file)
  const filled = rows.filter((row) => row.some((cell) => cell != null && String(cell).trim() !== ""))
  if (!filled.length) throw new Error("The first worksheet is empty.")
  return filled.map((row) => row.map((cell) => csvField(cellText(cell))).join(",")).join("\n")
}

export function detectUploadType(csv: string, kind: PersonaKind): { type?: UploadType; ambiguous: boolean } {
  const headers = new Set(parseCsv(csv).headers)
  const ranked = specsFor(kind)
    .map((spec) => ({
      type: spec.type,
      required: spec.columns.filter((column) => column.required && headers.has(column.key)).length,
      total: spec.columns.filter((column) => headers.has(column.key)).length,
    }))
    .sort((a, b) => b.required - a.required || b.total - a.total)
  const best = ranked[0]
  if (!best || best.total === 0) return { ambiguous: true }
  const second = ranked[1]
  return {
    type: best.type,
    ambiguous: !!second && best.required === second.required && best.total === second.total,
  }
}
