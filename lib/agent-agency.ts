import { addDaysISO, formatDay, weekStartISO } from "@/lib/dates"
import { eligiblePros, joinNames } from "@/lib/domain/core"
import { fullName, hours, money, plural, round2 } from "@/lib/format"
import { filledCount, groupPhase, isOpenTo } from "@/lib/metrics"
import { buyer, location, position } from "@/lib/reference"
import { EXPENSE_LABEL, canEditBilled, readyToSubmit, timesheetAmount, timesheetChecks, withAgency } from "@/lib/timesheets"
import type { BatchRow, TimesheetBatch } from "@/lib/agent-hours"
import type { DemoData, ExpenseKind, Timesheet } from "@/lib/types"

/**
 * The agency's longest chores, in a sentence. "Submit this week's timesheets" sends every draft that's ready and
 * holds back, by name, the ones that aren't. "Assign workers" fills every open spot the agency has with its
 * best cleared workers. "Add $20 parking to everyone on this shift" bills the crew's cost at once. Either way the chat
 * lays the plan out first, and nothing happens until the agency clicks.
 */

export type AgencyAction =
  | { label: string; kind: "submit-timesheets"; ids: string[]; from?: string }
  | { label: string; kind: "assign-workers"; plan: { groupId: string; proIds: string[] }[] }
  | { label: string; kind: "add-expenses"; ids: string[]; expense: ExpenseKind; amount: number; note?: string }

const LISTED = 3

const lowerOf = (text: string) => text.toLowerCase().replace(/’/g, "'")

export const asksToSubmit = (text: string) => {
  const lower = lowerOf(text)
  return /\b(submit|send)\b/.test(lower) && /\b(hours?|timesheets?|time ?sheets?)\b/.test(lower)
}

export const asksToAssign = (text: string) => /\b(assign|staff|fill)\b/.test(lowerOf(text)) && !asksToSubmit(text)

const AMOUNT = /\$\s?(\d{1,3}(?:\.\d{1,2})?)\b/

export const asksToExpense = (text: string) => /\b(expenses?|parking|reimburse\w*)\b/.test(lowerOf(text)) && AMOUNT.test(text)

/** The cost a sentence names: "$20 parking", "a $35 background check", or anything else with an amount. */
export function expenseFrom(text: string): { kind: ExpenseKind; amount: number; note?: string } {
  const lower = lowerOf(text)
  const amount = round2(Number(AMOUNT.exec(text)?.[1] ?? 0))
  if (/\bparking\b/.test(lower)) return { kind: "parking", amount }
  if (/\bbackground\b/.test(lower)) return { kind: "background_check", amount }
  return { kind: "other", amount, note: "Shift expense" }
}

/** The first day a sentence asks about, looking back from today. Everything still with the agency when it names none. */
export function submitFrom(text: string, today: string) {
  const lower = lowerOf(text)
  if (/\blast week\b/.test(lower)) return addDaysISO(weekStartISO(today), -7)
  if (/\bthis week\b/.test(lower)) return weekStartISO(today)
  if (/\b(yesterday|last night)\b/.test(lower)) return addDaysISO(today, -1)
  return undefined
}

/** The agency's drafts from `from` on, split into the ones ready to send and the ones that need a look. */
export function planSubmit(data: DemoData, supplierId: string, from?: string) {
  const theirs = data.timesheets.filter((t) => t.supplierId === supplierId)
  const waiting = theirs.filter((t) => withAgency(t) && (!from || t.date >= from)).sort((a, b) => b.date.localeCompare(a.date))
  const ready: Timesheet[] = []
  const held: Timesheet[] = []
  for (const t of waiting) (readyToSubmit(t, theirs.filter((o) => o.proId === t.proId)) ? ready : held).push(t)
  return { ready, held }
}

const proName = (data: DemoData, id: string) => {
  const p = data.pros.find((x) => x.id === id)
  return p ? fullName(p) : "A worker"
}

