"use client"

import { useRouter, useSearchParams } from "next/navigation"
import { CalendarClock, Check, ChevronDown, ChartColumn, Copy, Download, Link2, MoreHorizontal, Plus, Trash2 } from "lucide-react"
import { useEffect, useMemo, useState } from "react"
import { toast } from "sonner"

import { DataTable, type Column } from "@/components/common/data-table"
import { DateRangeFilter } from "@/components/common/date-range-filter"
import { EmptyState } from "@/components/common/empty-state"
import { MultiSelectFilter, ResetFilters, SelectFilter, activeClass, triggerClass, type FilterOption } from "@/components/common/filters"
import { InfoTip } from "@/components/common/info-tip"
import { PageHeader } from "@/components/common/page-header"
import { PillTabs } from "@/components/common/pill-tabs"
import { Surface } from "@/components/common/surface"
import { ReportChart } from "@/components/reports/report-chart"
import { ScheduleDialog } from "@/components/reports/schedule-dialog"
import { Button } from "@/components/ui/button"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { useData, useWorkspace } from "@/hooks/use-app"
import { downloadCsv, exportName, toCsv } from "@/lib/csv"
import { formatClockShort, formatTimestamp } from "@/lib/dates"
import { scopeOf } from "@/lib/metrics"
import { BUYERS, CITIES, LOCATIONS, POSITIONS, SUPPLIERS, buyer, citiesForBuyer, locationsFor } from "@/lib/reference"
import {
  DIMENSIONS,
  FILTERS,
  MAX_MEASURES,
  PERIODS,
  cadencePhrase,
  changeOf,
  csvRows,
  daysIn,
  describeSpec,
  dimensionLabel,
  formatValue,
  isPivot,
  isTimeDimension,
  measureInfo,
  nextSend,
  pivotValue,
  rangeLabel,
  reportHref,
  reportsFor,
  runReport,
  sameSpec,
  specFromParams,
  type ReportGroup,
  type ReportResult,
  type ReportRow,
} from "@/lib/reports"
import { joinNames, useStore } from "@/lib/store"
import type { ReportDimension, ReportFilterKey, ReportMeasure, ReportSpec, SavedReport, Workspace } from "@/lib/types"
import { cn } from "@/lib/utils"

/**
 * Reports: the ones an organization saved and shares, and a builder for new ones. The URL carries the report, so a
 * link, a reload or the chat opens exactly what was on screen.
 */

const NEW_SPEC: ReportSpec = { measures: ["spend", "hours"], groupBy: "week", period: "last_28", filters: {} }

const SECTIONS: { title: string; ids: ReportMeasure[] }[] = [
  { title: "From timesheets", ids: ["spend", "hours", "workers", "costPerHour", "aboveClock"] },
  { title: "From shifts", ids: ["shifts", "spots", "fillRate", "noShowRate", "timeToFill"] },
]

/** A buyer only sees its own spend, and an agency only its own work, so those groupings would be a single row. */
const hidden = (ws: Workspace): string[] => (ws.kind === "buyer" ? ["buyer"] : ws.kind === "supplier" ? ["agency"] : [])

export function ReportsPage() {
  const data = useData()
  const ready = useStore((s) => s.ready)
  const { ws } = useWorkspace()
  const router = useRouter()
  const params = useSearchParams()
  const saved = useMemo(() => reportsFor(data, ws), [data, ws])
  const reportId = params.get("r") ?? undefined
  const current = saved.find((r) => r.id === reportId)
  const spec = useMemo(() => specFromParams(new URLSearchParams(params.toString())), [params])

  useEffect(() => {
    if (!ready) return
    if (reportId && !current) router.replace("/reports")
    else if (!spec && saved[0]) router.replace(reportHref(saved[0].spec, saved[0].id))
  }, [ready, reportId, current, spec, saved, router])

  const open = (r: SavedReport) => router.push(reportHref(r.spec, r.id))

  return (
    <>
      <PageHeader
        className="pt-4"
        title="Reports"
        description="Build a report from every shift, timesheet and rate on Iris. Save it for your team, email it on a schedule, or download it."
        actions={
          <Button onClick={() => router.push(reportHref(NEW_SPEC))}>
            <Plus /> New report
          </Button>
        }
      />
      <div className="grid items-start gap-4 xl:grid-cols-[260px_minmax(0,1fr)]">
        <SavedList reports={saved} activeId={current?.id} onOpen={open} />
        {spec ? <ReportEditor key={current?.id ?? "new"} report={current} spec={spec} /> : <Surface elevated className="h-96 animate-pulse" />}
      </div>
    </>
  )
}

