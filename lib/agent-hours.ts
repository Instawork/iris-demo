import { locationIn, roleIn } from "@/lib/agent-shift"
import { addDaysISO, formatDateShort, formatDay, toISODate, weekEndISO, weekStartISO } from "@/lib/dates"
import { joinNames } from "@/lib/domain/core"
import type { ApproveResult } from "@/lib/domain/commands"
import { fullName, hours, money, plural, round2 } from "@/lib/format"
import { POSITIONS, SUPPLIERS, location, locationsFor, position, supplier } from "@/lib/reference"
import { timesheetAmount, timesheetChecks, weekClosed, type Proposal, type TimesheetCheck } from "@/lib/timesheets"
import type { DemoData, Pro, Timesheet } from "@/lib/types"

/**
 * Approving hours in a sentence: "approve last night's hours at West Loop", "approve Harbor's timesheets for this
 * week", "approve Nico Price". The chat approves what matches the clock in one click and lays out each flagged
 * timesheet with the fix Iris proposes. It never approves a flagged timesheet as billed; that takes a reason, on the
 * timesheet itself.
 */

export interface HoursScope {
  from?: string
  to?: string
  /** The days as the reply names them: "yesterday", "Sunday, Oct 25", "last week". */
  days?: string
  /** The same days before an event name: "yesterday's", "Sunday's". */
  daysOf?: string
  locationId?: string
  supplierId?: string
  positionId?: string
  proIds?: string[]
  /** A word from the event's name, like "concert". */
  event?: string
}

export type HoursAction =
  | { label: string; kind: "approve-timesheets"; ids: string[]; scope: HoursScope }
  | {
      label: string
      kind: "accept-proposal"
      id: string
      times: { clockIn: string; clockOut: string; breakMins: number }
      hours: number
      reason: string
      scope: HoursScope
    }
  | { label: string; kind: "link"; href: string }

/** One timesheet in a reply's card: who, and what Iris found. */
export interface BatchRow {
  id: string
  name: string
  meta: string
  issue: string
  detail: string
  /** What Iris's fix takes off the bill, or adds. */
  saves?: string
}

/** A batch of timesheets as the chat lays it out: the ones ready to go in one click, then each one held back. */
export interface TimesheetBatch {
  ready?: { label: string; count: number; hours: string; amount: string; note?: string }
  held: BatchRow[]
  heldCount: number
  heldLabel: string
  more?: string
}

export interface FlaggedSheet {
  t: Timesheet
  /** The check whose fix Iris offers, or the first one when none has a fix. */
  check: TimesheetCheck
  others: TimesheetCheck[]
  proposal?: Proposal
}

const VERB = /\b(approve|confirm|sign off)\b/
const NOUN = /\b(hours?|timesheets?|time ?sheets?|time ?cards?|clean)\b/
const LISTED = 3
const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"]
const WEEKDAYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"]

const wordIn = (word: string, lower: string) => new RegExp(`\\b${word}\\b`).test(lower)

const weekdayOf = (iso: string) => new Date(`${iso}T12:00:00`).getDay()

function isoOf(year: number, month: number, day: number) {
  const d = new Date(year, month, day)
  return d.getMonth() === month && d.getDate() === day ? toISODate(d) : undefined
}

