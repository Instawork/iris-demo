import { canWork } from "@/lib/compliance"
import { addDaysISO } from "@/lib/dates"
import { round2 } from "@/lib/format"
import { PROGRAM, SUPPLIERS, location } from "@/lib/reference"
import { emptyCounters } from "@/lib/seed"
import type { ActivityEvent, Counters, DemoData, Invoice, RateCard, ShiftGroup, Timesheet } from "@/lib/types"

export const emptyData = (): DemoData => ({
  version: 0,
  seededOn: "",
  pros: [],
  rateCards: [],
  groups: [],
  timesheets: [],
  invoices: [],
  invoiceGroups: [],
  uploads: [],
  roster: [],
  activity: [],
  approvals: {},
  reviews: [],
  businessActivity: [],
  budgets: [],
  counters: emptyCounters(),
})

export interface BookingInput {
  locationId: string
  positionId: string
  dates: string[]
  start: string
  end: string
  breakMins: number
  headcount: number
  name?: string
  eventName?: string
  instructions: string
  attire: string
  tips: boolean
}

export interface RateCardInput {
  id?: string
  supplierId: string
  cityId: string
  positionId: string
  proRate: number
  billRate: number
  markupPct: number
  zips: string[]
  zipsAutoFilled: boolean
  source: RateCard["source"]
  uploadId?: string
  status?: RateCard["status"]
}

/** Patches only carry the counters they change, so several patches can be merged in order. */
export type Patch = Omit<Partial<DemoData>, "counters"> & { counters?: Partial<Counters> }

export const merge = (data: DemoData, ...patches: Patch[]): DemoData => {
  let next = data
  for (const p of patches) next = { ...next, ...p, counters: { ...next.counters, ...(p.counters ?? {}) } }
  return next
}

export function event(data: DemoData, e: Omit<ActivityEvent, "id" | "at"> & { at?: string }, now: string): Patch {
  const entry: ActivityEvent = { id: `ev-${data.counters.ev}`, at: e.at ?? now, ...e }
  return { activity: [entry, ...data.activity].slice(0, 200), counters: { ev: data.counters.ev + 1 } }
}

export const joinNames = (names: string[]) =>
  names.length <= 1 ? (names[0] ?? "") : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`

/** Pros of the supplier who can take this shift: same city, free that day, not blocked by the buyer, and cleared for the role. */
export function eligiblePros(data: DemoData, g: ShiftGroup, supplierId = g.supplierId) {
  const loc = location(g.locationId)
  const busy = new Set<string>()
  for (const other of data.groups) {
    if (other.date !== g.date || other.cancelledAt) continue
    for (const s of other.slots) if (s.proId) busy.add(s.proId)
  }
  const blocked = new Set(data.roster.filter((r) => r.buyerId === g.buyerId && r.status === "blocked").map((r) => r.proId))
  return data.pros.filter(
    (p) => p.supplierId === supplierId && p.cityId === loc.cityId && !busy.has(p.id) && !blocked.has(p.id) && canWork(p, g.positionId, g.date).ok,
  )
}

/** The buyer's approved suppliers that can staff this role in the city, in program order. Their rate cards price the shift. */
export function notifiedSuppliers(data: DemoData, buyerId: string, cityId: string, positionId: string) {
  const approved = data.approvals[buyerId] ?? []
  return approved.flatMap((id) => {
    const s = SUPPLIERS.find((candidate) => candidate.id === id)
    if (!s || !s.cityIds.includes(cityId)) return []
    const card = data.rateCards.find((c) => c.supplierId === s.id && c.cityId === cityId && c.positionId === positionId && c.status === "active")
    return card ? [{ supplier: s, card }] : []
  })
}

export function supplierReleasePlan(supplierIds: string[], createdAt: string) {
  const start = new Date(createdAt).getTime()
  return supplierIds.map((supplierId, index) => ({
    supplierId,
    releasedAt: new Date(start + index * PROGRAM.cascadeHoursBefore * 60 * 60 * 1000).toISOString(),
  }))
}

/** One invoice per supplier for a batch of approved hours, priced at the hours, tips and bill rate on each timesheet. */
export function invoicesFor(data: DemoData, approved: Timesheet[], today: string) {
  const pros = new Map(data.pros.map((p) => [p.id, p]))
  const bySupplier = new Map<string, Timesheet[]>()
  for (const t of approved) bySupplier.set(`${t.supplierId}|${t.buyerId}`, [...(bySupplier.get(`${t.supplierId}|${t.buyerId}`) ?? []), t])
  let counter = data.counters.inv
  const invoiceOf = new Map<string, string>()
  const invoices: Invoice[] = [...bySupplier.values()].map((rows) => {
    const number = `INV-${counter}`
    const id = `inv-${counter++}`
    const dates = rows.map((t) => t.date).sort()
    rows.forEach((t) => invoiceOf.set(t.id, id))
    return {
      id,
      number,
      supplierId: rows[0].supplierId,
      buyerId: rows[0].buyerId,
      periodStart: dates[0],
      periodEnd: dates[dates.length - 1],
      issuedOn: today,
      dueOn: addDaysISO(today, PROGRAM.paymentTermsDays),
      status: "unpaid",
      paidAmount: 0,
      source: "auto",
      lines: rows.map((t, i) => {
        const pro = pros.get(t.proId)
        return {
          id: `${t.id}-l${i}`,
          timesheetId: t.id,
          proId: t.proId,
          proName: pro ? `${pro.firstName} ${pro.lastName}` : "Unknown Pro",
          groupId: t.groupId,
          positionId: t.positionId,
          locationId: t.locationId,
          date: t.date,
          scheduledStart: t.scheduledStart,
          scheduledEnd: t.scheduledEnd,
          clockIn: t.clockIn,
          clockOut: t.clockOut,
          hours: t.hours,
          billRate: t.billRate,
          amount: round2(t.hours * t.billRate),
          tips: t.tips,
        }
      }),
    }
  })
  return { invoices, invoiceOf, counter }
}