function SavedList({ reports, activeId, onOpen }: { reports: SavedReport[]; activeId?: string; onOpen: (r: SavedReport) => void }) {
  return (
    <Surface elevated className="flex flex-col p-2">
      <p className="px-2.5 pt-1.5 pb-2 text-caption-1 font-medium text-faded">Saved for your team</p>
      {reports.map((r) => (
        <button
          key={r.id}
          type="button"
          onClick={() => onOpen(r)}
          className={cn(
            "flex flex-col items-start gap-0.5 rounded-lg px-2.5 py-2 text-left transition-colors duration-100 hover:bg-hover",
            r.id === activeId && "bg-hover",
          )}
        >
          <span className="flex w-full items-center gap-1.5 text-body-3 font-semibold">
            <span className="min-w-0 flex-1 truncate">{r.name}</span>
            {r.schedule && <CalendarClock className="size-3.5 shrink-0 text-faded" aria-label="Emailed on a schedule" />}
          </span>
          <span className="line-clamp-2 text-caption-1 text-faded">{r.description ?? describeSpec(r.spec)}</span>
        </button>
      ))}
      {reports.length === 0 && <p className="px-2.5 pb-2 text-caption-1 text-faded">Nothing saved yet. Build one and save it here.</p>}
    </Surface>
  )
}

