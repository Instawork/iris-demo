import { readiness, summaryOf } from "@/lib/compliance"
import { addDaysISO, daysFromToday, isPastShift, paidHours, todayISO, weekStartISO } from "@/lib/dates"
import { formatDateShort } from "@/lib/dates"
import { money, plural, round2 } from "@/lib/format"
import { SUPPLIERS, location, supplier } from "@/lib/reference"
import type { DemoData, Invoice, Pro, Scope, ShiftGroup, Timesheet, Workspace } from "@/lib/types"

export const scopeOf = (ws: Workspace): Scope => ({ kind: ws.kind, buyerId: ws.buyerId, supplierId: ws.supplierId })

export const inScope = (scope: Scope, item: { buyerId?: string; supplierId?: string }) => {
  if (scope.kind === "buyer") return item.buyerId === scope.buyerId
  if (scope.kind === "supplier") return item.supplierId === scope.supplierId
  return true
}

/** Suppliers see every shift they were sent, not only the ones their rates priced. */
export const isOpenTo = (g: ShiftGroup, supplierId: string) => g.supplierIds.includes(supplierId) || g.supplierId === supplierId

export const groupInScope = (scope: Scope, g: ShiftGroup) =>
  scope.kind === "supplier" ? !!scope.supplierId && isOpenTo(g, scope.supplierId) : inScope(scope, g)

const memo = <R>(fn: (data: DemoData, key: string) => R) => {
  const cache = new WeakMap<DemoData, Map<string, R>>()
  return (data: DemoData, key: string) => {
    let byKey = cache.get(data)
    if (!byKey) {
      byKey = new Map()
      cache.set(data, byKey)
    }
    if (!byKey.has(key)) byKey.set(key, fn(data, key))
    return byKey.get(key) as R
  }
}

const scopeKey = (scope: Scope) => `${scope.kind}:${scope.buyerId ?? ""}:${scope.supplierId ?? ""}`

/* ---------------------------------- Shifts --------------------------------- */

export const filledCount = (g: ShiftGroup) => g.slots.filter((s) => !!s.proId).length

export const fillRatio = (g: ShiftGroup) => (g.slots.length ? filledCount(g) / g.slots.length : 0)

export const groupHours = (g: ShiftGroup) => paidHours(g.start, g.end, g.breakMins)

export const groupEstimate = (g: ShiftGroup) => round2(groupHours(g) * g.billRate * g.slots.length)

export type GroupPhase = "cancelled" | "past" | "in_progress" | "upcoming"

export function groupPhase(g: ShiftGroup): GroupPhase {
  if (g.cancelledAt) return "cancelled"
  if (isPastShift(g.date, g.end, g.start)) return "past"
  const today = todayISO()
  if (g.date === today) {
    const now = new Date()
    const [h, m] = g.start.split(":").map(Number)
    if (now.getHours() * 60 + now.getMinutes() >= h * 60 + m) return "in_progress"
  }
  return "upcoming"
}

/** Fill attention mirrors the partner dashboard pipe: green at 80%+, yellow when a soon shift is short. */
export function fillTone(g: ShiftGroup): "positive" | "warning" | "critical" | "neutral" {
  const ratio = fillRatio(g)
  if (ratio >= 0.8) return "positive"
  const days = daysFromToday(g.date)
  if (groupPhase(g) === "upcoming" && days <= 1 && ratio < 0.5) return "critical"
  if (groupPhase(g) === "upcoming" && days <= 3) return "warning"
  return "neutral"
}

export const needsAttention = (g: ShiftGroup) => {
  const phase = groupPhase(g)
  return phase === "upcoming" && daysFromToday(g.date) <= 3 && fillRatio(g) < 0.8
}

/* -------------------------------- Timesheets ------------------------------- */

export const timesheetAmount = (t: Timesheet) => round2(t.hours * t.billRate + t.tips)

export type TimesheetFlag = { id: string; label: string; detail: string }

