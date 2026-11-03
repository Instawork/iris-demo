"use client"

import { Check, Clock, Send, X } from "lucide-react"
import { useState } from "react"
import { toast } from "sonner"

import { Surface } from "@/components/common/surface"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import { useWorkspace } from "@/hooks/use-app"
import { formatDateShort, formatTimestamp, timeAgo } from "@/lib/dates"
import { releaseSummary } from "@/lib/domain/order"
import { moneyWhole } from "@/lib/format"
import { awaitingApproval, filledCount, groupPhase } from "@/lib/metrics"
import { approversFor, location, policyFor, position, supplier } from "@/lib/reference"
import { joinNames, useStore } from "@/lib/store"
import type { ShiftGroup } from "@/lib/types"
import { cn } from "@/lib/utils"

const overText = (g: ShiftGroup) => `${Math.round((g.approval?.overPct ?? 0) * 100)}%`

/** The approval decision for an over-budget order. The district approver decides; everyone else sees who it's waiting on. */
export function ApprovalCard({ group, compact }: { group: ShiftGroup; compact?: boolean }) {
  const { ws } = useWorkspace()
  const decide = useStore((s) => s.decideApproval)
  const [note, setNote] = useState("")
  const [busy, setBusy] = useState<"approve" | "decline">()
  const a = group.approval
  if (!a) return null
  const canDecide = awaitingApproval(group) && !!ws.approves?.includes(group.locationId)
  const loc = location(group.locationId)
  const approvers = joinNames(approversFor(group.locationId).map((w) => w.user.name))

  const run = async (decision: "approve" | "decline") => {
    setBusy(decision)
    const n = await decide([group.id], decision, note.trim() || undefined)
    setBusy(undefined)
    if (!n) return
    const updated = useStore.getState().data.groups.find((g) => g.id === group.id)
    const release = updated && releaseSummary(updated)
    toast.success(decision === "decline" ? "Declined. The buyer has been told." : release ? `Approved. ${release}.` : "Approved.", {
      description: `${group.slots.length} ${position(group.positionId).name} spots at ${loc.name}`,
    })
  }

  if (a.status === "approved") {
    return compact ? null : (
      <p className="flex items-center gap-2 rounded-lg bg-positive-faded px-3 py-2 text-caption-1 text-positive-fg">
        <Check className="size-3.5" /> Approved by {a.decidedBy} {a.decidedAt ? timeAgo(a.decidedAt) : ""}, {overText(group)} over the week&apos;s budget
      </p>
    )
  }

  if (a.status === "declined") {
    return (
      <Surface elevated className="flex flex-col gap-1 border-critical-border/70 bg-critical-faded p-4">
        <span className="text-body-3 font-semibold text-critical-fg">Declined by {a.decidedBy}</span>
        <span className="text-caption-1 text-faded">{a.note ? `"${a.note}"` : "No reason given."} Agencies never saw this order.</span>
      </Surface>
    )
  }

  return (
    <Surface elevated className="flex flex-col gap-3 border-warning-border/80 bg-warning-faded p-4" data-tour="approval">
      <div className="flex flex-col gap-1">
        <span className="text-body-2 font-semibold">{canDecide ? "Needs your approval" : `Waiting for ${approvers}`}</span>
        <span className="text-body-3 text-faded">
          {overText(group)} over {loc.name}&apos;s budget for the week of {formatDateShort(a.weekStart)}: {moneyWhole(a.committed)} committed of {moneyWhole(a.budget)}, and this order adds{" "}
          {moneyWhole(a.estimate)}.
        </span>
        <span className="text-caption-1 text-subtle">
          Requested by {a.requestedBy} {timeAgo(a.requestedAt)}. Agencies don&apos;t see it until it&apos;s approved.
        </span>
      </div>
      {canDecide && (
        <>
          <Textarea value={note} onChange={(e) => setNote(e.target.value)} placeholder="Note for the buyer (optional)" className="min-h-16 bg-background" />
          <div className={cn("flex gap-2", compact && "flex-col sm:flex-row")}>
            <Button className="h-10 min-h-10 w-full gap-1.5 rounded-lg font-semibold sm:w-auto sm:flex-1" disabled={!!busy} onClick={() => run("approve")}>
              <Check className="size-4" /> {busy === "approve" ? "Approving…" : "Approve"}
            </Button>
            <Button variant="outline" className="h-10 min-h-10 w-full gap-1.5 rounded-lg bg-background sm:w-auto sm:flex-1" disabled={!!busy} onClick={() => run("decline")}>
              <X className="size-4" /> Decline
            </Button>
          </div>
        </>
      )}
    </Surface>
  )
}

/** Where the order is in its release: held for the sector's lead time, or the next agency in line, with a way to release early. */
export function ReleaseCard({ group }: { group: ShiftGroup }) {
  const { ws } = useWorkspace()
  const releaseNext = useStore((s) => s.releaseNextTier)
  const [busy, setBusy] = useState(false)
  if (awaitingApproval(group) || group.cancelledAt || groupPhase(group) !== "upcoming" || filledCount(group) >= group.slots.length) return null
  const next = (group.supplierReleases ?? []).find((r) => !group.supplierIds.includes(r.supplierId))
  if (!next) return null
  const held = group.supplierIds.length === 0
  const policy = policyFor(group.buyerId)
  const canRelease = ws.kind === "compass" || (ws.kind === "buyer" && ws.buyerId === group.buyerId)
  const name = supplier(next.supplierId).shortName

  const run = async () => {
    setBusy(true)
    const id = await releaseNext(group.id)
    setBusy(false)
    if (id) toast.success(`Released to ${supplier(id).shortName}`, { description: "They can staff it now." })
  }

  return (
    <Surface elevated className="flex flex-col gap-3 p-4">
      <div className="flex items-start gap-3">
        <span className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-full bg-tint-faded">
          <Clock className="size-4 text-faded" />
        </span>
        <span className="flex flex-col gap-0.5">
          <span className="text-body-3 font-semibold">{held ? `Held until ${formatTimestamp(next.releasedAt)}` : `${name} gets it ${formatTimestamp(next.releasedAt)}`}</span>
          <span className="text-caption-1 text-faded">
            {held
              ? `${policy.sector} releases orders ${policy.releaseLeadHours} hours before the shift. ${name} sees it first.`
              : `If spots are still open then, ${name} is next, by rate.`}
          </span>
        </span>
      </div>
      {canRelease && (
        <Button variant="outline" className="h-9 gap-1.5 self-start rounded-lg" disabled={busy} onClick={run}>
          <Send className="size-4" /> Release to {name} now
        </Button>
      )}
    </Surface>
  )
}
