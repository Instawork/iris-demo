import { addDaysISO, formatDateShort, weekEndISO, weekStartISO } from "@/lib/dates"
import { round2 } from "@/lib/format"
import { billingFindings } from "@/lib/metrics"
import { PROGRAM, buyer } from "@/lib/reference"
import { billedOf, change, laborAmount, overtimeKey, weekClosed, withOvertime } from "@/lib/timesheets"
import type { DemoData, Invoice, InvoiceCredit, InvoiceGroup, InvoiceLine, Pro, Timesheet } from "@/lib/types"

/**
 * How approved hours become invoices. Each agency has one invoice per buyer and Saturday to Friday week. It stays open
 * and collects the week's approved hours until the week closes, then Iris issues it on net terms. Hours approved after
 * their week closed go on an invoice of their own, issued right away. Every invoice for a buyer's week also sits in that
 * week's consolidated invoice, which the buyer reviews and pays as one.
 */

/** One line per timesheet, keyed by it, so a line keeps its id as the invoice it's on changes. */
export const lineOf = (t: Timesheet, pros: Map<string, Pro>): InvoiceLine => {
  const pro = pros.get(t.proId)
  return {
    id: `${t.id}-l`,
    timesheetId: t.id,
    proId: t.proId,
    proName: pro ? `${pro.firstName} ${pro.lastName}` : "Unknown worker",
    groupId: t.groupId,
    positionId: t.positionId,
    locationId: t.locationId,
    ...(t.departmentId ? { departmentId: t.departmentId } : {}),
    date: t.date,
    scheduledStart: t.scheduledStart,
    scheduledEnd: t.scheduledEnd,
    clockIn: t.clockIn,
    clockOut: t.clockOut,
    hours: t.hours,
    otHours: t.otHours || undefined,
    billRate: t.billRate,
    amount: laborAmount(t),
    tips: t.tips,
  }
}

const inOrder = (a: InvoiceLine, b: InvoiceLine) =>
  a.date.localeCompare(b.date) || (a.scheduledStart ?? "").localeCompare(b.scheduledStart ?? "") || a.proName.localeCompare(b.proName)

/** A week's invoices go out the Saturday after it ends. */
export const issueDateOf = (weekStart: string) => addDaysISO(weekEndISO(weekStart), 1)

export const weekName = (buyerId: string, weekStart: string) => `${buyer(buyerId).name}, week of ${formatDateShort(weekStart)}`

/**
 * Rebuilds the lines of these invoices from the timesheets on them, so overtime and tips stay current while a week is
 * open. A line that was credited keeps the times it was billed with, next to its credit.
 */
export function rebuildLines(invoices: Invoice[], timesheets: Timesheet[], ids: Set<string>, pros: Map<string, Pro>) {
  if (!ids.size) return invoices
  const onInvoice = new Map<string, Timesheet[]>()
  for (const t of timesheets) if (t.invoiceId && ids.has(t.invoiceId)) onInvoice.set(t.invoiceId, [...(onInvoice.get(t.invoiceId) ?? []), t])
  return invoices.map((inv) => {
    if (!ids.has(inv.id)) return inv
    const credited = new Set((inv.credits ?? []).map((c) => c.lineId))
    const kept = new Map(inv.lines.filter((l) => credited.has(l.id)).map((l) => [l.id, l]))
    const lines = (onInvoice.get(inv.id) ?? []).map((t) => kept.get(`${t.id}-l`) ?? lineOf(t, pros)).sort(inOrder)
    return { ...inv, lines }
  })
}

/**
 * Puts these invoices in their buyer's consolidated invoice for the week, creating it when needed. Invoices already in a
 * group, including ones grouped by hand, stay where they are.
 */