export function timesheetFlags(t: Timesheet): TimesheetFlag[] {
  const flags: TimesheetFlag[] = []
  const scheduled = paidHours(t.scheduledStart, t.scheduledEnd, t.breakMins)
  if (t.hours - scheduled >= 0.75) {
    flags.push({
      id: "over",
      label: "Over schedule",
      detail: `${round2(t.hours - scheduled)} hrs more than the ${round2(scheduled)} hrs scheduled.`,
    })
  }
  if (t.breakMins === 0 && scheduled >= 6) {
    flags.push({ id: "break", label: "No break", detail: "No unpaid break recorded on a shift of 6+ hours." })
  }
  if (!t.clockIn || !t.clockOut) {
    flags.push({ id: "punch", label: "Missing punch", detail: "Clock-in or clock-out is missing." })
  }
  return flags
}

/* --------------------------------- Invoices -------------------------------- */

export const invoiceSubtotal = (inv: Invoice) => round2(inv.lines.reduce((s, l) => s + l.amount, 0))
export const invoiceTips = (inv: Invoice) => round2(inv.lines.reduce((s, l) => s + l.tips, 0))
export const invoiceTotal = (inv: Invoice) => round2(invoiceSubtotal(inv) + invoiceTips(inv))
export const invoiceBalance = (inv: Invoice) => round2(Math.max(0, invoiceTotal(inv) - inv.paidAmount))
export const invoiceHours = (inv: Invoice) => round2(inv.lines.reduce((s, l) => s + l.hours, 0))

export type InvoiceDisplayStatus = "paid" | "unpaid" | "partial" | "in_process" | "overdue"

export function invoiceStatus(inv: Invoice): InvoiceDisplayStatus {
  if (inv.status === "paid") return "paid"
  if ((inv.status === "unpaid" || inv.status === "partial") && inv.dueOn < todayISO()) return "overdue"
  return inv.status
}

/** An invoice is anomalous when it costs this much more than other suppliers would have charged for the same hours, weighted by rating. */
export const ANOMALY_THRESHOLD = 0.15

export interface PeerQuote {
  supplierId: string
  score: number
  amount: number
  /** Share of the invoice's hours this supplier has a rate for. */
  coverage: number
}

export interface InvoiceBenchmark {
  labor: number
  fair: number
  deltaPct: number
  anomalous: boolean
  score: number
  peers: PeerQuote[]
  lineDelta: Map<string, number>
}

export const invoiceBenchmark = memo((data: DemoData, invoiceId: string): InvoiceBenchmark => {
  const inv = data.invoices.find((i) => i.id === invoiceId)
  const empty: InvoiceBenchmark = { labor: 0, fair: 0, deltaPct: 0, anomalous: false, score: 0, peers: [], lineDelta: new Map() }
  if (!inv) return empty
  const scores = new Map(SUPPLIERS.map((s) => [s.id, supplierScore(metricsFor(data, s.id))]))
  const self = scores.get(inv.supplierId) ?? 0
  const quotes = new Map<string, { amount: number; hours: number }>()
  const lineDelta = new Map<string, number>()
  let labor = 0
  let fair = 0
  let hours = 0
  for (const line of inv.lines) {
    const cityId = location(line.locationId).cityId
    const peers = SUPPLIERS.filter((s) => s.id !== inv.supplierId).flatMap((s) => {
      const card = data.rateCards.find((c) => c.supplierId === s.id && c.cityId === cityId && c.positionId === line.positionId && c.status === "active")
      return card ? [{ supplierId: s.id, rate: card.billRate, score: scores.get(s.id) ?? 0 }] : []
    })
    const weight = peers.reduce((sum, p) => sum + p.score, 0)
    const peerRate = weight ? peers.reduce((sum, p) => sum + p.rate * p.score, 0) / weight : line.billRate
    const peerScore = peers.length ? weight / peers.length : self
    const fairRate = peerScore ? peerRate * (self / peerScore) : line.billRate
    labor += line.amount
    fair += line.hours * fairRate
    hours += line.hours
    lineDelta.set(line.id, fairRate ? line.billRate / fairRate - 1 : 0)
    for (const p of peers) {
      const q = quotes.get(p.supplierId) ?? { amount: 0, hours: 0 }
      quotes.set(p.supplierId, { amount: q.amount + line.hours * p.rate, hours: q.hours + line.hours })
    }
  }
  const deltaPct = fair ? labor / fair - 1 : 0
  return {
    labor: round2(labor),
    fair: round2(fair),
    deltaPct,
    anomalous: deltaPct >= ANOMALY_THRESHOLD,
    score: self,
    peers: [...quotes.entries()]
      .map(([supplierId, q]) => ({ supplierId, score: scores.get(supplierId) ?? 0, amount: round2(q.amount), coverage: hours ? q.hours / hours : 0 }))
      .sort((a, b) => b.score - a.score),
    lineDelta,
  }
})

