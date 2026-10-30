import { readiness, summaryOf } from "@/lib/compliance"
import { addDaysISO, daysFromToday, isPastShift, minutesOf, paidHours, todayISO, wallClock, weekStartISO } from "@/lib/dates"
import { formatDateShort } from "@/lib/dates"
import { money, plural, round2 } from "@/lib/format"
import { SUPPLIERS, location, supplier } from "@/lib/reference"
import { expensesOf, readyToSubmit, timesheetAmount, timesheetChecks, withAgency, type Proposal } from "@/lib/timesheets"
import type { DemoData, Invoice, InvoiceLine, Pro, Scope, ShiftGroup, Timesheet, Workspace } from "@/lib/types"

export const scopeOf = (ws: Workspace): Scope => ({ kind: ws.kind, buyerId: ws.buyerId, supplierId: ws.supplierId })

export const inScope = (scope: Scope, item: { buyerId?: string; supplierId?: string }) => {
  if (scope.kind === "buyer") return item.buyerId === scope.buyerId
  if (scope.kind === "supplier") return item.supplierId === scope.supplierId
  return true
}

/** Suppliers see every shift they were sent, not only the ones their rates priced. */
/** Released to this agency. Orders with a release plan open only as each tier's time comes. */
export const isOpenTo = (g: ShiftGroup, supplierId: string) => g.supplierIds.includes(supplierId) || (!g.supplierReleases && g.supplierId === supplierId)

export const awaitingApproval = (g: ShiftGroup) => g.approval?.status === "pending" && !g.cancelledAt

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
  const now = wallClock()
  if (g.date === now.date && now.minutes >= minutesOf(g.start)) return "in_progress"
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

export { timesheetAmount }

/* --------------------------------- Invoices -------------------------------- */

export const invoiceSubtotal = (inv: Invoice) => round2(inv.lines.reduce((s, l) => s + l.amount, 0))
export const invoiceTips = (inv: Invoice) => round2(inv.lines.reduce((s, l) => s + l.tips, 0))
export interface VenueTips {
  key: string
  locationId: string
  date: string
  amount: number
  workers: { proName: string; tips: number }[]
}

/** Tips billed the way venues approve them: one line per venue and day, the sum of every worker's tip to the cent. */
export function venueTips(lines: InvoiceLine[]): VenueTips[] {
  const byVenue = new Map<string, VenueTips>()
  for (const l of lines) {
    if (l.tips <= 0) continue
    const key = `${l.locationId}|${l.date}`
    const v = byVenue.get(key) ?? { key, locationId: l.locationId, date: l.date, amount: 0, workers: [] }
    v.amount = round2(v.amount + l.tips)
    v.workers.push({ proName: l.proName, tips: l.tips })
    byVenue.set(key, v)
  }
  return [...byVenue.values()].sort((a, b) => a.date.localeCompare(b.date) || a.locationId.localeCompare(b.locationId))
}

/** Every expense on an invoice, with the worker and line it was billed on. */
export const invoiceExpenseRows = (lines: InvoiceLine[]) => lines.flatMap((l) => (l.expenses ?? []).map((e) => ({ ...e, line: l })))
export const invoiceExpenses = (inv: Invoice) => round2(inv.lines.reduce((s, l) => s + expensesOf(l), 0))
export const invoiceCredits = (inv: Invoice) => round2((inv.credits ?? []).reduce((s, c) => s + c.amount, 0))
export const invoiceTotal = (inv: Invoice) => round2(invoiceSubtotal(inv) + invoiceTips(inv) + invoiceExpenses(inv) - invoiceCredits(inv))
export const invoiceBalance = (inv: Invoice) => round2(Math.max(0, invoiceTotal(inv) - inv.paidAmount))
export const invoiceHours = (inv: Invoice) => round2(inv.lines.reduce((s, l) => s + l.hours, 0) - (inv.credits ?? []).reduce((s, c) => s + c.hours, 0))