export function consolidate(data: Pick<DemoData, "invoices" | "invoiceGroups" | "counters">, ids: Set<string>, today: string) {
  let ig = data.counters.ig
  const groups = new Map(data.invoiceGroups.map((g) => [g.id, g]))
  const weekly = new Map<string, string>()
  for (const g of data.invoiceGroups) if (g.weekStart && g.buyerId) weekly.set(`${g.buyerId}|${g.weekStart}`, g.id)
  const created: string[] = []
  const groupOf = new Map<string, string>()
  for (const inv of data.invoices) {
    if (inv.groupId || !ids.has(inv.id)) continue
    const key = `${inv.buyerId}|${inv.periodStart}`
    let id = weekly.get(key)
    if (!id) {
      const code = `IG-2026-${String(ig++).padStart(3, "0")}`
      id = code.toLowerCase()
      groups.set(id, { id, code, name: weekName(inv.buyerId, inv.periodStart), buyerId: inv.buyerId, weekStart: inv.periodStart, createdOn: today, createdBy: "Iris", invoiceIds: [] })
      weekly.set(key, id)
      created.push(id)
    }
    const g = groups.get(id)!
    groups.set(id, { ...g, invoiceIds: [...g.invoiceIds, inv.id] })
    groupOf.set(inv.id, id)
  }
  if (!groupOf.size) return { invoices: data.invoices, invoiceGroups: data.invoiceGroups, ig }
  return {
    invoices: data.invoices.map((i) => (groupOf.has(i.id) ? { ...i, groupId: groupOf.get(i.id) } : i)),
    invoiceGroups: [...created.reverse(), ...data.invoiceGroups.map((g) => g.id)].map((id) => groups.get(id)!),
    ig,
  }
}

/**
 * Puts newly approved timesheets on invoices: this week's go on the agency's open invoice for the week, and hours from a
 * week that has closed go on an invoice issued now. Returns the changed collections, the invoices issued and the open
 * invoices the hours were added to, or undefined when none of `ids` is approved.
 */
export function invoiceApproved(data: DemoData, ids: Set<string>, today: string, now: string) {
  let counter = data.counters.inv
  const created: Invoice[] = []
  const openOf = new Map<string, string>()
  for (const i of data.invoices) if (i.status === "open") openOf.set(`${i.supplierId}|${i.buyerId}|${i.periodStart}`, i.id)
  const issuedOf = new Map<string, string>()
  const assigned = new Map<string, { invoiceId: string; issued: boolean }>()
  for (const t of data.timesheets) {
    if (!ids.has(t.id) || t.status !== "approved") continue
    const week = weekStartISO(t.date)
    const key = `${t.supplierId}|${t.buyerId}|${week}`
    const closed = weekClosed(t.date, today)
    const pool = closed ? issuedOf : openOf
    let id = pool.get(key)
    if (!id) {
      const number = `INV-${counter}`
      id = `inv-${counter++}`
      const issuedOn = closed ? today : issueDateOf(week)
      created.push({
        id,
        number,
        supplierId: t.supplierId,
        buyerId: t.buyerId,
        periodStart: week,
        periodEnd: weekEndISO(week),
        issuedOn,
        dueOn: addDaysISO(issuedOn, PROGRAM.paymentTermsDays),
        status: closed ? "unpaid" : "open",
        paidAmount: 0,
        lines: [],
        source: "auto",
      })
      pool.set(key, id)
    }
    assigned.set(t.id, { invoiceId: id, issued: closed })
  }
  if (!assigned.size) return undefined
  const all = [...created, ...data.invoices]
  const numberOf = new Map(all.map((i) => [i.id, i.number]))
  const timesheets = data.timesheets.map((t) => {
    const a = assigned.get(t.id)
    if (!a) return t
    return a.issued
      ? { ...t, status: "invoiced" as const, invoiceId: a.invoiceId, history: [...t.history, change(now, "Iris", "invoiced", { note: numberOf.get(a.invoiceId) })] }
      : { ...t, invoiceId: a.invoiceId }
  })
  const touched = new Set([...assigned.values()].map((a) => a.invoiceId))
  const pros = new Map(data.pros.map((p) => [p.id, p]))
  const lined = rebuildLines(all, timesheets, touched, pros)
  const grouped = consolidate({ invoices: lined, invoiceGroups: data.invoiceGroups, counters: data.counters }, touched, today)
  const final = grouped.invoices.filter((i) => touched.has(i.id))
  return {
    patch: { timesheets, invoices: grouped.invoices, invoiceGroups: grouped.invoiceGroups, counters: { inv: counter, ig: grouped.ig } },
    issued: final.filter((i) => i.status !== "open"),
    open: final.filter((i) => i.status === "open"),
  }
}

/**
 * Issues open invoices whose week has closed, or every open invoice when the presenter closes the week early. Their
 * timesheets become invoiced. Undefined when nothing is due.
 */