/** The days a sentence asks about, always looking back from today. */
function daysIn(lower: string, today: string): Pick<HoursScope, "from" | "to" | "days" | "daysOf"> {
  const one = (date: string, days: string, daysOf: string) => ({ from: date, to: date, days, daysOf })
  if (/\b(yesterday|last night)\b/.test(lower)) return one(addDaysISO(today, -1), "yesterday", "yesterday's")
  if (/\b(today|tonight|this morning|this afternoon)\b/.test(lower)) return one(today, "today", "today's")
  if (/\blast week\b/.test(lower)) {
    const start = addDaysISO(weekStartISO(today), -7)
    return { from: start, to: addDaysISO(start, 6), days: "last week", daysOf: "last week's" }
  }
  if (/\bthis week\b/.test(lower)) return { from: weekStartISO(today), to: today, days: "this week", daysOf: "this week's" }
  if (/\bweekend\b/.test(lower)) {
    const saturday = addDaysISO(today, -((weekdayOf(today) + 1) % 7))
    const sunday = addDaysISO(saturday, 1)
    return { from: saturday, to: sunday <= today ? sunday : saturday, days: "the weekend", daysOf: "the weekend's" }
  }
  const named = lower.match(/\b(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sept?(?:ember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\.?\s+(\d{1,2})(?:st|nd|rd|th)?\b/)
  const numeric = lower.match(/\b(\d{1,2})\/(\d{1,2})\b/)
  if (named || numeric) {
    const month = named ? MONTHS.indexOf(named[1].slice(0, 3)) : Number(numeric![1]) - 1
    const day = Number(named ? named[2] : numeric![2])
    const year = Number(today.slice(0, 4))
    const thisYear = isoOf(year, month, day)
    const date = thisYear && thisYear > today ? isoOf(year - 1, month, day) : thisYear
    if (date) return one(date, formatDateShort(date), `the ${formatDateShort(date)}`)
  }
  const weekday = lower.match(/\b(last\s+)?(sunday|monday|tuesday|wednesday|thursday|friday|saturday)\b/)
  if (weekday) {
    let back = (weekdayOf(today) - WEEKDAYS.indexOf(weekday[2]) + 7) % 7
    if (!back && weekday[1]) back = 7
    const date = addDaysISO(today, -back)
    return one(date, formatDay(date, "EEEE, MMM d"), `${formatDay(date, "EEEE")}'s`)
  }
  return {}
}

/** Workers named in full, or by a first name only one of the buyer's workers has, preferring those with hours waiting. */
function workersIn(lower: string, data: DemoData, mine: Timesheet[]) {
  const waiting = new Set(mine.filter((t) => t.status === "pending_approval").map((t) => t.proId))
  const ids = new Set(mine.map((t) => t.proId))
  const pros = data.pros.filter((p) => ids.has(p.id))
  const found = new Set<string>()
  let rest = lower
  for (const p of pros) {
    const full = new RegExp(`\\b${fullName(p).toLowerCase()}\\b`)
    if (!full.test(rest)) continue
    found.add(p.id)
    rest = rest.replace(full, " ")
  }
  const byFirst = new Map<string, Pro[]>()
  for (const p of pros) byFirst.set(p.firstName.toLowerCase(), [...(byFirst.get(p.firstName.toLowerCase()) ?? []), p])
  const ambiguous: string[] = []
  for (const [first, list] of byFirst) {
    if (!wordIn(first, rest)) continue
    const withHours = list.filter((p) => waiting.has(p.id))
    const pick = withHours.length ? withHours : list
    if (pick.length === 1) found.add(pick[0].id)
    else ambiguous.push(...pick.map(fullName))
  }
  return { ids: [...found], ambiguous }
}

const supplierIn = (lower: string) => SUPPLIERS.find((s) => [s.name, s.shortName].some((n) => wordIn(n.toLowerCase(), lower)))?.id

/** A word from one of the buyer's event names, skipping words that also name a venue, an agency or a role. */
function eventIn(lower: string, data: DemoData, mine: Timesheet[], buyerId: string) {
  const groupIds = new Set(mine.map((t) => t.groupId))
  const names = new Set(data.groups.filter((g) => groupIds.has(g.id) && g.eventName).map((g) => g.eventName!.toLowerCase()))
  const taken = new Set(
    [...locationsFor(buyerId).map((l) => l.name), ...SUPPLIERS.flatMap((s) => [s.name, s.shortName]), ...POSITIONS.map((p) => p.name)].flatMap((n) => n.toLowerCase().split(/\s+/)),
  )
  const words = new Set([...names].flatMap((n) => n.split(/[^a-z-]+/)).filter((w) => w.length >= 4 && w !== "night" && w !== "home" && !taken.has(w)))
  return [...words].find((w) => new RegExp(`\\b${w}s?\\b`).test(lower))
}

/**
 * A buyer's sentence asking to approve hours, read into the timesheets it covers. Undefined when the sentence is about
 * something else. A first name several workers share comes back as `ambiguous` instead of a guess.
 */
export function parseHoursApproval(text: string, data: DemoData, buyerId: string, today: string) {
  const lower = text.toLowerCase().replace(/’/g, "'")
  if (!VERB.test(lower)) return undefined
  const mine = data.timesheets.filter((t) => t.buyerId === buyerId && t.status !== "removed")
  const workers = workersIn(lower, data, mine)
  if (!NOUN.test(lower) && !workers.ids.length && !workers.ambiguous.length) return undefined
  const scope: HoursScope = {
    ...daysIn(lower, today),
    locationId: locationIn(lower, buyerId)?.id,
    supplierId: supplierIn(lower),
    positionId: roleIn(lower),
    proIds: workers.ids.length ? workers.ids : undefined,
    event: eventIn(lower, data, mine, buyerId),
  }
  return { scope, ambiguous: workers.ambiguous }
}

const hasFilters = (s: HoursScope) => !!(s.from || s.locationId || s.supplierId || s.positionId || s.proIds?.length || s.event)

const proOf = (data: DemoData, id: string) => data.pros.find((p) => p.id === id)

/** The event as the reply names it: "the concert night" for one, "concert nights" for several. */
function eventPhrase(scope: HoursScope, inScope: Timesheet[], data: DemoData) {
  if (!scope.event) return ""
  const groupIds = new Set(inScope.map((t) => t.groupId))
  const names = new Set(data.groups.filter((g) => groupIds.has(g.id) && g.eventName).map((g) => g.eventName!.toLowerCase()))
  const name = names.size === 1 ? [...names][0] : scope.event
  const one = new Set(inScope.map((t) => t.date)).size <= 1
  return `from ${scope.daysOf ? `${scope.daysOf} ` : one ? "the " : ""}${one ? name : `${name}s`}`
}

/** "Harbor bartender timesheets from yesterday's concert night at West Loop Arena". */
export function scopePhrase(scope: HoursScope, data: DemoData, n: number, inScope: Timesheet[] = []) {
  const names = (scope.proIds ?? []).flatMap((id) => {
    const p = proOf(data, id)
    return p ? [fullName(p)] : []
  })
  const when = scope.event ? eventPhrase(scope, inScope, data) : scope.days ? `from ${scope.days}` : ""
  return [
    scope.supplierId && supplier(scope.supplierId).shortName,
    scope.positionId && position(scope.positionId).name.toLowerCase(),
    n === 1 ? "timesheet" : "timesheets",
    names.length > 0 && `for ${joinNames(names)}`,
    when,
    scope.locationId && `at ${location(scope.locationId).name}`,
  ]
    .filter(Boolean)
    .join(" ")
}

/** What accepting Iris's proposal takes off the bill, at the timesheet's rate. Negative when it adds hours. */
export const savingOf = (f: FlaggedSheet) => (f.proposal ? round2((f.t.hours - f.proposal.hours) * f.t.billRate) : 0)

/** The buyer's timesheets in scope, and the pending ones split into clean and flagged with the same checks the server runs. */
export function planHoursApproval(data: DemoData, buyerId: string, scope: HoursScope) {
  const events = scope.event ? new Map(data.groups.map((g) => [g.id, g.eventName?.toLowerCase() ?? ""])) : undefined
  const inScope = data.timesheets.filter(
    (t) =>
      t.buyerId === buyerId &&
      t.status !== "removed" &&
      (!scope.from || t.date >= scope.from) &&
      (!scope.to || t.date <= scope.to) &&
      (!scope.locationId || t.locationId === scope.locationId) &&
      (!scope.supplierId || t.supplierId === scope.supplierId) &&
      (!scope.positionId || t.positionId === scope.positionId) &&
      (!scope.proIds?.length || scope.proIds.includes(t.proId)) &&
      (!events || new RegExp(`\\b${scope.event}`).test(events.get(t.groupId) ?? "")),
  )
  const pending = inScope.filter((t) => t.status === "pending_approval")
  const pros = new Set(pending.map((t) => t.proId))
  const theirs = new Map<string, Timesheet[]>()
  for (const t of data.timesheets) if (pros.has(t.proId)) theirs.set(t.proId, [...(theirs.get(t.proId) ?? []), t])
  const clean: Timesheet[] = []
  const flagged: FlaggedSheet[] = []
  for (const t of pending) {
    const checks = timesheetChecks(t, theirs.get(t.proId))
    if (!checks.length) {
      clean.push(t)
      continue
    }
    const check = checks.find((c) => c.proposal) ?? checks[0]
    flagged.push({ t, check, others: checks.filter((c) => c !== check), proposal: check.proposal })
  }
  flagged.sort((a, b) => savingOf(b) - savingOf(a) || b.t.date.localeCompare(a.t.date))
  return { inScope, clean, flagged }
}

/** A flagged timesheet as one row of the reply's card. */
function heldRow(f: FlaggedSheet, scope: HoursScope, data: DemoData): BatchRow {
  const pro = proOf(data, f.t.proId)
  const saving = savingOf(f)
  return {
    id: f.t.id,
    name: pro ? fullName(pro) : "A worker",
    meta: [!scope.supplierId && supplier(f.t.supplierId).shortName, !(scope.from && scope.from === scope.to) && formatDay(f.t.date, "EEE MMM d")].filter(Boolean).join(" · "),
    issue: f.check.label,
    detail: [f.check.detail, f.others.length && `Also ${f.others.map((c) => c.label.toLowerCase()).join(", ")}.`].filter(Boolean).join(" "),
    saves: saving > 0 ? `${money(saving)} less` : saving < 0 ? `${money(-saving)} more` : undefined,
  }
}

function nothingWaiting(inScope: Timesheet[], scope: HoursScope, data: DemoData) {
  if (inScope.length === 1) {
    const t = inScope[0]
    const agency = supplier(t.supplierId).shortName
    const state =
      t.status === "approved"
        ? "It's approved"
        : t.status === "invoiced"
          ? "It's already invoiced"
          : t.status === "draft"
            ? `It's still a draft with ${agency}`
            : `It was sent back to ${agency} with a reason`
    return `The ${scopePhrase(scope, data, 1, inScope)} isn't waiting for approval. ${state}.`
  }
  const count = (status: Timesheet["status"]) => inScope.filter((t) => t.status === status).length
  const drafts = count("draft")
  const parts = [
    count("approved") && `${count("approved")} approved`,
    count("invoiced") && `${count("invoiced")} invoiced`,
    drafts && `${drafts} still ${drafts === 1 ? "a draft" : "drafts"} with the agency`,
    count("rejected") && `${count("rejected")} sent back to the agency`,
  ].filter((p): p is string => !!p)
  return `None of the ${inScope.length} ${scopePhrase(scope, data, inScope.length, inScope)} is waiting for approval: ${joinNames(parts)}.`
}

/**
 * The reply to an approval request: what's clean, what Iris flagged and the fix it proposes, and a button for each.
 * `still` words it as the follow-up to an approval that just went through.
 */
export function hoursReply(data: DemoData, buyerId: string, scope: HoursScope, today: string, still = false): { text: string; actions: HoursAction[]; batch?: TimesheetBatch } {
  const { inScope, clean, flagged } = planHoursApproval(data, buyerId, scope)
  const pending = clean.length + flagged.length
  if (!pending) {
    if (still) return { text: "Nothing else here is waiting for approval.", actions: [] }
    if (!hasFilters(scope)) return { text: "Nothing is waiting for your approval. Iris brings you the next ones as agencies submit them.", actions: [] }
    if (!inScope.length) return { text: `I couldn't find any ${scopePhrase(scope, data, 2)}.`, actions: [{ label: "Open timesheets", kind: "link", href: "/timesheets" }] }
    return { text: nothingWaiting(inScope, scope, data), actions: [{ label: "Open timesheets", kind: "link", href: "/timesheets?filter=all" }] }
  }

  const waiting = [...clean, ...flagged.map((f) => f.t)]
  const text = `${pending.toLocaleString("en-US")} ${scopePhrase(scope, data, pending, waiting)} ${pending === 1 ? "is" : "are"} ${still ? "still " : ""}waiting for approval.`
  const closed = clean.filter((t) => weekClosed(t.date, today)).length
  const listed = flagged.slice(0, LISTED)
  const batch: TimesheetBatch = {
    ready: clean.length
      ? {
          label: "Match the clock",
          count: clean.length,
          hours: hours(round2(clean.reduce((s, t) => s + t.hours, 0))),
          amount: money(round2(clean.reduce((s, t) => s + timesheetAmount(t), 0))),
          note: closed ? (closed === clean.length ? "Invoiced as soon as you approve" : `${closed} invoiced as soon as you approve`) : undefined,
        }
      : undefined,
    held: listed.map((f) => heldRow(f, scope, data)),
    heldCount: flagged.length,
    heldLabel: clean.length ? "Held back" : "Needs your decision",
    more: flagged.length > LISTED ? `${flagged.length - LISTED} more in Timesheets` : undefined,
  }

  const actions: HoursAction[] = []
  if (clean.length) actions.push({ label: `Approve ${plural(clean.length, "timesheet")}`, kind: "approve-timesheets", ids: clean.map((t) => t.id), scope })
  const fixable = listed.filter((f) => f.proposal?.clockIn && f.proposal.clockOut)
  const firsts = fixable.map((f) => proOf(data, f.t.proId)?.firstName ?? "")
  for (const f of fixable) {
    const pro = proOf(data, f.t.proId)
    const name = !pro ? "it" : firsts.filter((n) => n === pro.firstName).length > 1 ? fullName(pro) : pro.firstName
    actions.push({
      label: `Approve ${name} at ${f.proposal!.hours.toFixed(2)} hrs`,
      kind: "accept-proposal",
      id: f.t.id,
      times: { clockIn: f.proposal!.clockIn!, clockOut: f.proposal!.clockOut!, breakMins: f.proposal!.breakMins },
      hours: f.proposal!.hours,
      reason: f.proposal!.reason,
      scope,
    })
  }
  if (flagged.length === 1) {
    const pro = proOf(data, flagged[0].t.proId)
    actions.push({ label: pro ? `Open ${pro.firstName}'s timesheet` : "Open the timesheet", kind: "link", href: `/timesheets?ts=${flagged[0].t.id}` })
  } else if (flagged.length) {
    const shifts = new Set(flagged.map((f) => f.t.groupId))
    actions.push({ label: "Review flagged", kind: "link", href: shifts.size === 1 ? `/timesheets?filter=flagged&shift=${[...shifts][0]}` : "/timesheets?filter=flagged" })
  }
  return { text, actions, batch }
}

/** When the approved hours get billed: on this week's invoice, out on Saturday, or right away if their week has closed. */
function invoiceLine(rows: Timesheet[], result: ApproveResult, today: string) {
  const saturday = formatDateShort(addDaysISO(weekEndISO(today), 1))
  const closed = rows.filter((t) => weekClosed(t.date, today)).length
  const one = rows.length === 1
  if (!result.invoices.length || !closed) return result.open.length ? `${one ? "It goes" : "They go"} out on Saturday's invoice, ${saturday}.` : ""
  if (closed === rows.length) return `${one ? "Its week has" : "Their weeks have"} closed, so ${one ? "it's" : "they're"} invoiced now.`
  return `Closed weeks are invoiced now. This week's go out on Saturday, ${saturday}.`
}

/** The first line after "Approve N timesheets" goes through. `rows` are the ones now approved. */
export function approvedLine(rows: Timesheet[], result: ApproveResult, today: string) {
  if (!rows.length) return result.flagged ? "Iris flagged those since, so none went through." : "Those were already decided, so nothing changed."
  return `Approved ${plural(rows.length, "timesheet")}, ${hours(round2(rows.reduce((s, t) => s + t.hours, 0)))}. ${invoiceLine(rows, result, today)}`.trim()
}

/** The first line after accepting Iris's proposal on a flagged timesheet. `before` is the timesheet as the agency billed it. */
export function correctedLine(before: Timesheet, approvedHours: number, reason: string, data: DemoData, result: ApproveResult, today: string) {
  const pro = proOf(data, before.proId)
  const agency = supplier(before.supplierId).shortName
  const saving = round2((before.hours - approvedHours) * before.billRate)
  const billed = saving > 0 ? ` ${agency} billed ${before.hours.toFixed(2)}, so ${money(saving)} comes off.` : ""
  return `Approved ${pro ? fullName(pro) : "the timesheet"} at ${approvedHours.toFixed(2)} hrs, ${reason.toLowerCase()}.${billed} ${invoiceLine([before], result, today)}`.trim()
}
