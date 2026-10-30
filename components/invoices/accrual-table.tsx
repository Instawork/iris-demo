"use client"

import { Receipt } from "lucide-react"
import { useMemo } from "react"

import { EmptyState } from "@/components/common/empty-state"
import { Surface } from "@/components/common/surface"
import { Breakdown, type BreakdownColumn } from "@/components/invoices/breakdown"
import { ACCRUAL_STAGE, ACCRUAL_STAGES, stageOf, type Accruals } from "@/lib/accruals"
import { timesheetAmount } from "@/lib/timesheets"

const COLUMNS: BreakdownColumn[] = [
  { header: "Approved", info: ACCRUAL_STAGE.approved },
  { header: "Pending", info: ACCRUAL_STAGE.approval },
  { header: "With agency", info: ACCRUAL_STAGE.agency },
  { header: "To accrue" },
]

/** What to accrue, laid out like the monthly invoice: sector, business, then each cost center. */
export function AccrualTable({ accruals }: { accruals: Accruals }) {
  const items = useMemo(
    () =>
      accruals.timesheets.map((t) => {
        const amount = timesheetAmount(t)
        const stage = stageOf(t)
        return { ...t, amounts: [...ACCRUAL_STAGES.map((s) => (s === stage ? amount : 0)), amount] }
      }),
    [accruals.timesheets],
  )
  if (!items.length) return <EmptyState icon={Receipt} title="Nothing to accrue" description="Every hour worked is on an issued invoice." />
  return (
    <Surface elevated className="overflow-hidden" data-tour="accruals">
      <div className="px-3 pb-2">
        <Breakdown items={items} columns={COLUMNS} />
      </div>
    </Surface>
  )
}
