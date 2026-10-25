"use client"

import Link from "next/link"
import { BadgeCheck, ChevronRight } from "lucide-react"
import { useMemo } from "react"

import { EmptyState } from "@/components/common/empty-state"
import { PageHeader } from "@/components/common/page-header"
import { Surface } from "@/components/common/surface"
import { ApprovalCard } from "@/components/shifts/order-status"
import { useData, useWorkspace } from "@/hooks/use-app"
import { formatClock, formatDay, timeAgo } from "@/lib/dates"
import { awaitingApproval } from "@/lib/metrics"
import { location, position } from "@/lib/reference"
import type { ShiftGroup } from "@/lib/types"

/** The district approver's inbox: over-budget orders waiting on them, then what they decided recently. Built for a phone. */
export function ApprovalsPage() {
  const data = useData()
  const { ws } = useWorkspace()

  const { pending, decided } = useMemo(() => {
    const mine = data.groups.filter((g) => g.approval && ws.approves?.includes(g.locationId))
    return {
      pending: mine.filter(awaitingApproval).sort((a, b) => b.approval!.requestedAt.localeCompare(a.approval!.requestedAt)),
      decided: mine
        .filter((g) => !awaitingApproval(g))
        .sort((a, b) => (b.approval!.decidedAt ?? "").localeCompare(a.approval!.decidedAt ?? ""))
        .slice(0, 10),
    }
  }, [data.groups, ws.approves])

  if (!ws.approves?.length) {
    return (
      <div className="flex flex-col gap-6 pt-4">
        <PageHeader title="Approvals" />
        <EmptyState icon={BadgeCheck} title="Nothing to approve here" description="Over-budget orders go to the district approver for the location." />
      </div>
    )
  }

  return (
    <div className="mx-auto flex w-full max-w-[640px] flex-col gap-5 pt-4">
      <PageHeader title="Approvals" description="Orders that would take a location over its weekly agency budget. Agencies don't see them until you approve." />
      {pending.length ? (
        <div className="flex flex-col gap-4">
          {pending.map((g) => (
            <OrderItem key={g.id} group={g} />
          ))}
        </div>
      ) : (
        <EmptyState icon={BadgeCheck} title="You're all caught up" description="New over-budget orders will show up here, and you'll get a notification." compact />
      )}
      {decided.length > 0 && (
        <section className="flex flex-col gap-2">
          <h2 className="px-1 text-caption-1 font-semibold tracking-wide text-subtle uppercase">Recently decided</h2>
          <ul className="flex flex-col overflow-hidden rounded-xl border border-border bg-card">
            {decided.map((g) => (
              <li key={g.id} className="border-b border-border last:border-b-0">
                <Link href={`/shifts/${g.id}`} className="group flex items-center gap-3 px-4 py-3 transition-colors duration-100 hover:bg-hover">
                  <span className="flex min-w-0 flex-1 flex-col">
                    <span className="truncate text-body-3 font-semibold">{summary(g)}</span>
                    <span className="truncate text-caption-1 text-faded">
                      {g.approval!.status === "approved" ? "Approved" : "Declined"} {g.approval!.decidedAt ? timeAgo(g.approval!.decidedAt) : ""}
                    </span>
                  </span>
                  <ChevronRight className="size-4 text-subtle transition-transform duration-100 group-hover:translate-x-0.5" />
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  )
}

const summary = (g: ShiftGroup) => `${g.slots.length} ${position(g.positionId).name} · ${location(g.locationId).name}`

function OrderItem({ group }: { group: ShiftGroup }) {
  return (
    <Surface elevated className="flex flex-col gap-3 p-4">
      <Link href={`/shifts/${group.id}`} className="group flex items-start justify-between gap-3">
        <span className="flex min-w-0 flex-col gap-0.5">
          <span className="text-body-1 font-semibold">{summary(group)}</span>
          <span className="text-body-3 text-faded">
            {formatDay(group.date, "EEEE, MMM d")} · {formatClock(group.start)}–{formatClock(group.end)}
            {group.eventName ? ` · ${group.eventName}` : ""}
          </span>
        </span>
        <ChevronRight className="mt-1 size-4 shrink-0 text-subtle transition-transform duration-100 group-hover:translate-x-0.5" />
      </Link>
      <ApprovalCard group={group} compact />
    </Surface>
  )
}
