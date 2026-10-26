import { planImport } from "@/lib/csv"
import { addDaysISO, hhmmFromMinutes, paidHours, spanMinutes, todayISO, wallClock } from "@/lib/dates"
import { budgetCheck, releasePlan } from "@/lib/domain/budget"
import { eligiblePros, event, joinNames, merge, notifiedSuppliers, type BookingInput, type Patch, type RateCardInput } from "@/lib/domain/core"
import { creditSentBack, invoiceApproved, issueOpen, withTips } from "@/lib/domain/invoicing"
import { releaseSummary } from "@/lib/domain/order"
import { billFrom, money, round2 } from "@/lib/format"
import { ANOMALY_THRESHOLD, awaitingApproval, billingFindings, canCredit, groupPhase, invoiceBenchmark, isOpenTo } from "@/lib/metrics"
import { PROGRAM, SUPPLIERS, approversFor, city, findLocation, findPosition, findSupplier, location, policyFor, position, supplier } from "@/lib/reference"
import { generateDemoData } from "@/lib/seed"
import { billedOf, canEditBilled, change, hoursFor, overtimeKey, timesheetChecks, withAgency, withOvertime } from "@/lib/timesheets"
import type { ApprovalRequest, DemoData, InvoiceGroup, RateCard, RequirementId, RosterStatus, ShiftGroup, Timesheet, Upload, Workspace } from "@/lib/types"

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
  /** Only these workspaces, when set. */
  workspaceIds?: string[]
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

/** Puts an order in front of agencies: the release plan from now, and the first tiers whose time has come. */
function released(g: ShiftGroup, ordered: string[], now: string): ShiftGroup {
  const plan = releasePlan(policyFor(g.buyerId), g, ordered, new Date(now))
  return { ...g, supplierReleases: plan, supplierIds: plan.filter((r) => r.releasedAt <= now).map((r) => r.supplierId), liveFill: { startedAt: now } }
}

function createJobPosting(data: DemoData, ctx: CommandContext, input: BookingInput): Outcome<string[]> {
  const loc = need(findLocation(str(input?.locationId, "Location")), "That location doesn't exist")
  if (ctx.ws.kind !== "buyer" || ctx.ws.buyerId !== loc.buyerId) forbid("Only this location's buyer can post shifts here.")
  const pos = need(findPosition(str(input.positionId, "Position")), "That position doesn't exist")
  const policy = policyFor(loc.buyerId)
  const dates = [...new Set(strList(input.dates, "Dates", 31))].sort()
  const today = todayISO()
  if (!dates.length || dates.some((d) => !DATE.test(d) || d < today)) fail("Pick one or more dates from today on.")
  const start = time(input.start, "Start time")
  const end = time(input.end, "End time")
  if (start === end) fail("Start and end can't be the same time.")
  const clockNow = hhmmFromMinutes(wallClock(new Date(ctx.now)).minutes)
  if (dates[0] === today && start <= clockNow) fail("That start time has already passed today. Pick a later time or another day.")
  const breakMins = num(input.breakMins ?? 0, "Break", 0, 120)
  const headcount = Math.round(num(input.headcount, "Headcount", 1, 60))
  if (headcount * dates.length > policy.maxSpotsPerOrder) fail(`${policy.sector} orders can create up to ${policy.maxSpotsPerOrder} spots at a time.`)
  const notified = notifiedSuppliers(data, loc.buyerId, loc.cityId, pos.id)
  if (!notified.length) fail(`None of your approved suppliers has an active ${pos.name} rate at ${loc.name}.`)
  const card = notified[0].card
  const ordered = notified.map((n) => n.card.supplierId)
  const estimate = round2(paidHours(start, end, breakMins) * card.billRate * headcount)
  const check = budgetCheck(data, loc.id, dates.map((date) => ({ date, estimate })), policy)
  const worst = check.worst
  const approvers = approversFor(loc.id)
  const approval: ApprovalRequest | undefined =
    check.needsApproval && worst && approvers.length
      ? {
          status: "pending",
          requestedAt: ctx.now,
          requestedBy: actorName(ctx),
          requestedByWorkspace: ctx.ws.id,
          weekStart: worst.weekStart,
          budget: worst.budget,
          committed: worst.committed,
          estimate: round2(estimate * dates.length),
          overPct: worst.overPct,
        }
      : undefined
  let sg = data.counters.sg
  const ids: string[] = []
  const groups: ShiftGroup[] = dates.map((date) => {
    const code = `SG-${sg++}`
    const id = code.toLowerCase()
    ids.push(id)
    const g: ShiftGroup = {
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
      supplierIds: [],
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
      approval,
    }
    return approval ? g : released(g, ordered, ctx.now)
  })
  const spots = headcount * groups.length
  const first = groups[0]
  const text = approval
    ? `${actorName(ctx)} asked for ${spots} ${pos.name} spots at ${loc.name}. It's ${(approval.overPct * 100).toFixed(1)}% over that week's budget, so it's waiting for ${joinNames(approvers.map((a) => a.user.name))}`
    : first.supplierIds.length
      ? `${actorName(ctx)} posted ${spots} ${pos.name} spots at ${loc.name}. ${supplier(card.supplierId).shortName} received them first`
      : `${actorName(ctx)} posted ${spots} ${pos.name} spots at ${loc.name}. ${policy.sector} releases them ${policy.releaseLeadHours} hours before the shift`
  return {
    ...done(data, ids, { groups: [...groups, ...data.groups], counters: { sg } }, event(data, { text, actor: actorName(ctx), tone: approval ? "warning" : "primary", buyerId: loc.buyerId, groupId: first.id }, ctx.now)),
    notices: approval
      ? [
          {
            text: `${actorName(ctx)} needs your approval: ${spots} ${pos.name} spots at ${loc.name}, ${(approval.overPct * 100).toFixed(1)}% over budget`,
            tone: "warning",
            workspaceIds: approvers.map((a) => a.id),
          },
        ]
      : [],
  }
}