export type InvoiceDisplayStatus = "open" | "paid" | "unpaid" | "partial" | "in_process" | "overdue"

export function invoiceStatus(inv: Invoice): InvoiceDisplayStatus {
  if (inv.status === "paid") return "paid"
  if ((inv.status === "unpaid" || inv.status === "partial") && inv.dueOn < todayISO()) return "overdue"
  return inv.status
}

/** An open invoice can't be paid until Iris issues it, and a paid or paying one can't take a credit. */
export const canCredit = (inv: Invoice) => inv.status === "open" || inv.status === "unpaid" || inv.status === "partial"

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

export interface BillingFinding {
  lineId: string
  timesheetId: string
  proName: string
  date: string
  label: string
  detail: string
  /** Who approved it as billed, and the reason they gave. */
  approvedBy: string
  reason: string
  hours: number
  amount: number
  /** The billed times Iris's records support. A credit revises the timesheet to them. */
  proposal: Proposal
}

const sheetsByPro = memo((data: DemoData) => {
  const byPro = new Map<string, Timesheet[]>()
  for (const t of data.timesheets) byPro.set(t.proId, [...(byPro.get(t.proId) ?? []), t])
  return byPro
})

const sheetsById = memo((data: DemoData) => new Map(data.timesheets.map((t) => [t.id, t])))

/**
 * Lines a unit approved as billed even though Iris's checks proposed fewer hours: the billing errors Compass can send
 * back for a credit. Credited lines drop off.
 */
export const billingFindings = memo((data: DemoData, invoiceId: string): BillingFinding[] => {
  const inv = data.invoices.find((i) => i.id === invoiceId)
  if (!inv) return []
  const credited = new Set((inv.credits ?? []).map((c) => c.lineId))
  const sheets = sheetsById(data, "")
  const findings: BillingFinding[] = []
  for (const line of inv.lines) {
    const t = line.timesheetId && !credited.has(line.id) ? sheets.get(line.timesheetId) : undefined
    const approval = t ? [...t.history].reverse().find((h) => h.action === "approved") : undefined
    if (!t || !approval?.reason) continue
    const check = timesheetChecks(t, sheetsByPro(data, "").get(t.proId)).find((c) => c.proposal && c.proposal.hours < t.hours)
    if (!check?.proposal) continue
    const hours = round2(t.hours - check.proposal.hours)
    findings.push({
      lineId: line.id,
      timesheetId: t.id,
      proName: line.proName,
      date: line.date,
      label: check.label,
      detail: check.detail,
      approvedBy: approval.by,
      reason: approval.reason,
      hours,
      amount: round2(hours * line.billRate),
      proposal: check.proposal,
    })
  }
  return findings
})

export const creditDue = (data: DemoData, inv: Invoice) => round2(billingFindings(data, inv.id).reduce((s, f) => s + f.amount, 0))

/** Lines Iris found billed above its records, waiting on Compass to send them back or accept them. */
export const billingToReview = (data: DemoData, inv: Invoice) => canCredit(inv) && !inv.billingReview && billingFindings(data, inv.id).length > 0

/** An issued, unpaid invoice priced above the market that Compass hasn't reviewed. */
export const marketToReview = (data: DemoData, inv: Invoice) => (inv.status === "unpaid" || inv.status === "partial") && !inv.review && invoiceBenchmark(data, inv.id).anomalous

export const isFlagged = (data: DemoData, inv: Invoice) => invoiceBenchmark(data, inv.id).anomalous || billingFindings(data, inv.id).length > 0

export const needsReview = (data: DemoData, inv: Invoice) => billingToReview(data, inv) || marketToReview(data, inv)

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
  const sheets = data.timesheets.filter((t) => t.proId === proId && t.status !== "removed" && (!buyerId || t.buyerId === buyerId))
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

/**
 * How well an agency keeps its roster ready to work, out of 100: mostly the share of active Pros cleared today, and
 * partly the share with nothing about to lapse. Documents Iris couldn't verify are counted for Compass to follow up.
 */
