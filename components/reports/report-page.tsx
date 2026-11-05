"use client"

import { useRouter, useSearchParams } from "next/navigation"
import { CalendarClock, ChartColumn, Download, X } from "lucide-react"
import { useMemo, useState } from "react"

import { SupplierLogo } from "@/components/brand/org-avatar"
import { DataTable, type Column } from "@/components/common/data-table"
import { EmptyState } from "@/components/common/empty-state"
import { SelectFilter } from "@/components/common/filters"
import { InfoTip, Tip } from "@/components/common/info-tip"
import { PageHeader } from "@/components/common/page-header"
import { Surface } from "@/components/common/surface"
import { LocationTree } from "@/components/reports/location-tree"
import { ReportChart } from "@/components/reports/report-chart"
import { ScheduleDialog } from "@/components/reports/schedule-dialog"
import { Button } from "@/components/ui/button"
import { useData, useWorkspace } from "@/hooks/use-app"
import { downloadCsv, exportName, toCsv } from "@/lib/csv"
import { formatClockShort, formatTimestamp } from "@/lib/dates"
import { scopeOf } from "@/lib/metrics"
import {
  FILTERS,
  PERIODS,
  cadencePhrase,
  changeOf,
  csvRows,
  daysIn,
  dimensionLabel,
  filterNames,
  formatValue,
  measureInfo,
  measureLabel,
  nextSend,
  pageHref,
  periodRange,
  queryFromParams,
  rangeLabel,
  reportPages,
  reportsFor,
  runReport,
  type PageQuery,
  type ReportGroup,
  type ReportPage,
  type ReportResult,
} from "@/lib/reports"
import { joinNames, useStore } from "@/lib/store"
import type { ReportFilterKey, ReportMeasure, ReportSpec, ReportView } from "@/lib/types"
import { cn } from "@/lib/utils"

/**
 * One of the three report pages: the numbers that matter up top, or the week-by-week chart, and one table under them.
 * The period and any filters a link carried live in the URL, so the chat's "Open the report" lands on the same numbers.
 */
export function ReportPageView({ view }: { view: ReportView }) {
  const data = useData()
  const ready = useStore((s) => s.ready)
  const { ws } = useWorkspace()
  const router = useRouter()
  const params = useSearchParams()
  const [scheduling, setScheduling] = useState(false)
  const page = reportPages(ws.kind).find((p) => p.id === view)!
  const query = useMemo(() => queryFromParams(new URLSearchParams(params.toString())), [params])
  const scope = useMemo(() => scopeOf(ws), [ws])
  const table = useMemo(() => withQuery(page.table, query), [page, query])
  const result = useMemo(() => runReport(data, table, scope), [data, table, scope])
  const trend = useMemo(() => {
    if (!page.trend) return undefined
    const spec = withQuery(page.trend, query)
    const short = daysIn(periodRange(spec)) <= 14
    return runReport(data, short ? { ...spec, groupBy: page.trend.splitBy!, splitBy: undefined } : spec, scope)
  }, [data, page, query, scope])
  const saved = reportsFor(data, ws).find((r) => r.view === view)
  const go = (next: Partial<PageQuery>) => router.replace(pageHref(view, { ...query, ...next }), { scroll: false })
  const download = () => downloadCsv(exportName(page.label.toLowerCase().replace(/[^a-z0-9]+/g, "-")), toCsv(csvRows(result)))
  const hasRows = result.rows.length > 0

  return (
    <>
      <PageHeader
        className="pt-4"
        title={page.label}
        description={page.info}
        actions={
          <>
            <FilterChips filters={query.filters} onRemove={(key) => go({ filters: { ...query.filters, [key]: [] } })} />
            <PeriodPicker spec={table} onChange={(period) => go({ period, from: undefined, to: undefined })} />
            <Button variant="outline" onClick={download} disabled={!hasRows}>
              <Download /> Download
            </Button>
            {saved && (
              <Tip
                content={
                  saved.schedule
                    ? `Emailed ${cadencePhrase(saved.schedule.cadence)} at ${formatClockShort(saved.schedule.time)} to ${joinNames(saved.schedule.recipients)}. Next ${formatTimestamp(nextSend(saved.schedule).toISOString())}.`
                    : "Iris emails it fresh, with the CSV."
                }
              >
                <Button variant="outline" onClick={() => setScheduling(true)} data-tour="report-schedule">
                  <CalendarClock /> {saved.schedule ? "Emailed weekly" : "Email it"}
                </Button>
              </Tip>
            )}
          </>
        }
      />

      {!ready ? (
        <Surface elevated className="h-96 animate-pulse" />
      ) : !hasRows ? (
        <Surface elevated>
          <EmptyState icon={ChartColumn} title="Nothing in this period" description="Try a longer period, or clear the filters." />
        </Surface>
      ) : (
        <>
          {trend ? <TrendCard page={page} result={result} trend={trend} /> : <Totals page={page} result={result} />}
          <ResultTable page={page} result={result} canOpenAgency={ws.kind !== "supplier"} onOpenAgency={(id) => router.push(`/agencies/${id}`)} />
        </>
      )}

      {scheduling && saved && <ScheduleDialog key={saved.id} report={saved} open onOpenChange={setScheduling} />}
    </>
  )
}

