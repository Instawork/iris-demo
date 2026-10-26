import { minutesOf, paidHours, spanMinutes, weekEndISO, weekStartISO } from "@/lib/dates"
import { round2 } from "@/lib/format"
import type { BilledTimes, ClockRecord, Timesheet, TimesheetAction, TimesheetChange, TimesheetStatus } from "@/lib/types"

/**
 * Timesheet rules shared by the server and the browser: paid hours, the four-hour minimum, overtime, and the checks
 * that run on every timesheet with the fix Iris proposes for each. The checks start from the anomalies Compass's
 * Fieldglass filing already refuses, then add the ones only an independent clock makes possible.
 */

export const OVERTIME_AFTER = 40
export const OVERTIME_RATE = 1.5
export const SENT_HOME_MINIMUM = 4

export const STATUS_LABEL: Record<TimesheetStatus, string> = {
  draft: "Draft",
  pending_approval: "Pending approval",
  approved: "Approved",
  rejected: "Rejected",
  invoiced: "Invoiced",
  removed: "Removed",
}

export const billedOf = (t: Pick<Timesheet, "clockIn" | "clockOut" | "breakMins" | "hours">): BilledTimes => ({
  clockIn: t.clockIn,
  clockOut: t.clockOut,
  breakMins: t.breakMins,
  hours: t.hours,
})

/** Paid hours for a set of times. A worker sent home early is paid at least four hours. */
export function hoursFor(clockIn: string | undefined, clockOut: string | undefined, breakMins: number, sentHome?: boolean) {
  if (!clockIn || !clockOut) return sentHome ? SENT_HOME_MINIMUM : 0
  const worked = paidHours(clockIn, clockOut, breakMins)
  return sentHome ? Math.max(worked, SENT_HOME_MINIMUM) : worked
}

export const clockHours = (clock?: ClockRecord) => (clock?.in && clock.out ? paidHours(clock.in, clock.out, clock.breakMins) : undefined)

export const scheduledHours = (t: Pick<Timesheet, "scheduledStart" | "scheduledEnd" | "scheduledBreakMins">) =>
  paidHours(t.scheduledStart, t.scheduledEnd, t.scheduledBreakMins)

export const laborAmount = (t: Pick<Timesheet, "hours" | "otHours" | "billRate">) =>
  round2((t.hours - t.otHours) * t.billRate + t.otHours * t.billRate * OVERTIME_RATE)

export const timesheetAmount = (t: Pick<Timesheet, "hours" | "otHours" | "billRate" | "tips">) => round2(laborAmount(t) + t.tips)

/** The agency has to act: complete and submit a draft, or fix a rejected one. */
export const withAgency = (t: Timesheet) => t.status === "draft" || t.status === "rejected"

export const canEditBilled = (t: Timesheet) => t.status === "draft" || t.status === "rejected"

/** A work week closes the day after it ends; its approved hours then go on the agency's invoice for that week. */
export const weekClosed = (date: string, today: string) => weekEndISO(date) < today

export const change = (at: string, by: string, action: TimesheetAction, extra?: Omit<TimesheetChange, "at" | "by" | "action">): TimesheetChange => ({
  at,
  by,
  action,
  ...extra,
})

/* --------------------------------- Checks --------------------------------- */

export type CheckId = "missing_punch" | "zero" | "short" | "break_long" | "above_clock" | "early" | "over_schedule" | "no_break" | "overlap"

export interface Proposal extends BilledTimes {
  reason: string
}

export interface TimesheetCheck {
  id: CheckId
  label: string
  detail: string
  /** The billed times Iris proposes instead. Absent when only the agency can fix it. */
  proposal?: Proposal
}

const fmt = (hhmm: string) => {
  const m = minutesOf(hhmm)
  const h = Math.floor(m / 60) % 24
  return `${h % 12 === 0 ? 12 : h % 12}:${String(m % 60).padStart(2, "0")}${h >= 12 ? "pm" : "am"}`
}

const proposal = (t: Timesheet, clockIn: string, clockOut: string, breakMins: number, reason: string): Proposal => ({
  clockIn,
  clockOut,
  breakMins,
  hours: hoursFor(clockIn, clockOut, breakMins, t.sentHome),
  reason,
})

const interval = (t: Timesheet) => {
  const start = minutesOf(t.clockIn!)
  return [start, start + spanMinutes(t.clockIn!, t.clockOut!)] as const
}

/**
 * Every check that applies to a timesheet's billed times, most important first. `others` are the worker's other
 * timesheets, used to catch the same person billed twice at once.
 */
