"use client"

import { useRouter } from "next/navigation"
import { useState } from "react"
import { toast } from "sonner"

import { SupplierLogo } from "@/components/brand/org-avatar"
import { StatusBadge } from "@/components/common/status-badge"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { addDaysISO, todayISO } from "@/lib/dates"
import { CITIES, POSITIONS, SUPPLIERS, city } from "@/lib/reference"
import { CATEGORY, estimatedHours, fiscalYear } from "@/lib/sourcing"
import { useStore } from "@/lib/store"
import { cn } from "@/lib/utils"

export function NewEventDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-xl">{open && <NewEventForm onClose={() => onOpenChange(false)} />}</DialogContent>
    </Dialog>
  )
}

const agenciesIn = (cityId: string) => SUPPLIERS.filter((s) => s.cityIds.includes(cityId)).map((s) => s.id)

function NewEventForm({ onClose }: { onClose: () => void }) {
  const router = useRouter()
  const create = useStore((s) => s.createSourcingEvent)
  const fy = fiscalYear(todayISO())
  const [cityId, setCityId] = useState("atl")
  const [title, setTitle] = useState("")
  const [roles, setRoles] = useState<string[]>(POSITIONS.map((p) => p.id))
  const [agencies, setAgencies] = useState<string[]>(agenciesIn("atl"))
  const [closesOn, setClosesOn] = useState(addDaysISO(todayISO(), 14))
  const [busy, setBusy] = useState(false)
  const defaultTitle = `${fy.label} rate renewal · ${city(cityId).name}`
  const hours = roles.reduce((sum, id) => sum + estimatedHours(id, cityId), 0)

  const toggle = (list: string[], id: string) => (list.includes(id) ? list.filter((x) => x !== id) : [...list, id])

  const submit = async () => {
    setBusy(true)
    const id = await create({ cityId, positionIds: roles, supplierIds: agencies, closesOn, title: title.trim() || undefined })
    setBusy(false)
    if (!id) return
    toast.success(`Invitations sent to ${agencies.length} ${agencies.length === 1 ? "agency" : "agencies"}`, { description: "Each one sees the event in Procurement and bids there." })
    onClose()
    router.push(`/procurement/${id}`)
  }

  return (
    <>
      <DialogHeader>
        <div className="flex items-center gap-2">
          <DialogTitle>New sourcing event</DialogTitle>
          <StatusBadge tone="neutral" size="sm">
            {CATEGORY}
          </StatusBadge>
        </div>
        <DialogDescription>Agencies price each role for {fy.label}. You compare, counter and approve. Approved bids become their rate cards.</DialogDescription>
      </DialogHeader>
      <div className="grid gap-4 sm:grid-cols-[1fr_1.4fr]">
        <label className="flex flex-col gap-1.5">
          <span className="text-body-3 font-semibold">Market</span>
          <Select
            value={cityId}
            onValueChange={(v) => {
              setCityId(v)
              setAgencies(agenciesIn(v))
            }}
          >
            <SelectTrigger className="h-10 w-full rounded-lg">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {CITIES.map((c) => (
                <SelectItem key={c.id} value={c.id}>
                  {c.name}, {c.state}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </label>
        <label className="flex flex-col gap-1.5">
          <span className="text-body-3 font-semibold">Name</span>
          <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder={defaultTitle} className="h-10 rounded-lg" />
        </label>
      </div>
      <div className="flex flex-col gap-2">
        <span className="flex items-baseline justify-between gap-2">
          <span className="text-body-3 font-semibold">Roles to price</span>
          <span className="text-caption-1 text-faded tabular">About {hours.toLocaleString("en-US")} hours a year</span>
        </span>
        <div className="flex flex-wrap gap-1.5">
          {POSITIONS.map((p) => {
            const on = roles.includes(p.id)
            return (
              <button
                key={p.id}
                type="button"
                aria-pressed={on}
                onClick={() => setRoles((r) => toggle(r, p.id))}
                className={cn(
                  "h-8 rounded-lg px-2.5 text-body-3 ring-1 ring-inset transition-colors",
                  on ? "bg-foreground/[0.06] font-medium text-foreground ring-foreground/25" : "text-faded ring-border hover:bg-hover/60",
                )}
              >
                {p.name}
              </button>
            )
          })}
        </div>
      </div>
      <div className="flex flex-col gap-2">
        <span className="text-body-3 font-semibold">Invite</span>
        <div className="grid gap-1.5 sm:grid-cols-2">
          {SUPPLIERS.map((s) => {
            const here = s.cityIds.includes(cityId)
            return (
              <label
                key={s.id}
                className={cn("flex items-center gap-2.5 rounded-lg border border-border px-3 py-2", here ? "cursor-pointer hover:bg-hover/50" : "opacity-50")}
              >
                <Checkbox checked={agencies.includes(s.id)} disabled={!here} onCheckedChange={() => setAgencies((a) => toggle(a, s.id))} />
                <SupplierLogo supplierId={s.id} size="sm" />
                <span className="flex min-w-0 flex-col">
                  <span className="truncate text-body-3 font-medium">{s.name}</span>
                  <span className="text-caption-1 text-faded">{here ? (s.integration === "api" ? "Bids by API or in Iris" : "Bids in Iris") : `Not in ${city(cityId).name}`}</span>
                </span>
              </label>
            )
          })}
        </div>
      </div>
      <label className="flex w-48 flex-col gap-1.5">
        <span className="text-body-3 font-semibold">Bids due</span>
        <Input type="date" value={closesOn} min={addDaysISO(todayISO(), 1)} onChange={(e) => setClosesOn(e.target.value)} className="h-10 rounded-lg" />
      </label>
      <DialogFooter>
        <Button variant="ghost" onClick={onClose}>
          Cancel
        </Button>
        <Button disabled={busy || !roles.length || !agencies.length || !closesOn} onClick={submit}>
          Send invitations
        </Button>
      </DialogFooter>
    </>
  )
}
