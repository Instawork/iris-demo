"use client"

import Link from "next/link"
import { AlertTriangle, ArrowRight, ArrowRightLeft, Check, Pencil, Send, Trash2, Undo2, X } from "lucide-react"
import { useMemo, useState } from "react"
import { toast } from "sonner"

import { SupplierLogo } from "@/components/brand/org-avatar"
import { ProAvatar } from "@/components/common/pro-avatar"
import { MoveDialog } from "@/components/shifts/move-dialog"
import { BreakField, CLOCK_SOURCE, TimeField, TimesheetHistory, TimesheetStatusBadge, snapTime, timeRange, useTimesheetChecks } from "@/components/timesheets/timesheet-bits"
import { Button } from "@/components/ui/button"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { Textarea } from "@/components/ui/textarea"
import { useData, useWorkspace } from "@/hooks/use-app"
import { addDaysISO, formatClock, formatDateLong, formatDateShort, timeAgo, todayISO, weekEndISO, weekStartISO } from "@/lib/dates"
import type { ApproveResult } from "@/lib/domain/commands"
import { fullName, money, plural, round2 } from "@/lib/format"
import { location, position, supplier } from "@/lib/reference"
import { useStore, type TimesInput } from "@/lib/store"
import { OVERTIME_RATE, clockHours, hoursFor, laborAmount, primaryProposal, scheduledHours, timesheetAmount, weekClosed, type Proposal } from "@/lib/timesheets"
import type { Timesheet } from "@/lib/types"
import { cn } from "@/lib/utils"

type Mode = "idle" | "reject" | "as_billed" | "correct" | "edit" | "remove"

const REJECT_REASONS = ["Hours above the clock", "Hours above the schedule", "Missing or wrong punch", "Didn't work this shift", "Wrong worker", "Other"]
const AS_BILLED_REASONS = ["Asked to stay by the supervisor", "The clock missed a punch", "Overtime was approved", "Other"]
const CORRECT_REASONS = ["Matched to the supervisor's log", "Matched to the clock", "Matched to the schedule", "Other"]
const REMOVE_REASONS = ["Didn't work this shift", "Duplicate timesheet", "Other"]

/** One timesheet: the three sets of times side by side, Iris's checks, the history, and what this persona can do. */
export function TimesheetSheet({ id, onOpenChange }: { id?: string; onOpenChange: (open: boolean) => void }) {
  const t = useStore((s) => (id ? s.data.timesheets.find((x) => x.id === id) : undefined))
  return (
    <Sheet open={!!t} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="gap-0 overflow-y-auto p-0 data-[side=right]:w-full data-[side=right]:sm:max-w-lg" data-tour="timesheet-sheet">
        {t && <Body key={t.id} t={t} onDone={() => onOpenChange(false)} />}
      </SheetContent>
    </Sheet>
  )
}

