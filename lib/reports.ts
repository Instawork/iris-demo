import { differenceInCalendarDays, format } from "date-fns"

import { addDaysISO, formatDateShort, instantAt, parseDate, todayISO, wallClock, weekStartISO } from "@/lib/dates"
import { hours as formatHours, money, moneyCompact, moneyWhole, pct } from "@/lib/format"
import { formatTimeToFill, groupPhase, inScope } from "@/lib/metrics"
import { BUYERS, WORKSPACES, buyer, city, findCity, findLocation, findPosition, findSupplier, location, orgOf, position, supplier } from "@/lib/reference"
import { hoursAboveClock, timesheetAmount } from "@/lib/timesheets"
import type { DemoData, ReportDimension, ReportFilterKey, ReportMeasure, ReportPeriod, ReportSchedule, ReportSpec, ReportView, SavedReport, Scope, Workspace } from "@/lib/types"

/**
 * One engine behind saved reports, the builder, report links, the chat and the CSV, so a number reads the same
 * wherever it shows up. Spend, hours and workers come from timesheets by the day worked. Shifts, fill, no-shows and
 * time to fill come from posted shifts by the shift's date, counted for the agency the shift went to first, the way the
 * rest of Iris counts them.
 */

export type MeasureKind = "money" | "hours" | "count" | "pct" | "duration" | "rate"

export interface MeasureInfo {
  id: ReportMeasure
  label: string
  kind: MeasureKind
  info: string
  /** Adds up across groups, so a split stacks. */
  additive: boolean
  /** Which way is better, for coloring the change. Volumes have no better way. */
  goodWhen?: "up" | "down"
}

export const MEASURES: MeasureInfo[] = [
  { id: "spend", label: "Spend", kind: "money", additive: true, goodWhen: "down", info: "Billed hours at each agency's bill rate, with overtime, tips and expenses, by the day worked." },
  { id: "hours", label: "Hours worked", kind: "hours", additive: true, info: "Hours billed on timesheets." },
  { id: "workers", label: "Workers", kind: "count", additive: false, info: "Different workers who worked." },
  { id: "costPerHour", label: "Cost per hour", kind: "rate", additive: false, goodWhen: "down", info: "Spend divided by hours worked, with overtime, tips and expenses." },
  {
    id: "aboveClock",
    label: "Billed above the clock",
    kind: "money",
    additive: true,
    goodWhen: "down",
    info: "Billed hours past Iris's own clock, at the agency's bill rate. Iris flags each one before it's approved.",
  },
  { id: "shifts", label: "Shifts", kind: "count", additive: true, info: "Shifts posted, not counting cancelled ones." },
  { id: "spots", label: "Spots", kind: "count", additive: true, info: "Workers requested on those shifts." },
  { id: "fillRate", label: "Fill rate", kind: "pct", additive: false, goodWhen: "up", info: "Share of spots filled, on shifts that have ended." },
  { id: "noShowRate", label: "No-show rate", kind: "pct", additive: false, goodWhen: "down", info: "Share of filled spots where the worker didn't show." },
  { id: "timeToFill", label: "Time to fill", kind: "duration", additive: false, goodWhen: "down", info: "Median time from posting a shift to a worker confirming." },
]

export const DIMENSIONS: { id: ReportDimension; label: string; time?: boolean }[] = [
  { id: "week", label: "Week", time: true },
  { id: "month", label: "Month", time: true },
  { id: "buyer", label: "Buyer" },
  { id: "location", label: "Location" },
  { id: "market", label: "Market" },
  { id: "agency", label: "Agency" },
  { id: "position", label: "Position" },
]

export const PERIODS: { id: ReportPeriod; label: string }[] = [
  { id: "last_7", label: "Last 7 days" },
  { id: "last_28", label: "Last 28 days" },
  { id: "last_90", label: "Last 90 days" },
  { id: "this_month", label: "This month" },
  { id: "last_month", label: "Last month" },
  { id: "custom", label: "Custom dates" },
]

