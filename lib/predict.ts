import type { ParsedAgentShift } from "@/lib/agent-shift"
import { canWork, summaryOf } from "@/lib/compliance"
import { addDaysISO, daysFromToday, formatClockShort, formatDay, paidHours, parseDate, todayISO } from "@/lib/dates"
import { moneyWhole, plural } from "@/lib/format"
import { filledCount, groupPhase, isOpenTo, locationRanking, needsAttention, scopeOf } from "@/lib/metrics"
import { buyer, city, location, position } from "@/lib/reference"
import type { DemoData, ShiftGroup, Workspace } from "@/lib/types"

export interface Prediction {
  id: string
  kind: "recurring" | "fill-risk" | "expiring" | "spend"
  title: string
  detail: string
  /** Why Iris expects it, in one sentence. */
  evidence: string
  /** Past values, then the ones Iris expects. */
  bars?: { value: number; predicted: boolean }[]
  cta: string
  draft?: { ask: string; request: ParsedAgentShift }
  href?: string
}

const LOOKBACK_DAYS = 42
const HORIZON_DAYS = 35
const WEEKDAY = (iso: string) => formatDay(iso, "EEEE")
const median = (values: number[]) => {
  const sorted = [...values].sort((a, b) => a - b)
  return sorted[Math.floor(sorted.length / 2)] ?? 0
}

/** Shifts a buyer posts every week or every other week, projected one occurrence past the last one already posted. */
function recurringShifts(data: DemoData, buyerId: string): Prediction[] {
  const today = todayISO()
  const from = addDaysISO(today, -LOOKBACK_DAYS)
  const series = new Map<string, ShiftGroup[]>()
  for (const g of data.groups) {
    if (g.buyerId !== buyerId || g.cancelledAt || g.date < from) continue
    const key = [g.locationId, g.positionId, parseDate(g.date).getDay(), g.start, g.end].join("|")
    series.set(key, [...(series.get(key) ?? []), g])
  }
  const out: (Prediction & { date: string; spots: number })[] = []
  for (const [key, groups] of series) {
    const past = groups.filter((g) => g.date < today).sort((a, b) => a.date.localeCompare(b.date))
    if (past.length < 3) continue
    const dates = [...new Set(groups.map((g) => g.date))].sort()
    const gaps = dates.slice(1).map((d, i) => Math.round((parseDate(d).getTime() - parseDate(dates[i]).getTime()) / 86_400_000))
    const interval = median(gaps)
    if (interval !== 7 && interval !== 14) continue
    const next = addDaysISO(dates[dates.length - 1], interval)
    if (daysFromToday(next) > HORIZON_DAYS) continue
    const recent = past.slice(-5)
    const headcount = Math.max(1, Math.round(median(recent.map((g) => g.slots.length))))
    const last = groups[groups.length - 1]
    const loc = location(last.locationId)
    const pos = position(last.positionId)
    const estimate = paidHours(last.start, last.end, last.breakMins) * last.billRate * headcount
    const cadence = interval === 7 ? `Every ${WEEKDAY(next)}` : `Every other ${WEEKDAY(next)}`
    out.push({
      id: `recurring:${key}`,
      kind: "recurring",
      date: next,
      spots: headcount,
      title: `${pos.name} · ${loc.name}`,
      detail: `${cadence} · ${plural(headcount, "Pro")} · ${formatClockShort(last.start)}–${formatClockShort(last.end)} · ${formatDay(next)} · est. ${moneyWhole(estimate)}`,
      evidence: `You posted this shift ${plural(past.length, "time")} in the last 6 weeks. ${formatDay(next, "EEEE, MMMM d")} isn’t posted yet.`,
      bars: [...recent.map((g) => ({ value: g.slots.length, predicted: false })), { value: headcount, predicted: true }],
      cta: "Draft shift",
      draft: {
        ask: `Draft ${headcount} ${pos.name} shifts for ${formatDay(next, "EEEE, MMMM d")} at ${loc.name}`,
        request: { locationId: last.locationId, positionId: last.positionId, date: next, start: last.start, end: last.end, breakMins: last.breakMins, headcount },
      },
    })
  }
  return out.sort((a, b) => a.date.localeCompare(b.date) || b.spots - a.spots).slice(0, 4)
}