function decideApproval(data: DemoData, ctx: CommandContext, input: { groupIds: string[]; decision: "approve" | "decline"; note?: string }): Outcome<number> {
  const ids = new Set(strList(input?.groupIds, "Orders", 100))
  const pending = data.groups.filter((g) => ids.has(g.id) && awaitingApproval(g))
  if (!pending.length) fail("These orders were already decided.")
  if (pending.some((g) => !ctx.ws.approves?.includes(g.locationId))) forbid("Only the district approver can decide these orders.")
  const approve = input.decision === "approve"
  const note = optStr(input.note, 1000)
  const decided = { decidedAt: ctx.now, decidedBy: actorName(ctx), note }
  const updated = new Map(
    pending.map((g) => {
      const approval = { ...g.approval!, ...decided, status: approve ? ("approved" as const) : ("declined" as const) }
      const ordered = notifiedSuppliers(data, g.buyerId, location(g.locationId).cityId, g.positionId).map((n) => n.card.supplierId)
      const next: ShiftGroup = approve ? released({ ...g, approval }, ordered.length ? ordered : [g.supplierId], ctx.now) : { ...g, approval, cancelledAt: ctx.now }
      return [g.id, next]
    }),
  )
  const first = pending[0]
  const spots = pending.reduce((s, g) => s + g.slots.length, 0)
  const what = `${spots} ${position(first.positionId).name} spots at ${location(first.locationId).name}`
  const release = approve ? (releaseSummary(updated.get(first.id)!) ?? "It's going to agencies now") : ""
  return {
    ...done(
      data,
      pending.length,
      { groups: data.groups.map((g) => updated.get(g.id) ?? g) },
      event(
        data,
        {
          text: approve ? `${actorName(ctx)} approved ${what}. ${release}` : `${actorName(ctx)} declined ${what}${note ? `: ${note}` : ""}`,
          actor: actorName(ctx),
          tone: approve ? "positive" : "critical",
          buyerId: first.buyerId,
          groupId: first.id,
        },
        ctx.now,
      ),
    ),
    notices: [
      {
        text: approve ? `${actorName(ctx)} approved your order: ${what}. ${release}.` : `${actorName(ctx)} declined your order: ${what}${note ? `. "${note}"` : ""}`,
        tone: approve ? "success" : "warning",
        workspaceIds: [...new Set(pending.map((g) => g.approval!.requestedByWorkspace))],
      },
    ],
  }
}