export const FILTERS: { id: ReportFilterKey; label: string }[] = [
  { id: "buyer", label: "Buyer" },
  { id: "location", label: "Location" },
  { id: "market", label: "Market" },
  { id: "agency", label: "Agency" },
  { id: "position", label: "Position" },
]

export const MAX_MEASURES = 4

const MEASURE = Object.fromEntries(MEASURES.map((m) => [m.id, m])) as Record<ReportMeasure, MeasureInfo>
const DIMENSION = Object.fromEntries(DIMENSIONS.map((d) => [d.id, d])) as Record<ReportDimension, (typeof DIMENSIONS)[number]>
const PERIOD = Object.fromEntries(PERIODS.map((p) => [p.id, p])) as Record<ReportPeriod, (typeof PERIODS)[number]>

export const measureInfo = (id: ReportMeasure) => MEASURE[id]
export const dimensionLabel = (id: ReportDimension) => DIMENSION[id].label
export const isTimeDimension = (id: ReportDimension) => !!DIMENSION[id].time
export const periodLabel = (id: ReportPeriod) => PERIOD[id].label

/* --------------------------------- Periods --------------------------------- */

export interface DateRange {
  from: string
  to: string
}

const monthStart = (iso: string) => `${iso.slice(0, 8)}01`

export function periodRange(spec: Pick<ReportSpec, "period" | "from" | "to">, today = todayISO()): DateRange {
  switch (spec.period) {
    case "last_7":
      return { from: addDaysISO(today, -6), to: today }
    case "last_90":
      return { from: addDaysISO(today, -89), to: today }
    case "this_month":
      return { from: monthStart(today), to: today }
    case "last_month": {
      const end = addDaysISO(monthStart(today), -1)
      return { from: monthStart(end), to: end }
    }
    case "custom":
      if (spec.from && spec.to) return spec.from <= spec.to ? { from: spec.from, to: spec.to } : { from: spec.to, to: spec.from }
      return { from: addDaysISO(today, -27), to: today }
    default:
      return { from: addDaysISO(today, -27), to: today }
  }
}

export const daysIn = (r: DateRange) => differenceInCalendarDays(parseDate(r.to), parseDate(r.from)) + 1

/** The same number of days just before, for the change on each total. */
export function priorRange(r: DateRange): DateRange {
  const n = daysIn(r)
  return { from: addDaysISO(r.from, -n), to: addDaysISO(r.from, -1) }
}

export const rangeLabel = (r: DateRange) =>
  r.from.slice(0, 4) === r.to.slice(0, 4) ? `${formatDateShort(r.from)} – ${formatDateShort(r.to)}` : `${format(parseDate(r.from), "MMM d, yyyy")} – ${format(parseDate(r.to), "MMM d, yyyy")}`

/* ---------------------------------- Keys ----------------------------------- */

interface Fact {
  date: string
  buyerId: string
  locationId: string
  supplierId: string
  positionId: string
}

const KEY: Record<ReportDimension, (f: Fact) => string> = {
  week: (f) => weekStartISO(f.date),
  month: (f) => f.date.slice(0, 7),
  buyer: (f) => f.buyerId,
  location: (f) => f.locationId,
  market: (f) => location(f.locationId).cityId,
  agency: (f) => f.supplierId,
  position: (f) => f.positionId,
}

export function keyLabel(dim: ReportDimension, key: string): { label: string; hint?: string } {
  switch (dim) {
    case "week":
      return { label: `Week of ${formatDateShort(key)}` }
    case "month":
      return { label: format(parseDate(`${key}-01`), "MMMM yyyy") }
    case "buyer":
      return { label: buyer(key).name }
    case "location": {
      const l = location(key)
      return { label: l.name, hint: `${buyer(l.buyerId).name} · ${l.costCenter}` }
    }
    case "market": {
      const c = city(key)
      return { label: `${c.name}, ${c.state}` }
    }
    case "agency":
      return { label: supplier(key).shortName }
    case "position":
      return { label: position(key).name }
  }
}

const PALETTE = ["var(--chart-1)", "var(--chart-3)", "var(--chart-4)", "var(--chart-5)", "var(--brand-strong)", "var(--critical)", "var(--warning)", "var(--chart-2)"]