export const flaggedLineIds = (data: DemoData, invoiceId: string) => {
  const b = invoiceBenchmark(data, invoiceId)
  return new Set([...b.lineDelta.entries()].filter(([, d]) => d >= ANOMALY_THRESHOLD).map(([id]) => id))
}

export const isFlagged = (data: DemoData, inv: Invoice) => invoiceBenchmark(data, inv.id).anomalous

export const needsReview = (data: DemoData, inv: Invoice) => isFlagged(data, inv) && !inv.review

/** What the invoice costs above its rating-weighted benchmark. */
export const amountAtRisk = (data: DemoData, inv: Invoice) => {
  const b = invoiceBenchmark(data, inv.id)
  return round2(Math.max(0, b.labor - b.fair))
}

/* ----------------------------- Supplier metrics ---------------------------- */

export interface SupplierMetrics {
  fillRate: number
  hoursToFill: number
  noShowRate: number
  compliance: number
  activePros: number
  onboardingPros: number
  slotsFilled: number
  avgBillRate: number
}

export const supplierMetrics = memo((data: DemoData, key: string): SupplierMetrics => {
  const [supplierId, buyerId] = key.split("|")
  const from = addDaysISO(todayISO(), -28)
  const groups = data.groups.filter(
    (g) => g.supplierId === supplierId && !g.cancelledAt && (!buyerId || g.buyerId === buyerId),
  )
  let total = 0
  let assigned = 0
  let noShows = 0
  const fillTimes: number[] = []
  let rateSum = 0
  for (const g of groups) {
    for (const s of g.slots) {
      if (s.confirmedAt) fillTimes.push((new Date(s.confirmedAt).getTime() - new Date(g.createdAt).getTime()) / 3600_000)
    }
    if (g.date < from || groupPhase(g) !== "past") continue
    total += g.slots.length
    rateSum += g.billRate * g.slots.length
    for (const s of g.slots) {
      if (s.proId) assigned++
      if (s.status === "no_show") noShows++
    }
  }
  fillTimes.sort((a, b) => a - b)
  const median = fillTimes.length ? fillTimes[Math.floor(fillTimes.length / 2)] : supplier(supplierId).profile.hoursToFill
  const pros = data.pros.filter((p) => p.supplierId === supplierId)
  const active = pros.filter((p) => p.status === "active")
  const ready = active.filter((p) => readiness(p).ready)
  return {
    fillRate: total ? assigned / total : supplier(supplierId).profile.fillRate,
    hoursToFill: Math.max(0.1, median),
    noShowRate: assigned ? noShows / assigned : supplier(supplierId).profile.noShowRate,
    compliance: active.length ? ready.length / active.length : 1,
    activePros: active.length,
    onboardingPros: pros.length - active.length,
    slotsFilled: assigned,
    avgBillRate: total ? round2(rateSum / total) : 0,
  }
})

export const metricsFor = (data: DemoData, supplierId: string, buyerId?: string) =>
  supplierMetrics(data, `${supplierId}|${buyerId ?? ""}`)

/** One number to rank suppliers by: fill rate, reliability, compliance and speed to fill, out of 100. */
export const supplierScore = (m: SupplierMetrics) =>
  Math.round(
    100 * (0.35 * m.fillRate + 0.25 * Math.max(0, 1 - m.noShowRate * 5) + 0.25 * m.compliance + 0.15 * Math.max(0, 1 - m.hoursToFill / 48)),
  )