function ReportEditor({ report, spec }: { report?: SavedReport; spec: ReportSpec }) {
  const data = useData()
  const { ws } = useWorkspace()
  const router = useRouter()
  const saveReport = useStore((s) => s.saveReport)
  const deleteReport = useStore((s) => s.deleteReport)
  const [name, setName] = useState(report?.name ?? "Untitled report")
  const [charted, setCharted] = useState<ReportMeasure>(spec.measures[0])
  const [scheduling, setScheduling] = useState(false)
  const [busy, setBusy] = useState(false)
  const scope = useMemo(() => scopeOf(ws), [ws])
  const result = useMemo(() => runReport(data, spec, scope), [data, spec, scope])
  const measure = spec.measures.includes(charted) ? charted : spec.measures[0]
  const dirty = !report || !sameSpec(spec, report.spec) || name.trim() !== report.name

  const update = (patch: Partial<ReportSpec>) => router.replace(reportHref({ ...spec, ...patch }, report?.id), { scroll: false })

  const save = async (asNew: boolean) => {
    const title = name.trim() || "Untitled report"
    setBusy(true)
    const id = await saveReport({ id: asNew ? undefined : report?.id, name: title, description: asNew ? undefined : report?.description, spec })
    setBusy(false)
    if (!id) return
    toast.success(report && !asNew ? `Saved your changes to “${title}”` : `Saved “${title}” for your team`)
    router.replace(reportHref(spec, id), { scroll: false })
  }

  const remove = async () => {
    if (!report) return
    if (await deleteReport(report.id)) {
      toast.success(`Deleted “${report.name}”`)
      router.replace("/reports")
    }
  }

  const copyLink = async () => {
    await navigator.clipboard.writeText(`${window.location.origin}${reportHref(spec, report?.id)}`).catch(() => undefined)
    toast.success("Link copied. It opens this report with these settings.")
  }

  const download = () => downloadCsv(exportName((name.trim() || "report").toLowerCase().replace(/[^a-z0-9]+/g, "-")), toCsv(csvRows(result)))

  return (
    <div className="flex min-w-0 flex-col gap-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-[min(100%,18rem)] flex-1 flex-col gap-1">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            aria-label="Report name"
            maxLength={80}
            className="-mx-1.5 rounded-md bg-transparent px-1.5 text-featured-2 font-semibold outline-none hover:bg-hover focus:bg-hover"
          />
          <p className="text-body-3 text-faded">
            {describeSpec(spec)} · {rangeLabel(result.range)}
          </p>
          {report?.schedule && (
            <button type="button" onClick={() => setScheduling(true)} className="flex w-fit items-center gap-1.5 text-caption-1 text-faded hover:text-foreground">
              <CalendarClock className="size-3.5" />
              Emailed {cadencePhrase(report.schedule.cadence)} at {formatClockShort(report.schedule.time)} to {joinNames(report.schedule.recipients)} · next{" "}
              {formatTimestamp(nextSend(report.schedule).toISOString())}
            </button>
          )}
        </div>
        <div className="flex items-center gap-2">
          {dirty && (
            <Button onClick={() => save(false)} disabled={busy}>
              <Check /> {report ? "Save changes" : "Save report"}
            </Button>
          )}
          <Button variant="outline" onClick={() => (report ? setScheduling(true) : toast.info("Save the report first, then schedule it."))}>
            <CalendarClock /> {report?.schedule ? "Schedule" : "Email on a schedule"}
          </Button>
          <Button variant="ghost" className="text-faded" onClick={download}>
            <Download /> Download
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" aria-label="More actions">
                <MoreHorizontal />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={copyLink}>
                <Link2 /> Copy link
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => save(true)}>
                <Copy /> Save as a new report
              </DropdownMenuItem>
              {report && (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem variant="destructive" onClick={remove}>
                    <Trash2 /> Delete report
                  </DropdownMenuItem>
                </>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      <Builder ws={ws} spec={spec} onChange={update} />

      <Totals result={result} />

      <Surface elevated className="overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-5 py-4">
          <div className="flex flex-col">
            <h2 className="text-featured-3 font-semibold">
              {measureInfo(measure).label} by {dimensionLabel(spec.groupBy).toLowerCase()}
              {spec.splitBy ? ` and ${dimensionLabel(spec.splitBy).toLowerCase()}` : ""}
            </h2>
            <p className="text-caption-1 text-faded">{rangeLabel(result.range)}</p>
          </div>
          {spec.measures.length > 1 && (
            <PillTabs size="sm" value={measure} onChange={setCharted} items={spec.measures.map((m) => ({ value: m, label: measureInfo(m).label }))} />
          )}
        </div>
        {result.series.length > 0 && (
          <div className="flex flex-wrap gap-x-4 gap-y-1.5 px-5 pt-3">
            {result.series.map((s) => (
              <span key={s.key} className="inline-flex items-center gap-1.5 text-caption-1 text-faded">
                <span className="size-2 rounded-[3px]" style={{ background: s.color }} />
                {s.label}
              </span>
            ))}
          </div>
        )}
        <div className="px-3 pt-3 pb-4">
          {result.rows.length ? (
            <ReportChart result={result} measure={measure} />
          ) : (
            <EmptyState compact icon={ChartColumn} title="Nothing matches this report" description="Try a longer period or fewer filters." />
          )}
        </div>
      </Surface>

      {result.rows.length > 0 && <ResultTable key={JSON.stringify(spec)} result={result} />}

      {scheduling && report && <ScheduleDialog key={report.id} report={report} open onOpenChange={setScheduling} />}
    </div>
  )
}

function MeasurePicker({ value, onChange }: { value: ReportMeasure[]; onChange: (value: ReportMeasure[]) => void }) {
  const toggle = (m: ReportMeasure) => {
    if (value.includes(m)) {
      if (value.length > 1) onChange(value.filter((x) => x !== m))
    } else if (value.length < MAX_MEASURES) onChange([...value, m])
  }
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button type="button" className={cn(triggerClass, activeClass)}>
          <span className="text-faded">Show</span>
          <span className="max-w-[280px] truncate font-medium">{value.map((m) => measureInfo(m).label).join(", ")}</span>
          <ChevronDown className="size-3.5 text-subtle" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-80 p-1.5">
        {SECTIONS.map((section) => (
          <div key={section.title} className="py-0.5">
            <p className="px-2 pt-1.5 pb-1 text-caption-1 font-medium text-faded">{section.title}</p>
            {section.ids.map((id) => {
              const info = measureInfo(id)
              const on = value.includes(id)
              const locked = on ? value.length === 1 : value.length >= MAX_MEASURES
              return (
                <button
                  key={id}
                  type="button"
                  onClick={() => toggle(id)}
                  aria-pressed={on}
                  className={cn("flex w-full items-start gap-2 rounded-md px-2 py-1.5 text-left text-body-3 hover:bg-hover", locked && "cursor-default opacity-50 hover:bg-transparent")}
                >
                  <span className={cn("mt-0.5 flex size-4 shrink-0 items-center justify-center rounded border", on ? "border-primary bg-primary text-primary-foreground" : "border-border-strong")}>
                    {on && <Check className="size-3" />}
                  </span>
                  <span className="flex min-w-0 flex-col">
                    <span className="font-medium">{info.label}</span>
                    <span className="text-caption-1 text-faded">{info.info}</span>
                  </span>
                </button>
              )
            })}
          </div>
        ))}
        <p className="mt-1 border-t border-border px-2 pt-2 pb-1 text-caption-1 text-faded">Up to {MAX_MEASURES} at a time.</p>
      </PopoverContent>
    </Popover>
  )
}