export function complianceScore(data: DemoData, supplierId: string) {
  const roster = data.pros.filter((p) => p.supplierId === supplierId)
  const active = roster.filter((p) => p.status === "active")
  const states = active.map((p) => readiness(p))
  const cleared = states.filter((r) => r.ready).length
  const expiring = states.filter((r) => r.ready && r.expiring.length > 0).length
  const held = roster.filter((p) => Object.values(p.compliance).some((item) => item?.status === "pending" && item.verification?.result === "needs_review")).length
  const n = active.length
  const score = n ? Math.round(100 * (0.8 * (cleared / n) + 0.2 * (1 - expiring / n))) : 0
  return { score, active: n, cleared, expiring, held, onboarding: roster.length - n }
}

export const scoreTone = (score: number) => (score >= 90 ? "positive" : score >= 75 ? "warning" : "critical")

/** Issued and not yet paid. The buyer's to-do and the Invoices badge both count these. */
export const isOutstanding = (i: Invoice) => !["paid", "in_process", "open"].includes(invoiceStatus(i))

export function todosFor(data: DemoData, ws: Workspace): Todo[] {
  const scope = scopeOf(ws)
  const todos: Todo[] = []
  if (ws.approves?.length) {
    const pending = data.groups.filter((g) => awaitingApproval(g) && ws.approves!.includes(g.locationId))
    if (pending.length) {
      const amount = round2(pending.reduce((s, g) => s + (g.approval?.estimate ?? 0), 0))
      todos.push({
        id: "order-approvals",
        title: `${plural(pending.length, "order")} over budget to approve`,
        description: `${money(amount)} of agency spend waiting on you. Nothing goes to agencies until you approve.`,
        count: pending.length,
        href: "/approvals",
        tone: "warning",
        icon: "alert",
        cta: "Review orders",
      })
    }
  }
  if (scope.kind === "buyer") {
    const toApprove = data.timesheets.filter((t) => inScope(scope, t) && t.status === "pending_approval")
    if (toApprove.length) {
      const flagged = toApprove.filter((t) => timesheetChecks(t).length > 0).length
      const hours = round2(toApprove.reduce((s, t) => s + t.hours, 0)).toLocaleString()
      todos.push({
        id: "approve",
        title: `${plural(toApprove.length, "timesheet")} to approve`,
        description: flagged
          ? `${hours} hours. Iris checked them against the clock and flagged ${flagged} with a proposed fix.`
          : `${hours} hours, all matching the clock and the schedule.`,
        count: toApprove.length,
        href: "/timesheets",
        tone: "warning",
        icon: "clock",
        cta: "Approve hours",
      })
    }
    const open = data.invoices.filter((i) => inScope(scope, i) && isOutstanding(i))
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
    const sentBack = data.invoices.filter((i) => i.supplierId === scope.supplierId && i.billingReview?.status === "sent_back")
    if (sentBack.length) {
      const amount = round2(sentBack.reduce((s, i) => s + i.billingReview!.amount, 0))
      todos.push({
        id: "send-backs",
        title: `${plural(sentBack.length, "invoice")} sent back for a credit`,
        description: `Compass found ${money(amount)} billed above Iris's clock. Credit it so the invoice can be paid.`,
        count: sentBack.length,
        href: sentBack.length === 1 ? `/invoices/${sentBack[0].id}` : "/invoices",
        tone: "critical",
        icon: "dispute",
        cta: "Issue the credit",
      })
    }
    const reviews = data.rateCards.filter((c) => c.supplierId === scope.supplierId && c.rateReview?.status === "requested")
    if (reviews.length) {
      todos.push({
        id: "rate-reviews",
        title: `${plural(reviews.length, "rate")} Compass asked you to review`,
        description: "These bill rates run above what other agencies charge for the same city and role.",
        count: reviews.length,
        href: "/rates",
        tone: "warning",
        icon: "rate",
        cta: "Review rates",
      })
    }
    const mine = data.timesheets.filter((t) => t.supplierId === scope.supplierId && withAgency(t))
    if (mine.length) {
      const rejected = mine.filter((t) => t.status === "rejected").length
      const matched = mine.filter((t) => readyToSubmit(t, mine.filter((o) => o.proId === t.proId))).length
      todos.push({
        id: "timesheets",
        title: `${plural(mine.length, "timesheet")} to submit`,
        description: [
          rejected && `${rejected} rejected by the buyer with a reason. Fix and resubmit them so they can be invoiced.`,
          matched ? `${matched} are ready and can go in one click.` : !rejected && "Drafts from finished shifts. Check the times and submit them for approval.",
        ]
          .filter(Boolean)
          .join(" "),
        count: mine.length,
        href: "/timesheets",
        tone: rejected ? "critical" : "warning",
        icon: "clock",
        cta: "Submit hours",
      })
    }
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
        description: "Active workers Iris keeps off shifts until their documents are current again.",
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
      const billing = flagged.filter((i) => billingToReview(data, i))
      const market = flagged.filter((i) => marketToReview(data, i))
      const due = round2(billing.reduce((s, i) => s + creditDue(data, i), 0))
      const risk = round2(market.reduce((s, i) => s + amountAtRisk(data, i), 0))
      todos.push({
        id: "anomalies",
        title: `${plural(flagged.length, "invoice")} to review`,
        description: [
          billing.length && `${plural(billing.length, "invoice")} with hours billed above Iris's clock, ${money(due)} to credit.`,
          market.length && `${market.length} priced ${money(risk)} above what other agencies would charge, weighted by rating.`,
        ]
          .filter(Boolean)
          .join(" "),
        count: flagged.length,
        href: "/invoices?filter=flagged",
        tone: "critical",
        icon: "alert",
        cta: "Review",
      })
    }
    const held = data.pros.filter((p) => Object.values(p.compliance).some((item) => item?.status === "pending" && item.verification?.result === "needs_review"))
    if (held.length) {
      todos.push({
        id: "verify",
        title: `${plural(held.length, "document")} Iris couldn't verify`,
        description: "The agency attested them, but the issuer had no matching record. The workers stay off shifts until you accept or send them back.",
        count: held.length,
        href: held.length === 1 ? `/professionals?filter=not_compliant&pro=${held[0].id}` : "/professionals?filter=not_compliant",
        tone: "critical",
        icon: "shield",
        cta: "Review documents",
      })
    }
    const safetyExceptions = data.pros.filter((p) => {
      const summary = summaryOf(p)
      return summary === "action_needed" || summary === "onboarding"
    })
    if (safetyExceptions.length) {
      const expiring = data.pros.filter((p) => summaryOf(p) === "expiring").length
      todos.push({
        id: "safety",
        title: `${plural(safetyExceptions.length, "professional")} requiring safety review`,
        description: `Background checks, I-9s, orientation and role-specific documents that are pending, missing or expired.${expiring ? ` Another ${expiring} drop off shifts within 30 days unless a document is renewed.` : ""}`,
        count: safetyExceptions.length,
        href: "/professionals?filter=not_compliant",
        tone: "warning",
        icon: "shield",
        cta: "Review workers",
      })
    }
  }
  const fixes = data.uploads.filter((u) => u.status === "needs_review" && u.actorKind === ws.kind && (scope.kind === "compass" || inScope(scope, u)))
  if (fixes.length) {
    todos.push({
      id: "uploads",
      title: `${plural(fixes.length, "upload")} waiting on fixes`,
      description: "Iris checked every row and proposed fixes for the ones it couldn't save. Approve them and the rest goes in.",
      count: fixes.length,
      href: "/uploads",
      tone: "warning",
      icon: "upload",
      cta: "Review fixes",
    })
  }
  return todos
}

/* ---------------------------------- Spend ---------------------------------- */

const isPending = (t: Timesheet) => t.status !== "approved" && t.status !== "invoiced"

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