/** A supplier's average bill rate for the roles it staffs in these cities. */
export const avgBillRate = (data: DemoData, supplierId: string, cityIds: string[]) => {
  const cards = data.rateCards.filter((c) => c.supplierId === supplierId && c.status === "active" && cityIds.includes(c.cityId))
  return cards.length ? round2(cards.reduce((s, c) => s + c.billRate, 0) / cards.length) : 0
}

export const formatTimeToFill = (hours: number) => {
  if (hours < 1 / 60) return "under a minute"
  if (hours < 1) return `${Math.max(1, Math.round(hours * 60))} min`
  if (hours < 36) return `${Math.round(hours)} hr${Math.round(hours) === 1 ? "" : "s"}`
  return `${Math.round(hours / 24)} days`
}

/* ------------------------------ Program metrics ---------------------------- */

export const programFill = memo((data: DemoData, key: string) => {
  const [kind, buyerId, supplierId] = key.split(":")
  const scope: Scope = { kind: kind as Scope["kind"], buyerId: buyerId || undefined, supplierId: supplierId || undefined }
  const from = addDaysISO(todayISO(), -28)
  let total = 0
  let filled = 0
  let noShows = 0
  const times: number[] = []
  for (const g of data.groups) {
    if (!inScope(scope, g) || g.cancelledAt) continue
    for (const s of g.slots) if (s.confirmedAt) times.push((new Date(s.confirmedAt).getTime() - new Date(g.createdAt).getTime()) / 3600_000)
    if (g.date < from || groupPhase(g) !== "past") continue
    total += g.slots.length
    for (const s of g.slots) {
      if (s.proId) filled++
      if (s.status === "no_show") noShows++
    }
  }
  times.sort((a, b) => a - b)
  return {
    fillRate: total ? filled / total : 0,
    noShowRate: filled ? noShows / filled : 0,
    hoursToFill: times.length ? times[Math.floor(times.length / 2)] : 0,
    slots: total,
    filled,
  }
})

export const fillFor = (data: DemoData, scope: Scope) => programFill(data, scopeKey(scope))

export interface SpendPoint {
  week: string
  weekStart: string
  total: number
  [supplierId: string]: number | string
}

export const spendSeries = memo((data: DemoData, key: string): SpendPoint[] => {
  const [kind, buyerId, supplierId] = key.split(":")
  const scope: Scope = { kind: kind as Scope["kind"], buyerId: buyerId || undefined, supplierId: supplierId || undefined }
  const thisWeek = weekStartISO(todayISO())
  const weeks = [-3, -2, -1, 0].map((w) => addDaysISO(thisWeek, w * 7))
  const points: SpendPoint[] = weeks.map((ws) => {
    const base: SpendPoint = { week: formatDateShort(ws), weekStart: ws, total: 0 }
    for (const s of SUPPLIERS) base[s.id] = 0
    return base
  })
  for (const t of data.timesheets) {
    if (!inScope(scope, t)) continue
    const idx = weeks.indexOf(weekStartISO(t.date))
    if (idx < 0) continue
    const amt = timesheetAmount(t)
    points[idx][t.supplierId] = round2((points[idx][t.supplierId] as number) + amt)
    points[idx].total = round2(points[idx].total + amt)
  }
  return points
})

export const spendFor = (data: DemoData, scope: Scope) => spendSeries(data, scopeKey(scope))

export interface FillPoint {
  week: string
  fillRate: number
  noShowRate: number
  slots: number
}

export const fillSeries = memo((data: DemoData, key: string): FillPoint[] => {
  const [kind, buyerId, supplierId] = key.split(":")
  const scope: Scope = { kind: kind as Scope["kind"], buyerId: buyerId || undefined, supplierId: supplierId || undefined }
  const thisWeek = weekStartISO(todayISO())
  const weeks = [-4, -3, -2, -1, 0].map((w) => addDaysISO(thisWeek, w * 7))
  const points = weeks.map((ws) => {
    let total = 0
    let filled = 0
    let noShow = 0
    for (const g of data.groups) {
      if (!inScope(scope, g) || g.cancelledAt || weekStartISO(g.date) !== ws || groupPhase(g) !== "past") continue
      total += g.slots.length
      for (const s of g.slots) {
        if (s.proId) filled++
        if (s.status === "no_show") noShow++
      }
    }
    return {
      week: formatDateShort(ws),
      fillRate: total ? round2((filled / total) * 100) : 0,
      noShowRate: filled ? round2((noShow / filled) * 100) : 0,
      slots: total,
    }
  })
  return points.filter((p) => p.slots > 0).slice(-4)
})

