"use client"

import { ArrowRight, Check } from "lucide-react"
import { useMemo, useState } from "react"
import { toast } from "sonner"

import { StatusBadge } from "@/components/common/status-badge"
import { TimeField, snapTime } from "@/components/timesheets/timesheet-bits"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Textarea } from "@/components/ui/textarea"
import { useData } from "@/hooks/use-app"
import { canWork } from "@/lib/compliance"
import { formatClockShort, hhmmFromMinutes, minutesOf, spanMinutes, wallClock } from "@/lib/dates"
import { money } from "@/lib/format"
import { POSITIONS, city, location, position, supplier } from "@/lib/reference"
import { useStore } from "@/lib/store"
import { partAt, splitSpan } from "@/lib/timesheets"
import type { ShiftGroup, Slot } from "@/lib/types"
import { cn } from "@/lib/utils"

/**
 * Moving a worker to another role partway through a shift, the way it happens on an event floor: concessions are
 * quiet, so someone goes up to the suites as a barback. Iris checks they're cleared for the new role, prices it from
 * their agency's rate card, and keeps the record of what they did when.
 */
export function MoveDialog({ group, slot, open, onOpenChange }: { group: ShiftGroup; slot: Slot; open: boolean; onOpenChange: (open: boolean) => void }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg" data-tour="move-dialog">{open && <MoveBody group={group} slot={slot} onDone={() => onOpenChange(false)} />}</DialogContent>
    </Dialog>
  )
}

