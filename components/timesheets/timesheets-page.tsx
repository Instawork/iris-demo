"use client"

import { useSearchParams } from "next/navigation"
import { Check, Clock, Download, Send, ShieldCheck, X } from "lucide-react"
import { AnimatePresence, motion } from "motion/react"
import { useMemo, useState } from "react"
import { toast } from "sonner"

import { SupplierLogo } from "@/components/brand/org-avatar"
import { DataTable, type Column } from "@/components/common/data-table"
import { EmptyState } from "@/components/common/empty-state"
import { MultiSelectFilter, ResetFilters, SearchInput, SelectFilter } from "@/components/common/filters"
import { PageHeader } from "@/components/common/page-header"
import { PillTabs } from "@/components/common/pill-tabs"
import { ProAvatar } from "@/components/common/pro-avatar"
import { CLOCK_SOURCE, ChecksCell, HoursCell, TimesheetStatusBadge, shortRange, useTimesheetChecks } from "@/components/timesheets/timesheet-bits"
import { TimesheetSheet } from "@/components/timesheets/timesheet-sheet"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Textarea } from "@/components/ui/textarea"
import { useData, useWorkspace } from "@/hooks/use-app"
import { downloadCsv, exportName, toCsv } from "@/lib/csv"
import { addDaysISO, formatDateShort, formatDay, todayISO, weekEndISO, weekStartISO } from "@/lib/dates"
import { fullName, money, plural, round2 } from "@/lib/format"
import { inScope } from "@/lib/metrics"
import { LOCATIONS, SUPPLIERS, location, position, supplier } from "@/lib/reference"
import { joinNames, useStore } from "@/lib/store"
import { STATUS_LABEL, timesheetAmount, withAgency } from "@/lib/timesheets"
import type { PersonaKind, Timesheet } from "@/lib/types"
import { cn } from "@/lib/utils"

type Quick = "needs_approval" | "flagged" | "to_submit" | "drafts" | "pending" | "rejected" | "approved" | "invoiced" | "all"

const QUICK: Record<PersonaKind, Quick[]> = {
  buyer: ["needs_approval", "flagged", "drafts", "rejected", "approved", "invoiced", "all"],
  supplier: ["to_submit", "rejected", "pending", "approved", "invoiced", "all"],
  compass: ["all", "flagged", "pending", "rejected", "invoiced"],
}

const QUICK_LABEL: Record<Quick, string> = {
  needs_approval: "Needs approval",
  flagged: "Flagged",
  to_submit: "To submit",
  drafts: "Drafts",
  pending: "Pending approval",
  rejected: "Rejected",
  approved: "Approved",
  invoiced: "Invoiced",
  all: "All",
}

const QUICK_TIP: Partial<Record<Quick, string>> = {
  needs_approval: "Submitted timesheets waiting for your approval",
  flagged: "Pending timesheets Iris flagged against the clock or the schedule, each with a proposed fix",
  drafts: "Timesheets the agency hasn't submitted yet",
  to_submit: "Drafts from finished shifts, and timesheets the buyer sent back",
  approved: "Approved hours waiting for the week to close and be invoiced",
}

const DESCRIPTION: Record<PersonaKind, string> = {
  buyer:
    "Every worker's hours, checked against Iris's clock before you approve. Approve the clean ones together; for the rest, Iris proposes a fix. The work week runs Saturday to Friday, and approved hours are invoiced when it closes.",
  supplier:
    "Timesheets from your finished shifts, prefilled from the clock. Check the times and submit them. The buyer sees Iris's clock beside what you bill.",
  compass: "Every timesheet in the program, with Iris's clock beside what each agency billed and the buyer's decision.",
}

const REJECT_REASONS = ["Hours above the clock", "Hours above the schedule", "Missing or wrong punch", "Didn't work this shift", "Other"]

function setParams(patch: Record<string, string | undefined>) {
  const next = new URLSearchParams(window.location.search)
  for (const [key, value] of Object.entries(patch)) {
    if (value) next.set(key, value)
    else next.delete(key)
  }
  const query = next.toString()
  window.history.replaceState(null, "", query ? `/timesheets?${query}` : "/timesheets")
}

const when = <T,>(show: boolean, column: Column<T>) => (show ? [column] : [])

