import { planImport } from "@/lib/csv"
import { addDaysISO, paidHours, todayISO } from "@/lib/dates"
import { billFrom, round2 } from "@/lib/format"
import { groupPhase, isOpenTo } from "@/lib/metrics"
import { PROGRAM, SUPPLIERS, findLocation, findPosition, findSupplier, location, position, supplier } from "@/lib/reference"
import { generateDemoData } from "@/lib/seed"
import type { DemoData, InvoiceGroup, RateCard, RequirementId, RosterStatus, ShiftGroup, Upload, Workspace } from "@/lib/types"
import {
  eligiblePros,
  event,
  invoicesFor,
  merge,
  notifiedSuppliers,
  supplierReleasePlan,
  type BookingInput,
  type Patch,
  type RateCardInput,
} from "@/lib/domain/core"

export class CommandError extends Error {
  constructor(
    message: string,
    readonly status = 400,
  ) {
    super(message)
  }
}

export interface CommandContext {
  ws: Workspace
  now: string
}

/** A toast for the devices it concerns, sent along with the change. */
export interface Notice {
  text: string
  tone: "success" | "info" | "warning"
  buyerId?: string
  supplierId?: string
}

export interface Outcome<R> {
  data: DemoData
  result: R
  notices?: Notice[]
  /** The whole dataset was replaced, so devices reload it instead of applying a diff. */
  replaced?: boolean
}

const fail = (message: string, status = 400): never => {
  throw new CommandError(message, status)
}
const forbid = (message = "This workspace can't do that."): never => fail(message, 403)
const need = <T>(value: T | undefined | null, message: string): T => value ?? fail(message, 404)

const isCompass = (ws: Workspace) => ws.kind === "compass"
const ownsBuyer = (ws: Workspace, buyerId: string) => isCompass(ws) || (ws.kind === "buyer" && ws.buyerId === buyerId)
const isSupplier = (ws: Workspace, supplierId: string) => ws.kind === "supplier" && ws.supplierId === supplierId

const TIME = /^([01]\d|2[0-3]):[0-5]\d$/
const DATE = /^\d{4}-\d{2}-\d{2}$/

const str = (value: unknown, name: string, max = 500): string => (typeof value === "string" && value.trim() ? value.slice(0, max) : fail(`${name} is required`))
const optStr = (value: unknown, max = 500): string | undefined => (typeof value === "string" && value.trim() ? value.slice(0, max) : undefined)
const num = (value: unknown, name: string, min: number, max: number): number => {
  const n = typeof value === "number" ? value : Number.NaN
  return Number.isFinite(n) && n >= min && n <= max ? n : fail(`${name} must be between ${min} and ${max}`)
}
const strList = (value: unknown, name: string, max = 2000): string[] =>
  Array.isArray(value) && value.length <= max && value.every((v) => typeof v === "string") ? (value as string[]) : fail(`${name} must be a list of ids`)
const time = (value: unknown, name: string): string => (typeof value === "string" && TIME.test(value) ? value : fail(`${name} must be HH:MM`))

