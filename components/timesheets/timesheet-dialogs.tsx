"use client"

import { useState } from "react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Textarea } from "@/components/ui/textarea"
import { formatClock, paidHours } from "@/lib/dates"
import { money, round2 } from "@/lib/format"
import { useStore } from "@/lib/store"
import type { Pro, Timesheet } from "@/lib/types"
import { cn } from "@/lib/utils"

const TIMES = Array.from({ length: 288 }, (_, i) => `${String(Math.floor(i / 12)).padStart(2, "0")}:${String((i % 12) * 5).padStart(2, "0")}`)

function TimeField({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-body-3 font-semibold">{label}</span>
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger className="h-10 w-full rounded-lg">
          <SelectValue />
        </SelectTrigger>
        <SelectContent className="max-h-72">
          {TIMES.map((t) => (
            <SelectItem key={t} value={t}>
              {formatClock(t)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </label>
  )
}

const snap = (t?: string) => {
  if (!t) return "09:00"
  const [h, m] = t.split(":").map(Number)
  return `${String(h).padStart(2, "0")}:${String(Math.round(m / 5) * 5 === 60 ? 55 : Math.round(m / 5) * 5).padStart(2, "0")}`
}

export function EditHoursDialog({ ts, pro, onOpenChange }: { ts?: Timesheet; pro?: Pro; onOpenChange: (open: boolean) => void }) {
  return (
    <Dialog open={!!ts} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">{ts && <EditHoursForm key={ts.id} ts={ts} pro={pro} onClose={() => onOpenChange(false)} />}</DialogContent>
    </Dialog>
  )
}

function EditHoursForm({ ts, pro, onClose }: { ts: Timesheet; pro?: Pro; onClose: () => void }) {
  const adjust = useStore((s) => s.adjustTimesheet)
  const [clockIn, setClockIn] = useState(() => snap(ts.clockIn ?? ts.scheduledStart))
  const [clockOut, setClockOut] = useState(() => snap(ts.clockOut ?? ts.scheduledEnd))
  const [breakMins, setBreak] = useState(ts.breakMins)
  const [reason, setReason] = useState("Pro clocked in late")
  const next = paidHours(clockIn, clockOut, breakMins)
  const delta = round2(next - ts.hours)
  return (
    <>
      <DialogHeader>
        <DialogTitle>Edit hours</DialogTitle>
        <DialogDescription>
          {pro ? `${pro.firstName} ${pro.lastName}` : "Pro"} · scheduled {formatClock(ts.scheduledStart)} - {formatClock(ts.scheduledEnd)}. The supplier sees your change and the reason.
        </DialogDescription>
      </DialogHeader>
      <div className="grid grid-cols-2 gap-3">
        <TimeField label="Clock-in" value={clockIn} onChange={setClockIn} />
        <TimeField label="Clock-out" value={clockOut} onChange={setClockOut} />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <label className="flex flex-col gap-1.5">
          <span className="text-body-3 font-semibold">Break (mins)</span>
          <Select value={String(breakMins)} onValueChange={(v) => setBreak(Number(v))}>
            <SelectTrigger className="h-10 w-full rounded-lg">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {[0, 15, 30, 45, 60].map((m) => (
                <SelectItem key={m} value={String(m)}>
                  {m}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </label>
        <label className="flex flex-col gap-1.5">
          <span className="text-body-3 font-semibold">Reason</span>
          <Select value={reason} onValueChange={setReason}>
            <SelectTrigger className="h-10 w-full rounded-lg">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {["Pro clocked in late", "Pro left early", "Forgot to clock out", "Break not recorded", "Other"].map((r) => (
                <SelectItem key={r} value={r}>
                  {r}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </label>
      </div>
      <div className="flex items-center justify-between rounded-lg bg-page-faded px-4 py-3 text-body-3">
        <span>
          {ts.hours} hrs → <span className="font-bold">{next} hrs</span>
        </span>
        <span className={cn("font-semibold tabular", delta < 0 ? "text-positive-fg" : delta > 0 ? "text-critical-fg" : "text-faded")}>
          {delta === 0 ? "No change" : `${delta > 0 ? "+" : "−"}${money(Math.abs(delta * ts.billRate))}`}
        </span>
      </div>
      <DialogFooter>
        <Button variant="outline" onClick={onClose}>
          Cancel
        </Button>
        <Button
          disabled={next <= 0}
          onClick={() => {
            adjust(ts.id, { clockIn, clockOut, breakMins, reason })
            toast.success("Hours updated", { description: `${next} hrs. You can approve it now.` })
            onClose()
          }}
        >
          Save hours
        </Button>
      </DialogFooter>
    </>
  )
}

export function DisputeDialog({ ts, pro, onOpenChange }: { ts?: Timesheet; pro?: Pro; onOpenChange: (open: boolean) => void }) {
  const dispute = useStore((s) => s.disputeTimesheet)
  const [reason, setReason] = useState("Hours above schedule")
  const [note, setNote] = useState("")
  return (
    <Dialog
      open={!!ts}
      onOpenChange={(o) => {
        if (!o) setNote("")
        onOpenChange(o)
      }}
    >
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Dispute hours</DialogTitle>
          <DialogDescription>
            {pro ? `${pro.firstName} ${pro.lastName}` : "This timesheet"} goes back to the supplier. It can&apos;t be invoiced until it&apos;s resolved.
          </DialogDescription>
        </DialogHeader>
        <label className="flex flex-col gap-1.5">
          <span className="text-body-3 font-semibold">Reason</span>
          <Select value={reason} onValueChange={setReason}>
            <SelectTrigger className="h-10 w-full rounded-lg">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {["Hours above schedule", "Pro didn't work the full shift", "Wrong Pro on the timesheet", "Pro was a no-show", "Other"].map((r) => (
                <SelectItem key={r} value={r}>
                  {r}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </label>
        <label className="flex flex-col gap-1.5">
          <span className="text-body-3 font-semibold">Note for the supplier</span>
          <Textarea value={note} onChange={(e) => setNote(e.target.value)} placeholder="Our supervisor saw them leave at 10:15pm." className="min-h-20 rounded-lg text-body-3" />
        </label>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            className="bg-critical hover:bg-critical/90"
            onClick={() => {
              if (!ts) return
              dispute(ts.id, reason, note || undefined)
              toast("Dispute sent", { description: "The supplier will confirm or correct the hours." })
              onOpenChange(false)
            }}
          >
            Send dispute
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export function RespondDialog({ ts, pro, onOpenChange }: { ts?: Timesheet; pro?: Pro; onOpenChange: (open: boolean) => void }) {
  const respond = useStore((s) => s.respondDispute)
  const [action, setAction] = useState<"accept" | "confirm">("accept")
  const [note, setNote] = useState("")
  const scheduled = ts ? paidHours(ts.scheduledStart, ts.scheduledEnd, ts.breakMins) : 0
  return (
    <Dialog
      open={!!ts}
      onOpenChange={(o) => {
        if (!o) setNote("")
        onOpenChange(o)
      }}
    >
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Respond to dispute</DialogTitle>
          <DialogDescription>
            {ts?.dispute?.raisedBy} questioned {pro ? `${pro.firstName}'s` : "these"} hours: {ts?.dispute?.reason?.toLowerCase()}.
          </DialogDescription>
        </DialogHeader>
        {ts?.dispute?.note && <p className="rounded-lg bg-page-faded px-3 py-2 text-body-3 text-faded">“{ts.dispute.note}”</p>}
        <div className="flex flex-col gap-2">
          {(
            [
              { value: "accept", title: `Correct to scheduled hours (${scheduled} hrs)`, sub: `Down from ${ts?.hours} hrs. Resubmits for approval.` },
              { value: "confirm", title: `Confirm ${ts?.hours} hrs are right`, sub: "Add a note so the buyer can approve with confidence." },
            ] as const
          ).map((o) => (
            <button
              key={o.value}
              type="button"
              onClick={() => setAction(o.value)}
              className={cn("flex items-start gap-3 rounded-lg border p-3 text-left transition-colors", action === o.value ? "border-primary bg-primary-faded/40" : "border-border hover:bg-hover")}
            >
              <span className={cn("mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-full border-2", action === o.value ? "border-primary" : "border-border-strong")}>
                {action === o.value && <span className="size-2 rounded-full bg-primary" />}
              </span>
              <span className="flex flex-col">
                <span className="text-body-3 font-semibold">{o.title}</span>
                <span className="text-caption-1 text-faded">{o.sub}</span>
              </span>
            </button>
          ))}
        </div>
        {action === "confirm" && <Textarea value={note} onChange={(e) => setNote(e.target.value)} placeholder="Pro stayed for teardown at the supervisor's request." className="min-h-16 rounded-lg text-body-3" />}
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            onClick={() => {
              if (!ts) return
              respond(ts.id, action, note || undefined)
              toast.success("Response sent", { description: "The timesheet is back with the buyer for approval." })
              onOpenChange(false)
            }}
          >
            Send response
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
