"use client"

import { AlertTriangle, CheckCircle2 } from "lucide-react"
import { useMemo } from "react"

import { Tip } from "@/components/common/info-tip"
import { StatusBadge, type Tone } from "@/components/common/status-badge"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { formatClock, formatClockShort, formatTimestamp } from "@/lib/dates"
import { round2 } from "@/lib/format"
import { STATUS_LABEL, timesheetChecks, type TimesheetCheck } from "@/lib/timesheets"
import type { ClockRecord, Invoice, PersonaKind, Timesheet, TimesheetAction, TimesheetChange, TimesheetStatus } from "@/lib/types"
import { cn } from "@/lib/utils"

const TONE: Record<PersonaKind, Record<TimesheetStatus, Tone>> = {
  buyer: { draft: "neutral", pending_approval: "warning", approved: "positive", rejected: "critical", invoiced: "neutral", removed: "neutral" },
  supplier: { draft: "warning", pending_approval: "neutral", approved: "positive", rejected: "critical", invoiced: "neutral", removed: "neutral" },
  compass: { draft: "neutral", pending_approval: "neutral", approved: "positive", rejected: "critical", invoiced: "neutral", removed: "neutral" },
}

const MEANING: Record<PersonaKind, Record<TimesheetStatus, string>> = {
  buyer: {
    draft: "With the agency. It hasn't been submitted yet.",
    pending_approval: "Waiting for your approval.",
    approved: "Approved. It goes on the agency's invoice when the week closes.",
    rejected: "Sent back to the agency with a reason.",
    invoiced: "On an invoice, so it can't change.",
    removed: "Taken out of billing. It bills nothing.",
  },
  supplier: {
    draft: "Check the times and submit it for approval.",
    pending_approval: "With the buyer for approval. Withdraw it to make a change.",
    approved: "Approved. It goes on your invoice when the week closes.",
    rejected: "The buyer sent it back. Fix it and resubmit.",
    invoiced: "On an invoice, so it can't change.",
    removed: "Taken out of billing. It bills nothing.",
  },
  compass: {
    draft: "The agency hasn't submitted it yet.",
    pending_approval: "Waiting for the buyer's approval.",
    approved: "Approved. It goes on the agency's invoice when the week closes.",
    rejected: "Sent back to the agency with a reason.",
    invoiced: "On an invoice, so it can't change.",
    removed: "Taken out of billing. It bills nothing.",
  },
}

export function TimesheetStatusBadge({ t, kind, size = "md" }: { t: Timesheet; kind: PersonaKind; size?: "sm" | "md" }) {
  return (
    <Tip content={t.status === "rejected" && t.rejection ? `${MEANING[kind].rejected} ${t.rejection.reason}.` : MEANING[kind][t.status]}>
      <span>
        <StatusBadge tone={TONE[kind][t.status]} size={size}>
          {STATUS_LABEL[t.status]}
        </StatusBadge>
      </span>
    </Tip>
  )
}

export const CLOCK_SOURCE: Record<ClockRecord["source"], string> = { instawork_app: "Instawork app", iris_checkin: "Iris check-in" }

export const timeRange = (from?: string, to?: string) => (from || to ? `${from ? formatClock(from) : "--"} – ${to ? formatClock(to) : "--"}` : "--")

/** "4pm – 12:30am", for tables. */
export const shortRange = (from?: string, to?: string) => (from || to ? `${from ? formatClockShort(from) : "--"} – ${to ? formatClockShort(to) : "--"}` : "--")

export function ChecksCell({ checks }: { checks: TimesheetCheck[] }) {
  if (!checks.length) {
    return (
      <Tip content="Matches the clock and the schedule.">
        <span className="inline-flex items-center gap-1 text-caption-1 text-positive-fg">
          <CheckCircle2 className="size-3.5" /> Clean
        </span>
      </Tip>
    )
  }
  return (
    <Tip
      content={
        <span className="flex flex-col gap-1">
          {checks.map((c) => (
            <span key={c.id}>
              <span className="font-semibold">{c.label}.</span> {c.detail}
            </span>
          ))}
        </span>
      }
    >
      <span className="inline-flex items-center gap-1 text-caption-1 font-semibold text-warning-fg">
        <AlertTriangle className="size-3.5" />
        {checks[0].label}
        {checks.length > 1 && <span className="font-medium text-faded">+{checks.length - 1}</span>}
      </span>
    </Tip>
  )
}

/** Hours with the overtime part called out. */
export function HoursCell({ t }: { t: Timesheet }) {
  return (
    <span className="flex flex-col items-end">
      <span className="font-semibold tabular">{t.hours.toFixed(2)}</span>
      {t.otHours > 0 && <span className="text-caption-1 text-warning-fg tabular">{round2(t.otHours).toFixed(2)} OT</span>}
      {t.sentHome && <span className="text-caption-1 text-faded">4-hr minimum</span>}
    </span>
  )
}

