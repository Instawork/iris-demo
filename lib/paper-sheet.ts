import { hhmmFromMinutes, minutesOf, spanMinutes } from "@/lib/dates"
import { canEditBilled } from "@/lib/timesheets"
import type { DemoData, Pro, ShiftGroup, Timesheet } from "@/lib/types"

/**
 * Paper sign-in sheets, for venues that still sign workers in on a clipboard. Iris reads each line, matches the name
 * to a worker on the shift, and compares the hours with its clock, so the agency submits what the sheet says without
 * re-keying it and sees where the sheet and the clock disagree.
 */

export interface SheetLine {
  written: string
  in: string
  out: string
  breakMins: number
}

export type SheetState = "matches" | "over" | "under" | "fills" | "no_clock" | "unmatched"

export interface SheetMatch {
  line: SheetLine
  timesheet?: Timesheet
  pro?: Pro
  /** Paid minutes on the sheet minus paid minutes on the clock. */
  vsClock?: number
  state: SheetState
}

const paidMinutes = (from: string, to: string, breakMins: number) => spanMinutes(from, to) - breakMins
const roundTo5 = (hhmm: string) => hhmmFromMinutes(Math.round(minutesOf(hhmm) / 5) * 5)

const unpunched = (sheets: Timesheet[]) => sheets.filter((t) => !t.clockIn || !t.clockOut || !t.clock?.in || !t.clock.out).length

/** Shifts where the agency still has hours to submit, ones with a missing punch first. */
export function sheetShifts(data: DemoData, supplierId: string): { group: ShiftGroup; sheets: Timesheet[] }[] {
  const open = new Map<string, Timesheet[]>()
  for (const t of data.timesheets) if (t.supplierId === supplierId && canEditBilled(t) && !t.movedFrom && !t.movedTo) open.set(t.groupId, [...(open.get(t.groupId) ?? []), t])
  return [...open.entries()]
    .map(([id, sheets]) => ({ group: data.groups.find((g) => g.id === id), sheets }))
    .filter((x): x is { group: ShiftGroup; sheets: Timesheet[] } => !!x.group && x.sheets.length >= 2)
    .sort((a, b) => unpunched(b.sheets) - unpunched(a.sheets) || b.group.date.localeCompare(a.group.date) || b.sheets.length - a.sheets.length)
    .slice(0, 6)
}

/**
 * What the clipboard for a shift looks like: names written the way people sign in, times rounded the way people write
 * them, and one worker who wrote down a later finish than the clock shows.
 */
export function writtenSheet(sheets: Timesheet[], pros: Pro[]): SheetLine[] {
  return [...sheets]
    .sort((a, b) => (a.clock?.in ?? a.scheduledStart).localeCompare(b.clock?.in ?? b.scheduledStart))
    .map((t, i) => {
      const pro = pros.find((p) => p.id === t.proId)
      const first = pro?.firstName ?? "?"
      const last = pro?.lastName ?? "?"
      const written = i % 3 === 1 ? `${first[0]}. ${last}` : i % 3 === 2 ? `${first} ${last[0]}.` : `${first} ${last}`
      const start = roundTo5(t.clock?.in ?? t.scheduledStart)
      const end = roundTo5(t.clock?.out ?? t.scheduledEnd)
      return { written, in: start, out: i === 2 ? hhmmFromMinutes(minutesOf(end) + 20) : end, breakMins: t.clock?.breakMins ?? t.scheduledBreakMins }
    })
}

const norm = (s: string) => s.toLowerCase().replace(/[^a-z\s]/g, " ").split(/\s+/).filter(Boolean)

/** The worker a written name belongs to: full last name, plus a first name or initial that fits. */
function whoWrote(written: string, sheets: Timesheet[], pros: Pro[]) {
  const words = norm(written)
  return sheets.find((t) => {
    const pro = pros.find((p) => p.id === t.proId)
    if (!pro) return false
    const first = pro.firstName.toLowerCase()
    const last = pro.lastName.toLowerCase()
    const hasLast = words.includes(last) || words.some((w) => w.length === 1 && w === last[0])
    const hasFirst = words.includes(first) || words.some((w) => w.length === 1 && w === first[0])
    return hasLast && hasFirst && (words.includes(last) || words.includes(first))
  })
}

export function matchSheet(lines: SheetLine[], sheets: Timesheet[], pros: Pro[]): SheetMatch[] {
  const used = new Set<string>()
  return lines.map((line) => {
    const t = whoWrote(line.written, sheets.filter((s) => !used.has(s.id)), pros)
    if (!t) return { line, state: "unmatched" as const }
    used.add(t.id)
    const pro = pros.find((p) => p.id === t.proId)
    const vsClock = t.clock?.in && t.clock.out ? paidMinutes(line.in, line.out, line.breakMins) - paidMinutes(t.clock.in, t.clock.out, t.clock.breakMins) : undefined
    if (!t.clockIn || !t.clockOut) return { line, timesheet: t, pro, vsClock, state: "fills" as const }
    if (vsClock === undefined) return { line, timesheet: t, pro, state: "no_clock" as const }
    return { line, timesheet: t, pro, vsClock, state: vsClock > 5 ? ("over" as const) : vsClock < -5 ? ("under" as const) : ("matches" as const) }
  })
}