const actorName = (ctx: CommandContext) => ctx.ws.user.name
const done = <R>(data: DemoData, result: R, ...patches: Patch[]): Outcome<R> => ({ data: merge(data, ...patches), result })
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`

/* --------------------------------- Shifts --------------------------------- */

function createJobPosting(data: DemoData, ctx: CommandContext, input: BookingInput): Outcome<string[]> {
  const loc = need(findLocation(str(input?.locationId, "Location")), "That location doesn't exist")
  if (ctx.ws.kind !== "buyer" || ctx.ws.buyerId !== loc.buyerId) forbid("Only this location's buyer can post shifts here.")
  const pos = need(findPosition(str(input.positionId, "Position")), "That position doesn't exist")
  const dates = strList(input.dates, "Dates", 31)
  const today = todayISO()
  if (!dates.length || dates.some((d) => !DATE.test(d) || d < today)) fail("Pick one or more dates from today on.")
  const start = time(input.start, "Start time")
  const end = time(input.end, "End time")
  if (start === end) fail("Start and end can't be the same time.")
  const breakMins = num(input.breakMins ?? 0, "Break", 0, 120)
  const headcount = Math.round(num(input.headcount, "Headcount", 1, 60))
  const notified = notifiedSuppliers(data, loc.buyerId, loc.cityId, pos.id)
  if (!notified.length) fail(`None of your approved suppliers has an active ${pos.name} rate at ${loc.name}.`)
  const card = notified[0].card
  const ordered = notified.map((n) => n.card.supplierId)
  let sg = data.counters.sg
  const ids: string[] = []
  const groups: ShiftGroup[] = [...new Set(dates)].sort().map((date) => {
    const code = `SG-${sg++}`
    const id = code.toLowerCase()
    ids.push(id)
    return {
      id,
      code,
      buyerId: loc.buyerId,
      locationId: loc.id,
      positionId: pos.id,
      name: optStr(input.name, 120),
      eventName: optStr(input.eventName, 120),
      date,
      start,
      end,
      breakMins,
      supplierId: card.supplierId,
      supplierIds: ordered.slice(0, 1),
      supplierReleases: supplierReleasePlan(ordered, ctx.now),
      billRate: card.billRate,
      proRate: card.proRate,
      markupPct: card.markupPct,
      slots: Array.from({ length: headcount }, (_, i) => ({ id: `${id}-${i + 1}`, status: "open" as const })),
      badges: input.tips ? ["TIPS"] : [],
      instructions: optStr(input.instructions, 2000) ?? pos.duties,
      attire: optStr(input.attire, 500) ?? pos.attire,
      createdAt: ctx.now,
      createdBy: actorName(ctx),
      source: "booking",
      liveFill: { startedAt: ctx.now },
    }
  })
  return done(
    data,
    ids,
    { groups: [...groups, ...data.groups], counters: { sg } },
    event(
      data,
      {
        text: `${actorName(ctx)} posted ${headcount * groups.length} ${pos.name} spots at ${loc.name}. ${supplier(card.supplierId).shortName} received them first`,
        actor: actorName(ctx),
        tone: "primary",
        buyerId: loc.buyerId,
        groupId: groups[0]?.id,
      },
      ctx.now,
    ),
  )
}

const groupOf = (data: DemoData, groupId: unknown) => need(data.groups.find((g) => g.id === groupId), "That shift doesn't exist")

function cancelGroup(data: DemoData, ctx: CommandContext, input: { groupId: string }): Outcome<null> {
  const g = groupOf(data, input?.groupId)
  if (!ownsBuyer(ctx.ws, g.buyerId)) forbid("Only the buyer can cancel this shift.")
  if (g.cancelledAt) return done(data, null)
  return done(
    data,
    null,
    { groups: data.groups.map((x) => (x.id === g.id ? { ...x, cancelledAt: ctx.now, liveFill: undefined } : x)) },
    event(
      data,
      {
        text: `${actorName(ctx)} cancelled ${g.code} (${position(g.positionId).name}, ${location(g.locationId).name})`,
        actor: actorName(ctx),
        tone: "critical",
        buyerId: g.buyerId,
        supplierId: g.supplierId,
        groupId: g.id,
      },
      ctx.now,
    ),
  )
}

function setHeadcount(data: DemoData, ctx: CommandContext, input: { groupId: string; headcount: number }): Outcome<null> {
  const g = groupOf(data, input?.groupId)
  if (!ownsBuyer(ctx.ws, g.buyerId)) forbid("Only the buyer can change headcount.")
  const headcount = Math.round(num(input.headcount, "Headcount", 1, 60))
  const filled = g.slots.filter((s) => s.proId)
  const open = g.slots.filter((s) => !s.proId)
  const target = Math.max(filled.length, headcount)
  let slots = [...filled, ...open].slice(0, target)
  let n = g.slots.length
  while (slots.length < target) slots = [...slots, { id: `${g.id}-${++n}`, status: "open" }]
  return done(data, null, {
    groups: data.groups.map((x) => (x.id === g.id ? { ...x, slots, liveFill: slots.some((s) => !s.proId) ? { startedAt: ctx.now } : undefined } : x)),
  })
}

function assignPros(data: DemoData, ctx: CommandContext, input: { groupId: string; proIds: string[] }): Outcome<number> {
  const g = groupOf(data, input?.groupId)
  const supplierId = ctx.ws.supplierId
  if (ctx.ws.kind !== "supplier" || !supplierId) return forbid("Only an agency can assign its Pros.")
  if (!isOpenTo(g, supplierId)) forbid("This shift hasn't been released to your agency.")
  if (g.cancelledAt || groupPhase(g) === "past") fail("This shift is no longer open.")
  const allowed = new Set(eligiblePros(data, g, supplierId).map((p) => p.id))
  const queue = strList(input.proIds, "Pros", 60).filter((id) => allowed.has(id))
  let assigned = 0
  const slots = g.slots.map((s) => {
    if (s.proId || !queue.length) return s
    assigned++
    return { ...s, proId: queue.shift(), status: "confirmed" as const, confirmedAt: ctx.now }
  })
  if (!assigned) return done(data, 0)
  return done(
    data,
    assigned,
    { groups: data.groups.map((x) => (x.id === g.id ? { ...x, slots } : x)) },
    event(
      data,
      {
        text: `${actorName(ctx)} assigned ${plural(assigned, "Pro")} to ${g.code} at ${location(g.locationId).name}`,
        actor: actorName(ctx),
        tone: "positive",
        buyerId: g.buyerId,
        supplierId,
        groupId: g.id,
      },
      ctx.now,
    ),
  )
}

function slotAccess(data: DemoData, ctx: CommandContext, g: ShiftGroup, slotId: unknown) {
  const slot = need(g.slots.find((s) => s.id === slotId), "That spot doesn't exist")
  const pro = slot.proId ? data.pros.find((p) => p.id === slot.proId) : undefined
  if (!ownsBuyer(ctx.ws, g.buyerId) && !(pro && isSupplier(ctx.ws, pro.supplierId))) forbid()
  return slot
}

function releasePro(data: DemoData, ctx: CommandContext, input: { groupId: string; slotId: string }): Outcome<null> {
  const g = groupOf(data, input?.groupId)
  slotAccess(data, ctx, g, input.slotId)
  return done(data, null, {
    groups: data.groups.map((x) => (x.id === g.id ? { ...x, slots: x.slots.map((s) => (s.id === input.slotId ? { id: s.id, status: "open" as const } : s)) } : x)),
  })
}

function markNoShow(data: DemoData, ctx: CommandContext, input: { groupId: string; slotId: string }): Outcome<null> {
  const g = groupOf(data, input?.groupId)
  slotAccess(data, ctx, g, input.slotId)
  return done(data, null, {
    groups: data.groups.map((x) => (x.id === g.id ? { ...x, slots: x.slots.map((s) => (s.id === input.slotId ? { ...s, status: "no_show" as const } : s)) } : x)),
    timesheets: data.timesheets.filter((t) => !(t.groupId === g.id && t.slotId === input.slotId && !t.invoiceId)),
  })
}

/* -------------------------------- Suppliers ------------------------------- */

function setSupplierApproval(data: DemoData, ctx: CommandContext, input: { buyerId: string; supplierId: string; approved: boolean }): Outcome<null> {
  const buyerId = str(input?.buyerId, "Buyer")
  if (!ownsBuyer(ctx.ws, buyerId)) forbid("Only the buyer or Compass can change approved agencies.")
  const s = need(findSupplier(str(input.supplierId, "Supplier")), "That agency doesn't exist")
  const approved = input.approved === true
  const current = data.approvals[buyerId] ?? []
  if (approved === current.includes(s.id)) return done(data, null)
  const nextIds = approved ? [...current, s.id] : current.filter((id) => id !== s.id)
  return done(
    data,
    null,
    { approvals: { ...data.approvals, [buyerId]: nextIds } },
    event(
      data,
      {
        text: `${actorName(ctx)} ${approved ? "approved" : "removed"} ${s.shortName} ${approved ? "for new shifts" : "from new shifts"}`,
        actor: actorName(ctx),
        tone: approved ? "positive" : "neutral",
        buyerId,
        supplierId: s.id,
      },
      ctx.now,
    ),
  )
}

function moveSupplierPriority(data: DemoData, ctx: CommandContext, input: { buyerId: string; supplierId: string; direction: -1 | 1 }): Outcome<null> {
  const buyerId = str(input?.buyerId, "Buyer")
  if (!ownsBuyer(ctx.ws, buyerId)) forbid("Only the buyer or Compass can reorder agencies.")
  const current = [...(data.approvals[buyerId] ?? [])]
  const index = current.indexOf(input.supplierId)
  const target = index + (input.direction === -1 ? -1 : 1)
  if (index < 0 || target < 0 || target >= current.length) return done(data, null)
  ;[current[index], current[target]] = [current[target], current[index]]
  return done(data, null, { approvals: { ...data.approvals, [buyerId]: current } })
}

function setRoster(data: DemoData, ctx: CommandContext, input: { buyerId: string; proIds: string[]; status: RosterStatus | null }): Outcome<null> {
  const buyerId = str(input?.buyerId, "Buyer")
  if (!ownsBuyer(ctx.ws, buyerId)) forbid("Only the buyer can change its roster.")
  const ids = new Set(strList(input.proIds, "Pros", 500))
  const status = input.status === "favorite" || input.status === "ok_to_return" || input.status === "blocked" ? input.status : null
  const kept = data.roster.filter((r) => !(r.buyerId === buyerId && ids.has(r.proId)))
  if (!status) return done(data, null, { roster: kept })
  const today = todayISO()
  const added = [...ids].map((proId) => ({ id: `${buyerId}-${proId}`, buyerId, proId, status, addedOn: today }))
  return done(data, null, { roster: [...kept, ...added] })
}

/* -------------------------------- Timesheets ------------------------------ */

function approveTimesheets(data: DemoData, ctx: CommandContext, input: { ids: string[] }): Outcome<string[]> {
  const set = new Set(strList(input?.ids, "Timesheets"))
  const approved = data.timesheets.filter((t) => set.has(t.id) && t.status === "submitted")
  if (approved.some((t) => !ownsBuyer(ctx.ws, t.buyerId) || isCompass(ctx.ws))) forbid("Only the buyer approves hours.")
  if (!approved.length) return done(data, [])
  const stamp = { approvedAt: ctx.now, approvedBy: actorName(ctx) }
  const { invoices, invoiceOf, counter } = invoicesFor(data, approved, todayISO())
  const worked = new Map<string, number>()
  for (const t of approved) worked.set(t.proId, (worked.get(t.proId) ?? 0) + 1)
  const ids = new Set(approved.map((t) => t.id))
  const numbers = invoices.map((i) => i.number)
  return done(
    data,
    numbers,
    {
      timesheets: data.timesheets.map((t) => (ids.has(t.id) ? { ...t, status: "approved" as const, ...stamp, invoiceId: invoiceOf.get(t.id) } : t)),
      pros: data.pros.map((p) => (worked.has(p.id) ? { ...p, shiftsWorked: p.shiftsWorked + worked.get(p.id)! } : p)),
      invoices: [...invoices, ...data.invoices],
      counters: { inv: counter },
    },
    event(
      data,
      {
        text: `${actorName(ctx)} approved ${plural(approved.length, "timesheet")}. Iris generated ${numbers.join(", ")}`,
        actor: actorName(ctx),
        tone: "positive",
        buyerId: approved[0].buyerId,
      },
      ctx.now,
    ),
  )
}

const timesheetOf = (data: DemoData, id: unknown) => need(data.timesheets.find((t) => t.id === id), "That timesheet doesn't exist")

function adjustTimesheet(
  data: DemoData,
  ctx: CommandContext,
  input: { id: string; patch: { clockIn: string; clockOut: string; breakMins: number; reason: string } },
): Outcome<null> {
  const t = timesheetOf(data, input?.id)
  if (ctx.ws.kind !== "buyer" || ctx.ws.buyerId !== t.buyerId) forbid("Only the buyer can adjust these hours.")
  if (t.invoiceId || t.status === "approved") fail("Approved hours can't be changed.")
  const clockIn = time(input.patch?.clockIn, "Clock-in")
  const clockOut = time(input.patch?.clockOut, "Clock-out")
  const breakMins = num(input.patch.breakMins ?? 0, "Break", 0, 180)
  const reason = str(input.patch.reason, "A reason", 300)
  return done(data, null, {
    timesheets: data.timesheets.map((x) =>
      x.id === t.id
        ? {
            ...x,
            clockIn,
            clockOut,
            breakMins,
            hours: paidHours(clockIn, clockOut, breakMins),
            adjustment: { reason, previousHours: x.hours, at: ctx.now, by: actorName(ctx) },
            source: "manual" as const,
          }
        : x,
    ),
  })
}

function disputeTimesheet(data: DemoData, ctx: CommandContext, input: { id: string; reason: string; note?: string }): Outcome<null> {
  const t = timesheetOf(data, input?.id)
  if (ctx.ws.kind !== "buyer" || ctx.ws.buyerId !== t.buyerId) forbid("Only the buyer can dispute these hours.")
  if (t.status !== "submitted") fail("Only submitted hours can be disputed.")
  const reason = str(input.reason, "A reason", 120)
  return done(
    data,
    null,
    {
      timesheets: data.timesheets.map((x) =>
        x.id === t.id ? { ...x, status: "disputed" as const, dispute: { reason, note: optStr(input.note, 1000), raisedAt: ctx.now, raisedBy: actorName(ctx) } } : x,
      ),
    },
    event(
      data,
      {
        text: `${actorName(ctx)} disputed hours for a ${position(t.positionId).name} shift (${reason.toLowerCase()})`,
        actor: actorName(ctx),
        tone: "warning",
        buyerId: t.buyerId,
        supplierId: t.supplierId,
      },
      ctx.now,
    ),
  )
}

function respondDispute(data: DemoData, ctx: CommandContext, input: { id: string; action: "accept" | "confirm"; note?: string }): Outcome<null> {
  const t = timesheetOf(data, input?.id)
  if (!isSupplier(ctx.ws, t.supplierId)) forbid("Only the agency can answer this dispute.")
  if (t.status !== "disputed" || !t.dispute) fail("This timesheet isn't disputed.")
  const action = input.action === "accept" ? "accept" : "confirm"
  const note = optStr(input.note, 1000)
  return done(data, null, {
    timesheets: data.timesheets.map((x) => {
      if (x.id !== t.id || !x.dispute) return x
      const scheduled = paidHours(x.scheduledStart, x.scheduledEnd, x.breakMins)
      const fixed =
        action === "accept"
          ? {
              clockIn: x.scheduledStart,
              clockOut: x.scheduledEnd,
              hours: scheduled,
              adjustment: { reason: "Corrected to schedule after dispute", previousHours: x.hours, at: ctx.now, by: actorName(ctx) },
            }
          : {}
      return {
        ...x,
        ...fixed,
        status: "submitted" as const,
        submittedAt: ctx.now,
        dispute: { ...x.dispute, response: note || (action === "accept" ? "Corrected to the scheduled hours." : "Confirmed with the Pro: hours are correct."), respondedAt: ctx.now },
      }
    }),
  })
}

function submitTimesheets(data: DemoData, ctx: CommandContext, input: { ids: string[] }): Outcome<null> {
  const set = new Set(strList(input?.ids, "Timesheets"))
  const rows = data.timesheets.filter((t) => set.has(t.id) && t.status === "awaiting_submission")
  if (rows.some((t) => !isSupplier(ctx.ws, t.supplierId))) forbid("Only the agency submits its hours.")
  if (!rows.length) return done(data, null)
  const ids = new Set(rows.map((t) => t.id))
  return done(
    data,
    null,
    { timesheets: data.timesheets.map((t) => (ids.has(t.id) ? { ...t, status: "submitted" as const, submittedAt: ctx.now } : t)) },
    event(
      data,
      {
        text: `${ctx.ws.name} submitted ${plural(rows.length, "timesheet")} for approval`,
        actor: actorName(ctx),
        tone: "primary",
        supplierId: ctx.ws.supplierId,
        buyerId: rows[0].buyerId,
      },
      ctx.now,
    ),
  )
}

function setTips(data: DemoData, ctx: CommandContext, input: { entries: { timesheetId: string; tips: number }[] }): Outcome<null> {
  const entries = Array.isArray(input?.entries) ? input.entries.slice(0, 2000) : fail("Tips are required")
  const map = new Map(entries.map((e) => [e.timesheetId, round2(Math.max(0, Number(e.tips) || 0))]))
  for (const t of data.timesheets) if (map.has(t.id) && !ownsBuyer(ctx.ws, t.buyerId) && !isSupplier(ctx.ws, t.supplierId)) forbid()
  return done(data, null, { timesheets: data.timesheets.map((t) => (map.has(t.id) && !t.invoiceId ? { ...t, tips: map.get(t.id)! } : t)) })
}

/* --------------------------------- Invoices -------------------------------- */

const invoiceAccess = (data: DemoData, ctx: CommandContext, ids: string[]) => {
  const rows = data.invoices.filter((i) => ids.includes(i.id))
  if (rows.some((i) => !ownsBuyer(ctx.ws, i.buyerId))) forbid("Only the buyer or Compass can manage these invoices.")
  return rows
}

function createInvoiceGroup(data: DemoData, ctx: CommandContext, input: { name: string; invoiceIds: string[] }): Outcome<string> {
  const name = str(input?.name, "Name", 120)
  const invoiceIds = strList(input.invoiceIds, "Invoices", 500)
  const members = invoiceAccess(data, ctx, invoiceIds)
  if (!members.length) fail("Pick at least one invoice.")
  const code = `IG-2026-${String(data.counters.ig).padStart(3, "0")}`
  const id = code.toLowerCase()
  const buyers = new Set(members.map((m) => m.buyerId))
  const group: InvoiceGroup = {
    id,
    code,
    name,
    buyerId: buyers.size === 1 ? [...buyers][0] : undefined,
    createdOn: todayISO(),
    createdBy: actorName(ctx),
    invoiceIds: members.map((m) => m.id),
  }
  const memberIds = new Set(group.invoiceIds)
  const prior = new Set(members.map((m) => m.groupId).filter(Boolean) as string[])
  return done(
    data,
    id,
    {
      invoiceGroups: [
        group,
        ...data.invoiceGroups
          .map((g) => (prior.has(g.id) ? { ...g, invoiceIds: g.invoiceIds.filter((x) => !memberIds.has(x)) } : g))
          .filter((g) => g.invoiceIds.length > 0),
      ],
      invoices: data.invoices.map((i) => (memberIds.has(i.id) ? { ...i, groupId: id } : i)),
      counters: { ig: data.counters.ig + 1 },
    },
    event(data, { text: `${actorName(ctx)} grouped ${plural(memberIds.size, "invoice")} into ${code}`, actor: actorName(ctx), tone: "primary", buyerId: group.buyerId }, ctx.now),
  )
}

function removeFromGroup(data: DemoData, ctx: CommandContext, input: { invoiceId: string }): Outcome<null> {
  const [inv] = invoiceAccess(data, ctx, [str(input?.invoiceId, "Invoice")])
  if (!inv?.groupId) return done(data, null)
  return done(data, null, {
    invoices: data.invoices.map((i) => (i.id === inv.id ? { ...i, groupId: undefined } : i)),
    invoiceGroups: data.invoiceGroups.map((g) => (g.id === inv.groupId ? { ...g, invoiceIds: g.invoiceIds.filter((x) => x !== inv.id) } : g)).filter((g) => g.invoiceIds.length > 0),
  })
}

function deleteInvoiceGroup(data: DemoData, ctx: CommandContext, input: { groupId: string }): Outcome<null> {
  const group = need(data.invoiceGroups.find((g) => g.id === input?.groupId), "That invoice group doesn't exist")
  invoiceAccess(data, ctx, group.invoiceIds)
  return done(data, null, {
    invoiceGroups: data.invoiceGroups.filter((g) => g.id !== group.id),
    invoices: data.invoices.map((i) => (i.groupId === group.id ? { ...i, groupId: undefined } : i)),
  })
}

function payInvoices(data: DemoData, ctx: CommandContext, input: { ids: string[] }): Outcome<null> {
  const rows = invoiceAccess(data, ctx, strList(input?.ids, "Invoices", 500)).filter((i) => i.status !== "paid")
  if (!rows.length) return done(data, null)
  const ids = new Set(rows.map((i) => i.id))
  return done(
    data,
    null,
    { invoices: data.invoices.map((i) => (ids.has(i.id) ? { ...i, status: "in_process" as const } : i)) },
    event(data, { text: `${actorName(ctx)} scheduled payment for ${plural(rows.length, "invoice")}`, actor: actorName(ctx), tone: "positive", buyerId: ctx.ws.buyerId }, ctx.now),
  )
}

function reviewInvoice(data: DemoData, ctx: CommandContext, input: { id: string; status: "reviewed" | "sent_back"; note?: string }): Outcome<null> {
  const [inv] = invoiceAccess(data, ctx, [str(input?.id, "Invoice")])
  if (!inv) return fail("That invoice doesn't exist", 404)
  const status = input.status === "sent_back" ? "sent_back" : "reviewed"
  return done(
    data,
    null,
    { invoices: data.invoices.map((i) => (i.id === inv.id ? { ...i, review: { status, note: optStr(input.note, 1000), by: actorName(ctx), at: ctx.now } } : i)) },
    event(
      data,
      {
        text:
          status === "reviewed"
            ? `${actorName(ctx)} reviewed ${inv.number} and cleared it for payment`
            : `${actorName(ctx)} sent ${inv.number} back to ${supplier(inv.supplierId).shortName} for correction`,
        actor: actorName(ctx),
        tone: status === "reviewed" ? "positive" : "warning",
        buyerId: inv.buyerId,
        supplierId: inv.supplierId,
        invoiceId: inv.id,
      },
      ctx.now,
    ),
  )
}

/* ---------------------------------- Rates ---------------------------------- */

function upsertRateCard(data: DemoData, ctx: CommandContext, input: RateCardInput): Outcome<string> {
  const supplierId = str(input?.supplierId, "Agency")
  if (!isCompass(ctx.ws) && !isSupplier(ctx.ws, supplierId)) forbid("Only the agency or Compass can change these rates.")
  const proRate = num(input.proRate, "Pay rate", 1, 500)
  const markupPct = round2(num(input.markupPct, "Markup", 0, PROGRAM.maxMarkupPct))
  const billRate = round2(input.billRate ? num(input.billRate, "Bill rate", 1, 1000) : billFrom(proRate, markupPct))
  const existing =
    (input.id && data.rateCards.find((c) => c.id === input.id)) ||
    data.rateCards.find((c) => c.supplierId === supplierId && c.cityId === input.cityId && c.positionId === input.positionId)
  if (existing && existing.supplierId !== supplierId) forbid()
  const status: RateCard["status"] = input.status ?? "active"
  const card: RateCard = {
    id: existing?.id ?? `rate-${data.counters.rate}`,
    supplierId,
    cityId: str(input.cityId, "City"),
    positionId: need(findPosition(str(input.positionId, "Position")), "That position doesn't exist").id,
    proRate: round2(proRate),
    billRate,
    markupPct,
    zips: Array.isArray(input.zips) ? input.zips.filter((z) => typeof z === "string").slice(0, 200) : [],
    zipsAutoFilled: input.zipsAutoFilled === true,
    status,
    effectiveFrom: todayISO(),
    updatedAt: ctx.now,
    source: input.source === "upload" || input.source === "api" ? input.source : "manual",
    uploadId: optStr(input.uploadId),
  }
  return existing
    ? done(data, card.id, { rateCards: data.rateCards.map((c) => (c.id === existing.id ? card : c)) })
    : done(data, card.id, { rateCards: [card, ...data.rateCards], counters: { rate: data.counters.rate + 1 } })
}

function deleteRateCard(data: DemoData, ctx: CommandContext, input: { id: string }): Outcome<null> {
  const card = need(data.rateCards.find((c) => c.id === input?.id), "That rate doesn't exist")
  if (!isCompass(ctx.ws) && !isSupplier(ctx.ws, card.supplierId)) forbid("Only the agency or Compass can remove this rate.")
  return done(data, null, { rateCards: data.rateCards.filter((c) => c.id !== card.id) })
}

/* ------------------------------ Professionals ------------------------------ */

const REQUIREMENT_IDS: RequirementId[] = ["background", "i9", "orientation", "foodHandler", "alcohol"]

function completeRequirement(data: DemoData, ctx: CommandContext, input: { proId: string; requirement: RequirementId }): Outcome<null> {
  const pro = need(data.pros.find((p) => p.id === input?.proId), "That Pro doesn't exist")
  if (!isCompass(ctx.ws) && !isSupplier(ctx.ws, pro.supplierId)) forbid("Only the Pro's agency can update their documents.")
  const requirement = REQUIREMENT_IDS.includes(input.requirement) ? input.requirement : fail("Unknown requirement")
  const today = todayISO()
  const renews = requirement === "background" ? 365 : requirement === "foodHandler" || requirement === "alcohol" ? 365 * 3 : 0
  const expiresOn = renews ? addDaysISO(today, renews) : undefined
  return done(data, null, {
    pros: data.pros.map((p) => {
      if (p.id !== pro.id) return p
      const compliance = { ...p.compliance, [requirement]: { status: "complete" as const, completedOn: today, expiresOn } }
      const next = { ...p, compliance }
      const required = Object.keys(compliance) as RequirementId[]
      const allDone = required.every((r) => compliance[r]?.status === "complete")
      return allDone && p.status === "onboarding" ? { ...next, status: "active" as const, rating: 0 } : next
    }),
  })
}

function addReview(data: DemoData, ctx: CommandContext, input: { proId: string; buyerId: string; groupId?: string; rating: number; text: string }): Outcome<null> {
  const pro = need(data.pros.find((p) => p.id === input?.proId), "That Pro doesn't exist")
  const buyerId = str(input.buyerId, "Buyer")
  if (ctx.ws.kind !== "buyer" || ctx.ws.buyerId !== buyerId) forbid("Only the buyer can review its Pros.")
  const rating = Math.max(1, Math.min(5, Math.round(num(input.rating, "Rating", 1, 5))))
  const weight = Math.max(1, data.reviews.filter((r) => r.proId === pro.id).length)
  const average = pro.rating > 0 ? round2((pro.rating * weight + rating) / (weight + 1)) : rating
  return done(
    data,
    null,
    {
      reviews: [
        { id: `rev-${data.counters.rev}`, proId: pro.id, buyerId, groupId: optStr(input.groupId), rating, text: optStr(input.text, 2000) ?? "", by: actorName(ctx), at: ctx.now },
        ...data.reviews,
      ],
      pros: data.pros.map((p) => (p.id === pro.id ? { ...p, rating: Math.round(average * 10) / 10 } : p)),
      counters: { rev: data.counters.rev + 1 },
    },
    event(data, { text: `${actorName(ctx)} rated ${pro.firstName} ${pro.lastName} ${rating} of 5`, actor: actorName(ctx), tone: "neutral", buyerId, supplierId: pro.supplierId }, ctx.now),
  )
}

/* ---------------------------------- Uploads -------------------------------- */

export interface UploadApply {
  /** The reviewed file text to apply. The server re-plans it against current data. */
  csv: string
  rowNumbers?: number[]
}

type UploadRecord = Omit<Upload, "id" | "code" | "uploadedBy" | "actorKind" | "buyerId" | "supplierId" | "uploadedAt">

const UPLOAD_TYPES: Upload["type"][] = ["shifts", "timesheets", "tips", "rates", "professionals", "activity"]

function applyUpload(data: DemoData, ctx: CommandContext, upload: Upload, apply?: UploadApply): DemoData {
  if (!apply || upload.status === "failed" || upload.status === "needs_review") return data
  const plan = planImport(upload.type, str(apply.csv, "File", 5_000_000), data, ctx.ws, Array.isArray(apply.rowNumbers) ? apply.rowNumbers : undefined)
  if (plan.errorCount) fail("Some rows still have problems. Review them before saving.")
  return plan.apply ? merge(data, plan.apply(data, upload.id)) : data
}

function commitUpload(data: DemoData, ctx: CommandContext, input: { upload: UploadRecord; apply?: UploadApply }): Outcome<Upload> {
  const record = input?.upload ?? fail("Upload details are required")
  if (!UPLOAD_TYPES.includes(record.type)) fail("Unknown upload type")
  const code = `UPL-${data.counters.upl}`
  const upload: Upload = {
    ...record,
    id: code.toLowerCase(),
    code,
    uploadedBy: actorName(ctx),
    actorKind: ctx.ws.kind,
    buyerId: ctx.ws.buyerId,
    supplierId: ctx.ws.supplierId,
    uploadedAt: ctx.now,
  }
  let next = merge(data, { uploads: [upload, ...data.uploads], counters: { upl: data.counters.upl + 1 } })
  next = applyUpload(next, ctx, upload, input.apply)
  next = merge(
    next,
    event(
      next,
      {
        text: `${actorName(ctx)} uploaded ${upload.fileName}: ${upload.summary.toLowerCase()}`,
        actor: actorName(ctx),
        tone: upload.status === "failed" ? "critical" : upload.status === "completed" ? "positive" : "warning",
        buyerId: upload.buyerId,
        supplierId: upload.supplierId,
      },
      ctx.now,
    ),
  )
  return { data: next, result: upload }
}

function resolveUpload(data: DemoData, ctx: CommandContext, input: { id: string; patch: Partial<UploadRecord>; apply?: UploadApply }): Outcome<null> {
  const existing = need(data.uploads.find((u) => u.id === input?.id), "That upload doesn't exist")
  if (existing.actorKind !== ctx.ws.kind || (existing.buyerId ?? null) !== (ctx.ws.buyerId ?? null) || (existing.supplierId ?? null) !== (ctx.ws.supplierId ?? null)) {
    forbid("Only the workspace that uploaded this file can save it.")
  }
  const patch: Partial<UploadRecord> = { ...(input.patch ?? {}) }
  delete patch.type
  const upload: Upload = { ...existing, ...patch }
  let next = merge(data, { uploads: data.uploads.map((u) => (u.id === upload.id ? upload : u)) })
  next = applyUpload(next, ctx, upload, input.apply)
  next = merge(
    next,
    event(next, { text: `${actorName(ctx)} saved ${upload.fileName}: ${upload.summary.toLowerCase()}`, actor: actorName(ctx), tone: "positive", buyerId: upload.buyerId, supplierId: upload.supplierId }, ctx.now),
  )
  return { data: next, result: null }
}

/* ---------------------------------- Demo ----------------------------------- */

function resetDemo(): Outcome<null> {
  return { data: generateDemoData(), result: null, replaced: true }
}

/* -------------------------------- Registry --------------------------------- */

export const COMMANDS = {
  createJobPosting,
  cancelGroup,
  setHeadcount,
  assignPros,
  releasePro,
  markNoShow,
  setSupplierApproval,
  moveSupplierPriority,
  setRoster,
  approveTimesheets,
  adjustTimesheet,
  disputeTimesheet,
  respondDispute,
  submitTimesheets,
  setTips,
  createInvoiceGroup,
  removeFromGroup,
  deleteInvoiceGroup,
  payInvoices,
  reviewInvoice,
  upsertRateCard,
  deleteRateCard,
  completeRequirement,
  addReview,
  commitUpload,
  resolveUpload,
  resetDemo,
}

export type CommandName = keyof typeof COMMANDS
export type CommandInput<N extends CommandName> = Parameters<(typeof COMMANDS)[N]>[2]
export type CommandResult<N extends CommandName> = ReturnType<(typeof COMMANDS)[N]>["result"]

export const isCommandName = (value: unknown): value is CommandName => typeof value === "string" && Object.hasOwn(COMMANDS, value)

export function runCommand<N extends CommandName>(name: N, data: DemoData, ctx: CommandContext, input: CommandInput<N>): Outcome<CommandResult<N>> {
  const handler = COMMANDS[name] as unknown as (data: DemoData, ctx: CommandContext, input: unknown) => Outcome<CommandResult<N>>
  return handler(data, ctx, input)
}

export const KNOWN_SUPPLIER_IDS = SUPPLIERS.map((s) => s.id)