function Builder({ ws, spec, onChange }: { ws: Workspace; spec: ReportSpec; onChange: (patch: Partial<ReportSpec>) => void }) {
  const skip = hidden(ws)
  const dims = DIMENSIONS.filter((d) => !skip.includes(d.id))
  const options: Record<ReportFilterKey, FilterOption[]> = useMemo(
    () => ({
      buyer: BUYERS.map((b) => ({ value: b.id, label: b.name, hint: b.sector })),
      location: (ws.kind === "buyer" ? locationsFor(ws.buyerId) : LOCATIONS).map((l) => ({ value: l.id, label: l.name, hint: `${buyer(l.buyerId).name} · ${l.costCenter}` })),
      market: (ws.kind === "buyer" ? citiesForBuyer(ws.buyerId) : CITIES).map((c) => ({ value: c.id, label: `${c.name}, ${c.state}` })),
      agency: SUPPLIERS.map((s) => ({ value: s.id, label: s.shortName })),
      position: POSITIONS.map((p) => ({ value: p.id, label: p.name, hint: p.category })),
    }),
    [ws],
  )
  const filtered = Object.values(spec.filters).some((ids) => ids?.length)
  const setFilter = (key: ReportFilterKey, ids: string[]) => onChange({ filters: { ...spec.filters, [key]: ids } })
  const groupBy = (id: ReportDimension) => onChange({ groupBy: id, splitBy: spec.splitBy === id ? undefined : spec.splitBy })

  return (
    <Surface elevated className="flex flex-col gap-2.5 p-3">
      <div className="flex flex-wrap items-center gap-2">
        <MeasurePicker value={spec.measures} onChange={(measures) => onChange({ measures })} />
        <SelectFilter label="By" options={dims.map((d) => ({ value: d.id, label: d.label }))} value={spec.groupBy} onChange={(v) => groupBy(v as ReportDimension)} />
        <SelectFilter
          label="Split by"
          options={[{ value: "", label: "Nothing" }, ...dims.filter((d) => d.id !== spec.groupBy).map((d) => ({ value: d.id, label: d.label }))]}
          value={spec.splitBy ?? ""}
          onChange={(v) => onChange({ splitBy: (v || undefined) as ReportDimension | undefined })}
        />
        <SelectFilter
          label="Period"
          options={PERIODS.map((p) => ({ value: p.id, label: p.label }))}
          value={spec.period}
          onChange={(v) => onChange(v === "custom" ? { period: "custom", from: spec.from, to: spec.to } : { period: v as ReportSpec["period"], from: undefined, to: undefined })}
        />
        {spec.period === "custom" && (
          <DateRangeFilter label="Dates" value={{ from: spec.from, to: spec.to }} onChange={(r) => r.from && r.to && onChange({ period: "custom", from: r.from, to: r.to })} />
        )}
      </div>
      <div className="flex flex-wrap items-center gap-2 border-t border-border pt-2.5">
        <span className="text-caption-1 font-medium text-faded">Only</span>
        {FILTERS.filter((f) => !skip.includes(f.id)).map((f) => (
          <MultiSelectFilter key={f.id} label={f.label} options={options[f.id]} value={spec.filters[f.id] ?? []} onChange={(ids) => setFilter(f.id, ids)} searchable={options[f.id].length > 6} />
        ))}
        <ResetFilters show={filtered} onClick={() => onChange({ filters: {} })} />
      </div>
    </Surface>
  )
}