const withQuery = (spec: ReportSpec, query: PageQuery): ReportSpec => ({
  ...spec,
  ...(query.period ? { period: query.period, from: query.from, to: query.to } : {}),
  filters: query.filters,
})

function PeriodPicker({ spec, onChange }: { spec: ReportSpec; onChange: (period: ReportSpec["period"]) => void }) {
  const options = PERIODS.filter((p) => p.id !== "custom").map((p) => ({ value: p.id, label: p.label }))
  if (spec.period === "custom") options.push({ value: "custom", label: rangeLabel(periodRange(spec)) })
  return <SelectFilter label="Period" options={options} value={spec.period} onChange={(v) => v !== "custom" && onChange(v as ReportSpec["period"])} />
}

function FilterChips({ filters, onRemove }: { filters: ReportSpec["filters"]; onRemove: (key: ReportFilterKey) => void }) {
  const active = FILTERS.filter((f) => filters[f.id]?.length)
  return active.map((f) => (
    <span key={f.id} className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-border bg-card pr-1.5 pl-3 text-body-3">
      <span className="text-faded">{f.label}</span>
      <span className="max-w-[180px] truncate font-medium">{joinNames(filterNames(f.id, filters[f.id]!))}</span>
      <button type="button" aria-label={`Clear the ${f.label.toLowerCase()} filter`} onClick={() => onRemove(f.id)} className="rounded p-0.5 text-faded hover:bg-hover hover:text-foreground">
        <X className="size-3.5" />
      </button>
    </span>
  ))
}

function Change({ m, result }: { m: ReportMeasure; result: ReportResult }) {
  const info = measureInfo(m)
  const before = result.priorTotal[m]
  if (before === null || (info.kind !== "pct" && !before)) return null
  const change = changeOf(m, result.total[m], before)
  const days = daysIn(result.range)
  if (!change) return <span className="text-caption-1 text-faded">Level with the {days} days before</span>
  const good = info.goodWhen ? (info.goodWhen === "up" ? change.delta > 0 : change.delta < 0) : undefined
  return (
    <span className={cn("text-caption-1 tabular", good === true ? "text-positive-fg" : good === false ? "text-critical-fg" : "text-faded")}>
      {change.label} vs the {days} days before
    </span>
  )
}

function Totals({ page, result }: { page: ReportPage; result: ReportResult }) {
  const measures = result.spec.measures
  return (
    <Surface elevated className="overflow-hidden" data-tour="report-totals">
      <div className={cn("grid grid-cols-2 gap-px bg-border", measures.length >= 4 ? "lg:grid-cols-4" : "sm:grid-cols-3")}>
        {measures.map((m) => (
          <div key={m} className="flex flex-col gap-1 bg-card px-5 py-4">
            <span className="flex items-center gap-1 text-caption-1 text-faded">
              {measureLabel(page, m)} <InfoTip>{measureInfo(m).info}</InfoTip>
            </span>
            <span className="text-featured-2 font-semibold tabular">{formatValue(m, result.total[m])}</span>
            <Change m={m} result={result} />
          </div>
        ))}
      </div>
    </Surface>
  )
}