/** Upcoming shifts that will start short, given how many cleared Pros the supplier has left for that day. */
function fillRisks(data: DemoData, supplierId: string): Prediction[] {
  const busy = new Map<string, Set<string>>()
  for (const g of data.groups)
    for (const s of g.slots) if (s.proId) busy.set(g.date, (busy.get(g.date) ?? new Set()).add(s.proId))
  return data.groups
    .filter((g) => isOpenTo(g, supplierId) && groupPhase(g) === "upcoming" && daysFromToday(g.date) <= 3 && filledCount(g) < g.slots.length)
    .map((g) => {
      const open = g.slots.length - filledCount(g)
      const loc = location(g.locationId)
      const pos = position(g.positionId)
      const available = data.pros.filter((p) => p.supplierId === supplierId && p.cityId === loc.cityId && !busy.get(g.date)?.has(p.id) && canWork(p, g.positionId, g.date, g.locationId).ok).length
      const short = Math.max(0, open - available)
      return { g, open, available, short, loc, pos }
    })
    .filter(({ short }) => short > 0)
    .sort((a, b) => b.short - a.short || a.g.date.localeCompare(b.g.date))
    .slice(0, 3)
    .map(({ g, open, available, short, loc, pos }) => ({
      id: `fill:${g.id}`,
      kind: "fill-risk" as const,
      title: `${pos.name} · ${loc.name} likely to start ${short} short`,
      detail: `${g.code} · ${formatDay(g.date)} · ${formatClockShort(g.start)} · ${plural(open, "open spot")} · ${plural(available, "cleared Pro")} free that day`,
      evidence: `Counts your Pros in ${city(loc.cityId).name} who are cleared for ${pos.name} and not already on a shift ${formatDay(g.date, "EEEE")}.`,
      cta: "Assign Pros",
      href: `/shifts/${g.id}`,
    }))
}

function expiringPros(data: DemoData, supplierId?: string): Prediction | undefined {
  const pros = data.pros.filter((p) => (!supplierId || p.supplierId === supplierId) && summaryOf(p) === "expiring")
  if (!pros.length) return undefined
  return {
    id: "expiring",
    kind: "expiring",
    title: `${plural(pros.length, "Pro")} will drop off shifts within 30 days`,
    detail: "A required document expires soon. Renewing now keeps them eligible.",
    evidence: "Iris stops placing a Pro the day a required document expires.",
    cta: "Review Pros",
    href: "/professionals?filter=compliant",
  }
}

/** Locations whose last week ran well above their normal week, and the program's shifts that will start short. */
function programSignals(data: DemoData): Prediction[] {
  const out: Prediction[] = []
  for (const rank of locationRanking(data, "all").filter((r) => r.aboveNormal).slice(0, 2)) {
    const loc = location(rank.locationId)
    out.push({
      id: `spend:${rank.locationId}`,
      kind: "spend",
      title: `${loc.name} spend running ${Math.round(rank.change * 100)}% above normal`,
      detail: `${buyer(rank.buyerId).name} · normal week ${moneyWhole(rank.normal)} · last 7 days ${moneyWhole(rank.normal * (1 + rank.change))}`,
      evidence: "Last 7 days of timesheet spend against the average of the two weeks before.",
      cta: "Review invoices",
      href: "/invoices",
    })
  }
  const atRisk = data.groups.filter(needsAttention)
  if (atRisk.length) {
    const byBuyer = new Map<string, number>()
    for (const g of atRisk) byBuyer.set(g.buyerId, (byBuyer.get(g.buyerId) ?? 0) + 1)
    const [topBuyer, count] = [...byBuyer].sort((a, b) => b[1] - a[1])[0]
    out.push({
      id: "fill-program",
      kind: "fill-risk",
      title: `${plural(atRisk.length, "shift")} likely to start under 80% filled`,
      detail: `Next 3 days · most at ${buyer(topBuyer).name} (${count})`,
      evidence: "Shifts starting within 3 days that are still under 80% filled.",
      cta: "Open Shifts",
      href: "/shifts",
    })
  }
  return out
}

export function predictionsFor(data: DemoData, ws: Workspace): Prediction[] {
  const scope = scopeOf(ws)
  if (scope.kind === "buyer" && scope.buyerId) return recurringShifts(data, scope.buyerId)
  if (scope.kind === "supplier" && scope.supplierId) return [...fillRisks(data, scope.supplierId), expiringPros(data, scope.supplierId)].filter((p): p is Prediction => !!p)
  const safetyTodo = data.pros.some((p) => ["action_needed", "onboarding"].includes(summaryOf(p)))
  return [...programSignals(data), safetyTodo ? undefined : expiringPros(data)].filter((p): p is Prediction => !!p)
}
