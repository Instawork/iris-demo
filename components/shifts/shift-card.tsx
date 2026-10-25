"use client"

import Link from "next/link"
import { useRouter } from "next/navigation"
import { Repeat, UserPlus } from "lucide-react"
import { motion } from "motion/react"
import { useState } from "react"

import { SupplierLogo } from "@/components/brand/org-avatar"
import { FillPipe } from "@/components/common/fill-pipe"
import { Tip } from "@/components/common/info-tip"
import { AvatarStack } from "@/components/common/pro-avatar"
import { StatusBadge } from "@/components/common/status-badge"
import { AssignProsDialog } from "@/components/shifts/assign-pros-dialog"
import { Button } from "@/components/ui/button"
import { useData, useWorkspace } from "@/hooks/use-app"
import { formatDateLong, formatInterval } from "@/lib/dates"
import { money } from "@/lib/format"
import { filledCount, fillRatio, fillTone, groupEstimate, groupPhase } from "@/lib/metrics"
import { buyer, city, location, position, supplier } from "@/lib/reference"
import { joinNames } from "@/lib/store"
import type { ShiftGroup } from "@/lib/types"
import { cn } from "@/lib/utils"

/** The suppliers a shift was sent to, as overlapping logos with their names in a tooltip. */
export function SupplierStack({ ids, names = false, className }: { ids: string[]; names?: boolean; className?: string }) {
  if (!ids.length) return <span className="text-faded">--</span>
  return (
    <Tip content={`Sent to ${joinNames(ids.map((id) => supplier(id).shortName))}`}>
      <span className={cn("inline-flex items-center gap-2", className)}>
        <span className="flex -space-x-1.5">
          {ids.map((id) => (
            <SupplierLogo key={id} supplierId={id} size="xs" className="ring-2 ring-card" />
          ))}
        </span>
        {names && <span className="truncate text-body-3">{ids.map((id) => supplier(id).shortName).join(", ")}</span>}
      </span>
    </Tip>
  )
}