export const colorOf = (dim: ReportDimension, key: string, index: number) => (dim === "agency" ? supplier(key).color : PALETTE[index % PALETTE.length])

const nextMonth = (ym: string) => {
  const [y, m] = ym.split("-").map(Number)
  return m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, "0")}`
}

const bucketEnd = (dim: ReportDimension, key: string) => (dim === "week" ? addDaysISO(key, 6) : addDaysISO(`${nextMonth(key)}-01`, -1))

/** Every week or month in the range, so a quiet one still shows up as a zero. */
function timeKeys(dim: ReportDimension, r: DateRange): string[] {
  const keys: string[] = []
  if (dim === "week") for (let w = weekStartISO(r.from); w <= r.to; w = addDaysISO(w, 7)) keys.push(w)
  if (dim === "month") for (let m = r.from.slice(0, 7); m <= r.to.slice(0, 7); m = nextMonth(m)) keys.push(m)
  return keys
}

/* --------------------------------- Engine ---------------------------------- */

interface Acc {
  facts: number
  spend: number
  hours: number
  workers: Set<string>
  above: number
  shifts: number
  spots: number
  ended: number
  filled: number
  noShows: number
  fills: number[]
}

const blank = (): Acc => ({ facts: 0, spend: 0, hours: 0, workers: new Set(), above: 0, shifts: 0, spots: 0, ended: 0, filled: 0, noShows: 0, fills: [] })

const median = (values: number[]) => {
  const sorted = [...values].sort((a, b) => a - b)
  return sorted[Math.floor(sorted.length / 2)]
}

const round = (n: number, digits = 2) => Math.round(n * 10 ** digits) / 10 ** digits

export type MeasureValues = Record<ReportMeasure, number | null>

function valuesOf(acc: Acc): MeasureValues {
  return {
    spend: round(acc.spend),
    hours: round(acc.hours),
    workers: acc.workers.size,
    costPerHour: acc.hours ? round(acc.spend / acc.hours) : null,
    aboveClock: round(acc.above),
    shifts: acc.shifts,
    spots: acc.spots,
    fillRate: acc.ended ? acc.filled / acc.ended : null,
    noShowRate: acc.filled ? acc.noShows / acc.filled : null,
    timeToFill: acc.fills.length ? median(acc.fills) : null,
  }
}

export interface ReportGroup {
  key: string
  label: string
  hint?: string
  /** A week or month the period ends partway through. */
  partial?: boolean
  values: MeasureValues
}

export interface ReportSeries {
  key: string
  label: string
  color: string
}

export interface ReportRow {
  id: string
  group: string
  label: string
  hint?: string
  split?: string
  splitLabel?: string
  values: MeasureValues
}

export interface ReportResult {
  spec: ReportSpec
  range: DateRange
  prior: DateRange
  groups: ReportGroup[]
  /** The split's values, ordered by the first measure. Empty without a split. */
  series: ReportSeries[]
  /** One per group, or one per group and split. */
  rows: ReportRow[]
  /** Values by `${group}|${split}`. */
  cells: Record<string, MeasureValues>
  total: MeasureValues
  priorTotal: MeasureValues
}

const passes = (filters: ReportSpec["filters"]) => {
  const active = (Object.entries(filters) as [ReportFilterKey, string[] | undefined][]).filter(([, ids]) => ids?.length)
  return (f: Fact) => active.every(([key, ids]) => ids!.includes(KEY[key](f)))
}

const byValue = (m: ReportMeasure) => (a: { values: MeasureValues; label: string }, b: { values: MeasureValues; label: string }) =>
  (b.values[m] ?? -Infinity) - (a.values[m] ?? -Infinity) || a.label.localeCompare(b.label)

export function runReport(data: DemoData, spec: ReportSpec, scope: Scope, today = todayISO()): ReportResult {
  const range = periodRange(spec, today)
  const prior = priorRange(range)
  const pass = passes(spec.filters)
  const groupKey = KEY[spec.groupBy]
  const splitKey = spec.splitBy ? KEY[spec.splitBy] : undefined
  const groups = new Map<string, Acc>()
  const splits = new Map<string, Acc>()
  const cells = new Map<string, Acc>()
  const total = blank()
  const priorTotal = blank()
  const target = (f: Fact) => {
    const g = groupKey(f)
    const s = splitKey?.(f)
    const accs = [total, groups.get(g) ?? groups.set(g, blank()).get(g)!]
    if (s !== undefined) {
      accs.push(splits.get(s) ?? splits.set(s, blank()).get(s)!)
      const c = `${g}|${s}`
      accs.push(cells.get(c) ?? cells.set(c, blank()).get(c)!)
    }
    return accs
  }
  const when = (date: string) => (date >= range.from && date <= range.to ? "now" : date >= prior.from && date <= prior.to ? "prior" : undefined)

  for (const t of data.timesheets) {
    const at = when(t.date)
    if (!at || !inScope(scope, t) || !pass(t)) continue
    const amount = timesheetAmount(t)
    const above = hoursAboveClock(t) * t.billRate
    for (const acc of at === "now" ? target(t) : [priorTotal]) {
      acc.facts += 1
      acc.spend += amount
      acc.above += above
      if (t.status === "removed") continue
      acc.hours += t.hours
      acc.workers.add(t.proId)
    }
  }

  for (const g of data.groups) {
    const at = when(g.date)
    if (!at || g.cancelledAt || !inScope(scope, g) || !pass(g)) continue
    const ended = groupPhase(g) === "past"
    const created = Date.parse(g.createdAt)
    for (const acc of at === "now" ? target(g) : [priorTotal]) {
      acc.facts += 1
      acc.shifts += 1
      acc.spots += g.slots.length
      for (const s of g.slots) {
        if (s.confirmedAt) acc.fills.push((Date.parse(s.confirmedAt) - created) / 3600_000)
        if (!ended) continue
        acc.ended += 1
        if (s.proId) acc.filled += 1
        if (s.status === "no_show") acc.noShows += 1
      }
    }
  }

  const first = spec.measures[0]
  const time = isTimeDimension(spec.groupBy)
  const keys = timeKeys(spec.groupBy, range)
  const start = keys.findIndex((key) => groups.has(key))
  if (start >= 0) for (const key of keys.slice(start)) if (!groups.has(key)) groups.set(key, blank())
  const groupList: ReportGroup[] = [...groups.entries()].map(([key, acc]) => {
    const label = keyLabel(spec.groupBy, key)
    const partial = time && bucketEnd(spec.groupBy, key) > range.to
    return { key, ...label, ...(partial ? { label: `${label.label}, so far`, partial } : {}), values: valuesOf(acc) }
  })
  groupList.sort(time ? (a, b) => a.key.localeCompare(b.key) : byValue(first))

  const splitList = [...splits.entries()].map(([key, acc]) => ({ key, ...keyLabel(spec.splitBy!, key), values: valuesOf(acc) }))
  splitList.sort(spec.splitBy && isTimeDimension(spec.splitBy) ? (a, b) => a.key.localeCompare(b.key) : byValue(first))
  const series = splitList.map((s, i) => ({ key: s.key, label: s.label, color: colorOf(spec.splitBy!, s.key, i) }))

  const cellValues = Object.fromEntries([...cells.entries()].map(([key, acc]) => [key, valuesOf(acc)]))
  const rows: ReportRow[] = spec.splitBy
    ? groupList.flatMap((g) =>
        series
          .filter((s) => cellValues[`${g.key}|${s.key}`])
          .map((s) => ({ id: `${g.key}|${s.key}`, group: g.key, label: g.label, hint: g.hint, split: s.key, splitLabel: s.label, values: cellValues[`${g.key}|${s.key}`] })),
      )
    : groupList.map((g) => ({ id: g.key, group: g.key, label: g.label, hint: g.hint, values: g.values }))

  return { spec, range, prior, groups: groupList, series, rows, cells: cellValues, total: valuesOf(total), priorTotal: valuesOf(priorTotal) }
}

/** The chart's rows: one per group, with a value per split, or a single `value`. */
export function chartRows(result: ReportResult, m: ReportMeasure) {
  return result.groups.map((g) => ({
    key: g.key,
    label: g.label,
    ...(result.series.length
      ? Object.fromEntries(result.series.map((s) => [s.key, result.cells[`${g.key}|${s.key}`]?.[m] ?? (measureInfo(m).additive ? 0 : null)]))
      : { value: g.values[m] }),
  }))
}

/* -------------------------------- Formatting ------------------------------- */

export function formatValue(m: ReportMeasure, v: number | null | undefined, compact = false): string {
  if (v === null || v === undefined) return "—"
  switch (MEASURE[m].kind) {
    case "money":
      return compact ? moneyCompact(v) : m === "spend" ? moneyWhole(v) : money(v)
    case "hours":
      return compact && v >= 1000 ? `${(v / 1000).toFixed(1)}k hrs` : formatHours(Math.round(v * 10) / 10)
    case "count":
      return v.toLocaleString("en-US")
    case "pct":
      return pct(v, compact ? 0 : 1)
    case "duration":
      return formatTimeToFill(v)
    case "rate":
      return `${money(v)}/hr`
  }
}

const CSV_UNIT: Partial<Record<MeasureKind, string>> = { money: " ($)", hours: " (hrs)", pct: " (%)", duration: " (hrs)", rate: " ($/hr)" }

const csvValue = (m: ReportMeasure, v: number | null | undefined) => {
  const kind = MEASURE[m].kind
  if (v === null || v === undefined) return ""
  return kind === "pct" ? (v * 100).toFixed(1) : kind === "count" ? v : kind === "duration" ? v.toFixed(1) : v.toFixed(2)
}

/** One measure split by something reads best as a grid: groups down, the split across, and a total. */
export const isPivot = (spec: ReportSpec) => !!spec.splitBy && spec.measures.length === 1

/** The cell of a pivot: missing means none for amounts, and unknown for rates. */
export const pivotValue = (result: ReportResult, group: string, split: string, m: ReportMeasure) =>
  result.cells[`${group}|${split}`]?.[m] ?? (MEASURE[m].additive ? 0 : null)

/** The report's rows as plain numbers, the way a spreadsheet wants them, laid out like the table on screen. */
export function csvRows(result: ReportResult): Record<string, string | number>[] {
  const { groupBy, splitBy, measures } = result.spec
  if (isPivot(result.spec)) {
    const m = measures[0]
    const unit = CSV_UNIT[MEASURE[m].kind] ?? ""
    return result.groups.map((g) => ({
      [DIMENSION[groupBy].label]: g.label,
      ...Object.fromEntries(result.series.map((s) => [`${s.label}${unit}`, csvValue(m, pivotValue(result, g.key, s.key, m))])),
      [`${MEASURE[m].additive ? "Total" : "All"}${unit}`]: csvValue(m, g.values[m]),
    }))
  }
  return result.rows.map((r) => ({
    [DIMENSION[groupBy].label]: r.label,
    ...(splitBy ? { [DIMENSION[splitBy].label]: r.splitLabel ?? "" } : {}),
    ...Object.fromEntries(measures.map((m) => [`${MEASURE[m].label}${CSV_UNIT[MEASURE[m].kind] ?? ""}`, csvValue(m, r.values[m])])),
  }))
}

/** The change against the prior period: relative for amounts, in points for rates. */
export function changeOf(m: ReportMeasure, now: number | null, before: number | null): { delta: number; label: string } | undefined {
  if (now === null || before === null) return undefined
  if (MEASURE[m].kind === "pct") {
    const delta = (now - before) * 100
    return Math.abs(delta) < 0.05 ? undefined : { delta, label: `${delta > 0 ? "+" : "−"}${Math.abs(delta).toFixed(1)} pts` }
  }
  if (!before) return undefined
  const delta = now / before - 1
  return Math.abs(delta) < 0.0005 ? undefined : { delta, label: `${delta > 0 ? "+" : "−"}${Math.abs(delta * 100).toFixed(1)}%` }
}

const joinWords = (words: string[]) => (words.length <= 1 ? (words[0] ?? "") : `${words.slice(0, -1).join(", ")} and ${words[words.length - 1]}`)

export function filterNames(key: ReportFilterKey, ids: string[]) {
  const dim: ReportDimension = key
  return ids.map((id) => keyLabel(dim, id).label)
}

/** The report in a sentence, for subtitles, the chat and scheduled emails. */
/** A report's name, its period and what it's filtered to, as separate phrases. */
export function specParts(spec: ReportSpec, today = todayISO()) {
  const what = joinWords(spec.measures.map((m, i) => (i ? MEASURE[m].label.toLowerCase() : MEASURE[m].label)))
  const by = ` by ${DIMENSION[spec.groupBy].label.toLowerCase()}${spec.splitBy ? ` and ${DIMENSION[spec.splitBy].label.toLowerCase()}` : ""}`
  const when = spec.period === "custom" ? rangeLabel(periodRange(spec, today)) : PERIOD[spec.period].label.toLowerCase()
  const only = FILTERS.filter((f) => spec.filters[f.id]?.length).flatMap((f) => filterNames(f.id, spec.filters[f.id]!))
  return { title: `${what}${by}`, when, only: only.length ? joinWords(only) : undefined }
}

export function describeSpec(spec: ReportSpec, today = todayISO()): string {
  const { title, when, only } = specParts(spec, today)
  return `${title}, ${when}${only ? `. Filtered to ${only}` : ""}`
}

/* ---------------------------------- Links ---------------------------------- */

const MEASURE_IDS = new Set<string>(MEASURES.map((m) => m.id))
const DIMENSION_IDS = new Set<string>(DIMENSIONS.map((d) => d.id))
const PERIOD_IDS = new Set<string>(PERIODS.map((p) => p.id))
const DATE = /^\d{4}-\d{2}-\d{2}$/

const known: Record<ReportFilterKey, (id: string) => boolean> = {
  buyer: (id) => BUYERS.some((b) => b.id === id),
  location: (id) => !!findLocation(id),
  market: (id) => !!findCity(id),
  agency: (id) => !!findSupplier(id),
  position: (id) => !!findPosition(id),
}

/** A spec from a link, the chat or a request, with anything unknown dropped. Undefined when nothing usable is left. */
export function cleanSpec(input: unknown): ReportSpec | undefined {
  if (!input || typeof input !== "object") return undefined
  const raw = input as Record<string, unknown>
  const measures = Array.isArray(raw.measures) ? [...new Set(raw.measures.filter((m): m is ReportMeasure => typeof m === "string" && MEASURE_IDS.has(m)))].slice(0, MAX_MEASURES) : []
  const groupBy = typeof raw.groupBy === "string" && DIMENSION_IDS.has(raw.groupBy) ? (raw.groupBy as ReportDimension) : undefined
  if (!measures.length || !groupBy) return undefined
  const splitBy = typeof raw.splitBy === "string" && DIMENSION_IDS.has(raw.splitBy) && raw.splitBy !== groupBy ? (raw.splitBy as ReportDimension) : undefined
  let period = typeof raw.period === "string" && PERIOD_IDS.has(raw.period) ? (raw.period as ReportPeriod) : "last_28"
  const from = typeof raw.from === "string" && DATE.test(raw.from) ? raw.from : undefined
  const to = typeof raw.to === "string" && DATE.test(raw.to) ? raw.to : undefined
  if (period === "custom" && (!from || !to)) period = "last_28"
  const given = raw.filters && typeof raw.filters === "object" ? (raw.filters as Record<string, unknown>) : {}
  const filters: ReportSpec["filters"] = {}
  for (const f of FILTERS) {
    const list = given[f.id]
    if (!Array.isArray(list)) continue
    const ids = [...new Set(list.filter((id): id is string => typeof id === "string" && known[f.id](id)))].slice(0, 50)
    if (ids.length) filters[f.id] = ids
  }
  return { measures, groupBy, ...(splitBy ? { splitBy } : {}), period, ...(period === "custom" ? { from, to } : {}), filters }
}

/** The period and filters a report page was opened with. A missing period means the page's own. */
export type PageQuery = Partial<Pick<ReportSpec, "period" | "from" | "to">> & Pick<ReportSpec, "filters">

export function pageHref(view: ReportView, query: Partial<PageQuery> = {}): string {
  const q = new URLSearchParams()
  if (query.period) q.set("period", query.period)
  if (query.period === "custom" && query.from && query.to) {
    q.set("from", query.from)
    q.set("to", query.to)
  }
  for (const f of FILTERS) if (query.filters?.[f.id]?.length) q.set(f.id, query.filters[f.id]!.join(","))
  const search = q.toString()
  return `/reports/${view}${search ? `?${search}` : ""}`
}

export function queryFromParams(params: URLSearchParams): PageQuery {
  const clean = cleanSpec({
    measures: ["spend"],
    groupBy: "week",
    period: params.get("period") ?? undefined,
    from: params.get("from") ?? undefined,
    to: params.get("to") ?? undefined,
    filters: Object.fromEntries(FILTERS.map((f) => [f.id, params.get(f.id)?.split(",").filter(Boolean) ?? []])),
  })!
  const asked = params.get("period")
  const period = asked === clean.period ? { period: clean.period, ...(clean.period === "custom" ? { from: clean.from, to: clean.to } : {}) } : {}
  return { ...period, filters: clean.filters }
}

const PERFORMANCE = new Set<ReportMeasure>(["fillRate", "noShowRate", "timeToFill", "shifts", "spots"])

/** Which of the three pages answers a spec best: performance goes to the scorecard, places to locations, money to spend. */
export function viewFor(spec: ReportSpec): ReportView {
  if (spec.measures.some((m) => PERFORMANCE.has(m))) return "scorecard"
  if (spec.groupBy === "location" || spec.splitBy === "location") return "locations"
  return "spend"
}

/** A link to the page that answers this spec, carrying its period and filters. */
export const reportHref = (spec: ReportSpec): string =>
  pageHref(viewFor(spec), { period: spec.period, from: spec.from, to: spec.to, filters: spec.filters })

export function specFromParams(params: URLSearchParams): ReportSpec | undefined {
  if (!params.get("m") || !params.get("by")) return undefined
  return cleanSpec({
    measures: params.get("m")!.split(","),
    groupBy: params.get("by"),
    splitBy: params.get("split") ?? undefined,
    period: params.get("period") ?? undefined,
    from: params.get("from") ?? undefined,
    to: params.get("to") ?? undefined,
    filters: Object.fromEntries(FILTERS.map((f) => [f.id, params.get(f.id)?.split(",").filter(Boolean) ?? []])),
  })
}

export const sameSpec = (a: ReportSpec, b: ReportSpec) => JSON.stringify(cleanSpec(a)) === JSON.stringify(cleanSpec(b))

/* ------------------------------ Saved reports ------------------------------ */

export const reportsFor = (data: DemoData, ws: Workspace) => data.reports.filter((r) => r.org === orgOf(ws))

export const CADENCES: { id: ReportSchedule["cadence"]; label: string }[] = [
  { id: "daily", label: "Every day" },
  { id: "weekly", label: "Every Monday" },
  { id: "monthly", label: "On the 1st of each month" },
]

/** For the middle of a sentence: "emailed every Monday at 7am". */
export const cadencePhrase = (c: ReportSchedule["cadence"]) => (c === "daily" ? "every day" : c === "weekly" ? "every Monday" : "on the 1st of each month")

/** The next time a schedule goes out, after `now`. */
export function nextSend(schedule: Pick<ReportSchedule, "cadence" | "time">, now = new Date()): Date {
  let date = wallClock(now).date
  for (let i = 0; i < 40; i++) {
    const day = parseDate(date)
    const due = schedule.cadence === "daily" || (schedule.cadence === "weekly" && day.getDay() === 1) || (schedule.cadence === "monthly" && day.getDate() === 1)
    const at = instantAt(date, schedule.time)
    if (due && at > now) return at
    date = addDaysISO(date, 1)
  }
  return instantAt(date, schedule.time)
}

/** The last time a schedule went out, at or before `now`. */
function lastSend(schedule: Pick<ReportSchedule, "cadence" | "time">, now: Date): Date | undefined {
  let date = wallClock(now).date
  for (let i = 0; i < 40; i++) {
    const day = parseDate(date)
    const due = schedule.cadence === "daily" || (schedule.cadence === "weekly" && day.getDay() === 1) || (schedule.cadence === "monthly" && day.getDate() === 1)
    const at = instantAt(date, schedule.time)
    if (due && at <= now) return at
    date = addDaysISO(date, -1)
  }
  return undefined
}

const spec = (measures: ReportMeasure[], groupBy: ReportDimension, period: ReportPeriod, extra: Partial<ReportSpec> = {}): ReportSpec => ({
  measures,
  groupBy,
  period,
  filters: {},
  ...extra,
})

/* ------------------------------- Report pages ------------------------------ */

export interface ReportPage {
  id: ReportView
  label: string
  info: string
  /** The table: one row per agency, location or buyer. */
  table: ReportSpec
  /** The chart above the table, week by week. */
  trend?: ReportSpec
  /** Each row's share of the first measure, as a bar. */
  share?: boolean
  /** What this side calls a measure, like "Billed" for an agency's spend. */
  labels?: Partial<Record<ReportMeasure, string>>
}

/** The same three pages for every side, each seen from that side: agencies see buyers where others see agencies. */
export function reportPages(kind: Workspace["kind"]): ReportPage[] {
  const agency = kind === "supplier"
  const who: ReportDimension = agency ? "buyer" : "agency"
  const labels = agency ? { spend: "Billed" } : undefined
  return [
    {
      id: "scorecard",
      label: agency ? "Your scorecard" : "Agency scorecard",
      info: agency ? "How you fill each buyer's shifts, how reliably and how fast, and what you billed." : "How each agency fills, shows up and how fast, and what it billed.",
      table: spec(["fillRate", "noShowRate", "timeToFill", "spend"], who, "last_28"),
      labels,
    },
    {
      id: "locations",
      label: agency ? "Billed by location" : "Spend by location",
      info: agency ? "What you billed at each location, and what an hour costs there." : "Every location's labor spend, and what an hour costs there.",
      table: spec(["spend", "hours", "costPerHour"], "location", "last_28"),
      share: true,
      labels,
    },
    {
      id: "spend",
      label: agency ? "Billed by buyer" : "Spend by agency",
      info: agency ? "What you billed each week, and each buyer's share." : "What each agency billed each week, and its share of the total.",
      table: spec(["spend", "hours", "costPerHour"], who, "last_90"),
      trend: spec(["spend"], "week", "last_90", { splitBy: who }),
      share: true,
      labels,
    },
  ]
}

export const REPORT_VIEWS: ReportView[] = ["scorecard", "locations", "spend"]

export const isReportView = (value: string): value is ReportView => (REPORT_VIEWS as string[]).includes(value)

export const measureLabel = (page: ReportPage, m: ReportMeasure) => page.labels?.[m] ?? MEASURE[m].label

/** Every organization starts with its three pages saved, so each can be emailed. Compass already sends spend every Monday. */
export function defaultReports(now: string): SavedReport[] {
  const at = new Date(now)
  const weekly: ReportSchedule = { cadence: "weekly", time: "07:00", recipients: ["Priya Raman", "Tom Becker"] }
  const sent = lastSend(weekly, at)
  const orgs = new Map<string, Workspace>()
  for (const w of WORKSPACES.filter((x) => !x.approves?.length)) if (!orgs.has(orgOf(w))) orgs.set(orgOf(w), w)
  const list: Omit<SavedReport, "id" | "createdAt" | "updatedAt">[] = [...orgs].flatMap(([org, w]) =>
    reportPages(w.kind).map((page) => ({
      name: page.label,
      description: page.info,
      org,
      view: page.id,
      createdBy: w.kind === "compass" ? "Priya Raman" : w.user.name,
      spec: page.table,
      ...(org === "compass" && page.id === "spend" ? { schedule: { ...weekly, ...(sent ? { lastSentAt: sent.toISOString() } : {}) } } : {}),
    })),
  )
  return list.map((r, i) => ({ ...r, id: `rep-${i + 1}`, createdAt: now, updatedAt: now }))
}
