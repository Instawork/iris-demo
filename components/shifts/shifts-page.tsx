"use client"

import Link from "next/link"
import { useRouter, useSearchParams } from "next/navigation"
import { CalendarDays, CalendarPlus, Download, FileUp, List, Plus, UserPlus } from "lucide-react"
import { useMemo, useState } from "react"

import { SupplierLogo } from "@/components/brand/org-avatar"
import { DataTable, type Column } from "@/components/common/data-table"
import { DateRangeFilter, type IsoRange } from "@/components/common/date-range-filter"
import { EmptyState } from "@/components/common/empty-state"
import { FillPipe } from "@/components/common/fill-pipe"
import { MultiSelectFilter, ResetFilters } from "@/components/common/filters"
import { PillTabs } from "@/components/common/pill-tabs"
import { StatusBadge, type Tone } from "@/components/common/status-badge"
import { Surface } from "@/components/common/surface"
import { AssignProsDialog } from "@/components/shifts/assign-pros-dialog"
import { SupplierStack } from "@/components/shifts/shift-card"
import { ShiftsCalendar } from "@/components/shifts/shifts-calendar"
import { Button } from "@/components/ui/button"
import { useData, useWorkspace } from "@/hooks/use-app"
import { useUi } from "@/hooks/use-ui"
import { downloadCsv, exportName, toCsv } from "@/lib/csv"
import { formatClockShort, formatDay } from "@/lib/dates"
import { filledCount, fillRatio, fillTone, groupInScope, groupPhase } from "@/lib/metrics"
import { BUYERS, LOCATIONS, POSITIONS, SUPPLIERS, buyer, location, locationsFor, position, supplier } from "@/lib/reference"
import type { ShiftGroup, Timesheet, Workspace } from "@/lib/types"
import { cn } from "@/lib/utils"

type Tab = "upcoming" | "hours" | "past"

interface HoursState {
  label: string
  tone: Tone
  action?: "approve" | "submit" | "respond"
  count?: number
}

/** Where a shift's hours stand for this persona, and the one thing to do next. */
function hoursState(g: ShiftGroup, sheets: Timesheet[], ws: Workspace): HoursState {
  const phase = groupPhase(g)
  if (g.cancelledAt) return { label: "Cancelled", tone: "neutral" }
  if (phase === "upcoming") return { label: "Not started", tone: "neutral" }
  if (phase === "in_progress") return { label: "In progress", tone: "positive" }
  const mine = (ws.kind === "supplier" ? sheets.filter((t) => t.supplierId === ws.supplierId) : sheets).filter((t) => t.status !== "removed")
  if (!mine.length) return { label: ws.kind === "supplier" ? "None of your Pros" : "No hours yet", tone: "neutral" }
  const by = (s: Timesheet["status"]) => mine.filter((t) => t.status === s).length
  const done: HoursState = { label: by("approved") ? "Approved" : "Invoiced", tone: "positive" }
  if (ws.kind === "buyer") {
    if (by("pending_approval")) return { label: "Approve hours", tone: "warning", action: "approve", count: by("pending_approval") }
    if (by("draft")) return { label: "With the agency", tone: "neutral", count: by("draft") }
    if (by("rejected")) return { label: "Rejected", tone: "critical" }
    return done
  }
  if (ws.kind === "supplier") {
    if (by("rejected")) return { label: "Fix rejected", tone: "critical", action: "respond", count: by("rejected") }
    if (by("draft")) return { label: "Submit hours", tone: "warning", action: "submit", count: by("draft") }
    if (by("pending_approval")) return { label: "Pending approval", tone: "neutral" }
    return done
  }
  if (by("pending_approval") || by("draft")) return { label: "Pending approval", tone: "neutral" }
  if (by("rejected")) return { label: "Rejected", tone: "critical" }
  return done
}

const needsHoursAction = (s: HoursState) => s.action === "approve" || s.action === "respond" || (s.action === "submit" && s.tone === "warning")