function heldRow(t: Timesheet, data: DemoData): BatchRow {
  const check = timesheetChecks(t)[0]
  return {
    id: t.id,
    name: proName(data, t.proId),
    meta: formatDay(t.date, "EEE MMM d"),
    issue: t.status === "rejected" ? "Sent back" : check ? check.label : "Doesn't match the clock",
    detail: t.status === "rejected" ? (t.rejection?.reason ?? "") : check ? check.detail : "The billed times differ from Iris's clock.",
  }
}

export function submitReply(data: DemoData, supplierId: string, from: string | undefined, still = false): { text: string; actions: AgencyAction[]; batch?: TimesheetBatch } {
  const { ready, held } = planSubmit(data, supplierId, from)
  if (!ready.length && !held.length) return { text: still ? "That's everything. Nothing else is waiting on you." : "Nothing to submit. Iris drafts the next ones when your shifts end.", actions: [] }
  const batch: TimesheetBatch = {
    ready: ready.length
      ? {
          label: "Ready to submit",
          count: ready.length,
          hours: hours(round2(ready.reduce((s, t) => s + t.hours, 0))),
          amount: money(round2(ready.reduce((s, t) => s + timesheetAmount(t), 0))),
        }
      : undefined,
    held: held.slice(0, LISTED).map((t) => heldRow(t, data)),
    heldCount: held.length,
    heldLabel: ready.length ? "Held back" : "Needs a look first",
    more: held.length > LISTED ? `${held.length - LISTED} more at the top of Timesheets` : undefined,
  }
  const actions: AgencyAction[] = []
  if (ready.length) actions.push({ label: `Submit ${plural(ready.length, "timesheet")}`, kind: "submit-timesheets", ids: ready.map((t) => t.id), from })
  return { text: `${plural(ready.length + held.length, "timesheet")} ${still ? "still " : ""}waiting on you.`, actions, batch }
}

/** The first line after "Submit N timesheets" goes through. */
export function submittedLine(rows: Timesheet[]) {
  if (!rows.length) return "Those changed since, so none went in."
  const buyers = [...new Set(rows.map((t) => buyer(t.buyerId).name))]
  return `Submitted ${plural(rows.length, "timesheet")}, ${hours(round2(rows.reduce((s, t) => s + t.hours, 0)))}. ${joinNames(buyers)} can approve ${rows.length === 1 ? "it" : "them"} now.`
}

/* -------------------------------- Expenses --------------------------------- */

/** The shift a crew expense is for: the one open on screen, or else the agency's latest shift that's been worked. */
export function crewShift(data: DemoData, supplierId: string, today: string, groupId?: string) {
  const worked = (id: string) => data.timesheets.filter((t) => t.groupId === id && t.supplierId === supplierId && t.status !== "removed" && !!t.clockIn && !!t.clockOut)
  const open = groupId ? data.groups.find((g) => g.id === groupId) : undefined
  if (open && worked(open.id).length) return { group: open, sheets: worked(open.id) }
  const latest = data.groups
    .filter((g) => g.date <= today && worked(g.id).some(canEditBilled))
    .sort((a, b) => b.date.localeCompare(a.date) || b.end.localeCompare(a.end))[0]
  return latest ? { group: latest, sheets: worked(latest.id) } : undefined
}

