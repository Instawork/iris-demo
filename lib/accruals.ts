import { round2 } from "@/lib/format"
import { inScope } from "@/lib/metrics"
import { buyer, departmentOf, location, position, supplier } from "@/lib/reference"
import { expensesOf, laborAmount, timesheetAmount } from "@/lib/timesheets"
import type { Scope, Timesheet } from "@/lib/types"

/**
 * Labor worked that no issued invoice covers yet. Agency invoices land a week or two after the shift, so accounting
 * accrues this at month end, and budgets track it each week, from Iris's timesheets instead of waiting for the bill.
 */

export type AccrualStage = "approved" | "approval" | "agency"

export const ACCRUAL_STAGES: AccrualStage[] = ["approved", "approval", "agency"]

export const ACCRUAL_STAGE: Record<AccrualStage, string> = {
  approved: "Approved, on this week's invoice",
  approval: "Waiting for approval",
  agency: "With the agency",
}

export const stageOf = (t: Timesheet): AccrualStage | undefined =>
  t.status === "draft" || t.status === "rejected" ? "agency" : t.status === "pending_approval" ? "approval" : t.status === "approved" ? "approved" : undefined

export interface Accruals {
  timesheets: Timesheet[]
  hours: number
  amount: number
}

/** Every timesheet worked by today that isn't on an issued invoice. */
export function accruals(timesheets: Timesheet[], scope: Scope, today: string): Accruals {
  const open = timesheets.filter((t) => !!stageOf(t) && t.date <= today && inScope(scope, t))
  return {
    timesheets: open,
    hours: round2(open.reduce((s, t) => s + t.hours, 0)),
    amount: round2(open.reduce((s, t) => s + timesheetAmount(t), 0)),
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