export function timesheetChecks(t: Timesheet, others: Timesheet[] = []): TimesheetCheck[] {
  if (t.status === "removed") return []
  const checks: TimesheetCheck[] = []
  const clock = t.clock
  const clockComplete = !!clock?.in && !!clock.out
  const scheduled = scheduledHours(t)

  if (!t.clockIn || !t.clockOut) {
    const fromClock = !!(clock?.in || clock?.out)
    checks.push({
      id: "missing_punch",
      label: "Missing punch",
      detail: !t.clockIn && !t.clockOut ? "No clock-in or clock-out billed yet." : !t.clockOut ? "Clock-out is missing." : "Clock-in is missing.",
      proposal: proposal(
        t,
        t.clockIn ?? clock?.in ?? t.scheduledStart,
        t.clockOut ?? clock?.out ?? t.scheduledEnd,
        t.breakMins || clock?.breakMins || t.scheduledBreakMins,
        clockComplete ? "Billed from the clock" : fromClock ? "Missing time taken from the schedule" : "Billed to the schedule",
      ),
    })
    return checks
  }

  const span = spanMinutes(t.clockIn, t.clockOut)
  if (t.clockIn === t.clockOut) checks.push({ id: "zero", label: "Zero hours", detail: "Clock-in and clock-out are the same time." })
  else if (span < 10) checks.push({ id: "short", label: "Under 10 minutes", detail: `Billed for ${span} minutes.` })
  if (t.breakMins > 0 && t.breakMins >= span) checks.push({ id: "break_long", label: "Break as long as the shift", detail: `A ${t.breakMins}-minute break on a ${span}-minute shift.` })
  if (checks.length) return checks

  const onClock = clockHours(clock)
  if (clockComplete && onClock !== undefined && t.hours - hoursFor(clock!.in, clock!.out, clock!.breakMins, t.sentHome) >= 0.25) {
    checks.push({
      id: "above_clock",
      label: "Billed above the clock",
      detail: `${t.hours} hrs billed, ${onClock} hrs on the clock (${fmt(clock!.in!)} to ${fmt(clock!.out!)}).`,
      proposal: proposal(t, clock!.in!, clock!.out!, clock!.breakMins, "Matched to the clock"),
    })
  }

  const early = minutesOf(t.scheduledStart) - minutesOf(t.clockIn)
  if (early > 15 && early < 180) {
    checks.push({
      id: "early",
      label: "Clocked in early",
      detail: `Billed from ${fmt(t.clockIn)}, ${early} minutes before the shift started.`,
      proposal: proposal(t, t.scheduledStart, t.clockOut, t.breakMins, "Billed from the scheduled start"),
    })
  }

  const over = round2(t.hours - scheduled)
  if (over >= 0.75 && !checks.some((c) => c.id === "above_clock")) {
    checks.push({
      id: "over_schedule",
      label: "Over schedule",
      detail: `${over} hrs more than the ${scheduled} hrs scheduled${clockComplete ? ", and the clock agrees" : ""}.`,
      proposal: proposal(t, t.scheduledStart, t.scheduledEnd, t.scheduledBreakMins, "Billed to the schedule"),
    })
  }

  if (t.breakMins === 0 && span >= 360 && t.scheduledBreakMins > 0 && !t.sentHome) {
    checks.push({
      id: "no_break",
      label: "No meal break",
      detail: `No unpaid break on a ${round2(span / 60)}-hour shift. ${t.scheduledBreakMins} minutes were scheduled.`,
      proposal: proposal(t, t.clockIn, t.clockOut, t.scheduledBreakMins, "Scheduled break deducted"),
    })
  }

  const [start, end] = interval(t)
  const clash = others.find((o) => {
    if (o.id === t.id || o.proId !== t.proId || o.date !== t.date || o.status === "removed" || !o.clockIn || !o.clockOut) return false
    const [s, e] = interval(o)
    return s < end && start < e
  })
  if (clash) {
    checks.push({
      id: "overlap",
      label: "Overlapping shift",
      detail: `Also billed ${fmt(clash.clockIn!)} to ${fmt(clash.clockOut!)} the same day on another shift.`,
    })
  }
  return checks
}

/** The fix Iris offers first: the clock beats the schedule, and either beats leaving it as billed. */
export const primaryProposal = (checks: TimesheetCheck[]) => checks.find((c) => c.proposal)?.proposal

/* -------------------------------- Overtime -------------------------------- */

export const overtimeKey = (t: Pick<Timesheet, "proId" | "supplierId" | "date">) => `${t.proId}|${t.supplierId}|${weekStartISO(t.date)}`

/**
 * Splits each worker's hours with one agency in a work week into straight time and overtime, in shift order. Only
 * the weeks in `keys` are recomputed when given. Invoiced timesheets keep the overtime they were invoiced with, and
 * unchanged timesheets keep their object so the change sync stays small.
 */
export function withOvertime(timesheets: Timesheet[], keys?: Set<string>): Timesheet[] {
  const weeks = new Map<string, Timesheet[]>()
  for (const t of timesheets) {
    if (t.status === "removed") continue
    const key = overtimeKey(t)
    if (keys && !keys.has(key)) continue
    weeks.set(key, [...(weeks.get(key) ?? []), t])
  }
  const ot = new Map<string, number>()
  for (const list of weeks.values()) {
    let total = 0
    const ordered = [...list].sort((a, b) => a.date.localeCompare(b.date) || a.scheduledStart.localeCompare(b.scheduledStart) || a.id.localeCompare(b.id))
    for (const t of ordered) {
      const before = total
      total += t.hours
      ot.set(t.id, round2(Math.max(0, total - OVERTIME_AFTER) - Math.max(0, before - OVERTIME_AFTER)))
    }
  }
  return timesheets.map((t) => {
    if (t.status === "invoiced") return t
    const next = t.status === "removed" ? 0 : ot.get(t.id)
    return next === undefined || next === t.otHours ? t : { ...t, otHours: next }
  })
}
