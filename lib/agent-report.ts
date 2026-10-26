import { addDaysISO, todayISO, weekStartISO } from "@/lib/dates"
import { roleIn } from "@/lib/agent-shift"
import { scopeOf } from "@/lib/metrics"
import { BUYERS, CITIES, LOCATIONS, SUPPLIERS, locationsFor } from "@/lib/reference"
import { changeOf, daysIn, describeSpec, formatValue, isTimeDimension, measureInfo, reportHref, runReport } from "@/lib/reports"
import type { DemoData, ReportDimension, ReportFilterKey, ReportMeasure, ReportSpec, Workspace } from "@/lib/types"

/**
 * Turns a question about spend or performance into a report: what to measure, how to group it, over which days, and
 * for which locations, agencies, roles or markets. Rules, not a model, so it answers only what it can read for sure
 * and hands over the full report for the rest.
 */

const CUE = /\b(report|show me|how much|how many|how fast|how quickly|what did|spend|spent|spending|cost per hour|hourly cost|fill rate|no.?shows?|time to fill|break ?down|trend|compare|chart|above the clock|overbill\w*|per agency|by (agenc\w+|suppliers?|vendors?|locations?|venues?|units?|markets?|cit(y|ies)|positions?|roles?|weeks?|months?|buyers?|operators?))\b/

/** Asking Iris to do something, or about shifts still to come, isn't a question for a report. */
const NOT_A_REPORT = /\b(create|book|post|order|cancel|approve|reject|assign|upload|template|submit|open shifts|unfilled|upcoming|tomorrow|next (week|month)|this weekend)\b/

const MEASURE_WORDS: [ReportMeasure, RegExp][] = [
  ["costPerHour", /\b(cost per hour|hourly cost|per hour|bill rates?|hourly rates?)\b/],
  ["aboveClock", /\b((above|past|over) the clock|overbill\w*|padded)\b/],
  ["fillRate", /\b(fill rates?|filled|fill)\b/],
  ["noShowRate", /\bno.?shows?\b/],
  ["timeToFill", /\b(time to fill|how (fast|quickly))\b/],
  ["workers", /\b(workers|pros|headcount|people)\b/],
  ["spots", /\bspots\b/],
  ["shifts", /\b(how many shifts|shifts posted|number of shifts)\b/],
  ["hours", /\bhours( worked)?\b/],
  ["spend", /\b(spend|spent|spending|costs?|bills?|billed|billing|paid|labor)\b/],
]

const GROUP_WORDS: [ReportDimension, RegExp][] = [
  ["agency", /\b(by|per|each|which|every) (agenc\w+|suppliers?|vendors?)\b/],
  ["location", /\b(by|per|each|which|every) (locations?|venues?|units?|sites?|campus\w*)\b/],
  ["market", /\b(by|per|each|which|every) (markets?|cit(y|ies))\b/],
  ["position", /\b(by|per|each|which|every) (positions?|roles?|jobs?)\b/],
  ["buyer", /\b(by|per|each|which|every) (buyers?|operators?|sectors?|clients?)\b/],
  ["week", /\b((by|per|each|every) week|weekly|week over week|trend)\b/],
  ["month", /\b((by|per|each|every) month|monthly|month over month)\b/],
]

const MONTHS = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"]

function periodIn(lower: string, today: string): Pick<ReportSpec, "period" | "from" | "to"> | undefined {
  if (/\b(today)\b/.test(lower)) return { period: "custom", from: today, to: today }
  if (/\byesterday\b/.test(lower)) return { period: "custom", from: addDaysISO(today, -1), to: addDaysISO(today, -1) }
  if (/\bthis week\b/.test(lower)) return { period: "custom", from: weekStartISO(today), to: today }
  if (/\blast week\b/.test(lower)) {
    const from = addDaysISO(weekStartISO(today), -7)
    return { period: "custom", from, to: addDaysISO(from, 6) }
  }
  if (/\b(last|past) 7 days|past week\b/.test(lower)) return { period: "last_7" }
  if (/\bthis month\b/.test(lower)) return { period: "this_month" }
  if (/\b(last|previous) month\b/.test(lower)) return { period: "last_month" }
  if (/\b(last|past) (28 days|4 weeks|four weeks|month)\b/.test(lower)) return { period: "last_28" }
  if (/\b(last|past) 30 days\b/.test(lower)) return { period: "custom", from: addDaysISO(today, -29), to: today }
  if (/\b((last|past) (90 days|3 months|three months|quarter)|this quarter)\b/.test(lower)) return { period: "last_90" }
  const month = MONTHS.findIndex((m) => new RegExp(`\\b(in|for|during) ${m}\\b`).test(lower))
  if (month >= 0) {
    const year = Number(today.slice(0, 4)) - (month + 1 > Number(today.slice(5, 7)) ? 1 : 0)
    const from = `${year}-${String(month + 1).padStart(2, "0")}-01`
    const next = month === 11 ? `${year + 1}-01-01` : `${year}-${String(month + 2).padStart(2, "0")}-01`
    const end = addDaysISO(next, -1)
    return { period: "custom", from, to: end < today ? end : today }
  }
  return undefined
}