/** Checks for every timesheet, with each worker's other timesheets in view so a double billing shows. */
export function useTimesheetChecks(timesheets: Timesheet[]) {
  return useMemo(() => {
    const byPro = new Map<string, Timesheet[]>()
    for (const t of timesheets) byPro.set(t.proId, [...(byPro.get(t.proId) ?? []), t])
    return new Map(timesheets.map((t) => [t.id, t.status === "invoiced" || t.status === "removed" ? [] : timesheetChecks(t, byPro.get(t.proId))]))
  }, [timesheets])
}

const TIMES = Array.from({ length: 288 }, (_, i) => `${String(Math.floor(i / 12)).padStart(2, "0")}:${String((i % 12) * 5).padStart(2, "0")}`)

export const snapTime = (t?: string, fallback = "09:00") => {
  if (!t) return fallback
  const [h, m] = t.split(":").map(Number)
  const five = Math.round(m / 5) * 5
  return `${String(five === 60 ? (h + 1) % 24 : h).padStart(2, "0")}:${String(five === 60 ? 0 : five).padStart(2, "0")}`
}

export function TimeField({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  const options = TIMES.includes(value) ? TIMES : [...TIMES, value].sort()
  return (
    <label className="flex min-w-0 flex-col gap-1.5">
      <span className="text-caption-1 font-semibold text-faded">{label}</span>
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger className="h-9 w-full rounded-lg">
          <SelectValue />
        </SelectTrigger>
        <SelectContent className="max-h-72">
          {options.map((t) => (
            <SelectItem key={t} value={t}>
              {formatClock(t)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </label>
  )
}

export function BreakField({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  const options = [0, 15, 30, 45, 60, 90].includes(value) ? [0, 15, 30, 45, 60, 90] : [0, 15, 30, 45, 60, 90, value].sort((a, b) => a - b)
  return (
    <label className="flex min-w-0 flex-col gap-1.5">
      <span className="text-caption-1 font-semibold text-faded">Break</span>
      <Select value={String(value)} onValueChange={(v) => onChange(Number(v))}>
        <SelectTrigger className="h-9 w-full rounded-lg">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {options.map((m) => (
            <SelectItem key={m} value={String(m)}>
              {m ? `${m} min` : "No break"}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </label>
  )
}

const ACTION: Record<TimesheetAction, string> = {
  created: "Created",
  submitted: "Submitted",
  withdrawn: "Withdrawn to Draft",
  edited: "Edited",
  corrected: "Corrected",
  approved: "Approved",
  rejected: "Rejected",
  removed: "Removed",
  invoiced: "Invoiced",
}

const DOT: Partial<Record<TimesheetAction, string>> = {
  approved: "bg-positive",
  invoiced: "bg-positive",
  rejected: "bg-critical",
  corrected: "bg-warning",
  removed: "bg-border-strong",
}

/** Older timesheets carry their dates instead of a full history; this rebuilds the same timeline from them. */
function derived(t: Timesheet, invoice?: Invoice): TimesheetChange[] {
  const entries: TimesheetChange[] = []
  if (t.submittedAt) entries.push({ at: t.submittedAt, by: t.source === "app" ? "Agency app" : "Agency", action: "submitted" })
  if (t.approvedAt) entries.push({ at: t.approvedAt, by: t.approvedBy ?? "Buyer", action: "approved" })
  if (invoice) entries.push({ at: `${invoice.issuedOn}T07:00:00.000Z`, by: "Iris", action: "invoiced", note: invoice.number })
  return entries
}

const billedLine = (b?: { clockIn?: string; clockOut?: string; breakMins: number; hours: number }) =>
  b ? `${timeRange(b.clockIn, b.clockOut)}, ${b.breakMins ? `${b.breakMins} min break` : "no break"}, ${b.hours} hrs` : ""

export function TimesheetHistory({ t, invoice }: { t: Timesheet; invoice?: Invoice }) {
  const entries = (t.history.length ? t.history : derived(t, invoice)).slice().reverse()
  if (!entries.length) return null
  return (
    <ol className="flex flex-col">
      {entries.map((e, i) => (
        <li key={`${e.at}-${i}`} className="relative flex gap-3 pb-4 last:pb-0">
          {i < entries.length - 1 && <span className="absolute top-3 left-[3.5px] h-full w-px bg-border" />}
          <span className={cn("relative mt-1.5 size-2 shrink-0 rounded-full", DOT[e.action] ?? "bg-primary")} />
          <span className="flex min-w-0 flex-col gap-0.5">
            <span className="text-body-3">
              <span className="font-semibold">{ACTION[e.action]}</span> by {e.by}
            </span>
            {e.from && e.to && (
              <span className="text-caption-1 text-faded">
                {billedLine(e.from)} → <span className="font-medium text-foreground">{billedLine(e.to)}</span>
              </span>
            )}
            {(e.reason || e.note) && <span className="text-caption-1 text-faded">{[e.reason, e.note].filter(Boolean).join(". ")}</span>}
            <span className="text-caption-2 text-subtle">{formatTimestamp(e.at)}</span>
          </span>
        </li>
      ))}
    </ol>
  )
}