export const fillTrendFor = (data: DemoData, scope: Scope) => fillSeries(data, scopeKey(scope))

export const spendBySupplier = (data: DemoData, scope: Scope, from: string, to: string) => {
  const totals = new Map<string, number>()
  for (const t of data.timesheets) {
    if (!inScope(scope, t) || t.date < from || t.date > to) continue
    totals.set(t.supplierId, round2((totals.get(t.supplierId) ?? 0) + timesheetAmount(t)))
  }
  return SUPPLIERS.map((s) => ({ supplierId: s.id, amount: totals.get(s.id) ?? 0 })).filter((x) => x.amount > 0)
}

export const spendByBuyer = (data: DemoData, from: string, to: string) => {
  const totals = new Map<string, number>()
  for (const t of data.timesheets) {
    if (t.date < from || t.date > to) continue
    totals.set(t.buyerId, round2((totals.get(t.buyerId) ?? 0) + timesheetAmount(t)))
  }
  return [...totals.entries()].map(([buyerId, amount]) => ({ buyerId, amount }))
}

export const spendBetween = (data: DemoData, scope: Scope, from: string, to: string) =>
  round2(
    data.timesheets
      .filter((t) => inScope(scope, t) && t.date >= from && t.date <= to)
      .reduce((s, t) => s + timesheetAmount(t), 0),
  )

export const bookedAhead = (data: DemoData, scope: Scope, days = 7) => {
  const today = todayISO()
  const until = addDaysISO(today, days)
  return round2(
    data.groups
      .filter((g) => inScope(scope, g) && !g.cancelledAt && g.date >= today && g.date <= until)
      .reduce((s, g) => s + filledCount(g) * groupHours(g) * g.billRate, 0),
  )
}

/* ---------------------------------- Pros ----------------------------------- */

export const scopedPros = memo((data: DemoData, key: string): Pro[] => {
  const [kind, buyerId, supplierId] = key.split(":")
  if (kind === "supplier") return data.pros.filter((p) => p.supplierId === supplierId)
  if (kind === "buyer") {
    const ids = new Set<string>()
    for (const g of data.groups) if (g.buyerId === buyerId) for (const s of g.slots) if (s.proId) ids.add(s.proId)
    for (const r of data.roster) if (r.buyerId === buyerId) ids.add(r.proId)
    return data.pros.filter((p) => ids.has(p.id))
  }
  return data.pros
})

export const prosFor = (data: DemoData, scope: Scope) => scopedPros(data, scopeKey(scope))

export const proStats = memo((data: DemoData, key: string) => {
  const [proId, buyerId] = key.split("|")
  const sheets = data.timesheets.filter((t) => t.proId === proId && (!buyerId || t.buyerId === buyerId))
  const last = sheets.map((t) => t.date).sort().pop()
  return { shifts: sheets.length, hours: round2(sheets.reduce((s, t) => s + t.hours, 0)), lastWorked: last }
})

/* ---------------------------------- Todos ---------------------------------- */

export interface Todo {
  id: string
  title: string
  description: string
  count: number
  href: string
  tone: "primary" | "warning" | "critical" | "positive" | "neutral"
  icon: "clock" | "invoice" | "alert" | "user" | "shield" | "rate" | "dispute" | "upload" | "tip"
  cta: string
}