export function ShiftsPage() {
  const data = useData()
  const { ws, scope } = useWorkspace()
  const params = useSearchParams()
  const router = useRouter()
  const view = useUi((s) => s.shiftsView)
  const setView = useUi((s) => s.setShiftsView)
  const openUpload = useUi((s) => s.openUpload)
  const [tab, setTab] = useState<Tab>(params.get("filter") === "hours" ? "hours" : params.get("timeframe") === "past" ? "past" : "upcoming")
  const [locations, setLocations] = useState<string[]>([])
  const [suppliers, setSuppliers] = useState<string[]>([])
  const [buyers, setBuyers] = useState<string[]>([])
  const [positions, setPositions] = useState<string[]>([])
  const [range, setRange] = useState<IsoRange>({})
  const [assignFor, setAssignFor] = useState<string>()

  const sheetsByGroup = useMemo(() => {
    const map = new Map<string, Timesheet[]>()
    for (const t of data.timesheets) map.set(t.groupId, [...(map.get(t.groupId) ?? []), t])
    return map
  }, [data.timesheets])

  const rows = useMemo(() => {
    return data.groups
      .filter((g) => groupInScope(scope, g))
      .filter((g) => {
        if (locations.length && !locations.includes(g.locationId)) return false
        if (suppliers.length && !g.supplierIds.some((id) => suppliers.includes(id))) return false
        if (buyers.length && !buyers.includes(g.buyerId)) return false
        if (positions.length && !positions.includes(g.positionId)) return false
        if (range.from && g.date < range.from) return false
        if (range.to && g.date > range.to) return false
        return true
      })
      .map((g) => ({ group: g, hours: hoursState(g, sheetsByGroup.get(g.id) ?? [], ws) }))
  }, [data.groups, scope, ws, sheetsByGroup, locations, suppliers, buyers, positions, range])

  const upcoming = useMemo(
    () => rows.filter((r) => groupPhase(r.group) !== "past").sort((a, b) => a.group.date.localeCompare(b.group.date) || a.group.start.localeCompare(b.group.start)),
    [rows],
  )
  const past = useMemo(
    () => rows.filter((r) => groupPhase(r.group) === "past").sort((a, b) => b.group.date.localeCompare(a.group.date) || b.group.start.localeCompare(a.group.start)),
    [rows],
  )
  const toAct = useMemo(() => past.filter((r) => needsHoursAction(r.hours)), [past])
  const list = tab === "upcoming" ? upcoming : tab === "hours" ? toAct : past

  const hasFilters = locations.length + suppliers.length + buyers.length + positions.length > 0 || !!range.from
  const reset = () => {
    setLocations([])
    setSuppliers([])
    setBuyers([])
    setPositions([])
    setRange({})
  }

  const exportCsv = () => {
    downloadCsv(
      exportName(`shifts-${tab}`),
      toCsv(
        list.map(({ group: g, hours }) => ({
          shift_group_id: g.code,
          shift: g.name || position(g.positionId).name,
          buyer: buyer(g.buyerId).name,
          location: location(g.locationId).name,
          date: g.date,
          start_time: g.start,
          end_time: g.end,
          pros_needed: g.slots.length,
          pros_filled: filledCount(g),
          suppliers: g.supplierIds.map((id) => supplier(id).shortName).join("; "),
          hours: hours.label,
        })),
      ),
    )
  }

  const columns = columnsFor(ws, {
    onHours: (g) => router.push(`/timesheets?shift=${g.id}`),
    onAssign: (g) => setAssignFor(g.id),
  })

  const hoursLabel = ws.kind === "buyer" ? "Hours to approve" : ws.kind === "supplier" ? "Hours to submit" : undefined

  return (
    <>
      <div className="flex flex-col gap-4 pt-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h1 className="text-featured-1 font-semibold">{ws.kind === "supplier" ? "Shifts open to you" : "Shifts"}</h1>
          <div className="flex items-center gap-2">
            <PillTabs
              value={view}
              onChange={setView}
              items={[
                { value: "list", label: "List", icon: List },
                { value: "calendar", label: "Calendar", icon: CalendarDays },
              ]}
            />
            {ws.kind === "buyer" && (
              <>
                <Button variant="outline" className="h-9 gap-1.5 rounded-lg text-body-3" onClick={() => openUpload("shifts")}>
                  <FileUp className="size-4" /> Upload CSV
                </Button>
                <Button asChild className="h-9 gap-1.5 rounded-lg text-body-3 font-semibold">
                  <Link href="/shifts/new">
                    <Plus className="size-4" /> New shift
                  </Link>
                </Button>
              </>
            )}
            {ws.kind === "supplier" && (
              <Button variant="outline" className="h-9 gap-1.5 rounded-lg text-body-3" onClick={() => openUpload()}>
                <FileUp className="size-4" /> Upload CSV
              </Button>
            )}
          </div>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <PillTabs
            value={tab}
            onChange={setTab}
            items={[
              { value: "upcoming", label: "Upcoming", count: upcoming.length },
              ...(hoursLabel ? [{ value: "hours" as const, label: hoursLabel, count: toAct.length }] : []),
              { value: "past", label: "Past", count: past.length },
            ]}
          />
          <Button variant="ghost" className="h-9 gap-1.5 rounded-lg text-body-3 text-faded" onClick={exportCsv}>
            <Download className="size-4" /> Download
          </Button>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {ws.kind !== "buyer" && (
            <MultiSelectFilter label="Buyers" options={BUYERS.map((b) => ({ value: b.id, label: b.name, hint: b.sector }))} value={buyers} onChange={setBuyers} />
          )}
          {ws.kind !== "supplier" && (
            <MultiSelectFilter
              label="Suppliers"
              options={SUPPLIERS.map((s) => ({ value: s.id, label: s.name, icon: <SupplierLogo supplierId={s.id} size="xs" /> }))}
              value={suppliers}
              onChange={setSuppliers}
            />
          )}
          <MultiSelectFilter
            label="Locations"
            searchable
            options={(ws.kind === "buyer" ? locationsFor(ws.buyerId) : LOCATIONS).map((l) => ({ value: l.id, label: l.name, hint: l.address }))}
            value={locations}
            onChange={setLocations}
          />
          <DateRangeFilter value={range} onChange={setRange} />
          <MultiSelectFilter label="Positions" searchable options={POSITIONS.map((p) => ({ value: p.id, label: p.name, hint: p.category }))} value={positions} onChange={setPositions} />
          <ResetFilters show={hasFilters} onClick={reset} />
        </div>
      </div>

      {view === "calendar" ? (
        <ShiftsCalendar groups={rows.map((r) => r.group)} />
      ) : list.length === 0 ? (
        <EmptyState
          icon={CalendarPlus}
          title={tab === "hours" ? "Nothing to do here" : "No shifts"}
          description={
            hasFilters
              ? "Try changing or clearing your filters."
              : tab === "hours"
                ? ws.kind === "buyer"
                  ? "Every submitted hour is approved."
                  : "Every hour is submitted."
                : ws.kind === "supplier"
                  ? "Shifts appear here when a buyer that approved you posts one."
                  : "Nothing scheduled yet."
          }
          actions={
            hasFilters ? (
              <Button variant="outline" onClick={reset}>
                Clear filters
              </Button>
            ) : ws.kind === "buyer" && tab === "upcoming" ? (
              <Button asChild>
                <Link href="/shifts/new">New shift</Link>
              </Button>
            ) : undefined
          }
        />
      ) : (
        <Surface elevated className="overflow-hidden">
          <DataTable
            rows={list}
            columns={columns}
            getRowId={(r) => r.group.id}
            onRowClick={(r) => router.push(`/shifts/${r.group.id}`)}
            rowClassName={(r) => (r.group.cancelledAt ? "opacity-60" : undefined)}
            pageSize={25}
          />
        </Surface>
      )}

      {assignFor && (
        <AssignProsDialog group={data.groups.find((g) => g.id === assignFor)!} open onOpenChange={(open) => !open && setAssignFor(undefined)} />
      )}
    </>
  )
}