function ReasonSelect({ value, onChange, options }: { value: string; onChange: (v: string) => void; options: string[] }) {
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger className="h-9 w-full rounded-lg">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {options.map((r) => (
          <SelectItem key={r} value={r}>
            {r}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}

function Panel({ title, children, className }: { title?: string; children: React.ReactNode; className?: string }) {
  return (
    <div className={cn("flex flex-col gap-3 rounded-xl border border-border bg-page-faded p-4", className)}>
      {title && <span className="text-body-3 font-semibold">{title}</span>}
      {children}
    </div>
  )
}

function Body({ t, onDone }: { t: Timesheet; onDone: () => void }) {
  const data = useData()
  const { ws } = useWorkspace()
  const { approveTimesheets, correctTimesheet, rejectTimesheets, submitTimesheets, withdrawTimesheets, editTimesheet, removeTimesheet } = useStore.getState()
  const kind = ws.kind
  const pro = data.pros.find((p) => p.id === t.proId)
  const loc = location(t.locationId)
  const sup = supplier(t.supplierId)
  const invoice = t.invoiceId ? data.invoices.find((i) => i.id === t.invoiceId) : undefined
  const theirs = useMemo(() => data.timesheets.filter((x) => x.proId === t.proId), [data.timesheets, t.proId])
  const checks = useTimesheetChecks(theirs).get(t.id) ?? []
  const proposal = primaryProposal(checks)
  const [mode, setMode] = useState<Mode>("idle")
  const [moving, setMoving] = useState(false)
  const group = data.groups.find((g) => g.id === t.groupId)
  const slot = group?.slots.find((s) => s.id === t.slotId)
  const parts = t.movedFrom || t.movedTo ? data.timesheets.filter((x) => x.groupId === t.groupId && x.slotId === t.slotId && x.status !== "removed").sort((a, b) => a.scheduledStart.localeCompare(b.scheduledStart)) : []
  const [busy, setBusy] = useState(false)
  const [reason, setReason] = useState("")
  const [note, setNote] = useState("")
  const [times, setTimes] = useState<TimesInput>(() => ({
    clockIn: snapTime(t.clockIn ?? t.clock?.in, t.scheduledStart),
    clockOut: snapTime(t.clockOut ?? t.clock?.out, t.scheduledEnd),
    breakMins: t.clockIn ? t.breakMins : t.scheduledBreakMins,
  }))

  const isBuyer = kind === "buyer" && ws.buyerId === t.buyerId
  const isAgency = kind === "supplier" && ws.supplierId === t.supplierId
  const weekEnd = weekEndISO(t.date)
  const closesOn = addDaysISO(weekEnd, 1)
  const closed = weekClosed(t.date, todayISO())
  const onClock = clockHours(t.clock)
  const scheduled = scheduledHours(t)
  const flagged = checks.length > 0

  const open = (next: Mode, preset = "") => {
    setMode(next)
    setReason(preset)
    setNote("")
  }

  const run = async (work: () => Promise<unknown>) => {
    setBusy(true)
    try {
      return await work()
    } finally {
      setBusy(false)
    }
  }

  const approved = (result: ApproveResult | undefined) => {
    if (!result) return
    if (!result.approved) {
      toast("This one needs a decision", { description: "Iris flagged it. Accept the proposal, approve as billed with a reason, or reject it." })
      return
    }
    toast.success(`Approved ${pro ? fullName(pro) : "the timesheet"}`, {
      description: result.invoices.length
        ? `Iris invoiced it on ${result.invoices.join(", ")}.`
        : `It's on ${result.open[0] ?? `${sup.shortName}'s invoice`} for this week, which Iris issues on Saturday, ${formatDateShort(closesOn)}.`,
    })
    onDone()
  }

  const approve = () => run(async () => approved(await approveTimesheets([t.id])))
  const acceptProposal = (p: Proposal) =>
    run(async () => approved(await correctTimesheet(t.id, { clockIn: p.clockIn!, clockOut: p.clockOut!, breakMins: p.breakMins }, p.reason)))
  const approveAsBilled = () => run(async () => approved(await approveTimesheets([t.id], [reason, note.trim()].filter(Boolean).join(". "))))
  const correct = () => run(async () => approved(await correctTimesheet(t.id, times, [reason, note.trim()].filter(Boolean).join(". "))))
  const reject = () =>
    run(async () => {
      const n = await rejectTimesheets([t.id], reason, note.trim() || undefined)
      if (!n) return
      toast(`Sent back to ${sup.shortName}`, { description: `${reason}. They'll fix it and resubmit.` })
      onDone()
    })
  const save = () =>
    run(async () => {
      if (!(await editTimesheet(t.id, times, note.trim() || undefined))) return
      toast.success("Times saved", { description: "Submit it when it's ready for the buyer." })
      setMode("idle")
    })
  const submit = () =>
    run(async () => {
      const n = await submitTimesheets([t.id])
      if (!n) return
      toast.success("Submitted for approval", { description: kind === "buyer" ? "It's ready for you to approve." : "The buyer can approve it now." })
      if (kind === "supplier") onDone()
    })
  const withdraw = () =>
    run(async () => {
      if (!(await withdrawTimesheets([t.id]))) return
      toast("Withdrawn to Draft", { description: "Change the times, then submit it again." })
    })
  const remove = () =>
    run(async () => {
      if (!(await removeTimesheet(t.id, [reason, note.trim()].filter(Boolean).join(". ")))) return
      toast("Removed from billing", { description: "The timesheet stays on record at zero hours." })
      onDone()
    })

  const draftHours = hoursFor(times.clockIn, times.clockOut, times.breakMins, t.sentHome)
  const billed = !!(t.clockIn || t.clockOut)
  const off = {
    in: billed && !!t.clock && t.clockIn !== t.clock.in,
    out: billed && !!t.clock && t.clockOut !== t.clock.out,
    breakMins: billed && !!t.clock && t.breakMins !== t.clock.breakMins,
    hours: billed && !!t.clock && t.hours !== onClock,
  }
  type Row = { label: string; sub?: string; in?: string; out?: string; breakMins?: number; hours?: number; off?: Partial<typeof off> }
  const rows: Row[] = [
    { label: "Scheduled", in: t.scheduledStart, out: t.scheduledEnd, breakMins: t.scheduledBreakMins, hours: scheduled },
    t.clock
      ? { label: "Clock", sub: CLOCK_SOURCE[t.clock.source], in: t.clock.in, out: t.clock.out, breakMins: t.clock.breakMins, hours: onClock }
      : { label: "Clock", sub: "No clock record" },
    {
      label: "Billed",
      sub: t.status === "draft" ? "Draft, prefilled from the clock" : t.source === "csv" ? `${sup.shortName}'s file` : t.source === "app" ? `${sup.shortName}'s system` : "Entered in Iris",
      in: t.clockIn,
      out: t.clockOut,
      breakMins: t.breakMins,
      hours: t.hours,
      off,
    },
  ]
  const mark = (on?: boolean) => (on ? "font-semibold text-warning-fg" : undefined)

  const st = round2(t.hours - t.otHours)
  const labor = laborAmount(t)

  return (
    <>
      <SheetHeader className="gap-4 border-b border-border px-6 pt-6 pb-5">
        <div className="flex items-start gap-4 pr-8">
          {pro && <ProAvatar pro={pro} size="lg" ring />}
          <div className="flex min-w-0 flex-col gap-1">
            <SheetTitle className="text-featured-3">{pro ? fullName(pro) : "Unknown Pro"}</SheetTitle>
            <SheetDescription className="flex flex-col gap-0.5 text-body-3">
              <span>
                {position(t.positionId).name} · {loc.name}
              </span>
              <span>{formatDateLong(t.date)}</span>
            </SheetDescription>
            <div className="mt-1 flex flex-wrap items-center gap-2">
              <TimesheetStatusBadge t={t} kind={kind} />
              {kind !== "supplier" && (
                <span className="inline-flex items-center gap-1.5 text-caption-1 text-faded">
                  <SupplierLogo supplierId={t.supplierId} size="xs" /> {sup.shortName}
                </span>
              )}
              <Link href={`/shifts/${t.groupId}`} className="text-caption-1 text-faded hover:text-foreground hover:underline">
                {data.groups.find((g) => g.id === t.groupId)?.code ?? "Shift"}
              </Link>
            </div>
          </div>
        </div>
      </SheetHeader>

      <div className="flex flex-col gap-6 px-6 py-5">
        <section className="flex flex-col gap-2">
          <table className="w-full text-body-3">
            <thead>
              <tr className="text-caption-1 text-faded">
                <th className="py-1.5 pr-2 text-left font-medium" />
                <th className="px-2 py-1.5 text-left font-medium">In</th>
                <th className="px-2 py-1.5 text-left font-medium">Out</th>
                <th className="px-2 py-1.5 text-left font-medium">Break</th>
                <th className="py-1.5 pl-2 text-right font-medium">Hours</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.label} className="border-t border-border/70">
                  <td className="py-2 pr-2">
                    <span className="flex flex-col">
                      <span className="font-semibold">{r.label}</span>
                      {r.sub && <span className="text-caption-1 text-faded">{r.sub}</span>}
                    </span>
                  </td>
                  <td className={cn("px-2 py-2 tabular", mark(r.off?.in))}>{r.in ? formatClock(r.in) : "--"}</td>
                  <td className={cn("px-2 py-2 tabular", mark(r.off?.out))}>{r.out ? formatClock(r.out) : "--"}</td>
                  <td className={cn("px-2 py-2 tabular", mark(r.off?.breakMins))}>{r.in || r.out ? (r.breakMins ? `${r.breakMins} min` : "None") : "--"}</td>
                  <td className={cn("py-2 pl-2 text-right font-semibold tabular", mark(r.off?.hours))}>{r.hours !== undefined && (r.in || r.out) ? r.hours.toFixed(2) : "--"}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {t.sentHome && <p className="text-caption-1 text-faded">Sent home early by the buyer, so it bills the four-hour minimum with no break.</p>}
        </section>

        <section className="flex flex-col gap-1.5 rounded-xl border border-border p-4">
          <div className="flex items-baseline justify-between gap-3">
            <span className="text-body-3 text-faded">
              {t.otHours > 0 ? (
                <>
                  {st.toFixed(2)} hrs straight time + <span className="font-semibold text-warning-fg">{t.otHours.toFixed(2)} hrs overtime</span> at {OVERTIME_RATE}× · {money(t.billRate)}/hr
                </>
              ) : (
                <>Billed at {money(t.billRate)}/hr</>
              )}
            </span>
            <span className="text-body-2 font-semibold tabular">{money(labor)}</span>
          </div>
          {t.tips > 0 && (
            <div className="flex items-baseline justify-between text-body-3 text-faded">
              <span>Tips, passed through with no markup</span>
              <span className="tabular">{money(t.tips)}</span>
            </div>
          )}
          {t.tips > 0 && (
            <div className="flex items-baseline justify-between border-t border-border/70 pt-1.5 text-body-3">
              <span className="font-semibold">Total</span>
              <span className="font-semibold tabular">{money(timesheetAmount(t))}</span>
            </div>
          )}
          <span className="text-caption-1 text-subtle">
            {invoice ? (
              <>
                On{" "}
                <Link href={`/invoices/${invoice.id}`} className="font-medium text-foreground hover:underline">
                  {invoice.number}
                </Link>{" "}
                for the week of {formatDateShort(weekStartISO(t.date))} to {formatDateShort(weekEnd)}.
                {invoice.status === "open" && ` Iris issues it on Saturday, ${formatDateShort(invoice.issuedOn)}.`}
              </>
            ) : (
              <>
                Week of {formatDateShort(weekStartISO(t.date))} to {formatDateShort(weekEnd)}.{" "}
                {closed
                  ? "That week has closed, so Iris invoices it as soon as it's approved."
                  : `Approved hours go on ${sup.shortName}'s invoice for the week, which Iris issues on Saturday, ${formatDateShort(closesOn)}.`}
              </>
            )}
          </span>
        </section>

        {parts.length > 1 && (
          <Panel title="This shift changed roles">
            <ol className="flex flex-col gap-1.5">
              {parts.map((p) => (
                <li key={p.id} className="flex items-baseline justify-between gap-3 text-body-3">
                  {p.id === t.id ? (
                    <span className="font-semibold">{position(p.positionId).name}</span>
                  ) : (
                    <Link href={`/timesheets?ts=${p.id}`} className="font-medium text-primary underline-offset-4 hover:underline">
                      {position(p.positionId).name}
                    </Link>
                  )}
                  <span className="text-faded tabular">
                    {timeRange(p.clockIn ?? p.scheduledStart, p.clockOut ?? p.scheduledEnd)} · {money(p.billRate)}/hr
                  </span>
                </li>
              ))}
            </ol>
            {slot?.moves?.some((m) => m.note) && <span className="text-caption-1 text-faded">{slot.moves.filter((m) => m.note).map((m) => `“${m.note}” ${m.by}`).join(" · ")}</span>}
          </Panel>
        )}

        {t.status === "rejected" && t.rejection && (
          <Panel className="border-critical-border/70 bg-critical-faded">
            <span className="text-body-3 font-semibold text-critical-fg">
              Rejected by {t.rejection.by} {timeAgo(t.rejection.at)}: {t.rejection.reason}
            </span>
            {t.rejection.note && <span className="text-body-3 text-faded">&ldquo;{t.rejection.note}&rdquo;</span>}
          </Panel>
        )}

        {checks.length > 0 && (
          <section className="flex flex-col gap-3">
            <h3 className="flex items-center gap-1.5 text-body-2 font-bold">
              <AlertTriangle className="size-4 text-warning-fg" /> Iris flagged {plural(checks.length, "thing")}
            </h3>
            <ul className="flex flex-col gap-2">
              {checks.map((c) => (
                <li key={c.id} className="text-body-3">
                  <span className="font-semibold">{c.label}.</span> <span className="text-faded">{c.detail}</span>
                </li>
              ))}
            </ul>
            {proposal && (
              <Panel>
                <span className="flex items-baseline justify-between gap-3">
                  <span className="text-body-3 font-semibold">Iris proposes</span>
                  <span className={cn("text-body-3 font-semibold tabular", proposal.hours < t.hours ? "text-positive-fg" : "text-faded")}>
                    {proposal.hours === t.hours ? "No change" : `${proposal.hours < t.hours ? "−" : "+"}${money(Math.abs(round2(proposal.hours - t.hours)) * t.billRate)}`}
                  </span>
                </span>
                <span className="text-body-3 text-faded">
                  {proposal.reason}: {timeRange(proposal.clockIn, proposal.clockOut)}, {proposal.breakMins ? `${proposal.breakMins} min break` : "no break"}
                  {!(isBuyer && t.status === "pending_approval") && `, ${proposal.hours.toFixed(2)} hrs`}.
                </span>
                {isBuyer && t.status === "pending_approval" && mode === "idle" && (
                  <Button className="h-9 gap-1.5 self-start rounded-lg" disabled={busy} onClick={() => acceptProposal(proposal)} data-tour="accept-proposal">
                    <Check className="size-4" /> Approve at {proposal.hours.toFixed(2)} hrs
                  </Button>
                )}
              </Panel>
            )}
          </section>
        )}

        {isBuyer && t.status === "pending_approval" && mode === "idle" && (
          <div className="flex flex-wrap gap-2">
            {!flagged && (
              <Button className="h-9 gap-1.5 rounded-lg" disabled={busy} onClick={approve}>
                <Check className="size-4" /> Approve
              </Button>
            )}
            {flagged && (
              <Button variant="outline" className="h-9 rounded-lg" onClick={() => open("as_billed", AS_BILLED_REASONS[0])}>
                Approve as billed
              </Button>
            )}
            <Button variant="outline" className="h-9 gap-1.5 rounded-lg" onClick={() => open("reject", flagged ? REJECT_REASONS[0] : REJECT_REASONS[1])}>
              <X className="size-4" /> Reject
            </Button>
            <Button variant="ghost" className="h-9 gap-1.5 rounded-lg text-faded" onClick={() => open("correct", CORRECT_REASONS[0])}>
              <Pencil className="size-4" /> Correct the times
            </Button>
            {slot && (
              <Button variant="ghost" className="h-9 gap-1.5 rounded-lg text-faded" onClick={() => setMoving(true)} data-tour="split-role">
                <ArrowRightLeft className="size-4" /> Split by role
              </Button>
            )}
          </div>
        )}
        {group && slot && <MoveDialog group={group} slot={slot} open={moving} onOpenChange={setMoving} />}

        {mode === "reject" && (
          <Panel title={`Send back to ${sup.shortName}`}>
            <ReasonSelect value={reason} onChange={setReason} options={REJECT_REASONS} />
            <Textarea value={note} onChange={(e) => setNote(e.target.value)} placeholder="Our supervisor saw them leave at 12:30am." className="min-h-16 rounded-lg bg-background text-body-3" />
            <div className="flex gap-2">
              <Button className="h-9 rounded-lg bg-critical hover:bg-critical/90" disabled={busy || !reason} onClick={reject}>
                Reject
              </Button>
              <Button variant="ghost" className="h-9 rounded-lg" onClick={() => setMode("idle")}>
                Cancel
              </Button>
            </div>
          </Panel>
        )}

        {mode === "as_billed" && (
          <Panel title={`Approve ${t.hours.toFixed(2)} hrs as billed`}>
            <ReasonSelect value={reason} onChange={setReason} options={AS_BILLED_REASONS} />
            <Textarea value={note} onChange={(e) => setNote(e.target.value)} placeholder="Stayed for teardown at the supervisor's request." className="min-h-16 rounded-lg bg-background text-body-3" />
            <div className="flex gap-2">
              <Button className="h-9 rounded-lg" disabled={busy || !reason || (reason === "Other" && !note.trim())} onClick={approveAsBilled}>
                Approve as billed
              </Button>
              <Button variant="ghost" className="h-9 rounded-lg" onClick={() => setMode("idle")}>
                Cancel
              </Button>
            </div>
          </Panel>
        )}

        {(mode === "correct" || mode === "edit") && (
          <Panel title={mode === "correct" ? "Correct the billed times" : "Edit the times you bill"}>
            <div className="grid grid-cols-3 gap-2">
              <TimeField label="In" value={times.clockIn} onChange={(v) => setTimes((x) => ({ ...x, clockIn: v }))} />
              <TimeField label="Out" value={times.clockOut} onChange={(v) => setTimes((x) => ({ ...x, clockOut: v }))} />
              <BreakField value={times.breakMins} onChange={(v) => setTimes((x) => ({ ...x, breakMins: v }))} />
            </div>
            <span className="text-body-3 text-faded">
              {t.hours.toFixed(2)} hrs → <span className="font-semibold text-foreground">{draftHours.toFixed(2)} hrs</span>
            </span>
            {mode === "correct" && <ReasonSelect value={reason} onChange={setReason} options={CORRECT_REASONS} />}
            <Textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder={mode === "correct" ? "Optional note for the agency" : "Optional note for the buyer"}
              className="min-h-14 rounded-lg bg-background text-body-3"
            />
            <div className="flex gap-2">
              <Button className="h-9 rounded-lg" disabled={busy || draftHours <= 0 || (mode === "correct" && reason === "Other" && !note.trim())} onClick={mode === "correct" ? correct : save}>
                {mode === "correct" ? `Approve at ${draftHours.toFixed(2)} hrs` : "Save times"}
              </Button>
              <Button variant="ghost" className="h-9 rounded-lg" onClick={() => setMode("idle")}>
                Cancel
              </Button>
            </div>
          </Panel>
        )}

        {mode === "remove" && (
          <Panel title="Remove from billing">
            <ReasonSelect value={reason} onChange={setReason} options={REMOVE_REASONS} />
            <Textarea value={note} onChange={(e) => setNote(e.target.value)} placeholder="Optional note" className="min-h-14 rounded-lg bg-background text-body-3" />
            <div className="flex gap-2">
              <Button variant="outline" className="h-9 rounded-lg text-critical-fg" disabled={busy || !reason || (reason === "Other" && !note.trim())} onClick={remove}>
                Remove
              </Button>
              <Button variant="ghost" className="h-9 rounded-lg" onClick={() => setMode("idle")}>
                Cancel
              </Button>
            </div>
          </Panel>
        )}

        {isAgency && mode === "idle" && (t.status === "draft" || t.status === "rejected") && (
          <div className="flex flex-wrap gap-2">
            <Button className="h-9 gap-1.5 rounded-lg" disabled={busy || !t.clockIn || !t.clockOut} onClick={submit}>
              <Send className="size-4" /> {t.status === "rejected" ? "Resubmit" : "Submit"}
            </Button>
            <Button variant="outline" className="h-9 gap-1.5 rounded-lg" onClick={() => open("edit")}>
              <Pencil className="size-4" /> Edit times
            </Button>
            <Button variant="ghost" className="h-9 gap-1.5 rounded-lg text-faded" onClick={() => open("remove", REMOVE_REASONS[0])}>
              <Trash2 className="size-4" /> Remove
            </Button>
          </div>
        )}
        {isAgency && t.status === "pending_approval" && (
          <Button variant="outline" className="h-9 gap-1.5 self-start rounded-lg" disabled={busy} onClick={withdraw}>
            <Undo2 className="size-4" /> Withdraw to Draft
          </Button>
        )}
        {isBuyer && t.status === "draft" && mode === "idle" && (
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-body-3 text-faded">With {sup.shortName}. It hasn&apos;t been submitted yet.</span>
            {t.clockIn && t.clockOut && (
              <Button variant="outline" className="h-8 gap-1.5 rounded-lg text-caption-1" disabled={busy} onClick={submit}>
                Submit for {sup.shortName} <ArrowRight className="size-3.5" />
              </Button>
            )}
          </div>
        )}

        <section className="flex flex-col gap-3">
          <h3 className="text-body-2 font-bold">History</h3>
          <TimesheetHistory t={t} invoice={invoice} />
        </section>
      </div>
    </>
  )
}
