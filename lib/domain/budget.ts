import { addDaysISO, weekStartISO } from "@/lib/dates"
import { round2 } from "@/lib/format"
import { groupEstimate } from "@/lib/metrics"
import { LOCATIONS, policyFor } from "@/lib/reference"
import type { DemoData, SectorPolicy, ShiftGroup, UnitBudget } from "@/lib/types"

/** Spend that counts against a unit's week: every live order there, at its estimated cost. */
const counts = (g: ShiftGroup) => !g.cancelledAt && g.approval?.status !== "declined"

export function committedSpend(data: Pick<DemoData, "groups">, locationId: string, weekStart: string) {
  const weekEnd = addDaysISO(weekStart, 6)
  return round2(data.groups.filter((g) => g.locationId === locationId && g.date >= weekStart && g.date <= weekEnd && counts(g)).reduce((s, g) => s + groupEstimate(g), 0))
}

/** The unit's budget for that week, or its largest weekly budget when the week is past the planning horizon. */
export function budgetFor(data: Pick<DemoData, "budgets">, locationId: string, weekStart: string) {
  const forUnit = (data.budgets ?? []).filter((b) => b.locationId === locationId)
  return forUnit.find((b) => b.weekStart === weekStart)?.amount ?? (forUnit.length ? Math.max(...forUnit.map((b) => b.amount)) : 0)
}

export interface WeekCheck {
  weekStart: string
  budget: number
  committed: number
  adding: number
  overPct: number
  over: boolean
}

export interface BudgetCheck {
  weeks: WeekCheck[]
  needsApproval: boolean
  /** The week that goes furthest over, for the one line the order shows. */
  worst?: WeekCheck
}

/** Checks an order against each week it touches. A unit without a budget never needs approval. */
export function budgetCheck(data: Pick<DemoData, "groups" | "budgets">, locationId: string, orders: { date: string; estimate: number }[], policy: SectorPolicy) {
  const byWeek = new Map<string, number>()
  for (const o of orders) byWeek.set(weekStartISO(o.date), (byWeek.get(weekStartISO(o.date)) ?? 0) + o.estimate)
  const weeks: WeekCheck[] = [...byWeek.entries()].sort().map(([weekStart, adding]) => {
    const budget = budgetFor(data, locationId, weekStart)
    const committed = committedSpend(data, locationId, weekStart)
    const overPct = budget ? (committed + adding) / budget - 1 : 0
    return { weekStart, budget, committed, adding: round2(adding), overPct, over: budget > 0 && overPct > policy.approvalOverPct }
  })
  const overWeeks = weeks.filter((w) => w.over)
  const worst = [...(overWeeks.length ? overWeeks : weeks)].sort((a, b) => b.overPct - a.overPct)[0]
  return { weeks, needsApproval: overWeeks.length > 0, worst } satisfies BudgetCheck
}

/** When an order reaches each agency: held until the sector's lead time before the shift, then one agency per gap. */
export function releasePlan(policy: SectorPolicy, startsAt: Date, supplierIds: string[], now: Date) {
  const first = Math.max(now.getTime(), startsAt.getTime() - policy.releaseLeadHours * 3600_000)
  return supplierIds.map((supplierId, index) => ({ supplierId, releasedAt: new Date(first + index * policy.tierGapHours * 3600_000).toISOString() }))
}

export const startsAt = (g: Pick<ShiftGroup, "date" | "start">) => new Date(`${g.date}T${g.start}:00`)

const HEADROOM = 2200

/**
 * Seeded weekly budgets: what each unit already committed that week plus $2,200 to $2,300 of room. A normal extra
 * order fits; a large one, like 12 more bartenders for a concert, goes over and needs the district manager.
 */
export function generateBudgets(groups: ShiftGroup[], today: string): UnitBudget[] {
  const firstWeek = weekStartISO(today)
  const budgets: UnitBudget[] = []
  for (const loc of LOCATIONS) {
    const weeks = [0, 1, 2, 3].map((w) => addDaysISO(firstWeek, w * 7))
    const amounts = weeks.map((weekStart) => committedSpend({ groups }, loc.id, weekStart))
    const typical = Math.max(...amounts)
    weeks.forEach((weekStart, i) => {
      const base = amounts[i] || typical
      if (!base) return
      budgets.push({ locationId: loc.id, weekStart, amount: Math.ceil((base + HEADROOM) / 100) * 100 })
    })
  }
  return budgets
}

export const policyOfLocation = (locationId: string) => policyFor(LOCATIONS.find((l) => l.id === locationId)?.buyerId ?? "")