export function TimesheetsPage() {
  const data = useData()
  const { ws, scope } = useWorkspace()
  const params = useSearchParams()
  const { approveTimesheets, rejectTimesheets, submitTimesheets } = useStore.getState()
  const kind = ws.kind
  const options = QUICK[kind]
  const quick = options.find((q) => q === params.get("filter")) ?? options[0]
  const shiftId = params.get("shift") ?? undefined
  const openId = params.get("ts") ?? undefined
  const week = params.get("week") ?? "all"

  const [query, setQuery] = useState("")
  const [locations, setLocations] = useState<string[]>([])
  const [agencies, setAgencies] = useState<string[]>([])
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [rejecting, setRejecting] = useState<string[]>([])
  const [busy, setBusy] = useState(false)

  const mine = useMemo(() => data.timesheets.filter((t) => inScope(scope, t)), [data.timesheets, scope])
  const checks = useTimesheetChecks(mine)
  const pros = useMemo(() => new Map(data.pros.map((p) => [p.id, p])), [data.pros])
  const codes = useMemo(() => new Map(data.groups.map((g) => [g.id, g.code])), [data.groups])
  const shift = shiftId ? data.groups.find((g) => g.id === shiftId) : undefined

  const weeks = useMemo(() => {
    const current = weekStartISO(todayISO())
    return Array.from({ length: 6 }, (_, i) => addDaysISO(current, -7 * i))
  }, [])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    return mine.filter((t) => {
      if (shiftId && t.groupId !== shiftId) return false
      if (week !== "all" && weekStartISO(t.date) !== week) return false
      if (locations.length && !locations.includes(t.locationId)) return false
      if (agencies.length && !agencies.includes(t.supplierId)) return false
      if (q) {
        const p = pros.get(t.proId)
        if (!`${p ? fullName(p) : ""} ${p?.code ?? ""} ${codes.get(t.groupId) ?? ""} ${location(t.locationId).name}`.toLowerCase().includes(q)) return false
      }
      return true
    })
  }, [mine, shiftId, week, locations, agencies, query, pros, codes])

  const isFlagged = (t: Timesheet) => (checks.get(t.id)?.length ?? 0) > 0
  const matches: Record<Quick, (t: Timesheet) => boolean> = {
    needs_approval: (t) => t.status === "pending_approval",
    flagged: (t) => t.status === "pending_approval" && isFlagged(t),
    to_submit: withAgency,
    drafts: (t) => t.status === "draft",
    pending: (t) => t.status === "pending_approval",
    rejected: (t) => t.status === "rejected",
    approved: (t) => t.status === "approved",
    invoiced: (t) => t.status === "invoiced",
    all: () => true,
  }
  const rows = filtered.filter(matches[quick])
  const clean = rows.filter((t) => t.status === "pending_approval" && !isFlagged(t))
  const selectable = (t: Timesheet) =>
    kind === "buyer" ? t.status === "pending_approval" && !isFlagged(t) : kind === "supplier" ? withAgency(t) && !!t.clockIn && !!t.clockOut : false
  const chosen = rows.filter((t) => selected.has(t.id) && selectable(t))

  const totals = (list: Timesheet[]) => ({
    hours: round2(list.reduce((s, t) => s + t.hours, 0)),
    ot: round2(list.reduce((s, t) => s + t.otHours, 0)),
    amount: round2(list.reduce((s, t) => s + timesheetAmount(t), 0)),
  })
  const sum = totals(rows)

  const hasFilters = !!query || locations.length + agencies.length > 0 || week !== "all"
  const resetFilters = () => {
    setQuery("")
    setLocations([])
    setAgencies([])
    setParams({ week: undefined })
  }

  const approveMany = async (ids: string[]) => {
    setBusy(true)
    const result = await approveTimesheets(ids)
    setBusy(false)
    setSelected(new Set())
    if (!result?.approved) return
    const open = result.open.length ? `This week's are on ${joinNames(result.open)}, issued Saturday.` : ""
    toast.success(`Approved ${plural(result.approved, "timesheet")}`, {
      description: result.invoices.length ? `Iris invoiced last week's hours on ${result.invoices.join(", ")}. ${open}`.trim() : open || "They go on each agency's invoice for the week.",
    })
  }

  const submitMany = async (ids: string[]) => {
    setBusy(true)
    const n = await submitTimesheets(ids)
    setBusy(false)
    setSelected(new Set())
    if (n) toast.success(`Submitted ${plural(n, "timesheet")}`, { description: "The buyer can approve them now." })
  }

  const columns: Column<Timesheet>[] = [
    {
      id: "worker",
      header: "Worker",
      sortValue: (t) => {
        const p = pros.get(t.proId)
        return p ? fullName(p) : ""
      },
      cell: (t) => {
        const p = pros.get(t.proId)
        return (
          <span className="flex items-center gap-2.5">
            {p && <ProAvatar pro={p} size="sm" />}
            <span className="flex min-w-0 flex-col">
              <span className="truncate font-semibold">{p ? fullName(p) : "Unknown Pro"}</span>
              {kind !== "supplier" ? (
                <span className="inline-flex items-center gap-1 text-caption-1 text-faded">
                  <SupplierLogo supplierId={t.supplierId} size="xs" /> {supplier(t.supplierId).shortName}
                </span>
              ) : (
                <span className="text-caption-1 text-faded">{p?.code}</span>
              )}
            </span>
          </span>
        )
      },
    },
    {
      id: "shift",
      header: "Shift",
      sortValue: (t) => `${t.date} ${t.scheduledStart}`,
      cell: (t) => (
        <span className="flex max-w-[220px] min-w-0 flex-col">
          <span className="truncate">
            {position(t.positionId).name} · {location(t.locationId).name}
          </span>
          <span className="text-caption-1 text-faded">
            {formatDay(t.date)} · {shortRange(t.scheduledStart, t.scheduledEnd)}
          </span>
        </span>
      ),
    },
    {
      id: "clock",
      header: "Clock",
      info: "Times Iris recorded itself: from the Instawork app, or the worker's check-in at the venue.",
      cell: (t) =>
        t.clock ? (
          <span className="flex flex-col">
            <span className="tabular">{shortRange(t.clock.in, t.clock.out)}</span>
            <span className="text-caption-1 text-faded">{CLOCK_SOURCE[t.clock.source]}</span>
          </span>
        ) : (
          <span className="text-caption-1 text-subtle">No clock record</span>
        ),
    },
    {
      id: "billed",
      header: "Billed",
      info: "What the agency submitted. Approval and the invoice use these times.",
      cell: (t) => {
        const flagged = checks.get(t.id)?.some((c) => c.id === "above_clock" || c.id === "early" || c.id === "over_schedule")
        return (
          <span className="flex flex-col">
            <span className={cn("tabular", flagged && "font-semibold text-warning-fg")}>{shortRange(t.clockIn, t.clockOut)}</span>
            <span className="text-caption-1 text-faded">{t.clockIn || t.clockOut ? (t.breakMins ? `${t.breakMins} min break` : "No break") : "Not billed yet"}</span>
          </span>
        )
      },
    },
    { id: "hours", header: "Hours", align: "right", sortValue: (t) => t.hours, cell: (t) => <HoursCell t={t} /> },
    { id: "amount", header: "Amount", align: "right", sortValue: (t) => timesheetAmount(t), cell: (t) => <span className="font-medium tabular">{money(timesheetAmount(t))}</span> },
    ...when<Timesheet>(quick !== "invoiced", {
      id: "checks",
      header: "Iris check",
      sortValue: (t) => checks.get(t.id)?.length ?? 0,
      cell: (t) => (t.status === "invoiced" || t.status === "removed" ? <span className="text-subtle">--</span> : <ChecksCell checks={checks.get(t.id) ?? []} />),
    }),
    { id: "status", header: "Status", sortValue: (t) => STATUS_LABEL[t.status], cell: (t) => <TimesheetStatusBadge t={t} kind={kind} size="sm" /> },
  ]

  const exportCsv = () =>
    downloadCsv(
      exportName("timesheets"),
      toCsv(
        rows.map((t) => {
          const p = pros.get(t.proId)
          return {
            timesheet_id: t.id,
            shift_group_id: codes.get(t.groupId) ?? "",
            pro_id: p?.code ?? "",
            pro_name: p ? fullName(p) : "",
            agency: supplier(t.supplierId).name,
            location: location(t.locationId).name,
            position: position(t.positionId).name,
            date: t.date,
            week_start: weekStartISO(t.date),
            scheduled_start: t.scheduledStart,
            scheduled_end: t.scheduledEnd,
            clock_in: t.clock?.in ?? "",
            clock_out: t.clock?.out ?? "",
            billed_in: t.clockIn ?? "",
            billed_out: t.clockOut ?? "",
            break_minutes: t.breakMins,
            hours: t.hours,
            overtime_hours: t.otHours,
            bill_rate: t.billRate,
            tips: t.tips,
            amount: timesheetAmount(t).toFixed(2),
            iris_checks: (checks.get(t.id) ?? []).map((c) => c.label).join("; "),
            status: STATUS_LABEL[t.status],
          }
        }),
      ),
    )

  const emptyText: Record<Quick, string> = {
    needs_approval: "Nothing waiting for your approval.",
    flagged: "Nothing flagged. Every pending timesheet matches the clock and the schedule.",
    to_submit: "Nothing to submit. Drafts appear here when your workers' shifts end.",
    drafts: "Every agency has submitted its hours.",
    pending: "Nothing waiting for approval.",
    rejected: "No rejected timesheets.",
    approved: "No approved hours waiting for the week to close.",
    invoiced: "No invoiced timesheets in this view.",
    all: "No timesheets in this view.",
  }

  return (
    <>
      <PageHeader
        className="pt-4"
        title="Timesheets"
        description={DESCRIPTION[kind]}
        actions={
          <>
            {kind === "buyer" && quick === "needs_approval" && clean.length > 0 && (
              <Button className="h-9 gap-1.5 rounded-lg text-body-3 font-semibold" disabled={busy} onClick={() => approveMany(clean.map((t) => t.id))} data-tour="approve-clean">
                <Check className="size-4" /> Approve {plural(clean.length, "clean timesheet")}
              </Button>
            )}
            <Button variant="ghost" className="h-9 gap-1.5 rounded-lg text-body-3" disabled={!rows.length} onClick={exportCsv}>
              <Download className="size-4" /> Download CSV
            </Button>
          </>
        }
      />

      <div className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <PillTabs
            size="sm"
            value={quick}
            onChange={(v) => {
              setSelected(new Set())
              setParams({ filter: v === options[0] ? undefined : v })
            }}
            items={options.map((q) => ({
              value: q,
              label: QUICK_LABEL[q],
              count: q === "all" || q === "invoiced" ? undefined : filtered.filter(matches[q]).length,
              tooltip: QUICK_TIP[q],
            }))}
          />
          <span className="text-body-3 text-faded">
            <span className="font-bold text-foreground tabular">{plural(rows.length, "timesheet")}</span> · <span className="font-bold text-foreground tabular">{sum.hours.toLocaleString()}</span> hrs
            {sum.ot > 0 && <span className="text-warning-fg"> ({sum.ot.toLocaleString()} OT)</span>} · <span className="font-bold text-foreground tabular">{money(sum.amount)}</span>
          </span>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <SearchInput value={query} onChange={setQuery} placeholder="Search workers or shifts" className="w-56" />
          <SelectFilter
            label="Week"
            value={week}
            onChange={(v) => setParams({ week: v === "all" ? undefined : v })}
            options={[
              { value: "all", label: "All weeks" },
              ...weeks.map((w, i) => ({ value: w, label: `${formatDateShort(w)} – ${formatDateShort(weekEndISO(w))}`, hint: i === 0 ? "This week" : i === 1 ? "Last week" : undefined })),
            ]}
          />
          {kind !== "supplier" && (
            <MultiSelectFilter
              label="Locations"
              options={LOCATIONS.filter((l) => kind === "compass" || l.buyerId === ws.buyerId).map((l) => ({ value: l.id, label: l.name }))}
              value={locations}
              onChange={setLocations}
            />
          )}
          {kind !== "supplier" && (
            <MultiSelectFilter
              label="Agencies"
              options={SUPPLIERS.map((s) => ({ value: s.id, label: s.name, icon: <SupplierLogo supplierId={s.id} size="xs" /> }))}
              value={agencies}
              onChange={setAgencies}
            />
          )}
          {shift && (
            <span className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-foreground/20 bg-foreground/[0.03] px-2.5 text-body-3">
              <Clock className="size-3.5 text-faded" /> {shift.code} · {position(shift.positionId).name}, {formatDay(shift.date)}
              <button type="button" onClick={() => setParams({ shift: undefined })} className="text-subtle hover:text-foreground" aria-label="Show every shift">
                <X className="size-3.5" />
              </button>
            </span>
          )}
          <ResetFilters show={hasFilters} onClick={resetFilters} />
        </div>

        <DataTable
          rows={rows}
          columns={columns}
          getRowId={(t) => t.id}
          selectable={kind !== "compass"}
          isSelectable={selectable}
          selected={selected}
          onSelectedChange={setSelected}
          onRowClick={(t) => setParams({ ts: t.id })}
          rowClassName={(t) => (checks.get(t.id)?.some((c) => c.id === "above_clock") && t.status === "pending_approval" ? "tour-flagged" : undefined)}
          initialSort={{ id: "shift", dir: "desc" }}
          pageSize={25}
          empty={
            <EmptyState
              icon={quick === "flagged" || quick === "needs_approval" ? ShieldCheck : Clock}
              title={hasFilters || shift ? "No timesheets" : "All caught up"}
              description={hasFilters || shift ? "Nothing matches these filters." : emptyText[quick]}
              actions={
                hasFilters || shift ? (
                  <Button
                    variant="outline"
                    onClick={() => {
                      resetFilters()
                      setParams({ shift: undefined, week: undefined })
                    }}
                  >
                    Clear filters
                  </Button>
                ) : undefined
              }
            />
          }
        />
      </div>

      <AnimatePresence>
        {chosen.length > 0 && (
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 12 }}
            transition={{ duration: 0.15 }}
            className="fixed bottom-6 left-1/2 z-40 flex -translate-x-1/2 items-center gap-3 rounded-xl bg-foreground px-4 py-2.5 text-background shadow-overlay"
          >
            <span className="text-body-3 font-semibold">
              {chosen.length} selected · {totals(chosen).hours} hrs · {money(totals(chosen).amount)}
            </span>
            {kind === "buyer" && (
              <>
                <Button size="sm" className="h-8 gap-1.5 rounded-lg bg-background text-foreground hover:bg-background/90" disabled={busy} onClick={() => approveMany(chosen.map((t) => t.id))}>
                  <Check className="size-4" /> Approve {chosen.length}
                </Button>
                <Button size="sm" variant="ghost" className="h-8 rounded-lg text-background hover:bg-background/10 hover:text-background" onClick={() => setRejecting(chosen.map((t) => t.id))}>
                  Reject
                </Button>
              </>
            )}
            {kind === "supplier" && (
              <Button size="sm" className="h-8 gap-1.5 rounded-lg bg-background text-foreground hover:bg-background/90" disabled={busy} onClick={() => submitMany(chosen.map((t) => t.id))}>
                <Send className="size-4" /> Submit {chosen.length}
              </Button>
            )}
            <button type="button" onClick={() => setSelected(new Set())} className="rounded-md p-1 text-background/70 hover:bg-background/10 hover:text-background" aria-label="Clear selection">
              <X className="size-4" />
            </button>
          </motion.div>
        )}
      </AnimatePresence>

      <RejectDialog
        ids={rejecting}
        onOpenChange={(o) => !o && setRejecting([])}
        onReject={async (reason, note) => {
          const n = await rejectTimesheets(rejecting, reason, note)
          setRejecting([])
          setSelected(new Set())
          if (n) toast(`Sent ${plural(n, "timesheet")} back`, { description: `${reason}. The agencies will fix and resubmit them.` })
        }}
      />
      <TimesheetSheet id={openId} onOpenChange={(o) => !o && setParams({ ts: undefined })} />
    </>
  )
}

