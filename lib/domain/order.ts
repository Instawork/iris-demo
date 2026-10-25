import { formatTimestamp, paidHours } from "@/lib/dates"
import { budgetCheck, releasePlan, startsAt, type BudgetCheck } from "@/lib/domain/budget"
import { notifiedSuppliers, type BookingInput } from "@/lib/domain/core"
import { round2 } from "@/lib/format"
import { approversFor, location, policyFor, supplier } from "@/lib/reference"
import type { DemoData, SectorPolicy, ShiftGroup, Workspace } from "@/lib/types"

export interface OrderPreview {
  policy: SectorPolicy
  check: BudgetCheck
  approvers: Workspace[]
  needsApproval: boolean
  /** Across every date, at the first agency's bill rate. */
  estimate: number
  /** When the first agency sees the earliest date, if it were approved now. */
  firstRelease?: Date
  held: boolean
}

/** What the server will decide about an order, shown before anyone posts it. Same rules as the command. */
export function previewOrder(
  data: DemoData,
  input: Pick<BookingInput, "locationId" | "positionId" | "dates" | "start" | "end" | "breakMins" | "headcount">,
  now = new Date(),
): OrderPreview | undefined {
  const loc = location(input.locationId)
  const notified = notifiedSuppliers(data, loc.buyerId, loc.cityId, input.positionId)
  if (!notified.length || !input.dates.length) return undefined
  const policy = policyFor(loc.buyerId)
  const perDate = round2(paidHours(input.start, input.end, input.breakMins) * notified[0].card.billRate * input.headcount)
  const check = budgetCheck(data, loc.id, input.dates.map((date) => ({ date, estimate: perDate })), policy)
  const approvers = approversFor(loc.id)
  const first = [...input.dates].sort()[0]
  const plan = releasePlan(policy, startsAt({ date: first, start: input.start }), [notified[0].card.supplierId], now)
  const firstRelease = plan[0] ? new Date(plan[0].releasedAt) : undefined
  return {
    policy,
    check,
    approvers,
    needsApproval: check.needsApproval && approvers.length > 0,
    estimate: round2(perDate * input.dates.length),
    firstRelease,
    held: !!firstRelease && firstRelease.getTime() > now.getTime() + 60_000,
  }
}

/** Who has a released order now, or when its first agency gets it while the sector holds it. */
export function releaseSummary(g: Pick<ShiftGroup, "buyerId" | "supplierIds" | "supplierReleases">): string | undefined {
  const first = g.supplierReleases?.[0]
  if (!first) return undefined
  const name = supplier(first.supplierId).shortName
  return g.supplierIds.length ? `${name} has it now` : `${name} gets it ${formatTimestamp(first.releasedAt)}, when ${policyFor(g.buyerId).sector} releases it`
}
