"use client"

import { CalendarClock, Mail, Plus, X } from "lucide-react"
import { useState } from "react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { useWorkspace } from "@/hooks/use-app"
import { formatClockShort, formatTimestamp } from "@/lib/dates"
import { CADENCES, cadencePhrase, nextSend } from "@/lib/reports"
import { teamFor } from "@/lib/reference"
import { joinNames, useStore } from "@/lib/store"
import type { ReportSchedule, SavedReport } from "@/lib/types"

const TIMES = ["06:00", "07:00", "08:00", "09:00", "12:00", "17:00"]

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export function ScheduleDialog({ report, open, onOpenChange }: { report: SavedReport; open: boolean; onOpenChange: (open: boolean) => void }) {
  const { ws } = useWorkspace()
  const team = teamFor(ws)
  const scheduleReport = useStore((s) => s.scheduleReport)
  const sendReport = useStore((s) => s.sendReport)
  const [cadence, setCadence] = useState<ReportSchedule["cadence"]>(report.schedule?.cadence ?? "weekly")
  const [time, setTime] = useState(report.schedule?.time ?? "07:00")
  const [recipients, setRecipients] = useState<string[]>(report.schedule?.recipients ?? [ws.user.name])
  const [email, setEmail] = useState("")
  const [busy, setBusy] = useState(false)
  const others = recipients.filter((r) => !team.some((m) => m.name === r))

  const toggle = (name: string, on: boolean) => setRecipients((list) => (on ? [...list, name] : list.filter((x) => x !== name)))
  const addEmail = () => {
    const value = email.trim()
    if (!EMAIL.test(value)) return toast.error("That doesn't look like an email address.")
    if (!recipients.includes(value)) setRecipients((list) => [...list, value])
    setEmail("")
  }

  const save = async () => {
    setBusy(true)
    const ok = await scheduleReport(report.id, { cadence, time, recipients })
    setBusy(false)
    if (!ok) return
    toast.success(`Iris will email “${report.name}” ${cadencePhrase(cadence)} at ${formatClockShort(time)}`)
    onOpenChange(false)
  }

  const stop = async () => {
    setBusy(true)
    const ok = await scheduleReport(report.id, null)
    setBusy(false)
    if (!ok) return
    toast.success(`“${report.name}” is no longer emailed`)
    onOpenChange(false)
  }

  const sendNow = async () => {
    setBusy(true)
    const sent = await sendReport(report.id, recipients)
    setBusy(false)
    if (sent) toast.success(`Sent “${report.name}” to ${joinNames(recipients)}`)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <CalendarClock className="size-5" /> Email this report
          </DialogTitle>
          <DialogDescription>Iris runs it fresh each time and sends the totals, what changed since the last period, and the CSV.</DialogDescription>
        </DialogHeader>

        <div className="grid grid-cols-2 gap-3">
          <label className="flex flex-col gap-1.5">
            <span className="text-caption-1 font-medium text-faded">How often</span>
            <Select value={cadence} onValueChange={(v) => setCadence(v as ReportSchedule["cadence"])}>
              <SelectTrigger className="h-9 w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {CADENCES.map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </label>
          <label className="flex flex-col gap-1.5">
            <span className="text-caption-1 font-medium text-faded">At</span>
            <Select value={time} onValueChange={setTime}>
              <SelectTrigger className="h-9 w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {TIMES.map((t) => (
                  <SelectItem key={t} value={t}>
                    {formatClockShort(t)} CT
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </label>
        </div>

        <div className="flex flex-col gap-1.5">
          <span className="text-caption-1 font-medium text-faded">Send to</span>
          <div className="flex flex-col rounded-lg border border-border">
            {team.map((m) => (
              <label key={m.name} className="flex items-center gap-3 border-b border-border/70 px-3 py-2 last:border-0">
                <Checkbox checked={recipients.includes(m.name)} onCheckedChange={(v) => toggle(m.name, v === true)} />
                <span className="flex min-w-0 flex-col">
                  <span className="text-body-3 font-medium">{m.name}</span>
                  <span className="truncate text-caption-1 text-faded">{m.title}</span>
                </span>
              </label>
            ))}
          </div>
          {others.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {others.map((r) => (
                <span key={r} className="inline-flex items-center gap-1 rounded-md bg-tint-faded px-2 py-1 text-caption-1 font-medium">
                  <Mail className="size-3" /> {r}
                  <button type="button" aria-label={`Remove ${r}`} onClick={() => toggle(r, false)} className="text-faded hover:text-foreground">
                    <X className="size-3" />
                  </button>
                </span>
              ))}
            </div>
          )}
          <div className="flex gap-2">
            <input
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), addEmail())}
              placeholder="Add someone outside your team by email"
              className="h-9 min-w-0 flex-1 rounded-lg border border-input bg-background px-3 text-body-3 outline-none focus:border-foreground/30"
            />
            <Button variant="outline" size="sm" className="h-9" onClick={addEmail} disabled={!email.trim()}>
              <Plus /> Add
            </Button>
          </div>
        </div>

        <p className="text-caption-1 text-faded">
          {recipients.length ? `Next email ${formatTimestamp(nextSend({ cadence, time }).toISOString())}, to ${joinNames(recipients)}.` : "Pick at least one person."}
        </p>

        <DialogFooter className="gap-2 sm:justify-between">
          <div className="flex gap-2">
            {report.schedule && (
              <Button variant="ghost" onClick={stop} disabled={busy}>
                Stop emailing
              </Button>
            )}
            <Button variant="outline" onClick={sendNow} disabled={busy || !recipients.length}>
              Send now
            </Button>
          </div>
          <Button onClick={save} disabled={busy || !recipients.length}>
            Save schedule
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