type Row = { group: ShiftGroup; hours: HoursState }

function columnsFor(ws: Workspace, actions: { onHours: (g: ShiftGroup) => void; onAssign: (g: ShiftGroup) => void }): Column<Row>[] {
  const shift: Column<Row> = {
    id: "shift",
    header: "Shift",
    sortValue: (r) => r.group.name || position(r.group.positionId).name,
    cell: ({ group: g }) => (
      <span className="flex min-w-0 flex-col">
        <span className="flex items-center gap-2">
          <span className="truncate font-semibold">{g.name || position(g.positionId).name}</span>
          {g.liveFill && groupPhase(g) === "upcoming" && (
            <span className="inline-flex h-[18px] shrink-0 items-center gap-1 rounded-[5px] bg-brand px-1.5 text-caption-2 font-semibold text-brand-foreground">
              <span className="size-1.5 animate-pulse rounded-full bg-brand-foreground" />
              Filling
            </span>
          )}
        </span>
        <span className="truncate text-caption-1 text-faded">
          {ws.kind === "buyer" ? location(g.locationId).name : position(g.positionId).name}
          {g.eventName ? ` · ${g.eventName}` : ""}
        </span>
      </span>
    ),
  }
  const buyerCol: Column<Row> = {
    id: "buyer",
    header: "Buyer",
    sortValue: (r) => location(r.group.locationId).name,
    cell: ({ group: g }) => (
      <span className="flex min-w-0 flex-col">
        <span className="truncate">{location(g.locationId).name}</span>
        <span className="truncate text-caption-1 text-faded">{buyer(g.buyerId).name}</span>
      </span>
    ),
  }
  const date: Column<Row> = {
    id: "date",
    header: "Date",
    sortValue: (r) => `${r.group.date}${r.group.start}`,
    cell: ({ group: g }) => (
      <span className="flex flex-col whitespace-nowrap">
        <span>{formatDay(g.date)}</span>
        <span className="text-caption-1 text-faded tabular">
          {formatClockShort(g.start)} to {formatClockShort(g.end)}
        </span>
      </span>
    ),
  }
  const filled: Column<Row> = {
    id: "filled",
    header: "Filled",
    sortValue: (r) => fillRatio(r.group),
    cell: ({ group: g }) => (
      <span className="flex items-center gap-2.5 whitespace-nowrap">
        <FillPipe ratio={fillRatio(g)} tone={g.cancelledAt ? "neutral" : fillTone(g)} />
        <span className="tabular">
          {filledCount(g)} / {g.slots.length}
        </span>
      </span>
    ),
  }
  const suppliersCol: Column<Row> = {
    id: "suppliers",
    header: "Suppliers",
    info: "The approved suppliers this shift was sent to.",
    cell: ({ group: g }) => <SupplierStack ids={g.supplierIds} />,
  }
  const hours: Column<Row> = {
    id: "hours",
    header: ws.kind === "supplier" ? "Action" : "Hours",
    align: "right",
    cell: ({ group: g, hours: h }) => {
      const phase = groupPhase(g)
      const open = g.slots.length - filledCount(g)
      if (ws.kind === "supplier" && !g.cancelledAt && phase !== "past" && open > 0) {
        return (
          <Button
            size="sm"
            className="h-8 gap-1.5 rounded-lg px-3 text-caption-1 font-semibold"
            onClick={(e) => {
              e.stopPropagation()
              actions.onAssign(g)
            }}
          >
            <UserPlus className="size-3.5" /> Assign Pros
          </Button>
        )
      }
      if (ws.kind === "supplier" && phase === "upcoming") return <StatusBadge tone="positive">Filled</StatusBadge>
      const primary = (ws.kind === "buyer" && h.action === "approve") || (ws.kind === "supplier" && (h.action === "submit" || h.action === "respond"))
      if (primary || (ws.kind === "buyer" && h.action === "submit")) {
        return (
          <Button
            size="sm"
            variant={primary ? "default" : "outline"}
            className={cn("h-8 rounded-lg px-3 text-caption-1 font-semibold", !primary && "text-faded")}
            onClick={(e) => {
              e.stopPropagation()
              actions.onHours(g)
            }}
            data-tour={primary ? "hours-action" : undefined}
          >
            {h.label}
            {h.count ? <span className={cn("tabular", primary ? "opacity-70" : "")}>{h.count}</span> : null}
          </Button>
        )
      }
      return (
        <StatusBadge tone={h.tone} dot={h.tone === "positive"}>
          {h.label}
        </StatusBadge>
      )
    },
  }
  if (ws.kind === "buyer") return [shift, date, filled, suppliersCol, hours]
  if (ws.kind === "supplier") return [shift, buyerCol, date, filled, hours]
  return [shift, buyerCol, date, filled, suppliersCol, hours]
}