function Totals({ result }: { result: ReportResult }) {
  const days = daysIn(result.range)
  return (
    <div className={cn("grid gap-3 sm:grid-cols-2", result.spec.measures.length >= 3 && "xl:grid-cols-4", result.spec.measures.length === 3 && "xl:grid-cols-3")}>
      {result.spec.measures.map((m) => {
        const info = measureInfo(m)
        const now = result.total[m]
        const before = result.priorTotal[m]
        const change = changeOf(m, now, before)
        const good = change && info.goodWhen ? (info.goodWhen === "up" ? change.delta > 0 : change.delta < 0) : undefined
        return (
          <div key={m} className="flex flex-col gap-1 rounded-xl border border-border bg-card p-4 shadow-raised">
            <span className="flex items-center gap-1.5 text-caption-1 font-medium text-faded">
              {info.label}
              <InfoTip>{info.info}</InfoTip>
            </span>
            <span className="text-featured-2 font-semibold tabular">{formatValue(m, now)}</span>
            <span className={cn("text-caption-1 tabular", good === true ? "text-positive-fg" : good === false ? "text-critical-fg" : "text-faded")}>
              {change
                ? `${change.label} vs. the ${days} days before`
                : before === null || before === 0
                  ? `Nothing to compare in the ${days} days before`
                  : `Level with the ${days} days before`}
            </span>
          </div>
        )
      })}
    </div>
  )
}

function groupCell(g: { label: string; hint?: string }) {
  return (
    <span className="flex flex-col">
      <span className="font-medium">{g.label}</span>
      {g.hint && <span className="text-caption-1 text-faded">{g.hint}</span>}
    </span>
  )
}

function PivotTable({ result }: { result: ReportResult }) {
  const { groupBy, measures } = result.spec
  const m = measures[0]
  const info = measureInfo(m)
  const time = isTimeDimension(groupBy)
  const columns: Column<ReportGroup>[] = [
    { id: "group", header: dimensionLabel(groupBy), sortValue: (g) => (time ? g.key : g.label), cell: groupCell },
    ...result.series.map(
      (s) =>
        ({
          id: `split:${s.key}`,
          header: (
            <span className="inline-flex items-center gap-1.5">
              <span className="size-2 rounded-[3px]" style={{ background: s.color }} />
              {s.label}
            </span>
          ),
          align: "right",
          sortValue: (g: ReportGroup) => pivotValue(result, g.key, s.key, m) ?? -Infinity,
          cell: (g: ReportGroup) => <span className="tabular">{formatValue(m, pivotValue(result, g.key, s.key, m))}</span>,
        }) satisfies Column<ReportGroup>,
    ),
    {
      id: "total",
      header: info.additive ? "Total" : "All",
      info: info.additive ? undefined : `${info.label} across every ${dimensionLabel(result.spec.splitBy!).toLowerCase()}, not an average of the columns.`,
      align: "right",
      sortValue: (g) => g.values[m] ?? -Infinity,
      cell: (g) => <span className="font-semibold tabular">{formatValue(m, g.values[m])}</span>,
    },
  ]
  return (
    <Surface elevated className="overflow-hidden">
      <DataTable rows={result.groups} columns={columns} getRowId={(g) => g.key} pageSize={25} dense />
    </Surface>
  )
}

function ResultTable({ result }: { result: ReportResult }) {
  const { groupBy, splitBy, measures } = result.spec
  const color = new Map(result.series.map((s) => [s.key, s.color]))
  const time = isTimeDimension(groupBy)
  if (isPivot(result.spec)) return <PivotTable result={result} />
  const columns: Column<ReportRow>[] = [
    { id: "group", header: dimensionLabel(groupBy), sortValue: (r) => (time ? r.group : r.label), cell: groupCell },
    ...(splitBy
      ? [
          {
            id: "split",
            header: dimensionLabel(splitBy),
            sortValue: (r: ReportRow) => r.splitLabel ?? "",
            cell: (r: ReportRow) => (
              <span className="inline-flex items-center gap-1.5">
                <span className="size-2 rounded-[3px]" style={{ background: color.get(r.split ?? "") }} />
                {r.splitLabel}
              </span>
            ),
          } satisfies Column<ReportRow>,
        ]
      : []),
    ...measures.map(
      (m) =>
        ({
          id: m,
          header: measureInfo(m).label,
          info: measureInfo(m).info,
          align: "right",
          sortValue: (r: ReportRow) => r.values[m] ?? -Infinity,
          cell: (r: ReportRow) => <span className="tabular">{formatValue(m, r.values[m])}</span>,
        }) satisfies Column<ReportRow>,
    ),
  ]
  return (
    <Surface elevated className="overflow-hidden">
      <DataTable rows={result.rows} columns={columns} getRowId={(r) => r.id} pageSize={25} dense />
    </Surface>
  )
}
