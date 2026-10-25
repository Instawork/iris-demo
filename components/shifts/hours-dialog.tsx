"use client"

import { useRouter } from "next/navigation"
import { AlertTriangle, MessageSquareWarning, Pencil, Reply } from "lucide-react"
import { useMemo, useState } from "react"
import { toast } from "sonner"

import { SupplierLogo } from "@/components/brand/org-avatar"
import { Tip } from "@/components/common/info-tip"
import { ProAvatar } from "@/components/common/pro-avatar"
import { StatusBadge, type Tone } from "@/components/common/status-badge"
import { DisputeDialog, EditHoursDialog, RespondDialog } from "@/components/timesheets/timesheet-dialogs"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { useData, useWorkspace } from "@/hooks/use-app"
import { formatClock, formatDay } from "@/lib/dates"
import { fullName, money, plural, round2 } from "@/lib/format"
import { timesheetAmount, timesheetFlags } from "@/lib/metrics"
import { location, position, supplier } from "@/lib/reference"
import { useStore } from "@/lib/store"
import type { PersonaKind, ShiftGroup, Timesheet } from "@/lib/types"

const STATUS: Record<Timesheet["status"], Record<PersonaKind, { label: string; tone: Tone }>> = {
  awaiting_submission: {
    buyer: { label: "Waiting on supplier", tone: "neutral" },
    supplier: { label: "To submit", tone: "warning" },
    compass: { label: "Not submitted", tone: "neutral" },
  },
  submitted: {
    buyer: { label: "Needs approval", tone: "warning" },
    supplier: { label: "Submitted", tone: "neutral" },
    compass: { label: "Submitted", tone: "neutral" },
  },
  approved: {
    buyer: { label: "Approved", tone: "positive" },
    supplier: { label: "Approved", tone: "positive" },
    compass: { label: "Approved", tone: "positive" },
  },
  disputed: {
    buyer: { label: "Disputed", tone: "critical" },
    supplier: { label: "Disputed", tone: "critical" },
    compass: { label: "Disputed", tone: "critical" },
  },
}

/** One shift's hours and tips. Buyers approve them, which generates the invoice; suppliers, or the buyer for them, submit them. */
export function HoursDialog({ group, onOpenChange }: { group?: ShiftGroup; onOpenChange: (open: boolean) => void }) {
  return (
    <Dialog open={!!group} onOpenChange={onOpenChange}>
      <DialogContent className="gap-0 p-0 sm:max-w-3xl" data-tour="hours-dialog">
        {group && <HoursBody key={group.id} group={group} onDone={() => onOpenChange(false)} />}
      </DialogContent>
    </Dialog>
  )
}

