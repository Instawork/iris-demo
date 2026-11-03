import { addDaysISO, spanMinutes, weekStartISO } from "@/lib/dates"
import { round2 } from "@/lib/format"
import { city, location } from "@/lib/reference"
import { OVERTIME_AFTER, hoursFor } from "@/lib/timesheets"
import type { DemoData, Timesheet } from "@/lib/types"

/**
 * Breaks and overtime, flagged before they turn into a claim or a time-and-a-half invoice. Meal breaks follow
 * Instawork's rules by state (`apps/meals_and_breaks`): a shift that reaches `hours` needs an unpaid break of `minutes`.
 * Georgia and Texas have none. Overtime starts past 40 hours in a work week with one agency, booked shifts included.
 */
export const MEAL_BREAK: Record<string, { hours: number; minutes: number }> = {
  CA: { hours: 5, minutes: 30 },
  CO: { hours: 5, minutes: 30 },
  IL: { hours: 7.5, minutes: 30 },
}

export const STATE_NAME: Record<string, string> = { CA: "California", CO: "Colorado", IL: "Illinois", GA: "Georgia", TX: "Texas" }

export type LaborFlag =
  | { kind: "break"; id: string; proId: string; date: string; timesheetId: string; span: number; breakMins: number; state: string; rule: { hours: number; minutes: number } }
  | { kind: "overtime"; id: string; proId: string; date: string; groupId: string; supplierId: string; total: number; over: number; booked: boolean }

type Work = { proId: string; supplierId: string; buyerId: string; date: string; start: string; hours: number; groupId: string; booked: boolean }

/** This week's and last week's missed meal breaks, then this week's workers going past 40 hours, for one buyer. */
export function laborFlags(data: DemoData, buyerId: string, today: string): LaborFlag[] {
  const week = weekStartISO(today)
  const live = (t: Timesheet) => t.status !== "removed" && t.status !== "rejected"

  const breaks: LaborFlag[] = data.timesheets
    .filter((t) => t.buyerId === buyerId && live(t) && t.clockIn && t.clockOut && !t.sentHome && t.date >= addDaysISO(week, -7) && t.date <= today)
    .flatMap((t) => {
      const state = city(location(t.locationId).cityId).state
      const rule = MEAL_BREAK[state]
      const span = spanMinutes(t.clockIn!, t.clockOut!) / 60
      if (!rule || span < rule.hours || t.breakMins >= rule.minutes) return []
      return [{ kind: "break" as const, id: `break-${t.id}`, proId: t.proId, date: t.date, timesheetId: t.id, span: round2(span), breakMins: t.breakMins, state, rule }]
    })

  const end = addDaysISO(week, 6)
  const billed = new Set(data.timesheets.map((t) => t.slotId))
  const agency = new Map(data.pros.map((p) => [p.id, p.supplierId]))
  const work: Work[] = [
    ...data.timesheets
      .filter((t) => live(t) && t.date >= week && t.date <= end)
      .map((t) => ({ proId: t.proId, supplierId: t.supplierId, buyerId: t.buyerId, date: t.date, start: t.scheduledStart, hours: t.hours, groupId: t.groupId, booked: false })),
    ...data.groups
      .filter((g) => !g.cancelledAt && g.date >= week && g.date <= end)
      .flatMap((g) =>
        g.slots
          .filter((s) => s.proId && s.status === "confirmed" && !billed.has(s.id))
          .map((s) => ({ proId: s.proId!, supplierId: agency.get(s.proId!) ?? g.supplierId, buyerId: g.buyerId, date: g.date, start: g.start, hours: hoursFor(g.start, g.end, g.breakMins), groupId: g.id, booked: true })),
      ),
  ]
  const weeks = new Map<string, Work[]>()
  for (const w of work) weeks.set(`${w.proId}|${w.supplierId}`, [...(weeks.get(`${w.proId}|${w.supplierId}`) ?? []), w])
  const overtime: LaborFlag[] = [...weeks.values()].flatMap((list) => {
    const ordered = [...list].sort((a, b) => a.date.localeCompare(b.date) || a.start.localeCompare(b.start))
    const total = round2(ordered.reduce((s, w) => s + w.hours, 0))
    let sum = 0
    const crossing = ordered.find((w) => (sum += w.hours) > OVERTIME_AFTER)
    if (!crossing || crossing.buyerId !== buyerId) return []
    return [{ kind: "overtime" as const, id: `ot-${crossing.proId}-${week}`, proId: crossing.proId, date: crossing.date, groupId: crossing.groupId, supplierId: crossing.supplierId, total, over: round2(total - OVERTIME_AFTER), booked: crossing.booked }]
  })

  return [...overtime.sort((a, b) => a.date.localeCompare(b.date)), ...breaks.sort((a, b) => b.date.localeCompare(a.date))]
}
