"use client"

import { ArrowRight, Check, Plus } from "lucide-react"
import { useMemo, useState } from "react"
import { toast } from "sonner"

import { Tip } from "@/components/common/info-tip"
import { TimeField, snapTime } from "@/components/timesheets/timesheet-bits"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Textarea } from "@/components/ui/textarea"
import { useData } from "@/hooks/use-app"
import { canWork } from "@/lib/compliance"
import { formatClockShort, hhmmFromMinutes, minutesOf, spanMinutes, wallClock } from "@/lib/dates"
import { money } from "@/lib/format"
import { POSITIONS, city, departmentOf, location, position, supplier } from "@/lib/reference"
import { useStore } from "@/lib/store"
import { partAt, splitSpan } from "@/lib/timesheets"
import type { ShiftGroup, Slot } from "@/lib/types"
import { cn } from "@/lib/utils"

/**
 * Moving a worker to another role or department partway through a shift, the way it happens on an event floor:
 * concessions are quiet, so someone goes up to the suites as a barback. Iris checks they're cleared for the new role,
 * prices it from their agency's rate card, charges it to the new department, and keeps the record of what they did when.
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
  const [departmentId, setDepartmentId] = useState<string>()
  const [note, setNote] = useState("")
  const [noting, setNoting] = useState(false)
  const [busy, setBusy] = useState(false)
  if (!pro) return null

  const sinceStart = (hhmm: string) => spanMinutes(group.start, hhmm)
  const part = parts.length ? partAt(parts, at) : undefined
  const lastMove = (slot.moves ?? []).filter((m) => sinceStart(m.at) < sinceStart(at)).at(-1)
  const current = part?.positionId ?? lastMove?.positionId ?? group.positionId
  const currentRate = part?.billRate ?? lastMove?.billRate ?? group.billRate
  const departments = loc.departments ?? []
  const currentDepartment = departmentOf(loc.id, part?.departmentId ?? lastMove?.departmentId ?? group.departmentId, current)
  const cards = data.rateCards.filter((c) => c.supplierId === pro.supplierId && c.cityId === loc.cityId && c.status === "active" && (departments.length > 1 || c.positionId !== current))
  const roles = cards
    .map((c) => ({ card: c, check: canWork(pro, c.positionId, group.date, group.locationId) }))
    .sort((a, b) => Number(b.check.ok) - Number(a.check.ok) || POSITIONS.findIndex((p) => p.id === a.card.positionId) - POSITIONS.findIndex((p) => p.id === b.card.positionId))
  const chosen = roles.find((r) => r.card.positionId === positionId)
  const department = chosen ? (departmentOf(loc.id, departmentId, chosen.card.positionId) ?? currentDepartment) : undefined
  const unchanged = !!chosen && chosen.card.positionId === current && department?.id === currentDepartment?.id
  const where = (role: string, d?: typeof department) => (departments.length && d ? `${position(role).name} in ${d.name}` : position(role).name)
  const outside = parts.length ? !part : spanMinutes(group.start, at) <= 0 || spanMinutes(group.start, at) >= spanMinutes(group.start, group.end)

  const submit = async () => {
    if (!chosen) return
    setBusy(true)
    const result = await moveToRole({ groupId: group.id, slotId: slot.id, positionId: chosen.card.positionId, ...(department ? { departmentId: department.id } : {}), at, note: note.trim() || undefined })
    setBusy(false)
    if (!result) return
    toast.success(`${pro.firstName} is in ${where(chosen.card.positionId, department)} from ${formatClockShort(at)}`, {
      description: result.split ? "Their timesheet is now in two parts, each at its own rate and cost center." : "When the shift ends, Iris splits the timesheet in two.",
    })
    onDone()
  }

  const cleared = roles.filter((r) => r.check.ok)
  const blocked = roles.filter((r) => !r.check.ok)

  return (
    <>
      <DialogHeader>
        <DialogTitle>Move {pro.firstName} to another {departments.length ? "role or department" : "role"}</DialogTitle>
        <DialogDescription>
          {where(current, currentDepartment)} at {loc.name}
        </DialogDescription>
      </DialogHeader>

      <div className="flex flex-col gap-5">
        <div className="flex flex-col gap-1.5">
          <span className="flex items-center justify-between gap-3 text-caption-1 font-semibold text-faded">
            Role
            {blocked.length > 0 && (
              <Tip
                content={
                  <span className="flex flex-col gap-1">
                    {[...Map.groupBy(blocked, (r) => r.check.reason ?? "Not cleared")].map(([reason, rs]) => (
                      <span key={reason}>
                        <span className="font-semibold">{reason}:</span> {rs.map((r) => position(r.card.positionId).name).join(", ")}
                      </span>
                    ))}
                  </span>
                }
              >
                <span className="cursor-default font-normal text-subtle underline decoration-dotted underline-offset-2">Not cleared for {blocked.length} more</span>
              </Tip>
            )}
          </span>
          <ul className="flex max-h-64 flex-col overflow-y-auto rounded-lg border border-border scrollbar-thin">
            {cleared.map(({ card }) => {
              const on = positionId === card.positionId
              const now = card.positionId === current
              return (
                <li key={card.id} className="border-b border-border/70 last:border-0">
                  <button
                    type="button"
                    onClick={() => {
                      setPositionId(card.positionId)
                      setDepartmentId(undefined)
                    }}
                    aria-pressed={on}
                    data-current={now ? "" : undefined}
                    className={cn("flex w-full items-center gap-3 px-3 py-2.5 text-left text-body-3 transition-colors", on ? "bg-primary-faded/70" : "hover:bg-hover")}
                  >
                    <span className={cn("flex size-4 shrink-0 items-center justify-center rounded-full border", on ? "border-primary bg-primary text-primary-foreground" : "border-border-strong")}>
                      {on && <Check className="size-3" />}
                    </span>
                    <span className="min-w-0 flex-1 font-medium">
                      {position(card.positionId).name}
                      {now && <span className="font-normal text-subtle"> · now</span>}
                    </span>
                    <span className="tabular text-faded">{money(card.billRate)}/hr</span>
                  </button>
                </li>
              )
            })}
            {!cleared.length && <li className="px-3 py-4 text-body-3 text-faded">{supplier(pro.supplierId).shortName} has no other rates in {city(loc.cityId).name}.</li>}
          </ul>
        </div>

        {chosen && departments.length > 0 && (
          <div className="flex flex-col gap-1.5" data-tour="move-department">
            <span className="text-caption-1 font-semibold text-faded">Department</span>
            <div className="flex flex-wrap gap-1.5">
              {departments.map((d) => {
                const on = department?.id === d.id
                return (
                  <Tip key={d.id} content={`Cost center ${d.costCenter}`}>
                    <button
                      type="button"
                      onClick={() => setDepartmentId(d.id)}
                      aria-pressed={on}
                      className={cn("inline-flex h-8 items-center rounded-lg border px-3 text-body-3 transition-colors", on ? "border-primary bg-primary-faded/70 font-medium" : "border-border text-faded hover:bg-hover")}
                    >
                      {d.name}
                    </button>
                  </Tip>
                )
              })}
            </div>
          </div>
        )}

        <div className="flex items-end gap-3">
          <div className="w-40">
            <TimeField label="Starting at" value={at} onChange={setAt} />
          </div>
          {!noting && (
            <Button variant="ghost" size="sm" className="mb-0.5 text-faded" onClick={() => setNoting(true)}>
              <Plus className="size-3.5" /> Add a note
            </Button>
          )}
        </div>
        {noting && <Textarea autoFocus value={note} onChange={(e) => setNote(e.target.value)} placeholder="Concessions were quiet; the suite bar needed a barback" className="-mt-2 min-h-9 rounded-lg text-body-3" />}
      </div>

      <DialogFooter className="sm:items-center">
        <p className={cn("mr-auto text-body-3 tabular", outside ? "text-critical-fg" : "text-faded")}>
          {outside ? (
            `Pick a time while ${pro.firstName} was working`
          ) : unchanged ? (
            `That's where ${pro.firstName} is now`
          ) : chosen ? (
            <span className="inline-flex items-center gap-1.5">
              {money(currentRate)}
              <ArrowRight className="size-3.5" />
              <span className="font-semibold text-foreground">{money(chosen.card.billRate)}/hr</span>
              from {formatClockShort(at)}
            </span>
          ) : null}
        </p>
        <Button variant="outline" onClick={onDone}>
          Cancel
        </Button>
        <Button onClick={submit} disabled={!chosen || outside || unchanged || busy} data-tour="move-submit">
          Move {pro.firstName}
        </Button>
      </DialogFooter>
    </>
  )
}
