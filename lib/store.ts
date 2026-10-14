"use client"

import { toast } from "sonner"
import { create } from "zustand"
import { persist, type PersistStorage, type StorageValue } from "zustand/middleware"

import { canWork } from "@/lib/compliance"
import { addDaysISO, paidHours, todayISO } from "@/lib/dates"
import { billFrom, round2 } from "@/lib/format"
import { filledCount, groupPhase } from "@/lib/metrics"
import { DEFAULT_WORKSPACE_ID, PROGRAM, SUPPLIERS, location, position, supplier, workspace } from "@/lib/reference"
import { DATA_VERSION, emptyCounters, generateDemoData } from "@/lib/seed"
import type {
  ActivityEvent,
  Counters,
  DemoData,
  Invoice,
  InvoiceGroup,
  RateCard,
  RequirementId,
  RosterStatus,
  ShiftGroup,
  Slot,
  Timesheet,
  Upload,
} from "@/lib/types"

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

interface StoreState {
  ready: boolean
  workspaceId: string
  data: DemoData
  ensureFresh: () => void
  resetDemo: () => void
  setWorkspace: (id: string) => void
  tick: () => void
  bookShifts: (input: BookingInput) => string[]
  cancelGroup: (groupId: string) => void
  setHeadcount: (groupId: string, headcount: number) => void
  setSupplierApproval: (buyerId: string, supplierId: string, approved: boolean) => void
  assignPros: (groupId: string, proIds: string[]) => number
  releasePro: (groupId: string, slotId: string) => void
  markNoShow: (groupId: string, slotId: string) => void
  setRoster: (buyerId: string, proIds: string[], status: RosterStatus | null) => void
  /** Approves submitted hours and returns the numbers of the invoices generated from them. */
  approveTimesheets: (ids: string[]) => string[]
  adjustTimesheet: (id: string, patch: { clockIn: string; clockOut: string; breakMins: number; reason: string }) => void
  disputeTimesheet: (id: string, reason: string, note?: string) => void
  respondDispute: (id: string, action: "accept" | "confirm", note?: string) => void
  submitTimesheets: (ids: string[]) => void
  setTips: (entries: { timesheetId: string; tips: number }[]) => void
  createInvoiceGroup: (name: string, invoiceIds: string[]) => string
  removeFromGroup: (invoiceId: string) => void
  deleteInvoiceGroup: (groupId: string) => void
  payInvoices: (ids: string[]) => void
  reviewInvoice: (id: string, status: "reviewed" | "sent_back", note?: string) => void
  upsertRateCard: (input: RateCardInput) => void
  deleteRateCard: (id: string) => void
  completeRequirement: (proId: string, requirement: RequirementId) => void
  addReview: (input: { proId: string; buyerId: string; groupId?: string; rating: number; text: string }) => void
  commitUpload: (upload: Omit<Upload, "id" | "code">, apply?: (data: DemoData, uploadId: string) => Patch) => Upload
  /** Saves an upload that was waiting on reviewed fixes. */
  resolveUpload: (id: string, patch: Partial<Omit<Upload, "id" | "code">>, apply?: (data: DemoData, uploadId: string) => Patch) => void
}

const nowISO = () => new Date().toISOString()

const actor = (workspaceId: string) => workspace(workspaceId).user.name

function event(data: DemoData, e: Omit<ActivityEvent, "id" | "at"> & { at?: string }): Patch {
  const entry: ActivityEvent = { id: `ev-${data.counters.ev}`, at: e.at ?? nowISO(), ...e }
  return { activity: [entry, ...data.activity].slice(0, 200), counters: { ev: data.counters.ev + 1 } }
}

const merge = (data: DemoData, ...patches: Patch[]): DemoData => {
  let next = data
  for (const p of patches) next = { ...next, ...p, counters: { ...next.counters, ...(p.counters ?? {}) } }
  return next
}

