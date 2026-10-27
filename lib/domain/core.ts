import { canWork } from "@/lib/compliance"
import { PROGRAM, SUPPLIERS, emptyDirectory, location } from "@/lib/reference"
import { emptyCounters } from "@/lib/seed"
import type { ActivityEvent, Counters, DemoData, RateCard, ShiftGroup } from "@/lib/types"

export const emptyData = (): DemoData => ({
  version: 0,
  seededOn: "",
  pros: [],
  rateCards: [],
  rateLog: [],
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
  reports: [],
  directory: emptyDirectory(),
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
  /** Only this agency sees it, instead of the release order. */
  onlyAgencyId?: string
  /** This agency sees it first instead of the buyer's pick for the role. The rest follow by rate. */
  firstAgencyId?: string
  /** Pros to book first, if they're cleared and free. The rest of the spots go out as usual. */
  requestedProIds?: string[]
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
    (p) => p.supplierId === supplierId && p.cityId === loc.cityId && !busy.has(p.id) && !blocked.has(p.id) && canWork(p, g.positionId, g.date, g.locationId).ok,
  )
}

/** Books the Pros the buyer asked for into open spots, as long as each is still cleared and free that day. */
export function placeRequested(data: DemoData, g: ShiftGroup, now: string): ShiftGroup {
  const wanted = g.dispatch?.proIds ?? []
  if (!wanted.length) return g
  const slots = [...g.slots]
  for (const proId of wanted) {
    if (slots.some((s) => s.proId === proId)) continue
    const pro = data.pros.find((p) => p.id === proId)
    const open = slots.findIndex((s) => !s.proId && s.status === "open")
    if (!pro || open < 0 || !eligiblePros(data, g, pro.supplierId).some((p) => p.id === proId)) continue
    slots[open] = { ...slots[open], proId, status: "confirmed", confirmedAt: now }
  }
  return { ...g, slots }
}

export const offerKey = (cityId: string, positionId: string) => `${cityId}:${positionId}`

/** The agency the buyer picked for this role in this market, if it picked one. */
export const pickedOffer = (data: DemoData, buyerId: string, cityId: string, positionId: string): string | undefined => data.offerPicks?.[buyerId]?.[offerKey(cityId, positionId)]

/**
 * The buyer's approved suppliers that can staff this role in the city, in release order: the agency the buyer picked
 * for the role first (or `first`, for one order), then the rest from lowest bill rate up. Their rate cards price the shift.
 */
export function notifiedSuppliers(data: DemoData, buyerId: string, cityId: string, positionId: string, first?: string) {
  const approved = data.approvals[buyerId] ?? []
  const lead = first ?? pickedOffer(data, buyerId, cityId, positionId)
  return approved
    .flatMap((id) => {
      const s = SUPPLIERS.find((candidate) => candidate.id === id)
      if (!s || !s.cityIds.includes(cityId)) return []
      const card = data.rateCards.find((c) => c.supplierId === s.id && c.cityId === cityId && c.positionId === positionId && c.status === "active")
      return card ? [{ supplier: s, card }] : []
    })
    .sort((a, b) => Number(b.supplier.id === lead) - Number(a.supplier.id === lead) || a.card.billRate - b.card.billRate || a.supplier.name.localeCompare(b.supplier.name))
}

export function supplierReleasePlan(supplierIds: string[], createdAt: string) {
  const start = new Date(createdAt).getTime()
  return supplierIds.map((supplierId, index) => ({
    supplierId,
    releasedAt: new Date(start + index * PROGRAM.cascadeHoursBefore * 60 * 60 * 1000).toISOString(),
  }))
}