function HoursBody({ group, onDone }: { group: ShiftGroup; onDone: () => void }) {
  const data = useData()
  const { ws } = useWorkspace()
  const router = useRouter()
  const approve = useStore((s) => s.approveTimesheets)
  const submit = useStore((s) => s.submitTimesheets)
  const setTips = useStore((s) => s.setTips)
  const kind = ws.kind

  const rows = useMemo(() => {
    const pros = new Map(data.pros.map((p) => [p.id, p]))
    return data.timesheets
      .filter((t) => t.groupId === group.id && (kind !== "supplier" || t.supplierId === ws.supplierId))
      .map((t) => ({ ts: t, pro: pros.get(t.proId) }))
      .sort((a, b) => (a.pro ? fullName(a.pro) : "").localeCompare(b.pro ? fullName(b.pro) : ""))
  }, [data, group.id, kind, ws.supplierId])

  const toApprove = rows.filter((r) => r.ts.status === "submitted").map((r) => r.ts.id)
  const toSubmit = rows.filter((r) => r.ts.status === "awaiting_submission").map((r) => r.ts.id)
  const actionable = kind === "buyer" ? toApprove : kind === "supplier" ? toSubmit : []
  const [selected, setSelected] = useState(() => new Set(actionable))
  const [tips, setTipDraft] = useState<Record<string, string>>({})
  const [edit, setEdit] = useState<string>()
  const [dispute, setDispute] = useState<string>()
  const [respond, setRespond] = useState<string>()
  const showTips = group.badges.includes("TIPS") || rows.some((r) => r.ts.tips > 0)
  const canEditTips = (t: Timesheet) => t.status === "awaiting_submission" && kind !== "compass"
  const pick = (id?: string) => rows.find((r) => r.ts.id === id)

  const saveTips = async (ids: string[]) => {
    const entries = ids.filter((id) => tips[id] !== undefined).map((id) => ({ timesheetId: id, tips: Number(tips[id]) || 0 }))
    if (entries.length) await setTips(entries)
  }

  const onApprove = async () => {
    const ids = toApprove.filter((id) => selected.has(id))
    const numbers = await approve(ids)
    if (!numbers.length) return
    toast.success(`Approved ${plural(ids.length, "timesheet")}`, {
      description: numbers.length ? `Iris generated ${numbers.join(" and ")} from these hours.` : undefined,
      action: numbers.length ? { label: "View invoice", onClick: () => router.push(`/invoices/${numbers[0].toLowerCase()}`) } : undefined,
    })
    onDone()
  }

  const onSubmit = async (ids: string[]) => {
    await saveTips(ids)
    await submit(ids)
    toast.success(`Submitted ${plural(ids.length, "timesheet")}`, { description: kind === "supplier" ? "The buyer can approve them now." : "They're ready for you to approve." })
    if (kind === "supplier") onDone()
    else setSelected(new Set(ids))
  }

  const selectable = (t: Timesheet) => actionable.includes(t.id)
  const allSelected = actionable.length > 0 && actionable.every((id) => selected.has(id))
  const loc = location(group.locationId)
  const total = round2(rows.reduce((s, r) => s + timesheetAmount({ ...r.ts, tips: canEditTips(r.ts) && tips[r.ts.id] !== undefined ? Number(tips[r.ts.id]) || 0 : r.ts.tips }), 0))

  return (
    <>
      <DialogHeader className="border-b border-border px-5 py-4 text-left">
        <DialogTitle>
          Hours for {position(group.positionId).name}, {formatDay(group.date)}
        </DialogTitle>
        <DialogDescription>
          {loc.name} · {formatClock(group.start)} to {formatClock(group.end)} · {group.code}
        </DialogDescription>
      </DialogHeader>

      <div className="max-h-[60svh] overflow-y-auto scrollbar-thin">
        {rows.length ? (
          <table className="w-full text-body-3">
            <thead className="sticky top-0 z-10 bg-card text-caption-1 text-faded">
              <tr className="border-b border-border">
                <th className="w-10 py-2.5 pl-5">
                  {actionable.length > 0 && (
                    <Checkbox checked={allSelected} onCheckedChange={(v) => setSelected(v === true ? new Set(actionable) : new Set())} aria-label="Select all" />
                  )}
                </th>
                <th className="px-3 py-2.5 text-left font-medium">Pro</th>
                <th className="px-3 py-2.5 text-left font-medium">Worked</th>
                <th className="px-3 py-2.5 text-right font-medium">Hours</th>
                {showTips && <th className="px-3 py-2.5 text-right font-medium">Tips</th>}
                <th className="px-3 py-2.5 text-right font-medium">Amount</th>
                <th className="px-3 py-2.5 text-left font-medium">Status</th>
                <th className="w-20 py-2.5 pr-5" />
              </tr>
            </thead>
            <tbody>
              {rows.map(({ ts, pro }) => {
                const flags = timesheetFlags(ts)
                const status = STATUS[ts.status][kind]
                return (
                  <tr key={ts.id} className="border-b border-border/70 last:border-0">
                    <td className="py-2.5 pl-5">
                      {selectable(ts) && (
                        <Checkbox
                          checked={selected.has(ts.id)}
                          onCheckedChange={(v) => {
                            const next = new Set(selected)
                            if (v === true) next.add(ts.id)
                            else next.delete(ts.id)
                            setSelected(next)
                          }}
                          aria-label={`Select ${pro ? fullName(pro) : "Pro"}`}
                        />
                      )}
                    </td>
                    <td className="px-3 py-2.5">
                      <span className="flex items-center gap-2.5">
                        {pro && <ProAvatar pro={pro} size="sm" />}
                        <span className="flex min-w-0 flex-col">
                          <span className="truncate font-medium">{pro ? fullName(pro) : "Unknown Pro"}</span>
                          {kind !== "supplier" && (
                            <span className="flex items-center gap-1 text-caption-1 text-faded">
                              <SupplierLogo supplierId={ts.supplierId} size="xs" /> {supplier(ts.supplierId).shortName}
                            </span>
                          )}
                        </span>
                      </span>
                    </td>
                    <td className="px-3 py-2.5">
                      <span className="flex flex-col">
                        <span className="tabular">{ts.clockIn && ts.clockOut ? `${formatClock(ts.clockIn)} to ${formatClock(ts.clockOut)}` : "Missing punch"}</span>
                        <span className="text-caption-1 text-subtle">
                          {ts.breakMins ? `${ts.breakMins} min break` : "No break"}
                        </span>
                      </span>
                    </td>
                    <td className="px-3 py-2.5 text-right">
                      <span className="inline-flex items-center justify-end gap-1.5 tabular">
                        {flags.length > 0 && (
                          <Tip content={flags.map((f) => f.detail).join(" ")}>
                            <AlertTriangle className="size-3.5 text-warning-fg" />
                          </Tip>
                        )}
                        {ts.hours.toFixed(2)}
                      </span>
                    </td>
                    {showTips && (
                      <td className="px-3 py-2.5 text-right">
                        {canEditTips(ts) ? (
                          <Input
                            type="number"
                            min={0}
                            step="0.01"
                            inputMode="decimal"
                            value={tips[ts.id] ?? (ts.tips ? String(ts.tips) : "")}
                            placeholder="0.00"
                            onChange={(e) => setTipDraft((d) => ({ ...d, [ts.id]: e.target.value }))}
                            className="ml-auto h-8 w-24 text-right tabular"
                            aria-label="Tips"
                          />
                        ) : (
                          <span className="tabular text-faded">{ts.tips ? money(ts.tips) : "--"}</span>
                        )}
                      </td>
                    )}
                    <td className="px-3 py-2.5 text-right font-medium tabular">{money(timesheetAmount(ts))}</td>
                    <td className="px-3 py-2.5">
                      <StatusBadge tone={status.tone} size="sm">
                        {status.label}
                      </StatusBadge>
                    </td>
                    <td className="py-2.5 pr-5">
                      <span className="flex justify-end gap-0.5">
                        {kind === "buyer" && ts.status !== "approved" && ts.status !== "disputed" && (
                          <Tip content="Edit hours">
                            <Button variant="ghost" size="icon" className="size-7 text-faded" onClick={() => setEdit(ts.id)} aria-label="Edit hours">
                              <Pencil className="size-3.5" />
                            </Button>
                          </Tip>
                        )}
                        {kind === "buyer" && ts.status === "submitted" && (
                          <Tip content="Dispute hours">
                            <Button variant="ghost" size="icon" className="size-7 text-faded" onClick={() => setDispute(ts.id)} aria-label="Dispute hours">
                              <MessageSquareWarning className="size-3.5" />
                            </Button>
                          </Tip>
                        )}
                        {kind === "supplier" && ts.status === "disputed" && !ts.dispute?.response && (
                          <Tip content={ts.dispute?.reason ?? "Respond"}>
                            <Button variant="ghost" size="icon" className="size-7 text-faded" onClick={() => setRespond(ts.id)} aria-label="Respond to dispute">
                              <Reply className="size-3.5" />
                            </Button>
                          </Tip>
                        )}
                      </span>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        ) : (
          <p className="px-5 py-10 text-center text-body-3 text-faded">
            {kind === "supplier" ? "None of your Pros worked this shift." : "No hours yet. They appear once Pros clock out."}
          </p>
        )}
      </div>

      <DialogFooter className="mx-0 mb-0 flex-row items-center justify-between gap-3 px-5 py-3 sm:justify-between">
        <span className="text-body-3 text-faded">
          Total <span className="font-semibold text-foreground tabular">{money(total)}</span>
        </span>
        <span className="flex gap-2">
          {kind === "buyer" && toSubmit.length > 0 && (
            <Button variant="outline" onClick={() => onSubmit(toSubmit)}>
              Submit {toSubmit.length} for supplier
            </Button>
          )}
          {kind === "buyer" && toApprove.length > 0 && (
            <Button disabled={!toApprove.some((id) => selected.has(id))} onClick={onApprove} data-tour="approve-hours">
              Approve {toApprove.filter((id) => selected.has(id)).length}
            </Button>
          )}
          {kind === "supplier" && toSubmit.length > 0 && (
            <Button disabled={!toSubmit.some((id) => selected.has(id))} onClick={() => onSubmit(toSubmit.filter((id) => selected.has(id)))}>
              Submit {toSubmit.filter((id) => selected.has(id)).length}
            </Button>
          )}
          {!actionable.length && !(kind === "buyer" && toSubmit.length) && (
            <Button variant="outline" onClick={onDone}>
              Done
            </Button>
          )}
        </span>
      </DialogFooter>

      <EditHoursDialog ts={pick(edit)?.ts} pro={pick(edit)?.pro} onOpenChange={(open) => !open && setEdit(undefined)} />
      <DisputeDialog ts={pick(dispute)?.ts} pro={pick(dispute)?.pro} onOpenChange={(open) => !open && setDispute(undefined)} />
      <RespondDialog ts={pick(respond)?.ts} pro={pick(respond)?.pro} onOpenChange={(open) => !open && setRespond(undefined)} />
    </>
  )
}