const LIVE_PACE: Record<string, { chance: number; burst: [number, number]; cap: number }> = {
  instawork: { chance: 0.95, burst: [1, 3], cap: 1 },
  crewline: { chance: 0.55, burst: [1, 1], cap: 0.92 },
  harbor: { chance: 0.42, burst: [1, 1], cap: 0.85 },
  metro: { chance: 0.28, burst: [1, 1], cap: 0.7 },
}

function eligiblePros(data: DemoData, g: ShiftGroup, supplierId = g.supplierId) {
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

export { eligiblePros }

const bestPace = (supplierIds: string[]) =>
  supplierIds.map((id) => LIVE_PACE[id] ?? LIVE_PACE.metro).sort((a, b) => b.chance - a.chance)[0] ?? LIVE_PACE.metro

export const joinNames = (names: string[]) =>
  names.length <= 1 ? (names[0] ?? "") : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`

/** The buyer's approved suppliers that can staff this role in the city, in program order. Their rate cards price the shift. */
export function notifiedSuppliers(data: DemoData, buyerId: string, cityId: string, positionId: string) {
  const approved = data.approvals[buyerId] ?? []
  return SUPPLIERS.filter((s) => approved.includes(s.id) && s.cityIds.includes(cityId)).flatMap((s) => {
    const card = data.rateCards.find((c) => c.supplierId === s.id && c.cityId === cityId && c.positionId === positionId && c.status === "active")
    return card ? [{ supplier: s, card }] : []
  })
}

/** One invoice per supplier for a batch of approved hours, priced at the hours, tips and bill rate on each timesheet. */
function invoicesFor(data: DemoData, approved: Timesheet[]) {
  const pros = new Map(data.pros.map((p) => [p.id, p]))
  const bySupplier = new Map<string, Timesheet[]>()
  for (const t of approved) bySupplier.set(`${t.supplierId}|${t.buyerId}`, [...(bySupplier.get(`${t.supplierId}|${t.buyerId}`) ?? []), t])
  const today = todayISO()
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

function debouncedStorage<T>(delay = 400): PersistStorage<T> | undefined {
  if (typeof window === "undefined") return undefined
  let timer: number | undefined
  let pending: { name: string; value: StorageValue<T> } | undefined
  const flush = () => {
    if (!pending) return
    try {
      window.localStorage.setItem(pending.name, JSON.stringify(pending.value))
    } catch {
      // Quota or private mode: the demo keeps working in memory.
    }
    pending = undefined
  }
  window.addEventListener("beforeunload", flush)
  return {
    getItem: (name) => {
      const raw = window.localStorage.getItem(name)
      if (!raw) return null
      try {
        return JSON.parse(raw) as StorageValue<T>
      } catch {
        return null
      }
    },
    setItem: (name, value) => {
      pending = { name, value }
      window.clearTimeout(timer)
      timer = window.setTimeout(flush, delay)
    },
    removeItem: (name) => window.localStorage.removeItem(name),
  }
}

type Persisted = Pick<StoreState, "workspaceId" | "data">

export const useStore = create<StoreState>()(
  persist(
    (set, get) => {
      const commit = (fn: (data: DemoData, workspaceId: string) => Patch | Patch[] | undefined) => {
        const { data, workspaceId } = get()
        const result = fn(data, workspaceId)
        if (!result) return
        const patches = Array.isArray(result) ? result : [result]
        set({ data: merge(data, ...patches) })
      }

      return {
        ready: false,
        workspaceId: DEFAULT_WORKSPACE_ID,
        data: emptyData(),

        ensureFresh: () => {
          const { data } = get()
          if (data.version !== DATA_VERSION || !data.groups.length) {
            set({ data: generateDemoData(), ready: true })
          } else {
            set({ ready: true })
          }
        },

        resetDemo: () => set({ data: generateDemoData() }),

        setWorkspace: (id) => set({ workspaceId: workspace(id).id }),

        tick: () => {
          const { data } = get()
          const live = data.groups.filter((g) => g.liveFill)
          if (!live.length) return
          const completions: string[] = []
          let next = data
          for (const g of live) {
            const current = next.groups.find((x) => x.id === g.id)
            if (!current?.liveFill) continue
            const pace = bestPace(current.supplierIds)
            const filled = filledCount(current)
            const cap = Math.max(1, Math.floor(current.slots.length * pace.cap))
            const stop = () => {
              next = merge(next, { groups: next.groups.map((x) => (x.id === current.id ? { ...x, liveFill: undefined } : x)) })
            }
            if (groupPhase(current) !== "upcoming" || filled >= current.slots.length || filled >= cap) {
              stop()
              continue
            }
            if (Math.random() > pace.chance) continue
            const pool = current.supplierIds.flatMap((id) => (Math.random() <= (LIVE_PACE[id] ?? LIVE_PACE.metro).chance ? eligiblePros(next, current, id) : []))
            if (!pool.length && !current.supplierIds.some((id) => eligiblePros(next, current, id).length)) {
              stop()
              continue
            }
            const burst = Math.min(
              pool.length,
              cap - filled,
              pace.burst[0] + Math.floor(Math.random() * (pace.burst[1] - pace.burst[0] + 1)),
            )
            const picks = [...pool].sort(() => Math.random() - 0.5).slice(0, burst)
            let i = 0
            const slots: Slot[] = current.slots.map((s) => {
              if (s.proId || i >= picks.length) return s
              const pro = picks[i++]
              return { ...s, proId: pro.id, status: "confirmed", confirmedAt: nowISO() }
            })
            const nowFilled = slots.filter((s) => s.proId).length
            const done = nowFilled >= current.slots.length || nowFilled >= cap
            const updated: ShiftGroup = { ...current, slots, liveFill: done ? undefined : current.liveFill }
            next = merge(next, { groups: next.groups.map((x) => (x.id === current.id ? updated : x)) })
            if (done) {
              const proSupplier = new Map(next.pros.map((p) => [p.id, p.supplierId]))
              const fillers = [...new Set(slots.map((s) => (s.proId ? proSupplier.get(s.proId) : undefined)).filter(Boolean) as string[])]
              const who = joinNames(fillers.map((id) => supplier(id).shortName))
              const secs = Math.max(1, Math.round((Date.now() - new Date(current.liveFill.startedAt).getTime()) / 1000))
              const text =
                nowFilled >= current.slots.length
                  ? `${who} filled all ${current.slots.length} ${position(current.positionId).name} spots at ${location(current.locationId).name}`
                  : `${who} confirmed ${nowFilled} of ${current.slots.length} ${position(current.positionId).name} spots. No more ready Pros right now`
              next = merge(next, event(next, {
                text,
                actor: who,
                tone: nowFilled >= current.slots.length ? "positive" : "warning",
                buyerId: current.buyerId,
                supplierId: fillers[0],
                groupId: current.id,
              }))
              completions.push(
                nowFilled >= current.slots.length
                  ? `${text} in ${secs < 90 ? `${secs} seconds` : `${Math.round(secs / 60)} minutes`}.`
                  : `${text}.`,
              )
            }
          }
          if (next !== data) set({ data: next })
          for (const msg of completions) toast.success(msg, { duration: 6000 })
        },

        bookShifts: (input) => {
          const ids: string[] = []
          commit((data, wsId) => {
            const loc = location(input.locationId)
            const notified = notifiedSuppliers(data, loc.buyerId, loc.cityId, input.positionId)
            if (!notified.length) return undefined
            const card = notified[0].card
            let sg = data.counters.sg
            const created = nowISO()
            const groups: ShiftGroup[] = input.dates.map((date) => {
              const code = `SG-${sg++}`
              ids.push(code.toLowerCase())
              return {
                id: code.toLowerCase(),
                code,
                buyerId: loc.buyerId,
                locationId: loc.id,
                positionId: input.positionId,
                name: input.name || undefined,
                eventName: input.eventName || undefined,
                date,
                start: input.start,
                end: input.end,
                breakMins: input.breakMins,
                supplierId: card.supplierId,
                supplierIds: notified.map((n) => n.card.supplierId),
                billRate: card.billRate,
                proRate: card.proRate,
                markupPct: card.markupPct,
                slots: Array.from({ length: input.headcount }, (_, i) => ({ id: `${code.toLowerCase()}-${i + 1}`, status: "open" as const })),
                badges: input.tips ? ["TIPS"] : [],
                instructions: input.instructions,
                attire: input.attire,
                createdAt: created,
                createdBy: actor(wsId),
                source: "booking",
                liveFill: { startedAt: created },
              }
            })
            return [
              { groups: [...groups, ...data.groups], counters: { sg } },
              event(data, {
                text: `${actor(wsId)} posted ${input.headcount * input.dates.length} ${position(input.positionId).name} spots at ${loc.name} and notified ${joinNames(notified.map((n) => supplier(n.card.supplierId).shortName))}`,
                actor: actor(wsId),
                tone: "primary",
                buyerId: loc.buyerId,
                groupId: groups[0]?.id,
              }),
            ]
          })
          return ids
        },

        cancelGroup: (groupId) =>
          commit((data, wsId) => {
            const g = data.groups.find((x) => x.id === groupId)
            if (!g) return undefined
            return [
              { groups: data.groups.map((x) => (x.id === groupId ? { ...x, cancelledAt: nowISO(), liveFill: undefined } : x)) },
              event(data, {
                text: `${actor(wsId)} cancelled ${g.code} (${position(g.positionId).name}, ${location(g.locationId).name})`,
                actor: actor(wsId),
                tone: "critical",
                buyerId: g.buyerId,
                supplierId: g.supplierId,
                groupId,
              }),
            ]
          }),

        setHeadcount: (groupId, headcount) =>
          commit((data) => {
            const g = data.groups.find((x) => x.id === groupId)
            if (!g) return undefined
            const filled = g.slots.filter((s) => s.proId)
            const open = g.slots.filter((s) => !s.proId)
            const target = Math.max(filled.length, headcount)
            let slots = [...filled, ...open].slice(0, target)
            let n = g.slots.length
            while (slots.length < target) slots = [...slots, { id: `${g.id}-${++n}`, status: "open" }]
            return {
              groups: data.groups.map((x) =>
                x.id === groupId ? { ...x, slots, liveFill: slots.some((s) => !s.proId) ? { startedAt: nowISO() } : undefined } : x,
              ),
            }
          }),

        setSupplierApproval: (buyerId, supplierId, approved) =>
          commit((data, wsId) => {
            const current = data.approvals[buyerId] ?? []
            if (approved === current.includes(supplierId)) return undefined
            const nextIds = approved ? SUPPLIERS.map((x) => x.id).filter((id) => id === supplierId || current.includes(id)) : current.filter((id) => id !== supplierId)
            return [
              { approvals: { ...data.approvals, [buyerId]: nextIds } },
              event(data, {
                text: `${actor(wsId)} ${approved ? "approved" : "removed"} ${supplier(supplierId).shortName} ${approved ? "for new shifts" : "from new shifts"}`,
                actor: actor(wsId),
                tone: approved ? "positive" : "neutral",
                buyerId,
                supplierId,
              }),
            ]
          }),

        assignPros: (groupId, proIds) => {
          let assigned = 0
          commit((data, wsId) => {
            const g = data.groups.find((x) => x.id === groupId)
            if (!g) return undefined
            const allowed = new Set(eligiblePros(data, g, workspace(wsId).supplierId ?? g.supplierId).map((p) => p.id))
            const queue = proIds.filter((id) => allowed.has(id))
            const slots = g.slots.map((s) => {
              if (s.proId || !queue.length) return s
              assigned++
              return { ...s, proId: queue.shift(), status: "confirmed" as const, confirmedAt: nowISO() }
            })
            if (!assigned) return undefined
            return [
              { groups: data.groups.map((x) => (x.id === groupId ? { ...x, slots } : x)) },
              event(data, {
                text: `${actor(wsId)} assigned ${assigned} Pro${assigned === 1 ? "" : "s"} to ${g.code} at ${location(g.locationId).name}`,
                actor: actor(wsId),
                tone: "positive",
                buyerId: g.buyerId,
                supplierId: workspace(wsId).supplierId ?? g.supplierId,
                groupId,
              }),
            ]
          })
          return assigned
        },

        releasePro: (groupId, slotId) =>
          commit((data) => ({
            groups: data.groups.map((g) =>
              g.id === groupId
                ? { ...g, slots: g.slots.map((s) => (s.id === slotId ? { id: s.id, status: "open" as const } : s)) }
                : g,
            ),
          })),

        markNoShow: (groupId, slotId) =>
          commit((data) => ({
            groups: data.groups.map((g) =>
              g.id === groupId ? { ...g, slots: g.slots.map((s) => (s.id === slotId ? { ...s, status: "no_show" as const } : s)) } : g,
            ),
            timesheets: data.timesheets.filter((t) => !(t.groupId === groupId && t.slotId === slotId && !t.invoiceId)),
          })),

        setRoster: (buyerId, proIds, status) =>
          commit((data) => {
            const ids = new Set(proIds)
            const kept = data.roster.filter((r) => !(r.buyerId === buyerId && ids.has(r.proId)))
            if (!status) return { roster: kept }
            const added = proIds.map((proId) => ({ id: `${buyerId}-${proId}`, buyerId, proId, status, addedOn: todayISO() }))
            return { roster: [...kept, ...added] }
          }),

        approveTimesheets: (ids) => {
          const numbers: string[] = []
          commit((data, wsId) => {
            const set = new Set(ids)
            const approved = data.timesheets.filter((t) => set.has(t.id) && t.status === "submitted")
            if (!approved.length) return undefined
            const stamp = { approvedAt: nowISO(), approvedBy: actor(wsId) }
            const { invoices, invoiceOf, counter } = invoicesFor(data, approved)
            numbers.push(...invoices.map((i) => i.number))
            const worked = new Map<string, number>()
            for (const t of approved) worked.set(t.proId, (worked.get(t.proId) ?? 0) + 1)
            return [
              {
                timesheets: data.timesheets.map((t) =>
                  set.has(t.id) && t.status === "submitted" ? { ...t, status: "approved" as const, ...stamp, invoiceId: invoiceOf.get(t.id) } : t,
                ),
                pros: data.pros.map((p) => (worked.has(p.id) ? { ...p, shiftsWorked: p.shiftsWorked + worked.get(p.id)! } : p)),
                invoices: [...invoices, ...data.invoices],
                counters: { inv: counter },
              },
              event(data, {
                text: `${actor(wsId)} approved ${approved.length} timesheet${approved.length === 1 ? "" : "s"}. CrUber generated ${joinNames(invoices.map((i) => i.number))}`,
                actor: actor(wsId),
                tone: "positive",
                buyerId: approved[0].buyerId,
              }),
            ]
          })
          return numbers
        },

        adjustTimesheet: (id, patch) =>
          commit((data, wsId) => ({
            timesheets: data.timesheets.map((t) =>
              t.id === id
                ? {
                    ...t,
                    clockIn: patch.clockIn,
                    clockOut: patch.clockOut,
                    breakMins: patch.breakMins,
                    hours: paidHours(patch.clockIn, patch.clockOut, patch.breakMins),
                    adjustment: { reason: patch.reason, previousHours: t.hours, at: nowISO(), by: actor(wsId) },
                    source: "manual" as const,
                  }
                : t,
            ),
          })),

        disputeTimesheet: (id, reason, note) =>
          commit((data, wsId) => {
            const t = data.timesheets.find((x) => x.id === id)
            if (!t) return undefined
            return [
              {
                timesheets: data.timesheets.map((x) =>
                  x.id === id ? { ...x, status: "disputed" as const, dispute: { reason, note, raisedAt: nowISO(), raisedBy: actor(wsId) } } : x,
                ),
              },
              event(data, {
                text: `${actor(wsId)} disputed hours for a ${position(t.positionId).name} shift (${reason.toLowerCase()})`,
                actor: actor(wsId),
                tone: "warning",
                buyerId: t.buyerId,
                supplierId: t.supplierId,
              }),
            ]
          }),

        respondDispute: (id, action, note) =>
          commit((data, wsId) => ({
            timesheets: data.timesheets.map((t) => {
              if (t.id !== id || !t.dispute) return t
              const scheduled = paidHours(t.scheduledStart, t.scheduledEnd, t.breakMins)
              const fixed =
                action === "accept"
                  ? { clockIn: t.scheduledStart, clockOut: t.scheduledEnd, hours: scheduled, adjustment: { reason: "Corrected to schedule after dispute", previousHours: t.hours, at: nowISO(), by: actor(wsId) } }
                  : {}
              return {
                ...t,
                ...fixed,
                status: "submitted" as const,
                submittedAt: nowISO(),
                dispute: { ...t.dispute, response: note || (action === "accept" ? "Corrected to the scheduled hours." : "Confirmed with the Pro: hours are correct."), respondedAt: nowISO() },
              }
            }),
          })),

        submitTimesheets: (ids) =>
          commit((data, wsId) => {
            const set = new Set(ids)
            const n = data.timesheets.filter((t) => set.has(t.id) && t.status === "awaiting_submission").length
            if (!n) return undefined
            return [
              {
                timesheets: data.timesheets.map((t) =>
                  set.has(t.id) && t.status === "awaiting_submission" ? { ...t, status: "submitted" as const, submittedAt: nowISO() } : t,
                ),
              },
              event(data, {
                text: `${workspace(wsId).name} submitted ${n} timesheet${n === 1 ? "" : "s"} for approval`,
                actor: actor(wsId),
                tone: "primary",
                supplierId: workspace(wsId).supplierId,
              }),
            ]
          }),

        setTips: (entries) =>
          commit((data) => {
            const map = new Map(entries.map((e) => [e.timesheetId, round2(Math.max(0, e.tips))]))
            return { timesheets: data.timesheets.map((t) => (map.has(t.id) && !t.invoiceId ? { ...t, tips: map.get(t.id)! } : t)) }
          }),

        createInvoiceGroup: (name, invoiceIds) => {
          let id = ""
          commit((data, wsId) => {
            const code = `IG-2026-${String(data.counters.ig).padStart(3, "0")}`
            id = code.toLowerCase()
            const members = data.invoices.filter((i) => invoiceIds.includes(i.id))
            const buyers = new Set(members.map((m) => m.buyerId))
            const group: InvoiceGroup = {
              id,
              code,
              name,
              buyerId: buyers.size === 1 ? [...buyers][0] : undefined,
              createdOn: todayISO(),
              createdBy: actor(wsId),
              invoiceIds,
            }
            const prior = new Set(members.map((m) => m.groupId).filter(Boolean) as string[])
            return [
              {
                invoiceGroups: [
                  group,
                  ...data.invoiceGroups
                    .map((g) => (prior.has(g.id) ? { ...g, invoiceIds: g.invoiceIds.filter((x) => !invoiceIds.includes(x)) } : g))
                    .filter((g) => g.invoiceIds.length > 0),
                ],
                invoices: data.invoices.map((i) => (invoiceIds.includes(i.id) ? { ...i, groupId: id } : i)),
                counters: { ig: data.counters.ig + 1 },
              },
              event(data, {
                text: `${actor(wsId)} grouped ${invoiceIds.length} invoices into ${code}`,
                actor: actor(wsId),
                tone: "primary",
                buyerId: group.buyerId,
              }),
            ]
          })
          return id
        },

        removeFromGroup: (invoiceId) =>
          commit((data) => {
            const inv = data.invoices.find((i) => i.id === invoiceId)
            if (!inv?.groupId) return undefined
            return {
              invoices: data.invoices.map((i) => (i.id === invoiceId ? { ...i, groupId: undefined } : i)),
              invoiceGroups: data.invoiceGroups
                .map((g) => (g.id === inv.groupId ? { ...g, invoiceIds: g.invoiceIds.filter((x) => x !== invoiceId) } : g))
                .filter((g) => g.invoiceIds.length > 0),
            }
          }),

        deleteInvoiceGroup: (groupId) =>
          commit((data) => ({
            invoiceGroups: data.invoiceGroups.filter((g) => g.id !== groupId),
            invoices: data.invoices.map((i) => (i.groupId === groupId ? { ...i, groupId: undefined } : i)),
          })),

        payInvoices: (ids) =>
          commit((data, wsId) => {
            const set = new Set(ids)
            const n = data.invoices.filter((i) => set.has(i.id) && i.status !== "paid").length
            if (!n) return undefined
            return [
              {
                invoices: data.invoices.map((i) => (set.has(i.id) && i.status !== "paid" ? { ...i, status: "in_process" as const } : i)),
              },
              event(data, {
                text: `${actor(wsId)} scheduled payment for ${n} invoice${n === 1 ? "" : "s"}`,
                actor: actor(wsId),
                tone: "positive",
                buyerId: workspace(wsId).buyerId,
              }),
            ]
          }),

        reviewInvoice: (id, status, note) =>
          commit((data, wsId) => {
            const inv = data.invoices.find((i) => i.id === id)
            if (!inv) return undefined
            return [
              { invoices: data.invoices.map((i) => (i.id === id ? { ...i, review: { status, note, by: actor(wsId), at: nowISO() } } : i)) },
              event(data, {
                text:
                  status === "reviewed"
                    ? `${actor(wsId)} reviewed ${inv.number} and cleared it for payment`
                    : `${actor(wsId)} sent ${inv.number} back to ${supplier(inv.supplierId).shortName} for correction`,
                actor: actor(wsId),
                tone: status === "reviewed" ? "positive" : "warning",
                buyerId: inv.buyerId,
                supplierId: inv.supplierId,
                invoiceId: id,
              }),
            ]
          }),

        upsertRateCard: (input) =>
          commit((data) => {
            const existing =
              (input.id && data.rateCards.find((c) => c.id === input.id)) ||
              data.rateCards.find((c) => c.supplierId === input.supplierId && c.cityId === input.cityId && c.positionId === input.positionId)
            const markupPct = round2(input.markupPct)
            const status: RateCard["status"] = input.status ?? "active"
            const card: RateCard = {
              id: existing?.id ?? `rate-${data.counters.rate}`,
              supplierId: input.supplierId,
              cityId: input.cityId,
              positionId: input.positionId,
              proRate: round2(input.proRate),
              billRate: round2(input.billRate || billFrom(input.proRate, markupPct)),
              markupPct,
              zips: input.zips,
              zipsAutoFilled: input.zipsAutoFilled,
              status,
              effectiveFrom: todayISO(),
              updatedAt: nowISO(),
              source: input.source,
              uploadId: input.uploadId,
            }
            return existing
              ? { rateCards: data.rateCards.map((c) => (c.id === existing.id ? card : c)) }
              : { rateCards: [card, ...data.rateCards], counters: { rate: data.counters.rate + 1 } }
          }),

        deleteRateCard: (id) => commit((data) => ({ rateCards: data.rateCards.filter((c) => c.id !== id) })),

        completeRequirement: (proId, requirement) =>
          commit((data) => {
            const today = todayISO()
            return {
              pros: data.pros.map((p) => {
                if (p.id !== proId) return p
                const renews = requirement === "background" ? 365 : requirement === "foodHandler" || requirement === "alcohol" ? 365 * 3 : 0
                const expiresOn = renews ? new Date(Date.now() + renews * 86400_000).toISOString().slice(0, 10) : undefined
                const compliance = { ...p.compliance, [requirement]: { status: "complete" as const, completedOn: today, expiresOn } }
                const pro = { ...p, compliance }
                const required = Object.keys(compliance) as RequirementId[]
                const allDone = required.every((r) => compliance[r]?.status === "complete")
                return allDone && p.status === "onboarding" ? { ...pro, status: "active" as const, rating: 0 } : pro
              }),
            }
          }),

        addReview: (input) =>
          commit((data, wsId) => {
            const pro = data.pros.find((p) => p.id === input.proId)
            if (!pro) return undefined
            const rating = Math.max(1, Math.min(5, Math.round(input.rating)))
            const weight = Math.max(1, data.reviews.filter((r) => r.proId === pro.id).length)
            const average = pro.rating > 0 ? round2((pro.rating * weight + rating) / (weight + 1)) : rating
            return [
              {
                reviews: [{ id: `rev-${data.counters.rev}`, ...input, rating, by: actor(wsId), at: nowISO() }, ...data.reviews],
                pros: data.pros.map((p) => (p.id === pro.id ? { ...p, rating: Math.round(average * 10) / 10 } : p)),
                counters: { rev: data.counters.rev + 1 },
              },
              event(data, {
                text: `${actor(wsId)} rated ${pro.firstName} ${pro.lastName} ${rating} of 5`,
                actor: actor(wsId),
                tone: "neutral",
                buyerId: input.buyerId,
                supplierId: pro.supplierId,
              }),
            ]
          }),

        resolveUpload: (id, patch, apply) => {
          const { data, workspaceId } = get()
          const existing = data.uploads.find((u) => u.id === id)
          if (!existing) return
          const upload: Upload = { ...existing, ...patch }
          let next = merge(data, { uploads: data.uploads.map((u) => (u.id === id ? upload : u)) })
          if (apply && upload.status !== "failed" && upload.status !== "needs_review") next = merge(next, apply(next, upload.id))
          next = merge(next, event(next, {
            text: `${actor(workspaceId)} saved ${upload.fileName}: ${upload.summary.toLowerCase()}`,
            actor: actor(workspaceId),
            tone: "positive",
            buyerId: upload.buyerId,
            supplierId: upload.supplierId,
          }))
          set({ data: next })
        },

        commitUpload: (input, apply) => {
          const { data, workspaceId } = get()
          const code = `UPL-${data.counters.upl}`
          const upload: Upload = { id: code.toLowerCase(), code, ...input }
          const patches: Patch[] = [{ uploads: [upload, ...data.uploads], counters: { upl: data.counters.upl + 1 } }]
          let next = merge(data, ...patches)
          if (apply && upload.status !== "failed" && upload.status !== "needs_review") next = merge(next, apply(next, upload.id))
          next = merge(next, event(next, {
            text: `${actor(workspaceId)} uploaded ${upload.fileName}: ${upload.summary.toLowerCase()}`,
            actor: actor(workspaceId),
            tone: upload.status === "failed" ? "critical" : upload.status === "completed" ? "positive" : "warning",
            buyerId: upload.buyerId,
            supplierId: upload.supplierId,
          }))
          set({ data: next })
          return upload
        },
      }
    },
    {
      name: "cruber-demo",
      version: DATA_VERSION,
      storage: debouncedStorage<Persisted>(),
      skipHydration: true,
      partialize: (s) => ({ workspaceId: s.workspaceId, data: s.data }),
      migrate: () => ({ workspaceId: DEFAULT_WORKSPACE_ID, data: emptyData() }) as Persisted,
    },
  ),
)