export function todosFor(data: DemoData, ws: Workspace): Todo[] {
  const scope = scopeOf(ws)
  const todos: Todo[] = []
  if (scope.kind === "buyer") {
    const toApprove = data.timesheets.filter((t) => inScope(scope, t) && t.status === "submitted")
    if (toApprove.length) {
      const shifts = new Set(toApprove.map((t) => t.groupId)).size
      todos.push({
        id: "approve",
        title: `${plural(toApprove.length, "timesheet")} to approve`,
        description: `${round2(toApprove.reduce((s, t) => s + t.hours, 0)).toLocaleString()} hours across ${plural(shifts, "shift")}. Approving them generates the supplier's invoice.`,
        count: toApprove.length,
        href: "/shifts?filter=hours",
        tone: "warning",
        icon: "clock",
        cta: "Approve hours",
      })
    }
    const open = data.invoices.filter((i) => inScope(scope, i) && invoiceStatus(i) !== "paid" && invoiceStatus(i) !== "in_process")
    if (open.length) {
      const overdue = open.filter((i) => invoiceStatus(i) === "overdue")
      const balance = round2(open.reduce((s, i) => s + invoiceBalance(i), 0))
      todos.push({
        id: "invoices",
        title: `${plural(open.length, "outstanding invoice")}`,
        description: overdue.length ? `${money(balance)} open, ${overdue.length} past due.` : `${money(balance)} open.`,
        count: open.length,
        href: "/invoices?filter=outstanding",
        tone: overdue.length ? "critical" : "primary",
        icon: "invoice",
        cta: "Review invoices",
      })
    }
  }
  if (scope.kind === "supplier") {
    const pros = data.pros.filter((p) => p.supplierId === scope.supplierId)
    const onboarding = pros.filter((p) => summaryOf(p) === "onboarding")
    const blocked = pros.filter((p) => summaryOf(p) === "action_needed")
    if (onboarding.length) {
      todos.push({
        id: "onboarding",
        title: `${plural(onboarding.length, "professional")} ${onboarding.length === 1 ? "needs" : "need"} onboarding`,
        description: "They can't be placed on shifts until their background check, I-9 and certifications are complete.",
        count: onboarding.length,
        href: "/professionals?filter=onboarding",
        tone: "warning",
        icon: "user",
        cta: "Finish onboarding",
      })
    }
    if (blocked.length) {
      todos.push({
        id: "documents",
        title: `${plural(blocked.length, "professional")} with missing or expired documents`,
        description: "Active Pros CrUber keeps off shifts until their documents are current again.",
        count: blocked.length,
        href: "/professionals?filter=not_compliant",
        tone: "critical",
        icon: "shield",
        cta: "Fix documents",
      })
    }
  }
  if (scope.kind === "compass") {
    const flagged = data.invoices.filter((i) => needsReview(data, i))
    if (flagged.length) {
      const risk = round2(flagged.reduce((s, i) => s + amountAtRisk(data, i), 0))
      todos.push({
        id: "anomalies",
        title: `${plural(flagged.length, "anomalous invoice")} to review`,
        description: `${money(risk)} above what other suppliers would have charged for the same hours, weighted by rating.`,
        count: flagged.length,
        href: "/invoices?filter=flagged",
        tone: "critical",
        icon: "alert",
        cta: "Review",
      })
    }
    const safetyExceptions = data.pros.filter((p) => {
      const summary = summaryOf(p)
      return summary === "action_needed" || summary === "onboarding"
    })
    if (safetyExceptions.length) {
      todos.push({
        id: "safety",
        title: `${plural(safetyExceptions.length, "professional")} requiring safety review`,
        description: "Background checks, I-9s, orientation and role-specific documents that are pending, missing or expired.",
        count: safetyExceptions.length,
        href: "/professionals?filter=not_compliant",
        tone: "warning",
        icon: "shield",
        cta: "Review workers",
      })
    }
  }
  return todos
}

/* ---------------------------------- Spend ---------------------------------- */

const isPending = (t: Timesheet) => t.status !== "approved"

const sumSpend = (rows: Timesheet[]) => round2(rows.reduce((s, t) => s + timesheetAmount(t), 0))

export interface SpendSlice {
  id: string
  amount: number
  hours: number
  headcount: number
  avgBillRate: number
}

const slices = (rows: Timesheet[], keyOf: (t: Timesheet) => string): SpendSlice[] => {
  const map = new Map<string, Timesheet[]>()
  for (const t of rows) map.set(keyOf(t), [...(map.get(keyOf(t)) ?? []), t])
  return [...map.entries()]
    .map(([id, list]) => {
      const hours = round2(list.reduce((s, t) => s + t.hours, 0))
      return {
        id,
        amount: sumSpend(list),
        hours,
        headcount: new Set(list.map((t) => t.proId)).size,
        avgBillRate: hours ? round2(list.reduce((s, t) => s + t.hours * t.billRate, 0) / hours) : 0,
      }
    })
    .sort((a, b) => b.amount - a.amount)
}