export function ShiftCard({ group }: { group: ShiftGroup }) {
  const router = useRouter()
  const data = useData()
  const { ws } = useWorkspace()
  const [assignOpen, setAssignOpen] = useState(false)
  const phase = groupPhase(group)
  const pos = position(group.positionId)
  const loc = location(group.locationId)
  const filled = filledCount(group)
  const total = group.slots.length
  const pros = group.slots.map((s) => data.pros.find((p) => p.id === s.proId)).filter(Boolean) as NonNullable<ReturnType<typeof data.pros.find>>[]
  const title = group.name || pos.name
  const isPast = phase === "past"
  const href = `/shifts/${group.id}`

  return (
    <motion.div layout="position" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.15, layout: { duration: 0.2 } }}>
      <div
        role="link"
        tabIndex={0}
        onClick={() => router.push(href)}
        onKeyDown={(e) => e.key === "Enter" && router.push(href)}
        className={cn(
          "group relative flex cursor-pointer flex-col gap-1 overflow-hidden rounded-xl border border-border bg-card p-4 shadow-raised outline-none transition-colors duration-100",
          "hover:border-border-strong focus-visible:ring-2 focus-visible:ring-ring/40",
          group.cancelledAt && "opacity-60",
        )}
      >
        <div className="flex flex-col-reverse justify-between gap-2 sm:flex-row sm:items-start">
          <div className="flex min-w-0 items-center gap-2">
            <span className="truncate text-body-2 font-bold">{title}</span>
            {group.liveFill && phase === "upcoming" && group.supplierIds.length > 0 && (
              <Tip content="Suppliers are confirming Pros right now">
                <span className="inline-flex h-5 items-center gap-1.5 rounded-md bg-brand px-1.5 text-caption-1 font-semibold text-brand-foreground">
                  <span className="size-1.5 animate-pulse rounded-full bg-brand-foreground" />
                  Filling now
                </span>
              </Tip>
            )}
            {group.approval?.status === "pending" && !group.cancelledAt && <StatusBadge tone="warning">Needs approval</StatusBadge>}
            {group.approval?.status === "declined" && <StatusBadge tone="critical">Declined</StatusBadge>}
            {!group.approval || group.approval.status === "approved"
              ? !group.cancelledAt && phase === "upcoming" && group.supplierReleases && !group.supplierIds.length && <StatusBadge>Held for release</StatusBadge>
              : null}
            {phase === "in_progress" && (
              <StatusBadge tone="positive" dot>
                In progress
              </StatusBadge>
            )}
          </div>
          <div className="flex shrink-0 flex-wrap items-center gap-2">
            {group.eventName && <span className="text-body-3 font-medium text-primary">{group.eventName}</span>}
            {group.badges.map((b) => (
              <Tip key={b} content={b === "TIPS" ? "Tips eligible: add tips per Pro after the shift" : b}>
                <span>
                  <StatusBadge>{b}</StatusBadge>
                </span>
              </Tip>
            ))}
            <SupplierStack ids={group.supplierIds} />
          </div>
        </div>

        <div className="flex flex-col justify-between gap-3 pb-1 sm:flex-row sm:items-center">
          <div className="flex flex-col gap-1 text-body-2 text-faded">
            <span>{formatDateLong(group.date)}</span>
            <span>{formatInterval(group.start, group.end, city(loc.cityId).tz)}</span>
            <span className="truncate">
              {ws.kind !== "buyer" && <>{buyer(group.buyerId).brand} · </>}
              {loc.name} • {pos.name}
            </span>
          </div>
          <div className="flex shrink-0 items-center gap-2 text-body-2 sm:flex-col sm:items-end sm:gap-0.5">
            {isPast ? (
              <span className="font-bold">
                {filled} Pros <span className="px-1 text-subtle">|</span> {money(groupEstimate({ ...group, slots: group.slots.filter((s) => s.proId) }))}
              </span>
            ) : (
              <>
                <span className="font-bold tabular">from {money(group.billRate)}/hr</span>
                <span className="text-caption-1 text-faded tabular">Est. {money(groupEstimate(group))}</span>
              </>
            )}
          </div>
        </div>

        <div className="h-px bg-border" />

        <div className="flex flex-col justify-between gap-2 pt-2 sm:flex-row sm:items-center">
          <div className="flex flex-wrap items-center gap-2">
            <FillPipe ratio={fillRatio(group)} tone={group.cancelledAt ? "neutral" : fillTone(group)} />
            <span className="text-body-2 tabular">{group.cancelledAt ? "Cancelled" : total > 0 ? `${filled} of ${total} filled` : "Cancelled"}</span>
            {pros.length > 0 && <AvatarStack pros={pros} />}
            {filled > 0 && (
              <Link href={href} onClick={(e) => e.stopPropagation()} className="text-body-2 font-medium text-foreground underline-offset-4 hover:text-primary hover:underline">
                View all Pros
              </Link>
            )}
          </div>
          <div className="flex items-center gap-2" onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()}>
            {isPast && ws.kind === "buyer" && (
              <Link href={`/shifts/new?from=${group.id}`} className="inline-flex items-center gap-1.5 text-body-3 font-medium text-primary hover:underline">
                <Repeat className="size-4" /> Post again
              </Link>
            )}
            {!isPast && !group.cancelledAt && ws.kind === "supplier" && filled < total && (
              <Button size="sm" className="h-8 gap-1.5 rounded-lg px-3 text-caption-1 font-semibold" onClick={() => setAssignOpen(true)}>
                <UserPlus className="size-3.5" /> Assign Pros
              </Button>
            )}
          </div>
        </div>
      </div>
      {ws.kind === "supplier" && <AssignProsDialog group={group} open={assignOpen} onOpenChange={setAssignOpen} />}
    </motion.div>
  )
}