function RejectDialog({ ids, onOpenChange, onReject }: { ids: string[]; onOpenChange: (open: boolean) => void; onReject: (reason: string, note?: string) => Promise<void> }) {
  const [reason, setReason] = useState(REJECT_REASONS[1])
  const [note, setNote] = useState("")
  const [busy, setBusy] = useState(false)
  return (
    <Dialog
      open={ids.length > 0}
      onOpenChange={(o) => {
        if (!o) setNote("")
        onOpenChange(o)
      }}
    >
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Reject {plural(ids.length, "timesheet")}</DialogTitle>
          <DialogDescription>They go back to the agency with your reason. Nothing is invoiced until they&apos;re fixed and approved.</DialogDescription>
        </DialogHeader>
        <Select value={reason} onValueChange={setReason}>
          <SelectTrigger className="h-10 w-full rounded-lg">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {REJECT_REASONS.map((r) => (
              <SelectItem key={r} value={r}>
                {r}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Textarea value={note} onChange={(e) => setNote(e.target.value)} placeholder="A note for the agency" className="min-h-20 rounded-lg text-body-3" />
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            className="bg-critical hover:bg-critical/90"
            disabled={busy || (reason === "Other" && !note.trim())}
            onClick={async () => {
              setBusy(true)
              await onReject(reason, note.trim() || undefined)
              setBusy(false)
              setNote("")
            }}
          >
            Reject
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