/** This week and month against the same stretch of the prior period, split into approved and pending. */
export const spendSummary = memo((data: DemoData, key: string) => {
  const [kind, buyerId, supplierId] = key.split(":")
  const scope: Scope = { kind: kind as Scope["kind"], buyerId: buyerId || undefined, supplierId: supplierId || undefined }
  const today = todayISO()
  const rows = data.timesheets.filter((t) => inScope(scope, t))
  const between = (from: string, to: string) => rows.filter((t) => t.date >= from && t.date <= to)
  const weekStart = weekStartISO(today)
  const monthStart = `${today.slice(0, 8)}01`
  const priorMonthStart = addDaysISO(monthStart, -1).slice(0, 8) + "01"
  const priorMonthSameDay = addDaysISO(priorMonthStart, Number(today.slice(8, 10)) - 1)
  const month = between(monthStart, today)
  const weeks = [3, 2, 1, 0].map((ago) => {
    const from = addDaysISO(weekStart, -7 * ago)
    const list = between(from, ago === 0 ? today : addDaysISO(from, 6))
    return { from, amount: sumSpend(list), hours: round2(list.reduce((s, t) => s + t.hours, 0)), headcount: new Set(list.map((t) => t.proId)).size }
  })
  return {
    week: sumSpend(between(addDaysISO(today, -6), today)),
    priorWeek: sumSpend(between(addDaysISO(today, -13), addDaysISO(today, -7))),
    month: sumSpend(month),
    priorMonth: sumSpend(between(priorMonthStart, priorMonthSameDay < monthStart ? priorMonthSameDay : addDaysISO(monthStart, -1))),
    approved: sumSpend(month.filter((t) => !isPending(t))),
    pending: sumSpend(month.filter(isPending)),
    bySupplier: slices(month, (t) => t.supplierId),
    byPosition: slices(month, (t) => t.positionId),
    byLocation: slices(month, (t) => t.locationId),
    weeks,
  }
})

export const spendSummaryFor = (data: DemoData, scope: Scope) => spendSummary(data, scopeKey(scope))

export interface LocationRank {
  locationId: string
  buyerId: string
  amount: number
  normal: number
  /** Last 7 days against the average of the two weeks before. */
  change: number
  aboveNormal: boolean
  anomalous: number
}

/** Every location ranked by 28-day spend, flagged when its last week runs far above its normal week or it has anomalous invoices. */
export const locationRanking = memo((data: DemoData): LocationRank[] => {
  const today = todayISO()
  const from = addDaysISO(today, -27)
  const totals = new Map<string, { buyerId: string; amount: number; recent: number; prior: number }>()
  for (const t of data.timesheets) {
    if (t.date < from || t.date > today) continue
    const entry = totals.get(t.locationId) ?? { buyerId: t.buyerId, amount: 0, recent: 0, prior: 0 }
    const amount = timesheetAmount(t)
    entry.amount += amount
    if (t.date > addDaysISO(today, -7)) entry.recent += amount
    else if (t.date > addDaysISO(today, -21)) entry.prior += amount
    totals.set(t.locationId, entry)
  }
  const flagged = new Map<string, number>()
  for (const inv of data.invoices) {
    if (!needsReview(data, inv)) continue
    for (const id of new Set(inv.lines.map((l) => l.locationId))) flagged.set(id, (flagged.get(id) ?? 0) + 1)
  }
  return [...totals.entries()]
    .map(([locationId, e]) => {
      const normal = e.prior / 2
      const change = normal ? e.recent / normal - 1 : 0
      return {
        locationId,
        buyerId: e.buyerId,
        amount: round2(e.amount),
        normal: round2(normal),
        change,
        aboveNormal: change >= 0.35 && e.recent - normal >= 1500,
        anomalous: flagged.get(locationId) ?? 0,
      }
    })
    .sort((a, b) => b.amount - a.amount)
})
