import { round2 } from "@/lib/format"
import { inScope } from "@/lib/metrics"
import { buyer, departmentOf, location, position, supplier } from "@/lib/reference"
import { expensesOf, laborAmount, timesheetAmount } from "@/lib/timesheets"
import type { Scope, Timesheet } from "@/lib/types"

/**
 * Labor worked that no issued invoice covers yet. Agency invoices land a week or two after the shift, so accounting
 * accrues this at month end, and budgets track it each week, from Iris's timesheets instead of waiting for the bill.
 */

export type AccrualStage = "agency" | "approval" | "approved"

export const ACCRUAL_STAGE: Record<AccrualStage, string> = {
  agency: "With the agency",
  approval: "Waiting for approval",
  approved: "Approved, on this week's invoice",
}

const stageOf = (t: Timesheet): AccrualStage | undefined =>
  t.status === "draft" || t.status === "rejected" ? "agency" : t.status === "pending_approval" ? "approval" : t.status === "approved" ? "approved" : undefined

export interface AccrualRow {
  costCenter: string
  locationId: string
  departmentName?: string
  buyerId: string
  hours: number
  amount: number
  byStage: Record<AccrualStage, number>
}

export interface Accruals {
  rows: AccrualRow[]
  timesheets: Timesheet[]
  hours: number
  amount: number
  byStage: Record<AccrualStage, number>
}

const noStages = (): Record<AccrualStage, number> => ({ agency: 0, approval: 0, approved: 0 })

/** Every timesheet worked by today that isn't on an issued invoice, by the cost center it's charged to. */
export function accruals(timesheets: Timesheet[], scope: Scope, today: string): Accruals {
  const rows = new Map<string, AccrualRow>()
  const open: Timesheet[] = []
  const byStage = noStages()
  for (const t of timesheets) {
    const stage = stageOf(t)
    if (!stage || t.date > today || !inScope(scope, t)) continue
    const dept = departmentOf(t.locationId, t.departmentId, t.positionId)
    const costCenter = dept?.costCenter || location(t.locationId).costCenter
    const row = rows.get(costCenter) ?? { costCenter, locationId: t.locationId, departmentName: dept?.name, buyerId: t.buyerId, hours: 0, amount: 0, byStage: noStages() }
    const amount = timesheetAmount(t)
    row.hours = round2(row.hours + t.hours)
    row.amount = round2(row.amount + amount)
    row.byStage[stage] = round2(row.byStage[stage] + amount)
    byStage[stage] = round2(byStage[stage] + amount)
    rows.set(costCenter, row)
    open.push(t)
  }
  const list = [...rows.values()].sort((a, b) => b.amount - a.amount)
  return {
    rows: list,
    timesheets: open,
    hours: round2(list.reduce((s, r) => s + r.hours, 0)),
    amount: round2(list.reduce((s, r) => s + r.amount, 0)),
    byStage,
  }
}

/** One line per timesheet, the way accounting books the accrual. */
export const accrualCsvRows = (a: Accruals) =>
  a.timesheets
    .slice()
    .sort((x, y) => x.date.localeCompare(y.date))
    .map((t) => {
      const dept = departmentOf(t.locationId, t.departmentId, t.positionId)
      return {
        work_date: t.date,
        cost_center: dept?.costCenter || location(t.locationId).costCenter,
        unit: location(t.locationId).name,
        department: dept?.name ?? "",
        buyer: buyer(t.buyerId).name,
        agency: supplier(t.supplierId).name,
        position: position(t.positionId).name,
        hours: t.hours,
        labor: laborAmount(t).toFixed(2),
        tips: t.tips.toFixed(2),
        expenses: expensesOf(t).toFixed(2),
        amount: timesheetAmount(t).toFixed(2),
        stage: ACCRUAL_STAGE[stageOf(t)!],
      }
    })