export function issueOpen(data: DemoData, today: string, now: string, early = false) {
  const due = data.invoices.filter((i) => i.status === "open" && i.lines.length > 0 && (early || i.periodEnd < today))
  if (!due.length) return undefined
  const ids = new Set(due.map((i) => i.id))
  const numberOf = new Map(due.map((i) => [i.id, i.number]))
  const issued = due.map((i) => ({ ...i, status: "unpaid" as const, issuedOn: today, dueOn: addDaysISO(today, PROGRAM.paymentTermsDays) }))
  const byId = new Map(issued.map((i) => [i.id, i]))
  return {
    patch: {
      invoices: data.invoices.map((i) => byId.get(i.id) ?? i),
      timesheets: data.timesheets.map((t) =>
        t.invoiceId && ids.has(t.invoiceId) && t.status === "approved"
          ? { ...t, status: "invoiced" as const, history: [...t.history, change(now, "Iris", "invoiced", { note: numberOf.get(t.invoiceId) })] }
          : t,
      ),
    },
    issued,
  }
}

/** Whether tips can still change on this timesheet: until the invoice it's on is issued. */
export const tipsOpen = (data: Pick<DemoData, "invoices">, t: Timesheet) => !t.invoiceId || data.invoices.some((i) => i.id === t.invoiceId && i.status === "open")

/** Sets tips on timesheets whose invoice isn't issued yet, and refreshes the open invoices they're on. */
export function withTips(data: DemoData, tips: Map<string, number>) {
  const open = new Set(data.invoices.filter((i) => i.status === "open").map((i) => i.id))
  const touched = new Set<string>()
  const timesheets = data.timesheets.map((t) => {
    if (!tips.has(t.id) || (t.invoiceId && !open.has(t.invoiceId))) return t
    if (t.invoiceId) touched.add(t.invoiceId)
    return { ...t, tips: tips.get(t.id)! }
  })
  return { timesheets, invoices: rebuildLines(data.invoices, timesheets, touched, new Map(data.pros.map((p) => [p.id, p]))) }
}

/**
 * The agency's answer to a send-back: each line's extra hours come off the invoice as a credit, and its timesheet is
 * revised to the times Iris's records support. Undefined when nothing on the invoice is waiting for a credit.
 */
export function creditSentBack(data: DemoData, invoiceId: string, by: string, now: string) {
  const inv = data.invoices.find((i) => i.id === invoiceId)
  const review = inv?.billingReview
  if (!inv || review?.status !== "sent_back") return undefined
  const findings = billingFindings(data, inv.id).filter((f) => review.lineIds.includes(f.lineId))
  const prior = inv.credits ?? []
  const credits: InvoiceCredit[] = findings.map((f, i) => ({
    id: `${inv.id}-c${prior.length + i + 1}`,
    lineId: f.lineId,
    timesheetId: f.timesheetId,
    proName: f.proName,
    date: f.date,
    hours: f.hours,
    amount: f.amount,
    reason: f.label,
    at: now,
    by,
  }))
  const revised = new Map(findings.map((f) => [f.timesheetId, f]))
  const changed: Timesheet[] = []
  const timesheets = data.timesheets.map((t) => {
    const f = revised.get(t.id)
    if (!f) return t
    const to = { clockIn: f.proposal.clockIn, clockOut: f.proposal.clockOut, breakMins: f.proposal.breakMins, hours: f.proposal.hours }
    const next = { ...t, ...to, history: [...t.history, change(now, by, "credited", { from: billedOf(t), to, reason: f.label, note: inv.number })] }
    changed.push(next)
    return next
  })
  const amount = round2(credits.reduce((s, c) => s + c.amount, 0))
  const updated: Invoice = {
    ...inv,
    credits: [...prior, ...credits],
    billingReview: { ...review, status: "credited", amount, creditedAt: now, creditedBy: by },
  }
  return {
    patch: {
      timesheets: withOvertime(timesheets, new Set(changed.map(overtimeKey))),
      invoices: data.invoices.map((i) => (i.id === inv.id ? updated : i)),
    },
    amount,
    invoice: updated,
  }
}

/** The weekly consolidated invoices for invoices that were never grouped, for the seed. */
export function weeklyGroups(invoices: Invoice[], startCounter: number) {
  let counter = startCounter
  const groups = new Map<string, InvoiceGroup>()
  for (const inv of invoices) {
    if (inv.groupId) continue
    const key = `${inv.buyerId}|${inv.periodStart}`
    let g = groups.get(key)
    if (!g) {
      const code = `IG-2026-${String(counter++).padStart(3, "0")}`
      g = { id: code.toLowerCase(), code, name: weekName(inv.buyerId, inv.periodStart), buyerId: inv.buyerId, weekStart: inv.periodStart, createdOn: issueDateOf(inv.periodStart), createdBy: "Iris", invoiceIds: [] }
      groups.set(key, g)
    }
    g.invoiceIds.push(inv.id)
    inv.groupId = g.id
  }
  return { groups: [...groups.values()].reverse(), counter }
}