/** Sends the order to its next agency now, instead of waiting for the sector's release time. */
function releaseNextTier(data: DemoData, ctx: CommandContext, input: { groupId: string }): Outcome<string | null> {
  const g = groupOf(data, input?.groupId)
  if (!ownsBuyer(ctx.ws, g.buyerId)) forbid("Only the buyer can release this order early.")
  if (awaitingApproval(g)) fail("This order is waiting for approval.")
  if (g.cancelledAt || groupPhase(g) === "past") fail("This order is closed.")
  const plan = g.supplierReleases ?? []
  const index = plan.findIndex((r) => !g.supplierIds.includes(r.supplierId))
  if (index < 0) fail("Every agency already has this order.")
  const gap = policyFor(g.buyerId).tierGapHours * 3600_000
  const nowMs = new Date(ctx.now).getTime()
  const nextPlan = plan.map((r, i) => (i < index ? r : { ...r, releasedAt: new Date(nowMs + (i - index) * gap).toISOString() }))
  const supplierId = plan[index].supplierId
  const next: ShiftGroup = { ...g, supplierReleases: nextPlan, supplierIds: [...g.supplierIds, supplierId], liveFill: g.liveFill ?? { startedAt: ctx.now } }
  return {
    ...done(
      data,
      supplierId,
      { groups: data.groups.map((x) => (x.id === g.id ? next : x)) },
      event(data, { text: `${actorName(ctx)} released ${g.code} to ${supplier(supplierId).shortName} early`, actor: actorName(ctx), tone: "primary", buyerId: g.buyerId, supplierId, groupId: g.id }, ctx.now),
    ),
    notices: [{ text: `New shift released to you: ${g.code} at ${location(g.locationId).name}`, tone: "info", supplierId }],
  }
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
  const sheets = data.timesheets.filter((t) => t.groupId === g.id && t.slotId === input.slotId && (withAgency(t) || t.status === "pending_approval"))
  return done(data, null, {
    groups: data.groups.map((x) => (x.id === g.id ? { ...x, slots: x.slots.map((s) => (s.id === input.slotId ? { ...s, status: "no_show" as const } : s)) } : x)),
    timesheets: replaceSheets(data, sheets.map((t) => removed(t, ctx, "No-show"))),
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

const timesheetOf = (data: DemoData, id: unknown) => need(data.timesheets.find((t) => t.id === id), "That timesheet doesn't exist")

const sheetsOf = (data: DemoData, ids: unknown) => {
  const set = new Set(strList(ids, "Timesheets"))
  return data.timesheets.filter((t) => set.has(t.id))
}

const buysSheet = (ws: Workspace, t: Timesheet) => ws.kind === "buyer" && ws.buyerId === t.buyerId

/** Puts changed timesheets back in place and recomputes overtime for the weeks they touch. */
function replaceSheets(data: DemoData, changed: Timesheet[]): Timesheet[] {
  const byId = new Map(changed.map((t) => [t.id, t]))
  return withOvertime(
    data.timesheets.map((t) => byId.get(t.id) ?? t),
    new Set(changed.map(overtimeKey)),
  )
}

/** The checks on each timesheet, with the worker's other timesheets in view so a double billing shows. */
function checksFor(data: DemoData, rows: Timesheet[]) {
  const pros = new Set(rows.map((t) => t.proId))
  const theirs = new Map<string, Timesheet[]>()
  for (const t of data.timesheets) if (pros.has(t.proId)) theirs.set(t.proId, [...(theirs.get(t.proId) ?? []), t])
  return new Map(rows.map((t) => [t.id, timesheetChecks(t, theirs.get(t.proId))]))
}

const billedTimes = (input: { clockIn?: unknown; clockOut?: unknown; breakMins?: unknown }) => {
  const clockIn = time(input?.clockIn, "Clock-in")
  const clockOut = time(input.clockOut, "Clock-out")
  const breakMins = Math.round(num(input.breakMins ?? 0, "Break", 0, 180))
  if (clockIn === clockOut) fail("Clock-in and clock-out can't be the same time.")
  if (breakMins >= spanMinutes(clockIn, clockOut)) fail("The break can't be as long as the shift.")
  return { clockIn, clockOut, breakMins }
}

const agenciesOf = (rows: Timesheet[]) => joinNames([...new Set(rows.map((t) => supplier(t.supplierId).shortName))])

const perAgency = (rows: Timesheet[], text: (n: number) => string, tone: Notice["tone"]): Notice[] =>
  [...new Set(rows.map((t) => t.supplierId))].map((supplierId) => ({ text: text(rows.filter((t) => t.supplierId === supplierId).length), tone, supplierId }))

export interface ApproveResult {
  approved: number
  /** Flagged timesheets left waiting, because they need a decision. */
  flagged: number
  /** Invoices issued for hours whose week had closed. */
  invoices: string[]
  /** This week's open invoices the hours went on. */
  open: string[]
}

/** Approves the rows. This week's hours go on the agency's open invoice for the week; hours from a week that has closed are invoiced now. */
function approve(data: DemoData, ctx: CommandContext, rows: Timesheet[], reason?: string): Outcome<ApproveResult> {
  const today = todayISO()
  const by = actorName(ctx)
  const approved = rows.map((t) => ({
    ...t,
    status: "approved" as const,
    approvedAt: ctx.now,
    approvedBy: by,
    history: [...t.history, change(ctx.now, by, "approved", reason ? { reason } : undefined)],
  }))
  const ids = new Set(approved.map((t) => t.id))
  const sheets = replaceSheets(data, approved)
  const placed = invoiceApproved({ ...data, timesheets: sheets }, ids, today, ctx.now)
  const worked = new Map<string, number>()
  for (const t of approved) worked.set(t.proId, (worked.get(t.proId) ?? 0) + 1)
  const numbers = placed?.issued.map((i) => i.number) ?? []
  const open = placed?.open.map((i) => i.number) ?? []
  const what = plural(approved.length, "timesheet")
  return {
    ...done(
      data,
      { approved: approved.length, flagged: 0, invoices: numbers, open },
      placed?.patch ?? { timesheets: sheets },
      { pros: data.pros.map((p) => (worked.has(p.id) ? { ...p, shiftsWorked: p.shiftsWorked + worked.get(p.id)! } : p)) },
      event(
        data,
        {
          text: `${by} approved ${what} from ${agenciesOf(approved)}. ${numbers.length ? `Iris invoiced them on ${numbers.join(", ")}` : `They're on ${joinNames(open)}, this week's ${open.length === 1 ? "invoice" : "invoices"}`}`,
          actor: by,
          tone: "positive",
          buyerId: approved[0].buyerId,
        },
        ctx.now,
      ),
    ),
    notices: perAgency(approved, (n) => `${by} approved ${plural(n, "timesheet")}${numbers.length ? ` and Iris invoiced them` : ""}.`, "success"),
  }
}

/** Approves pending timesheets. Clean ones approve in bulk; a flagged one needs a reason to approve as billed. */
function approveTimesheets(data: DemoData, ctx: CommandContext, input: { ids: string[]; reason?: string }): Outcome<ApproveResult> {
  if (ctx.ws.kind !== "buyer") forbid("Only the buyer approves hours.")
  const rows = sheetsOf(data, input?.ids)
  if (rows.some((t) => !buysSheet(ctx.ws, t))) forbid("Only the buyer approves hours.")
  const pending = rows.filter((t) => t.status === "pending_approval")
  const reason = optStr(input.reason, 300)
  const checks = checksFor(data, pending)
  const flagged = pending.filter((t) => checks.get(t.id)!.length > 0)
  const ready = reason ? pending : pending.filter((t) => !checks.get(t.id)!.length)
  if (!ready.length) return done(data, { approved: 0, flagged: flagged.length, invoices: [], open: [] })
  const out = approve(data, ctx, ready, reason)
  return { ...out, result: { ...out.result, flagged: reason ? 0 : flagged.length } }
}

/** Corrects a pending timesheet's billed times, Iris's proposal or the buyer's own, then approves it. */
function correctTimesheet(
  data: DemoData,
  ctx: CommandContext,
  input: { id: string; clockIn: string; clockOut: string; breakMins: number; reason: string },
): Outcome<ApproveResult> {
  const t = timesheetOf(data, input?.id)
  if (!buysSheet(ctx.ws, t)) forbid("Only the buyer can correct these hours.")
  if (t.status !== "pending_approval") fail("Only timesheets waiting for approval can be corrected.")
  const times = billedTimes(input)
  const reason = str(input.reason, "A reason", 300)
  const hours = hoursFor(times.clockIn, times.clockOut, times.breakMins, t.sentHome)
  const corrected: Timesheet = {
    ...t,
    ...times,
    hours,
    history: [...t.history, change(ctx.now, actorName(ctx), "corrected", { from: billedOf(t), to: { ...times, hours }, reason })],
  }
  return approve(data, ctx, [corrected])
}

/** Sends pending timesheets back to the agency with a reason. */
function rejectTimesheets(data: DemoData, ctx: CommandContext, input: { ids: string[]; reason: string; note?: string }): Outcome<number> {
  if (ctx.ws.kind !== "buyer") forbid("Only the buyer can reject hours.")
  const rows = sheetsOf(data, input?.ids)
  if (rows.some((t) => !buysSheet(ctx.ws, t))) forbid("Only the buyer can reject hours.")
  const pending = rows.filter((t) => t.status === "pending_approval")
  if (!pending.length) fail("These timesheets aren't waiting for approval.")
  const reason = str(input.reason, "A reason", 120)
  const note = optStr(input.note, 1000)
  const by = actorName(ctx)
  const rejected = pending.map((t) => ({
    ...t,
    status: "rejected" as const,
    rejection: { reason, note, at: ctx.now, by },
    history: [...t.history, change(ctx.now, by, "rejected", { reason, note })],
  }))
  return {
    ...done(
      data,
      rejected.length,
      { timesheets: replaceSheets(data, rejected) },
      event(
        data,
        {
          text: `${by} rejected ${plural(rejected.length, "timesheet")} back to ${agenciesOf(rejected)} (${reason.toLowerCase()})`,
          actor: by,
          tone: "warning",
          buyerId: rejected[0].buyerId,
          supplierId: rejected[0].supplierId,
        },
        ctx.now,
      ),
    ),
    notices: perAgency(rejected, (n) => `${by} rejected ${plural(n, "timesheet")}: ${reason}. Fix and resubmit.`, "warning"),
  }
}

/**
 * Submits drafts and rejected timesheets for approval. The agency submits its own; a buyer can submit a draft for an
 * agency that hasn't, as Fieldglass lets a buyer complete a draft for a worker.
 */
function submitTimesheets(data: DemoData, ctx: CommandContext, input: { ids: string[] }): Outcome<number> {
  const rows = sheetsOf(data, input?.ids).filter(withAgency)
  if (rows.some((t) => !isSupplier(ctx.ws, t.supplierId) && !buysSheet(ctx.ws, t))) forbid("Only the agency submits its hours.")
  if (!rows.length) return done(data, 0)
  const ready = rows.filter((t) => t.clockIn && t.clockOut)
  if (!ready.length) fail("Add the missing clock-in or clock-out first.")
  const by = actorName(ctx)
  const submitted = ready.map((t) => ({
    ...t,
    status: "pending_approval" as const,
    submittedAt: ctx.now,
    history: [
      ...t.history,
      change(ctx.now, by, "submitted", t.status === "rejected" ? { note: "Resubmitted after the rejection" } : ctx.ws.kind === "buyer" ? { note: "Submitted by the buyer for the agency" } : undefined),
    ],
  }))
  return {
    ...done(
      data,
      submitted.length,
      { timesheets: replaceSheets(data, submitted) },
      event(
        data,
        {
          text: `${ctx.ws.kind === "supplier" ? ctx.ws.name : by} submitted ${plural(submitted.length, "timesheet")} for approval`,
          actor: by,
          tone: "primary",
          supplierId: submitted[0].supplierId,
          buyerId: submitted[0].buyerId,
        },
        ctx.now,
      ),
    ),
    notices: [...new Set(submitted.map((t) => t.buyerId))].map((buyerId) => ({
      text: `${agenciesOf(submitted.filter((t) => t.buyerId === buyerId))} submitted ${plural(submitted.filter((t) => t.buyerId === buyerId).length, "timesheet")} for approval.`,
      tone: "info" as const,
      buyerId,
    })),
  }
}

/** Pulls pending timesheets back to Draft so the agency can change them. */
function withdrawTimesheets(data: DemoData, ctx: CommandContext, input: { ids: string[] }): Outcome<number> {
  const rows = sheetsOf(data, input?.ids).filter((t) => t.status === "pending_approval")
  if (rows.some((t) => !isSupplier(ctx.ws, t.supplierId))) forbid("Only the agency can withdraw its hours.")
  if (!rows.length) return done(data, 0)
  const by = actorName(ctx)
  const withdrawn = rows.map((t) => ({ ...t, status: "draft" as const, submittedAt: undefined, history: [...t.history, change(ctx.now, by, "withdrawn")] }))
  return done(data, withdrawn.length, { timesheets: replaceSheets(data, withdrawn) })
}

/** The agency changes the times it bills on a draft or a rejected timesheet. */
function editTimesheet(
  data: DemoData,
  ctx: CommandContext,
  input: { id: string; clockIn: string; clockOut: string; breakMins: number; note?: string },
): Outcome<null> {
  const t = timesheetOf(data, input?.id)
  if (!isSupplier(ctx.ws, t.supplierId)) forbid("Only the agency edits the hours it bills.")
  if (!canEditBilled(t)) fail("Withdraw it first. Only drafts and rejected timesheets can be edited.")
  const times = billedTimes(input)
  const hours = hoursFor(times.clockIn, times.clockOut, times.breakMins, t.sentHome)
  const edited: Timesheet = {
    ...t,
    ...times,
    hours,
    history: [...t.history, change(ctx.now, actorName(ctx), "edited", { from: billedOf(t), to: { ...times, hours }, note: optStr(input.note, 500) })],
  }
  return done(data, null, { timesheets: replaceSheets(data, [edited]) })
}

/** Takes a timesheet out of billing: a shift the worker didn't work, or a duplicate. The record stays, at zero hours. */
function removeTimesheet(data: DemoData, ctx: CommandContext, input: { id: string; reason: string }): Outcome<null> {
  const t = timesheetOf(data, input?.id)
  const reason = str(input?.reason, "A reason", 200)
  if (isSupplier(ctx.ws, t.supplierId)) {
    if (!canEditBilled(t)) fail("Only drafts and rejected timesheets can be removed.")
  } else if (buysSheet(ctx.ws, t)) {
    if (t.status !== "draft" && t.status !== "rejected" && t.status !== "pending_approval") fail("Approved hours can't be removed.")
  } else forbid()
  return done(data, null, { timesheets: replaceSheets(data, [removed(t, ctx, reason)]) })
}

const removed = (t: Timesheet, ctx: CommandContext, reason: string): Timesheet => ({
  ...t,
  status: "removed",
  hours: 0,
  otHours: 0,
  history: [...t.history, change(ctx.now, actorName(ctx), "removed", { reason })],
})

function setTips(data: DemoData, ctx: CommandContext, input: { entries: { timesheetId: string; tips: number }[] }): Outcome<null> {
  const entries = Array.isArray(input?.entries) ? input.entries.slice(0, 2000) : fail("Tips are required")
  const map = new Map(entries.map((e) => [e.timesheetId, round2(Math.max(0, Number(e.tips) || 0))]))
  for (const t of data.timesheets) if (map.has(t.id) && !ownsBuyer(ctx.ws, t.buyerId) && !isSupplier(ctx.ws, t.supplierId)) forbid()
  return done(data, null, withTips(data, map))
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
  const rows = invoiceAccess(data, ctx, strList(input?.ids, "Invoices", 500)).filter((i) => i.status !== "paid" && i.status !== "open")
  if (!rows.length) return done(data, null)
  const ids = new Set(rows.map((i) => i.id))
  return done(
    data,
    null,
    { invoices: data.invoices.map((i) => (ids.has(i.id) ? { ...i, status: "in_process" as const } : i)) },
    event(data, { text: `${actorName(ctx)} scheduled payment for ${plural(rows.length, "invoice")}`, actor: actorName(ctx), tone: "positive", buyerId: ctx.ws.buyerId }, ctx.now),
  )
}

/** Compass clears an invoice priced above the market for payment. */
function reviewInvoice(data: DemoData, ctx: CommandContext, input: { id: string; note?: string }): Outcome<null> {
  const [inv] = invoiceAccess(data, ctx, [str(input?.id, "Invoice")])
  if (!inv) return fail("That invoice doesn't exist", 404)
  return done(
    data,
    null,
    { invoices: data.invoices.map((i) => (i.id === inv.id ? { ...i, review: { status: "reviewed" as const, note: optStr(input.note, 1000), by: actorName(ctx), at: ctx.now } } : i)) },
    event(
      data,
      { text: `${actorName(ctx)} reviewed ${inv.number} and cleared it for payment`, actor: actorName(ctx), tone: "positive", buyerId: inv.buyerId, supplierId: inv.supplierId, invoiceId: inv.id },
      ctx.now,
    ),
  )
}

/**
 * Compass asks the agency to review the rates on this invoice that run above the market, and clears the invoice for
 * payment: it's billed at the rates the buyer agreed to, so the lever is the rate, not this invoice.
 */
function requestRateReview(data: DemoData, ctx: CommandContext, input: { id: string; note?: string }): Outcome<number> {
  if (!isCompass(ctx.ws)) forbid("Only Compass asks agencies to review their rates.")
  const inv = need(data.invoices.find((i) => i.id === input?.id), "That invoice doesn't exist")
  const benchmark = invoiceBenchmark(data, inv.id)
  if (!benchmark.anomalous) fail("This invoice isn't priced above the market.")
  const market = new Map<string, number>()
  for (const line of inv.lines) {
    const delta = benchmark.lineDelta.get(line.id) ?? 0
    if (delta < ANOMALY_THRESHOLD) continue
    const cityId = location(line.locationId).cityId
    const card = data.rateCards.find((c) => c.supplierId === inv.supplierId && c.cityId === cityId && c.positionId === line.positionId && c.status === "active")
    if (card && !market.has(card.id)) market.set(card.id, round2(line.billRate / (1 + delta)))
  }
  if (!market.size) fail("None of the rates on this invoice is active anymore.")
  const by = actorName(ctx)
  const note = optStr(input.note, 1000)
  const sup = supplier(inv.supplierId).shortName
  const rates = plural(market.size, "rate")
  return {
    ...done(
      data,
      market.size,
      {
        rateCards: data.rateCards.map((c) =>
          market.has(c.id) ? { ...c, rateReview: { status: "requested" as const, requestedAt: ctx.now, requestedBy: by, marketRate: market.get(c.id)!, fromRate: c.billRate, invoiceId: inv.id, note } } : c,
        ),
        invoices: data.invoices.map((i) => (i.id === inv.id ? { ...i, review: { status: "rate_review" as const, by, at: ctx.now, note } } : i)),
      },
      event(
        data,
        { text: `${by} asked ${sup} to review ${rates} that run above the market and cleared ${inv.number} for payment`, actor: by, tone: "primary", buyerId: inv.buyerId, supplierId: inv.supplierId, invoiceId: inv.id },
        ctx.now,
      ),
    ),
    notices: [{ text: `Compass asked you to review ${rates} that run above what other agencies charge`, tone: "warning", supplierId: inv.supplierId }],
  }
}

/** The agency answers a rate review: lower the bill rate to the market, or keep it with a note. New shifts price at the answer. */
function answerRateReview(data: DemoData, ctx: CommandContext, input: { id: string; decision: "lower" | "keep"; note?: string }): Outcome<null> {
  const card = need(data.rateCards.find((c) => c.id === input?.id), "That rate doesn't exist")
  if (!isSupplier(ctx.ws, card.supplierId)) forbid("Only the agency answers a rate review.")
  const review = card.rateReview
  if (review?.status !== "requested") return fail("Compass hasn't asked for a review of this rate.")
  const lower = input.decision === "lower"
  const note = optStr(input.note, 1000)
  if (!lower && !note) fail("Say why the rate should stay.")
  const billRate = lower ? round2(Math.max(review.marketRate, card.proRate)) : card.billRate
  const by = actorName(ctx)
  const where = `${position(card.positionId).name} rate in ${city(card.cityId).name}`
  return {
    ...done(
      data,
      null,
      {
        rateCards: data.rateCards.map((c) =>
          c.id === card.id
            ? {
                ...c,
                billRate,
                markupPct: lower ? round2(Math.max(0, (billRate / c.proRate - 1) * 100)) : c.markupPct,
                effectiveFrom: lower ? todayISO() : c.effectiveFrom,
                updatedAt: lower ? ctx.now : c.updatedAt,
                rateReview: { ...review, status: lower ? ("lowered" as const) : ("kept" as const), answeredAt: ctx.now, answeredBy: by, answer: note },
              }
            : c,
        ),
      },
      event(
        data,
        {
          text: lower
            ? `${supplier(card.supplierId).shortName} lowered its ${where} from ${money(card.billRate)} to ${money(billRate)}/hr`
            : `${supplier(card.supplierId).shortName} kept its ${where} at ${money(card.billRate)}/hr: “${note}”`,
          actor: by,
          tone: lower ? "positive" : "neutral",
          supplierId: card.supplierId,
        },
        ctx.now,
      ),
    ),
    notices: [{ text: lower ? `${supplier(card.supplierId).shortName} lowered its ${where} to ${money(billRate)}/hr` : `${supplier(card.supplierId).shortName} kept its ${where}`, tone: lower ? "success" : "info", workspaceIds: ["ws-compass"] }],
  }
}

/** Compass sends lines billed above Iris's records back to the agency for a credit, or accepts them as billed. */
function decideBilling(data: DemoData, ctx: CommandContext, input: { id: string; decision: "send_back" | "accept"; note?: string }): Outcome<null> {
  if (!isCompass(ctx.ws)) forbid("Only Compass reviews invoices for billing errors.")
  const inv = need(data.invoices.find((i) => i.id === input?.id), "That invoice doesn't exist")
  if (!canCredit(inv)) fail("This invoice is already paid or being paid.")
  if (inv.billingReview) fail("These hours were already decided.")
  const findings = billingFindings(data, inv.id)
  if (!findings.length) fail("Iris found nothing billed above its records on this invoice.")
  const send = input.decision === "send_back"
  const amount = round2(findings.reduce((s, f) => s + f.amount, 0))
  const by = actorName(ctx)
  const sup = supplier(inv.supplierId).shortName
  const lines = plural(findings.length, "line")
  const billingReview = { status: send ? ("sent_back" as const) : ("accepted" as const), lineIds: findings.map((f) => f.lineId), amount, at: ctx.now, by, note: optStr(input.note, 1000) }
  return {
    ...done(
      data,
      null,
      { invoices: data.invoices.map((i) => (i.id === inv.id ? { ...i, billingReview } : i)) },
      event(
        data,
        {
          text: send ? `${by} sent ${inv.number} back to ${sup}: ${lines} billed ${money(amount)} above Iris's clock` : `${by} accepted the ${lines} on ${inv.number} as billed`,
          actor: by,
          tone: send ? "warning" : "neutral",
          buyerId: inv.buyerId,
          supplierId: inv.supplierId,
          invoiceId: inv.id,
        },
        ctx.now,
      ),
    ),
    notices: send ? [{ text: `Compass sent ${inv.number} back: ${lines} billed above Iris's clock, ${money(amount)} to credit`, tone: "warning", supplierId: inv.supplierId }] : [],
  }
}

/** The agency credits what Compass sent back. Simulated agencies do this on their own. */
function creditInvoice(data: DemoData, ctx: CommandContext, input: { id: string }): Outcome<number> {
  const inv = need(data.invoices.find((i) => i.id === input?.id), "That invoice doesn't exist")
  if (!isSupplier(ctx.ws, inv.supplierId)) forbid("Only the agency credits its invoice.")
  return credited(data, inv.id, actorName(ctx), ctx.now) ?? fail("Nothing on this invoice is waiting for a credit.")
}

/** The credit, its activity line and its notices, for the agency's command and the scheduler alike. */
export function credited(data: DemoData, invoiceId: string, by: string, now: string): Outcome<number> | undefined {
  const out = creditSentBack(data, invoiceId, by, now)
  if (!out) return undefined
  const inv = out.invoice
  const sup = supplier(inv.supplierId).shortName
  const text = `${sup} credited ${money(out.amount)} on ${inv.number} for hours billed above Iris's clock`
  return {
    ...done(data, out.amount, out.patch, event(data, { text, actor: by, tone: "positive", buyerId: inv.buyerId, supplierId: inv.supplierId, invoiceId: inv.id }, now)),
    notices: [{ text, tone: "success", buyerId: inv.buyerId }],
  }
}

/** The presenter closes the week early: Iris issues every open invoice now instead of on Saturday. */
function closeWeekNow(data: DemoData, ctx: CommandContext): Outcome<string[]> {
  const out = issueOpen(data, todayISO(), ctx.now, true)
  if (!out) return fail("There are no open invoices to issue.")
  const numbers = out.issued.map((i) => i.number)
  return {
    ...done(
      data,
      numbers,
      out.patch,
      event(data, { text: `${actorName(ctx)} closed the week early, so Iris issued ${joinNames(numbers)}`, actor: actorName(ctx), tone: "positive" }, ctx.now),
    ),
    notices: out.issued.map((i) => ({ text: `${i.number}: this week's approved hours, invoiced`, tone: "success" as const, supplierId: i.supplierId })),
  }
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

function resetDemo(data: DemoData): Outcome<null> {
  return { data: { ...generateDemoData(), settings: data.settings }, result: null, replaced: true }
}

/** Presenter switch: whether Iris staffs an agency's shifts when nobody is signed in as that agency. */
function setAgencyAutoFill(data: DemoData, ctx: CommandContext, input: { supplierId: string; enabled: boolean }): Outcome<null> {
  const s = need(findSupplier(str(input?.supplierId, "Agency")), "That agency doesn't exist")
  const paused = new Set(data.settings?.pausedAgencies ?? [])
  if (input.enabled) paused.delete(s.id)
  else paused.add(s.id)
  return done(
    data,
    null,
    { settings: { ...data.settings, pausedAgencies: [...paused] } },
    event(data, { text: `${actorName(ctx)} ${input.enabled ? "resumed" : "paused"} automatic staffing for ${s.shortName}`, actor: actorName(ctx), tone: "neutral", supplierId: s.id }, ctx.now),
  )
}

/* -------------------------------- Registry --------------------------------- */

export const COMMANDS = {
  createJobPosting,
  decideApproval,
  releaseNextTier,
  cancelGroup,
  setHeadcount,
  assignPros,
  releasePro,
  markNoShow,
  setSupplierApproval,
  moveSupplierPriority,
  setRoster,
  approveTimesheets,
  correctTimesheet,
  rejectTimesheets,
  submitTimesheets,
  withdrawTimesheets,
  editTimesheet,
  removeTimesheet,
  setTips,
  createInvoiceGroup,
  removeFromGroup,
  deleteInvoiceGroup,
  payInvoices,
  reviewInvoice,
  requestRateReview,
  answerRateReview,
  decideBilling,
  creditInvoice,
  closeWeekNow,
  upsertRateCard,
  deleteRateCard,
  completeRequirement,
  addReview,
  commitUpload,
  resolveUpload,
  resetDemo,
  setAgencyAutoFill,
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