function MoveBody({ group, slot, onDone }: { group: ShiftGroup; slot: Slot; onDone: () => void }) {
  const data = useData()
  const moveToRole = useStore((s) => s.moveToRole)
  const pro = data.pros.find((p) => p.id === slot.proId)
  const loc = location(group.locationId)
  const parts = useMemo(
    () => data.timesheets.filter((t) => t.groupId === group.id && t.slotId === slot.id && t.status !== "removed").sort((a, b) => spanMinutes(group.start, splitSpan(a)[0]) - spanMinutes(group.start, splitSpan(b)[0])),
    [data.timesheets, group.id, group.start, slot.id],
  )
  const [at, setAt] = useState(() => {
    if (parts.length) {
      const [from, to] = splitSpan(parts[parts.length - 1])
      return snapTime(hhmmFromMinutes(minutesOf(from) + Math.round(spanMinutes(from, to) / 2)))
    }
    const now = hhmmFromMinutes(wallClock().minutes)
    return spanMinutes(group.start, now) < spanMinutes(group.start, group.end) ? snapTime(now) : snapTime(group.start)
  })
  const [positionId, setPositionId] = useState<string>()
  const [note, setNote] = useState("")
  const [busy, setBusy] = useState(false)
  if (!pro) return null

  const sinceStart = (hhmm: string) => spanMinutes(group.start, hhmm)
  const part = parts.length ? partAt(parts, at) : undefined
  const lastMove = (slot.moves ?? []).filter((m) => sinceStart(m.at) < sinceStart(at)).at(-1)
  const current = part?.positionId ?? lastMove?.positionId ?? group.positionId
  const currentRate = part?.billRate ?? lastMove?.billRate ?? group.billRate
  const cards = data.rateCards.filter((c) => c.supplierId === pro.supplierId && c.cityId === loc.cityId && c.status === "active" && c.positionId !== current)
  const roles = cards
    .map((c) => ({ card: c, check: canWork(pro, c.positionId, group.date, group.locationId) }))
    .sort((a, b) => Number(b.check.ok) - Number(a.check.ok) || POSITIONS.findIndex((p) => p.id === a.card.positionId) - POSITIONS.findIndex((p) => p.id === b.card.positionId))
  const chosen = roles.find((r) => r.card.positionId === positionId)
  const outside = parts.length ? !part : spanMinutes(group.start, at) <= 0 || spanMinutes(group.start, at) >= spanMinutes(group.start, group.end)

  const submit = async () => {
    if (!chosen) return
    setBusy(true)
    const result = await moveToRole({ groupId: group.id, slotId: slot.id, positionId: chosen.card.positionId, at, note: note.trim() || undefined })
    setBusy(false)
    if (!result) return
    toast.success(`${pro.firstName} is a ${position(chosen.card.positionId).name} from ${formatClockShort(at)}`, {
      description: result.split ? "Their timesheet is now in two parts, one per role, each at its own rate." : "When the shift ends, Iris splits the timesheet by role.",
    })
    onDone()
  }

  return (
    <>
      <DialogHeader>
        <DialogTitle>Move {pro.firstName} to another role</DialogTitle>
        <DialogDescription>
          {position(current).name} at {loc.name}. From the time you pick, {supplier(pro.supplierId).shortName} bills the new role&apos;s rate, and the timesheet shows both.
        </DialogDescription>
      </DialogHeader>

      <div className="flex flex-col gap-4">
        <div className="flex flex-col gap-1.5">
          <span className="text-caption-1 font-semibold text-faded">New role</span>
          <ul className="flex max-h-64 flex-col overflow-y-auto rounded-lg border border-border scrollbar-thin">
            {roles.map(({ card, check }) => {
              const on = positionId === card.positionId
              return (
                <li key={card.id} className="border-b border-border/70 last:border-0">
                  <button
                    type="button"
                    disabled={!check.ok}
                    onClick={() => setPositionId(card.positionId)}
                    aria-pressed={on}
                    className={cn("flex w-full items-center gap-3 px-3 py-2.5 text-left text-body-3 transition-colors", on ? "bg-primary-faded/70" : "hover:bg-hover", !check.ok && "cursor-not-allowed opacity-60 hover:bg-transparent")}
                  >
                    <span className={cn("flex size-4 shrink-0 items-center justify-center rounded-full border", on ? "border-primary bg-primary text-primary-foreground" : "border-border-strong")}>
                      {on && <Check className="size-3" />}
                    </span>
                    <span className="min-w-0 flex-1 font-medium">{position(card.positionId).name}</span>
                    {check.ok ? (
                      <span className="tabular text-faded">{money(card.billRate)}/hr</span>
                    ) : (
                      <StatusBadge tone={/expired|missing|pending/i.test(check.reason ?? "") ? "critical" : "neutral"} size="sm">
                        {check.reason}
                      </StatusBadge>
                    )}
                  </button>
                </li>
              )
            })}
            {!roles.length && <li className="px-3 py-4 text-body-3 text-faded">{supplier(pro.supplierId).shortName} has no other rates in {city(loc.cityId).name}.</li>}
          </ul>
        </div>

        <div className="grid gap-3 sm:grid-cols-[160px_1fr]">
          <TimeField label="Starting at" value={at} onChange={setAt} />
          <label className="flex min-w-0 flex-col gap-1.5">
            <span className="text-caption-1 font-semibold text-faded">What happened (optional)</span>
            <Textarea value={note} onChange={(e) => setNote(e.target.value)} placeholder="Concessions were quiet; the suite bar needed a barback" className="min-h-9 rounded-lg text-body-3" />
          </label>
        </div>

        {chosen && !outside && (
          <p className="flex flex-wrap items-center gap-1.5 rounded-lg bg-page-faded px-3 py-2.5 text-body-3">
            <span>
              {position(current).name} at {money(currentRate)}/hr until {formatClockShort(at)}
            </span>
            <ArrowRight className="size-3.5 text-faded" />
            <span className="font-semibold">
              {position(chosen.card.positionId).name} at {money(chosen.card.billRate)}/hr
            </span>
          </p>
        )}
        {outside && <p className="text-body-3 text-critical-fg">Pick a time while {pro.firstName} was working.</p>}
      </div>

      <DialogFooter>
        <Button variant="outline" onClick={onDone}>
          Cancel
        </Button>
        <Button onClick={submit} disabled={!chosen || outside || busy} data-tour="move-submit">
          Move {pro.firstName}
        </Button>
      </DialogFooter>
    </>
  )
}
