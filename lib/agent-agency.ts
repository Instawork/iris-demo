import { addDaysISO, formatDay, weekStartISO } from "@/lib/dates"
import { eligiblePros, joinNames } from "@/lib/domain/core"
import { fullName, hours, money, plural, round2 } from "@/lib/format"
import { filledCount, groupPhase, isOpenTo } from "@/lib/metrics"
import { buyer, location, position } from "@/lib/reference"
import { readyToSubmit, timesheetAmount, timesheetChecks, withAgency } from "@/lib/timesheets"
import type { BatchRow, TimesheetBatch } from "@/lib/agent-hours"
import type { DemoData, Timesheet } from "@/lib/types"

/**
 * The agency's two longest chores, in a sentence. "Submit this week's timesheets" sends every draft that's ready and
 * holds back, by name, the ones that aren't. "Assign workers" fills every open spot the agency has with its
 * best cleared workers. Either way the chat lays the plan out first, and nothing happens until the agency clicks.
 */

export type AgencyAction =
  | { label: string; kind: "submit-timesheets"; ids: string[]; from?: string }
  | { label: string; kind: "assign-workers"; plan: { groupId: string; proIds: string[] }[] }

const LISTED = 3

const lowerOf = (text: string) => text.toLowerCase().replace(/’/g, "'")

export const asksToSubmit = (text: string) => {
  const lower = lowerOf(text)
  return /\b(submit|send)\b/.test(lower) && /\b(hours?|timesheets?|time ?sheets?)\b/.test(lower)
}

export const asksToAssign = (text: string) => /\b(assign|staff|fill)\b/.test(lowerOf(text)) && !asksToSubmit(text)

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