function TrendCard({ page, result, trend }: { page: ReportPage; result: ReportResult; trend: ReportResult }) {
  const m = trend.spec.measures[0]
  const weekly = trend.spec.groupBy === "week"
  return (
    <Surface elevated className="overflow-hidden" data-tour="report-trend">
      <div className="flex flex-wrap items-start justify-between gap-4 px-5 pt-4">
        <div className="flex flex-col gap-1">
          <span className="text-caption-1 text-faded">
            {measureLabel(page, m)}, {rangeLabel(result.range)}
          </span>
          <span className="text-featured-2 font-semibold tabular">{formatValue(m, result.total[m])}</span>
          <Change m={m} result={result} />
        </div>
        {weekly && trend.series.length > 0 && (
          <div className="flex max-w-[60%] flex-wrap justify-end gap-x-4 gap-y-1.5 pt-1">
            {trend.series.map((s) => (
              <span key={s.key} className="inline-flex items-center gap-1.5 text-caption-1 text-faded">
                <span className="size-2 rounded-[3px]" style={{ background: s.color }} />
                {s.label}
              </span>
            ))}
          </div>
        )}
      </div>
      <div className="px-3 pt-4 pb-4">
        <ReportChart result={trend} measure={m} />
      </div>
    </Surface>
  )
}

function ResultTable({ page, result, canOpenAgency, onOpenAgency }: { page: ReportPage; result: ReportResult; canOpenAgency: boolean; onOpenAgency: (id: string) => void }) {
  const { groupBy, measures } = result.spec
  const first = measures[0]
  const sum = result.total[first] ?? 0
  const top = Math.max(...result.groups.map((g) => g.values[first] ?? 0), 0)
  const byAgency = groupBy === "agency"
  const columns: Column<ReportGroup>[] = [
    {
      id: "group",
      header: dimensionLabel(groupBy),
      sortValue: (g) => g.label,
      cell: (g) => (
        <span className="flex items-center gap-2.5">
          {byAgency && <SupplierLogo supplierId={g.key} size="sm" />}
          <span className="flex flex-col">
            <span className="font-medium">{g.label}</span>
            {g.hint && <span className="text-caption-1 text-faded">{g.hint}</span>}
          </span>
        </span>
      ),
    },
    ...measures.flatMap((m, i): Column<ReportGroup>[] => {
      const column: Column<ReportGroup> = {
        id: m,
        header: measureLabel(page, m),
        info: measureInfo(m).info,
        align: m === "hours" ? "center" : "right",
        sortValue: (g) => g.values[m] ?? -Infinity,
        cell: (g) => <span className={cn("tabular", i === 0 && "font-semibold", m === "overCard" && (g.values[m] ?? 0) > 0 && "font-semibold text-critical-fg")}>{formatValue(m, g.values[m])}</span>,
      }
      if (i > 0 || !page.share) return [column]
      return [
        column,
        {
          id: "share",
          header: "Share",
          align: "left",
          headerClassName: "w-48",
          sortValue: (g) => g.values[m] ?? 0,
          cell: (g) => {
            const v = g.values[m] ?? 0
            return (
              <span className="flex items-center gap-2.5">
                <span className="h-1.5 w-28 overflow-hidden rounded-full bg-page-faded">
                  <span className="block h-full rounded-full bg-brand-strong" style={{ width: `${top > 0 ? (v / top) * 100 : 0}%` }} />
                </span>
                <span className="w-9 text-right text-caption-1 text-faded tabular">{sum > 0 ? `${Math.round((v / sum) * 100)}%` : "—"}</span>
              </span>
            )
          },
        },
      ]
    }),
  ]
  if (groupBy === "location") {
    return (
      <Surface elevated className="overflow-hidden" data-tour="report-table">
        <LocationTree page={page} result={result} />
      </Surface>
    )
  }
  return (
    <Surface elevated className="overflow-hidden" data-tour="report-table">
      <DataTable
        rows={result.groups}
        columns={columns}
        getRowId={(g) => g.key}
        onRowClick={byAgency && canOpenAgency ? (g) => onOpenAgency(g.key) : undefined}
        pageSize={25}
      />
    </Surface>
  )
}
