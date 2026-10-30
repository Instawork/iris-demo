"use client"

import { Receipt } from "lucide-react"

import { DataTable, type Column } from "@/components/common/data-table"
import { EmptyState } from "@/components/common/empty-state"
import { ACCRUAL_STAGE, type AccrualRow, type AccrualStage, type Accruals } from "@/lib/accruals"
import { money } from "@/lib/format"
import { buyer, location } from "@/lib/reference"

const STAGES: AccrualStage[] = ["approved", "approval", "agency"]

const SHORT: Record<AccrualStage, string> = { approved: "Approved", approval: "Pending", agency: "With agency" }

/** What to accrue for each cost center: hours worked by today that no issued invoice covers yet. */
export function AccrualTable({ accruals, showBuyer }: { accruals: Accruals; showBuyer: boolean }) {
  const amountCell = (v: number) => (v ? <span className="tabular">{money(v)}</span> : <span className="text-subtle">--</span>)
  const columns: Column<AccrualRow>[] = [
    {
      id: "unit",
      header: "Unit",
      sortValue: (r) => location(r.locationId).name,
      cell: (r) => (
        <span className="flex flex-col">
          <span className="font-semibold">{location(r.locationId).name}</span>
          <span className="text-caption-1 text-faded">{[r.departmentName, showBuyer ? buyer(r.buyerId).name : undefined].filter(Boolean).join(" · ") || "Whole unit"}</span>
        </span>
      ),
    },
    { id: "cc", header: "Cost center", sortValue: (r) => r.costCenter, cell: (r) => <span className="font-mono text-caption-1">{r.costCenter}</span> },
    { id: "hours", header: "Hours", align: "right", sortValue: (r) => r.hours, cell: (r) => <span className="text-faded tabular">{r.hours.toFixed(2)}</span> },
    ...STAGES.map<Column<AccrualRow>>((s) => ({
      id: s,
      header: SHORT[s],
      info: ACCRUAL_STAGE[s],
      align: "right",
      sortValue: (r) => r.byStage[s],
      cell: (r) => amountCell(r.byStage[s]),
    })),
    { id: "amount", header: "To accrue", align: "right", sortValue: (r) => r.amount, cell: (r) => <span className="font-semibold tabular">{money(r.amount)}</span> },
  ]
  return (
    <div data-tour="accruals">
      <DataTable
        rows={accruals.rows}
        columns={columns}
        getRowId={(r) => r.costCenter}
        pageSize={15}
        empty={<EmptyState icon={Receipt} title="Nothing to accrue" description="Every hour worked is on an issued invoice." />}
      />
    </div>
  )
}
