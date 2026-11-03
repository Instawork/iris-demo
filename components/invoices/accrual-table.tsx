"use client"

import { Receipt } from "lucide-react"
import { useMemo } from "react"

import { EmptyState } from "@/components/common/empty-state"
import { Surface } from "@/components/common/surface"
import { Breakdown, type BreakdownColumn } from "@/components/invoices/breakdown"
import { ACCRUAL_STAGE, stageOf, type Accruals } from "@/lib/accruals"
import { timesheetAmount } from "@/lib/timesheets"

const COLUMNS: BreakdownColumn[] = [
  { header: "Approved", info: ACCRUAL_STAGE.approved },
  { header: "Pending", info: "Not approved yet: with the agency or waiting for approval" },
  { header: "Total" },
]

/** What to accrue, laid out like the weekly invoice, down to each cost center. */
export function AccrualTable({ accruals }: { accruals: Accruals }) {
  const items = useMemo(
    () =>
      accruals.timesheets.map((t) => {
        const amount = timesheetAmount(t)
        const approved = stageOf(t) === "approved"
        return { ...t, amounts: [approved ? amount : 0, approved ? 0 : amount, amount] }
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
