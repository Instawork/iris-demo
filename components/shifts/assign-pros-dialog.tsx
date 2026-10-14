"use client"

import { Check, Search, ShieldAlert, Star } from "lucide-react"
import { useMemo, useState } from "react"
import { toast } from "sonner"

import { ProAvatar } from "@/components/common/pro-avatar"
import { StatusBadge } from "@/components/common/status-badge"
import { Tip } from "@/components/common/info-tip"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { useData, useWorkspace } from "@/hooks/use-app"
import { canWork } from "@/lib/compliance"
import { formatDateLong, formatInterval } from "@/lib/dates"
import { filledCount } from "@/lib/metrics"
import { city, location, position } from "@/lib/reference"
import { eligiblePros, useStore } from "@/lib/store"
import type { ShiftGroup } from "@/lib/types"
import { cn } from "@/lib/utils"

/** Supplier-side placement. Only compliant, available Pros can be picked; everyone else shows why not. */
export function AssignProsDialog({ group, open, onOpenChange }: { group: ShiftGroup; open: boolean; onOpenChange: (open: boolean) => void }) {
  const data = useData()
  const { ws } = useWorkspace()
  const supplierId = ws.supplierId ?? group.supplierId
  const assignPros = useStore((s) => s.assignPros)
  const [query, setQuery] = useState("")
  const [picked, setPicked] = useState<string[]>([])
  const open_ = group.slots.length - filledCount(group)
  const loc = location(group.locationId)

  const rows = useMemo(() => {
    const eligible = new Set(eligiblePros(data, group, supplierId).map((p) => p.id))
    const busy = new Set<string>()
    for (const g of data.groups) if (g.date === group.date && !g.cancelledAt) for (const s of g.slots) if (s.proId) busy.add(s.proId)
    const onThis = new Set(group.slots.map((s) => s.proId).filter(Boolean) as string[])
    return data.pros
      .filter((p) => p.supplierId === supplierId && p.cityId === loc.cityId && p.positionIds.includes(group.positionId))
      .filter((p) => `${p.firstName} ${p.lastName} ${p.code}`.toLowerCase().includes(query.toLowerCase()))
      .map((p) => {
        let reason: string | undefined
        if (onThis.has(p.id)) reason = "Already on this shift"
        else if (!eligible.has(p.id)) {
          const check = canWork(p, group.positionId, group.date)
          reason = !check.ok ? check.reason : busy.has(p.id) ? "Booked elsewhere that day" : "Blocked by this buyer"
        }
        return { pro: p, reason }
      })
      .sort((a, b) => Number(!!a.reason) - Number(!!b.reason) || b.pro.rating - a.pro.rating)
  }, [data, group, loc.cityId, query, supplierId])

  const toggle = (id: string) =>
    setPicked((cur) => (cur.includes(id) ? cur.filter((x) => x !== id) : cur.length >= open_ ? cur : [...cur, id]))

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) setPicked([])
        onOpenChange(o)
      }}
    >
      <DialogContent className="gap-0 p-0 sm:max-w-lg">
        <DialogHeader className="gap-1 border-b border-border px-5 pt-5 pb-4">
          <DialogTitle className="text-featured-3 font-bold">Assign Pros</DialogTitle>
          <DialogDescription className="text-body-3">
            {position(group.positionId).name} · {loc.name} · {formatDateLong(group.date)} · {formatInterval(group.start, group.end, city(loc.cityId).tz)}
          </DialogDescription>
          <div className="mt-2 flex h-9 items-center gap-2 rounded-lg border border-input px-3">
            <Search className="size-4 text-subtle" />
            <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search your Pros" className="w-full bg-transparent text-body-3 outline-none placeholder:text-subtle" />
          </div>
        </DialogHeader>
        <div className="max-h-[52svh] overflow-y-auto px-2 py-2 scrollbar-thin">
          {rows.map(({ pro, reason }) => {
            const on = picked.includes(pro.id)
            const disabled = !!reason || (!on && picked.length >= open_)
            const row = (
              <button
                key={pro.id}
                type="button"
                disabled={disabled}
                onClick={() => toggle(pro.id)}
                className={cn(
                  "flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left transition-colors",
                  on ? "bg-primary-faded/70" : "hover:bg-hover",
                  disabled && !on && "cursor-not-allowed opacity-55 hover:bg-transparent",
                )}
              >
                <span className={cn("flex size-5 shrink-0 items-center justify-center rounded-md border transition-colors", on ? "border-primary bg-primary text-primary-foreground" : "border-border-strong")}>
                  {on && <Check className="size-3.5" />}
                </span>
                <ProAvatar pro={pro} size="sm" ring />
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="truncate text-body-3 font-semibold">
                    {pro.firstName} {pro.lastName}
                  </span>
                  <span className="flex items-center gap-1 text-caption-1 text-faded">
                    <Star className="size-3 fill-warning text-warning" />
                    {pro.rating ? pro.rating.toFixed(2) : "New"} · {pro.shiftsWorked} shifts · {pro.code}
                  </span>
                </span>
                {reason ? (
                  <StatusBadge tone={reason.includes("expired") || reason.includes("missing") || reason.includes("pending") || reason.includes("onboarding") ? "critical" : "neutral"} size="sm">
                    {reason}
                  </StatusBadge>
                ) : (
                  <StatusBadge tone="positive" size="sm">
                    Ready
                  </StatusBadge>
                )}
              </button>
            )
            return reason?.toLowerCase().includes("expired") || reason?.toLowerCase().includes("missing") || reason?.toLowerCase().includes("pending") ? (
              <Tip key={pro.id} content={<span className="flex items-center gap-1.5"><ShieldAlert className="size-3.5" />CrUber blocks placement until compliance is fixed.</span>}>
                <div>{row}</div>
              </Tip>
            ) : (
              row
            )
          })}
          {rows.length === 0 && <p className="px-3 py-8 text-center text-body-3 text-faded">No Pros with this position in {city(loc.cityId).name}.</p>}
        </div>
        <DialogFooter className="mx-0 mb-0 items-center px-5 py-3 sm:justify-between">
          <span className="text-caption-1 text-faded">
            {picked.length} of {open_} open spot{open_ === 1 ? "" : "s"} selected
          </span>
          <Button
            className="h-9 rounded-lg px-4 font-semibold"
            disabled={!picked.length}
            onClick={() => {
              const n = assignPros(group.id, picked)
              toast.success(`${n} Pro${n === 1 ? "" : "s"} assigned`, { description: `${position(group.positionId).name} at ${loc.name}` })
              setPicked([])
              onOpenChange(false)
            }}
          >
            Assign {picked.length || ""} Pro{picked.length === 1 ? "" : "s"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