export function expenseReply(data: DemoData, supplierId: string, text: string, today: string, groupId?: string): { text: string; actions: AgencyAction[] } {
  const { kind, amount, note } = expenseFrom(text)
  const shift = crewShift(data, supplierId, today, groupId)
  if (!shift) return { text: "None of your workers has finished a shift you can still bill, so there's nothing to add it to.", actions: [] }
  const { group, sheets } = shift
  const where = `${position(group.positionId).name}, ${location(group.locationId).name}, ${formatDay(group.date, "EEE MMM d")}`
  const has = (t: Timesheet) => t.expenses?.some((e) => e.kind === kind && e.amount === amount)
  const adds = sheets.filter((t) => canEditBilled(t) && !has(t))
  const sent = sheets.filter((t) => !canEditBilled(t) && !has(t)).length
  const label = EXPENSE_LABEL[kind].toLowerCase()
  if (!adds.length) return { text: sent ? `Everyone on ${where} is already submitted, so expenses can't change.` : `Everyone on ${where} already has ${money(amount)} ${label}.`, actions: [] }
  const names = adds.map((t) => proName(data, t.proId).split(" ")[0])
  const shown = names.length > LISTED + 1 ? `${names.slice(0, LISTED).join(", ")} and ${names.length - LISTED} more` : joinNames(names)
  return {
    text: [
      `${money(amount)} ${label} for each of the ${plural(adds.length, "worker")} on ${where}: ${shown}. ${money(round2(amount * adds.length))} at cost, approved with their hours.`,
      `${sent ? `${plural(sent, "timesheet")} already submitted ${sent === 1 ? "stays" : "stay"} as ${sent === 1 ? "it is" : "they are"}. ` : ""}Nothing is added until you click.`,
    ].join("\n\n"),
    actions: [{ label: `Add ${money(amount)} to ${plural(adds.length, "timesheet")}`, kind: "add-expenses", ids: adds.map((t) => t.id), expense: kind, amount, ...(note ? { note } : {}) }],
  }
}

/* -------------------------------- Assigning -------------------------------- */

/** Every open spot on the agency's upcoming shifts, soonest first, each given the best cleared worker free that day. */
export function planAssign(data: DemoData, supplierId: string) {
  const groups = data.groups
    .filter((g) => isOpenTo(g, supplierId) && groupPhase(g) === "upcoming" && filledCount(g) < g.slots.length)
    .sort((a, b) => a.date.localeCompare(b.date) || a.start.localeCompare(b.start))
  const taken = new Set<string>()
  const plan: { groupId: string; proIds: string[]; open: number }[] = []
  let open = 0
  for (const g of groups) {
    const spots = g.slots.length - filledCount(g)
    open += spots
    const picks = eligiblePros(data, g, supplierId)
      .filter((p) => !taken.has(`${p.id}|${g.date}`))
      .sort((a, b) => b.rating - a.rating || b.shiftsWorked - a.shiftsWorked)
      .slice(0, spots)
    for (const p of picks) taken.add(`${p.id}|${g.date}`)
    if (picks.length) plan.push({ groupId: g.id, proIds: picks.map((p) => p.id), open: spots })
  }
  return { plan, open, shifts: groups.length }
}

export function assignReply(data: DemoData, supplierId: string, still = false): { text: string; actions: AgencyAction[] } {
  const { plan, open, shifts } = planAssign(data, supplierId)
  if (!open) return { text: still ? "Every spot you have is filled." : "Every spot released to you is filled. Iris tells you when the next shift comes in.", actions: [] }
  const placed = plan.reduce((s, p) => s + p.proIds.length, 0)
  if (!placed) return { text: `${plural(open, "open spot")} across ${plural(shifts, "shift")}, but none of your cleared workers are free for them.`, actions: [] }
  const lines = plan.slice(0, LISTED).map((p) => {
    const g = data.groups.find((x) => x.id === p.groupId)!
    const names = p.proIds.map((id) => proName(data, id).split(" ")[0])
    return `• ${position(g.positionId).name}, ${location(g.locationId).name}, ${formatDay(g.date, "EEE MMM d")}: ${joinNames(names)}`
  })
  const more = plan.length > LISTED ? [`And ${plural(plan.length - LISTED, "more shift")}.`] : []
  const short = open - placed
  const head = `${plural(open, "open spot")} across ${plural(shifts, "shift")}. Iris picked your highest-rated workers who are cleared and free that day${short ? `, enough for ${placed}` : ""}:`
  return {
    text: [[head, ...lines, ...more].join("\n"), `${short ? `The other ${short} wait until someone is cleared. ` : ""}Nobody is booked until you click.`].join("\n\n"),
    actions: [{ label: `Assign ${plural(placed, "worker")}`, kind: "assign-workers", plan: plan.map(({ groupId, proIds }) => ({ groupId, proIds })) }],
  }
}