const named = <T extends { id: string }>(list: T[], lower: string, names: (item: T) => string[]) =>
  list.filter((item) => names(item).some((n) => n.length >= 4 && new RegExp(`\\b${n.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`).test(lower))).map((item) => item.id)

export function parseReportRequest(text: string, ws: Workspace, today = todayISO()): ReportSpec | undefined {
  const lower = text.toLowerCase().replace(/[’']/g, "")
  if (!CUE.test(lower) || NOT_A_REPORT.test(lower)) return undefined

  const measures = MEASURE_WORDS.map(([id, re]) => ({ id, at: lower.search(re) }))
    .filter((m) => m.at >= 0)
    .filter((m) => !(m.id === "spend" && /\bcost per hour|hourly cost\b/.test(lower) && !/\b(spend|spent|spending)\b/.test(lower)))
    .filter((m) => !(m.id === "hours" && /\bper hour\b/.test(lower) && !/\bhours\b/.test(lower)))
    .sort((a, b) => a.at - b.at)
    .map((m) => m.id)
    .slice(0, 4)

  const own: ReportDimension[] = ws.kind === "buyer" ? ["buyer"] : ws.kind === "supplier" ? ["agency"] : []
  const groups = GROUP_WORDS.map(([id, re]) => ({ id, at: lower.search(re) }))
    .filter((g) => g.at >= 0 && !own.includes(g.id))
    .sort((a, b) => a.at - b.at)
    .map((g) => g.id)
  if (!measures.length && !groups.length && !/\breport\b/.test(lower)) return undefined

  const locations = ws.kind === "buyer" ? locationsFor(ws.buyerId) : LOCATIONS
  const filters: ReportSpec["filters"] = {}
  const set = (key: ReportFilterKey, ids: string[]) => {
    if (ids.length) filters[key] = ids
  }
  set("location", named(locations, lower, (l) => [l.name, l.name.split(" ").slice(0, 2).join(" ")]))
  if (ws.kind !== "supplier") set("agency", named(SUPPLIERS, lower, (s) => [s.name, s.shortName]))
  if (ws.kind !== "buyer") set("buyer", named(BUYERS, lower, (b) => [b.name, b.brand]))
  set("market", named(CITIES, lower, (c) => [c.name]))
  const role = roleIn(lower)
  if (role) filters.position = [role]

  const oneVenue = filters.location?.length === 1
  const fallback: ReportDimension = ws.kind === "supplier" ? (oneVenue ? "position" : "buyer") : filters.agency ? (oneVenue ? "position" : "location") : "agency"
  const groupBy = groups[0] ?? fallback
  const splitBy = groups.find((g) => g !== groupBy)
  return {
    measures: measures.length ? measures : ["spend", "hours"],
    groupBy,
    ...(splitBy ? { splitBy } : {}),
    ...(periodIn(lower, today) ?? { period: "last_28" }),
    filters,
  }
}

/** The answer in two lines, with the whole report a click away. */
export function reportReply(data: DemoData, spec: ReportSpec, ws: Workspace, today = todayISO()): { text: string; actions: { label: string; kind: "link"; href: string }[] } {
  const result = runReport(data, spec, scopeOf(ws), today)
  const actions = [{ label: "Open the report", kind: "link" as const, href: reportHref(spec) }]
  const m = spec.measures[0]
  const info = measureInfo(m)
  if (!result.rows.length) return { text: `Nothing matches that: ${describeSpec(spec, today)}. Try a longer period or fewer filters.`, actions }

  const change = changeOf(m, result.total[m], result.priorTotal[m])
  const rest = spec.measures.slice(1).map((x) => `${measureInfo(x).label.toLowerCase()} ${formatValue(x, result.total[x])}`)
  const first = [
    `${describeSpec(spec, today)}.`,
    `${info.additive ? "Total" : "Overall"} ${formatValue(m, result.total[m])}${change ? ` (${change.label} on the ${daysIn(result.range)} days before)` : ""}${rest.length ? `, ${rest.join(", ")}` : ""}.`,
  ].join("\n")

  let second = ""
  if (isTimeDimension(spec.groupBy)) {
    const ranked = result.groups.filter((g) => g.values[m] !== null && !g.partial)
    const best = [...ranked].sort((a, b) => (b.values[m] ?? 0) - (a.values[m] ?? 0))[0]
    const low = [...ranked].sort((a, b) => (a.values[m] ?? 0) - (b.values[m] ?? 0))[0]
    if (best && low && best !== low) second = `Highest: ${best.label} at ${formatValue(m, best.values[m])}. Lowest: ${low.label} at ${formatValue(m, low.values[m])}.`
  } else {
    const top = result.groups.filter((g) => g.values[m] !== null).slice(0, 4)
    const sum = result.total[m] ?? 0
    second = top
      .map((g) => `${g.label} ${formatValue(m, g.values[m])}${info.additive && sum > 0 && top.length > 1 ? ` (${Math.round(((g.values[m] ?? 0) / sum) * 100)}%)` : ""}`)
      .join(" · ")
    if (result.groups.length > top.length) second += ` · and ${result.groups.length - top.length} more`
  }
  return { text: [first, second].filter(Boolean).join("\n"), actions }
}
