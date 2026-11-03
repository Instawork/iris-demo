import { BadgeDollarSign, CalendarPlus, ChartColumn, Clock, FileText, Receipt, ShieldCheck, type LucideIcon } from "lucide-react"
import { toast } from "sonner"

import { CHAT_COMPOSER_ID } from "@/components/agent/agent-chat"
import { useAgentThreads, type AgentMessage } from "@/components/agent/agent-store"
import { compose } from "@/components/agent/agent-thread"
import { enteringExpenses } from "@/components/agent/enter-expenses"
import { enteringTips } from "@/components/agent/enter-tips"
import { of100 } from "@/components/procurement/dollar-split"
import { COMPOSER_ID } from "@/components/home/agent-home"
import { STOPPED, cursorStopped, haltCursor, point, press, restCursor, sleep, type, until } from "@/components/tour/cursor"
import type { TourBase, TourPicks } from "@/hooks/use-tour"
import { tipShift } from "@/lib/agent-tips"
import { canWork, requirementRows } from "@/lib/compliance"
import { certificateFile } from "@/lib/certificate"
import { addDaysISO, formatDay, todayISO } from "@/lib/dates"
import { eligiblePros } from "@/lib/domain/core"
import { fullName, money, plural } from "@/lib/format"
import { filledCount, groupPhase, isOpenTo } from "@/lib/metrics"
import { standingOf } from "@/lib/pro-profile"
import { toCsv } from "@/lib/csv"
import { buyer, location, position, supplier } from "@/lib/reference"
import { dollarSplit, irisCounters, responded } from "@/lib/sourcing"
import { timesheetChecks, tippable } from "@/lib/timesheets"
import { SAMPLE_UNIT_SHEET } from "@/lib/unit-sheet"
import type { DemoData, Pro, RequirementId, Timesheet } from "@/lib/types"

/**
 * The guided demo: the core flows of a VMS, in the order of Compass's working sessions, each played as the person who does it. Nothing moves on until the
 * player clicks: "Do it for me" makes their next move on screen, typing a form in or clicking what the card points at.
 */

export type ChapterId = "rates" | "shifts" | "workers" | "timesheets" | "extras" | "invoicing" | "reporting"
export type Placement = "top" | "bottom" | "left" | "right"

/** Everything a step needs to decide where it is and whether the player has done it. */
export interface TourContext extends TourPicks {
  path: string
  params: URLSearchParams
  wsId: string
  data: DemoData
  thread: AgentMessage[]
  base: TourBase
  /** When the player reached the step they're on. */
  enteredAt: string
}

export interface TourApi {
  push: (href: string) => void
  remember: (patch: TourPicks) => void
  /** The context as it is now, for steps that play out over several screens. */
  now: () => TourContext
}

type Copy = string | ((ctx: TourContext) => string | undefined)

export interface TourStep {
  kind: "step"
  id: string
  chapter: ChapterId
  /** What the step is called in the tour's step list. */
  label: string
  wsId: string
  /** The page the step happens on. Anywhere else, the card offers to take the player there. */
  path: RegExp
  href: (ctx: TourContext) => string
  title: string | ((ctx: TourContext) => string)
  body?: Copy
  /** What the player does. When there's nothing to do, the card shows Next. */
  action?: Copy
  example?: (ctx: TourContext) => string | undefined
  /** Elements to spotlight. The first is the one the player acts on. */
  targets: (ctx: TourContext) => (Element | null | undefined)[]
  /** What the player's next click lands on, when that isn't the first target. */
  clicks?: (ctx: TourContext) => Element | null | undefined
  placement?: Placement
  /** What the card sits beside when that isn't the target itself, like the sheet a target lives in. */
  anchor?: () => Element | null | undefined
  done?: (ctx: TourContext) => boolean
  status?: (ctx: TourContext) => string | undefined
  success?: (ctx: TourContext) => string
  /** Where to return when the target disappears, like a dialog the player closed. */
  back?: string
  /** The step that sets this one up, like the question whose answer it acts on. Played for the player when they jump here, with whatever it needs in turn. */
  needs?: string
  /** Starts from an empty chat, so the answer it waits for is the one the player asks for, or Home shows its briefing. */
  startsChat?: boolean
  /** Acts on a reply in the bottom-right Agent Chat, so arriving here opens it. */
  inChat?: boolean
  /** Starts by asking Iris, so arriving here opens Agent Chat ready to type. */
  opensChat?: boolean
  /** Fills in the screen the player is on, and returns the button they click to move on. */
  fill?: {
    when: (ctx: TourContext) => boolean
    run: (ctx: TourContext, api: TourApi) => Promise<Element | null | undefined>
  }
  /** Plays the whole step through, for when the player has lost its target. */
  skip: (ctx: TourContext, api: TourApi) => void | Promise<void>
  onDone?: (ctx: TourContext, api: TourApi) => void
}

export interface TourChapter {
  kind: "chapter"
  id: string
  chapter: ChapterId
  title: string
  wsId: string
  href: string | ((ctx: TourContext) => string)
  /** What this part does, in a few words. */
  shows: string
}

export type TourItem = { kind: "intro"; id: "intro" } | TourChapter | TourStep | { kind: "finale"; id: "finale" }

/** The parts follow the agenda of Compass's working sessions. */
export const CHAPTER_ORDER: ChapterId[] = ["rates", "shifts", "workers", "timesheets", "extras", "invoicing", "reporting"]

export const CHAPTERS: Record<ChapterId, { number: number; label: string; short: string; icon: LucideIcon }> = {
  rates: { number: 1, label: "Rate cards and supplier sourcing", short: "Rate cards", icon: BadgeDollarSign },
  shifts: { number: 2, label: "Shift creation", short: "Shifts", icon: CalendarPlus },
  workers: { number: 3, label: "Worker assignment and compliance", short: "Workers", icon: ShieldCheck },
  timesheets: { number: 4, label: "Timesheets", short: "Timesheets", icon: Clock },
  extras: { number: 5, label: "Tips and expenses", short: "Tips and expenses", icon: Receipt },
  invoicing: { number: 6, label: "Invoicing and accruals", short: "Invoicing", icon: FileText },
  reporting: { number: 7, label: "Reporting", short: "Reporting", icon: ChartColumn },
}

const LEVY = "ws-levy"
const COMPASS = "ws-compass"
const METRO = "ws-metro"
const HARBOR = "ws-harbor"

const one = (selector: string) => document.querySelector(selector)
const last = (selector: string) => {
  const all = document.querySelectorAll(selector)
  return all[all.length - 1] ?? null
}
const inside = (root: string | Element | null | undefined, selector: string) => (typeof root === "string" ? one(root) : root)?.querySelector(selector) ?? null
const buttonIn = (root: string | Element | null | undefined, text: string) =>
  [...((typeof root === "string" ? one(root) : root)?.querySelectorAll("button") ?? [])].find((b) => b.textContent?.trim() === text) ?? null
/* -------------------------------- Autopilot -------------------------------- */

/** The button left lit for the player after Iris fills a screen, until they click it. */
let handoff: HTMLElement | undefined
/** A question sent with Enter leaves Send disabled behind it, no longer the thing to click. */
export const handedOff = () => (handoff?.isConnected && !(handoff instanceof HTMLButtonElement && handoff.disabled) ? handoff : undefined)
const clearHandoff = () => {
  handoff?.removeAttribute("data-tour-next")
  handoff = undefined
}
export const handOff = (el: Element | null | undefined) => {
  clearHandoff()
  if (!(el instanceof HTMLElement)) return
  handoff = el
  el.setAttribute("data-tour-next", "")
  el.addEventListener("click", () => handoff === el && clearHandoff(), { once: true })
}

/** Called when the step changes or the tour ends, so Iris stops where she is. */
export const stopPilot = () => {
  clearHandoff()
  haltCursor()
}
export const pilotStopped = cursorStopped

/** What the player's next click is on this step, if it's something Iris can click. */
export const nextClick = (step: TourStep, ctx: TourContext) => {
  const el = step.clicks ? step.clicks(ctx) : step.targets(ctx)[0]
  return el instanceof HTMLElement && !el.matches(":disabled, [aria-disabled=true]") && el.getClientRects().length > 0 ? el : undefined
}

/** Makes the player's next move for them, on screen: clicks the button Iris left, fills the screen in, or clicks what the card points at. */
export async function advance(step: TourStep, ctx: TourContext, api: TourApi) {
  const left = handedOff()
  if (left) return press(left)
  if (step.fill?.when(ctx)) return handOff(await step.fill.run(ctx, api))
  await press(nextClick(step, ctx))
}

const serial = (id: string) => Number(id.split("-")[1]) || 0
const nextDate = () => formatDay(addDaysISO(todayISO(), 2), "MMMM do")

export const askExample = () => `Create 8 bartender shifts at West Loop Arena on ${nextDate()} from 4pm to 11pm`
const reportAsk = () => "What did we spend by agency last week?"

/* ------------------------------- Cost centers ------------------------------ */

const FORM = '[data-tour="unit-form"]'
const SUBMIT = '[data-tour="unit-submit"]'
const UNITS_SHEET = '[data-tour="units-sheet"]'
const UNIT_CC = "LEV-4450"
const SHEET_CCS = new Set(SAMPLE_UNIT_SHEET.map((r) => r["Financial Code"]))

const newUnit = (ctx: TourContext) => ctx.data.directory.locations.find((l) => l.costCenter === UNIT_CC)
const unitRow = (ctx: TourContext) => (newUnit(ctx) ? one(`tr[data-row-id="${newUnit(ctx)!.id}"]`) : null)
const sheetUnits = (ctx: TourContext) => ctx.data.directory.locations.filter((l) => SHEET_CCS.has(l.costCenter))
const unitsAdded = () => [...document.querySelectorAll("[data-sonner-toast]")].some((t) => /units? added/.test(t.textContent ?? ""))
const sheetFiled = (ctx: TourContext) => !!one(`${UNITS_SHEET}[data-state="closed"]`) && sheetUnits(ctx).length > 0

const toggleOn = async (root: string, text: string) => {
  const button = buttonIn(root, text)
  if (button && button.getAttribute("aria-pressed") !== "true") await press(button)
}

const UNIT_FIELDS: [string, string][] = [
  ["Soldier Field", "Soldier Field"],
  [UNIT_CC, UNIT_CC],
  ["1410 Special Olympics Dr, Chicago, IL", "1410 Special Olympics Dr, Chicago, IL"],
  ["60605", "60605"],
]

/** Types the new unit into the form, leaving Add unit for the player. */
async function fillUnit() {
  for (const [placeholder, value] of UNIT_FIELDS) {
    const input = inside(FORM, `input[placeholder="${placeholder}"]`)
    if (input instanceof HTMLInputElement && input.value !== value) await type(input, value)
  }
  await toggleOn(FORM, "Food handler card")
  return inside(FORM, SUBMIT)
}

/* ------------------------------- Procurement ------------------------------- */

const EVENT = "rfp-27"
const event = (ctx: TourContext) => ctx.data.sourcing?.find((e) => e.id === EVENT)
/** The counters Iris sent during the tour, and how many the agencies have answered. */
/** Every counter Iris sent on the event, whenever it was sent, so a jump back here finds the negotiation already run. */
const irisSent = (ctx: TourContext) => {
  const ev = event(ctx)
  return ev ? irisCounters(ev) : []
}
const answered = (ctx: TourContext) => irisSent(ctx).filter((c) => c.outcome !== "waiting").length
const negotiated = (ctx: TourContext) => irisSent(ctx).length > 0 && answered(ctx) === irisSent(ctx).length
const approvedSince = (ctx: TourContext) => Object.values(event(ctx)?.approved ?? {}).filter((at) => at >= ctx.base.at).length
const approveDialog = () => [...document.querySelectorAll('[role="dialog"]')].find((d) => d.querySelector("h2")?.textContent?.trim() === "Approve bids")
const approveButton = () => [...(approveDialog()?.querySelectorAll("button") ?? [])].find((b) => /^Approve \d/.test(b.textContent?.trim() ?? ""))

/** The agencies that get the most and the least of each dollar to the worker, among those that bid. */
const valueEnds = (ctx: TourContext) => {
  const ev = event(ctx)
  if (!ev) return []
  const rows = responded(ev)
    .map((s) => ({ name: supplier(s).shortName, ...dollarSplit(ev, ctx.data.rateCards, s) }))
    .sort((a, b) => b.worker - a.worker)
  return rows.length > 1 ? [rows[0], rows.at(-1)!] : []
}

/* ------------------------------ Shift creation ----------------------------- */

const ordersSince = (ctx: TourContext) => ctx.data.groups.filter((g) => g.buyerId === "levy-chi" && serial(g.id) >= ctx.base.sg).sort((a, b) => serial(b.id) - serial(a.id))

/** The shift the player booked in the chat. */
const booked = (ctx: TourContext) => ordersSince(ctx).find((g) => !g.approval && !g.dispatch)

/** The order the player posted from the form, asking for workers by name. */
const requestedOrder = (ctx: TourContext) => ordersSince(ctx).find((g) => !!g.dispatch?.proIds?.length)

const DISPATCH = '[data-tour="dispatch"]'
const AGENCY_TAB = `${DISPATCH} [role="tab"][data-value="agency"]`
const PRO_PICKER = `${DISPATCH} [data-tour="request-pros"]`
const oneAgency = () => !!one(`${AGENCY_TAB}[aria-selected="true"]`)
const prosPicked = () => document.querySelectorAll(`${PRO_PICKER} li button[aria-pressed="true"]`).length

/** Sends the order to one agency and asks for two of its workers by name. */
async function pickTwo() {
  await until(() => one(AGENCY_TAB))
  if (!oneAgency()) await press(one(AGENCY_TAB))
  if (!one(PRO_PICKER)) await press(await until(() => one(`${DISPATCH} [data-tour="request-workers"]`)))
  await until(() => one(PRO_PICKER))
  while (prosPicked() < 2) {
    const row = [...document.querySelectorAll<HTMLButtonElement>(`${PRO_PICKER} li button:not(:disabled)`)].find((b) => b.getAttribute("aria-pressed") !== "true")
    if (!row) break
    await press(row)
  }
}

const composerText = (id = COMPOSER_ID) => (document.getElementById(id) as HTMLTextAreaElement | null)?.value.trim() ?? ""
const sendButton = (id = COMPOSER_ID) => inside(COMPOSER(id), 'button[aria-label="Send"]')

/** Types a question into a composer, Home's unless told otherwise, leaving Send for the player. */
async function typeAsk(text: string, id = COMPOSER_ID) {
  const box = document.getElementById(id)
  if (!box) throw STOPPED
  await point(box)
  compose(id, text)
  await until(() => composerText(id) === text, 6000)
  restCursor()
  await sleep(200)
  return sendButton(id)
}

/** The question box is free: nothing typed, and Iris isn't still answering. */
const canAsk = (ctx: TourContext, id = COMPOSER_ID) => !!COMPOSER(id) && !composerText(id) && !useAgentThreads.getState().thinking[ctx.wsId]

const offers = (ctx: TourContext, kind: string) => ctx.thread.some((m) => m.actions?.some((a) => a.kind === kind))
const hasDraft = (ctx: TourContext) => offers(ctx, "create-shift")

/** Sends a question for the player and waits for the answer the next step acts on. */
const askFor = (text: () => string, ready: (ctx: TourContext) => boolean, id = COMPOSER_ID) => async (_: TourContext, api: TourApi) => {
  await until(() => COMPOSER(id), 8000)
  compose(id, text(), true)
  await until(() => ready(api.now()), 15000)
}

/* ------------------------- Assignment and compliance ------------------------ */

const ASSIGN = '[data-tour="assign-dialog"]'
const ASSIGN_SUBMIT = '[data-tour="assign-submit"]'

/** The soonest upcoming shift open to Metro with a spot left and a cleared worker free for it. */
const assignShift = (data: DemoData) =>
  data.groups
    .filter((g) => isOpenTo(g, "metro") && groupPhase(g) === "upcoming" && filledCount(g) < g.slots.length && eligiblePros(data, g, "metro").length > 0)
    .sort((a, b) => a.date.localeCompare(b.date) || a.start.localeCompare(b.start) || a.id.localeCompare(b.id))[0]

const assignHref = (ctx: TourContext) => {
  const g = assignShift(ctx.data)
  return g ? `/shifts/${g.id}` : "/shifts"
}

/** Metro workers confirmed on a shift during the tour. */
const assignedSince = (ctx: TourContext) => {
  const metro = new Set(ctx.data.pros.filter((p) => p.supplierId === "metro").map((p) => p.id))
  return ctx.data.groups.reduce((n, g) => n + g.slots.filter((s) => !!s.proId && !!s.confirmedAt && s.confirmedAt >= ctx.base.at && metro.has(s.proId)).length, 0)
}

const assignReady = () => !(one(ASSIGN_SUBMIT) as HTMLButtonElement | null)?.disabled

/** Picks the first worker who's ready, leaving Assign for the player. */
async function pickReady() {
  if (!assignReady()) await press(inside(ASSIGN, '[data-tour="assign-row"][data-ready]:not(:disabled)'))
  return one(ASSIGN_SUBMIT)
}

const DOC: Record<RequirementId, string> = {
  background: "background check",
  i9: "work authorization",
  orientation: "Compass orientation",
  foodHandler: "food handler card",
  alcohol: "alcohol server cert",
}

const BLOCKING = ["expired", "missing", "pending"]
const CERTS: RequirementId[] = ["foodHandler", "alcohol"]
const blockers = (pro: Pro) => requirementRows(pro).filter((r) => BLOCKING.includes(r.state))
const byName = (a: Pro, b: Pro) => fullName(a).localeCompare(fullName(b))

/** Metro's worker kept off shifts by a work authorization that lapsed. */
const authPro = (data: DemoData) =>
  data.pros.filter((p) => p.supplierId === "metro" && requirementRows(p).some((r) => r.id === "i9" && r.state === "expired")).sort(byName)[0]

/** Metro's worker kept off shifts by a lapsed certification and nothing else, so verifying it clears them. */
const certPro = (data: DemoData) =>
  data.pros
    .filter((p) => {
      const held = p.supplierId === "metro" ? blockers(p) : []
      return held.length === 1 && CERTS.includes(held[0].id) && held[0].state === "expired"
    })
    .sort(byName)[0]

const certOf = (pro?: Pro) => (pro ? requirementRows(pro).find((r) => CERTS.includes(r.id) && BLOCKING.includes(r.state))?.id : undefined)

const verifyHref = (ctx: TourContext) => {
  const pro = certPro(ctx.data)
  return pro ? `/professionals?filter=not_compliant&pro=${pro.id}` : "/professionals?filter=not_compliant"
}

const openPro = (ctx: TourContext) => {
  const id = ctx.params.get("pro")
  return id ? ctx.data.pros.find((p) => p.id === id && p.supplierId === "metro") : undefined
}

/** A document Metro cleared during the tour, once Iris has recorded it. */
const verifiedSince = (ctx: TourContext, ids: RequirementId[]) => {
  for (const pro of ctx.data.pros) {
    if (pro.supplierId !== "metro") continue
    for (const id of ids) {
      const v = pro.compliance[id]?.verification
      if (v?.result === "verified" && v.at >= ctx.base.at) return { pro, v }
    }
  }
  return undefined
}

/** Where the player clicks next on the way to a document: the tab, the worker, then the document. */
const docTarget = (ctx: TourContext, doc: RequirementId, pick: (data: DemoData) => Pro | undefined) => {
  if (openPro(ctx)) return one(`[data-tour="doc-action"][data-doc-id="${doc}"]`) ?? one('[role="dialog"] [role="tab"][data-value="documents"]')
  if (ctx.params.get("filter") !== "not_compliant") return one('[role="tab"][data-value="not_compliant"]')
  const pro = pick(ctx.data)
  return (pro && one(`tr[data-row-id="${pro.id}"]`)) || one("tbody tr[data-row-id]")
}

/** Opens the worker's documents and clears the one named, from wherever the player is. */
async function clearDoc(ctx: TourContext, api: TourApi, doc: RequirementId, pick: (data: DemoData) => Pro | undefined) {
  if (!openPro(ctx)) {
    const pro = pick(ctx.data)
    if (!pro) throw STOPPED
    const row = one(`tr[data-row-id="${pro.id}"]`)
    if (row) await press(row)
    else api.push(`/professionals?filter=not_compliant&pro=${pro.id}`)
  }
  const action = () => one(`[data-tour="doc-action"][data-doc-id="${doc}"]`)
  if (!action()) await press(await until(() => one('[role="dialog"] [role="tab"][data-value="documents"]'), 8000))
  await press(await until(action, 8000))
}

const DROPZONE = '[data-tour="cert-dropzone"]'
const CERT_UPLOAD = '[data-tour="cert-upload"]'

/** Drops a photo of the worker's new card into the open upload, as if the agency had it from them. */
async function dropCert(ctx: TourContext) {
  const input = one("input[data-cert-file]")
  const pro = openPro(ctx) ?? certPro(ctx.data)
  if (!(input instanceof HTMLInputElement) || !pro) throw STOPPED
  const zone = one(DROPZONE)
  if (zone) await point(zone)
  const files = new DataTransfer()
  files.items.add(certificateFile(pro, input.dataset.certFile as RequirementId, todayISO()))
  input.files = files.files
  input.dispatchEvent(new Event("change", { bubbles: true }))
  restCursor()
  return null
}

/* -------------------------------- Timesheets ------------------------------- */

const SCAN = '[data-tour="scan-sheet"]'
const CHAT_OPEN = '[data-tour="agent-chat-open"]'

/** The sheet's updates are saved but may not have reached the page yet. */
const justScanned = () => [...document.querySelectorAll("[data-sonner-toast]")].some((t) => t.textContent?.includes("from the sheet"))

const approveAsk = () => "Approve this week's timesheets"

/** Levy timesheets approved as they were billed during the tour. A corrected one counts as the fix, not the batch. */
const hoursApproved = (ctx: TourContext) =>
  ctx.data.timesheets.filter((t) => {
    if (t.buyerId !== "levy-chi") return false
    const since = t.history.filter((h) => h.at >= ctx.base.at)
    return since.some((h) => h.action === "approved") && !since.some((h) => h.action === "corrected")
  }).length

const scannedSince = (ctx: TourContext) =>
  ctx.data.timesheets.filter((t) => t.supplierId === "harbor" && t.history.some((h) => h.at >= ctx.base.at && `${h.note ?? ""} ${h.reason ?? ""}`.includes("sign-in sheet"))).length

const sheetOwner = (ctx: TourContext, t: Timesheet | undefined) => {
  const pro = t && ctx.data.pros.find((p) => p.id === t.proId)
  return pro ? `${pro.firstName}'s timesheet` : "the timesheet"
}

const newestFirst = (a: Timesheet, b: Timesheet) => b.date.localeCompare(a.date) || b.scheduledStart.localeCompare(a.scheduledStart)

const SHEET = '[data-tour="timesheet-sheet"]'
const MOVE = '[data-tour="move-dialog"]'
const LABOR = '[data-tour="labor-flags"]'
const TIPS_FILE = "levy_bar_tips.csv"
/** What each bartender's share of the pooled tips came to, so the sheet reads like a real night. */
const TIP_SHARES = [168.5, 152, 139.75, 121.25, 134.5, 147]

/** A file waits in Agent Chat's composer for the player's Enter. */
const attached = () => one("[data-agent-attached]")

/** Drops a spreadsheet into Agent Chat's composer, leaving Enter for the player. */
async function attachFile(name: string, csv: string) {
  const input = last("input[data-agent-file]")
  if (!(input instanceof HTMLInputElement)) throw STOPPED
  const box = document.getElementById(CHAT_COMPOSER_ID)
  if (box) await point(box)
  const files = new DataTransfer()
  files.items.add(new File([csv], name, { type: "text/csv" }))
  input.files = files.files
  input.dispatchEvent(new Event("change", { bubbles: true }))
  await until(attached, 4000)
  restCursor()
  return sendButton(CHAT_COMPOSER_ID)
}

/** Last night's bar crew at Levy: the parking is for them, then the tips. */
const crewGroup = (ctx: TourContext) => tipGroup(ctx)
const crewHref = (ctx: TourContext) => {
  const g = crewGroup(ctx)
  return g ? `/timesheets?shift=${g.id}&filter=all` : "/timesheets"
}
const crewAsk = (ctx: TourContext) => {
  const g = crewGroup(ctx)
  return `Add a $25 parking expense for each worker on ${g ? `the ${location(g.locationId).name} shift` : "this shift"}`
}
/** Iris's confirmation once the expenses are on their timesheets. */
const expensesAdded = (ctx: TourContext) => ctx.thread.find((m) => m.from === "agent" && /^Added \$/.test(m.text) && /\bat cost\b/.test(m.text))?.text.split(". ")[0]

/** Last night's Levy bar shifts the agencies sent, with every hour matching the clock: the crew the tips are for. Approving the week first keeps them. */
const tipShifts = (data: DemoData) =>
  data.groups
    .filter((g) => g.buyerId === "levy-chi" && g.badges.includes("TIPS") && groupPhase(g) === "past")
    .map((g) => ({ g, sheets: data.timesheets.filter((t) => t.groupId === g.id && t.status !== "removed" && t.clockIn && t.clockOut) }))
    .filter(
      ({ sheets }) =>
        sheets.length >= 2 &&
        sheets.some((t) => !t.tips) &&
        sheets.every((t) => (t.status === "pending_approval" || t.status === "approved") && tippable(data, t) && !t.movedFrom && !t.movedTo && !timesheetChecks(t).length),
    )
    .sort((a, b) => b.g.date.localeCompare(a.g.date) || b.g.end.localeCompare(a.g.end))
    .map(({ g }) => g)

const tipGroup = (ctx: TourContext) => tipShifts(ctx.data)[0] ?? tipShift(ctx.data, "levy-chi", todayISO())?.group

const tipsHref = (ctx: TourContext) => {
  const g = tipGroup(ctx)
  return g ? `/timesheets?shift=${g.id}` : "/timesheets"
}

/** The night's tips sheet: each worker's share of the pool. */
const tipSheets = (ctx: TourContext) => {
  const g = tipGroup(ctx)
  return g ? ctx.data.timesheets.filter((t) => t.groupId === g.id && t.status !== "removed" && t.clockIn && t.clockOut) : []
}
const attachTips = (ctx: TourContext) => {
  const g = tipGroup(ctx)
  const rows = tipSheets(ctx).map((t, i) => ({ shift_group_id: g?.code ?? "", pro_id: ctx.data.pros.find((p) => p.id === t.proId)?.code ?? "", tip_amount: TIP_SHARES[i % TIP_SHARES.length].toFixed(2) }))
  return attachFile(TIPS_FILE, toCsv(rows, ["shift_group_id", "pro_id", "tip_amount"]))
}
const tipsAdded = (ctx: TourContext) => ctx.thread.find((m) => m.from === "agent" && /^Added \$[\d,.]+ in tips/.test(m.text))?.text.replace(/\.$/, "")
const approveHours = () => last('[data-tour="agent-approve-timesheets"]')
/** Iris has laid out the week's hours, or the player is already past them. */
const hoursPlan = (ctx: TourContext) => offers(ctx, "approve-timesheets") || offers(ctx, "accept-proposal") || correctedSince(ctx) || hoursApproved(ctx) > 0
/** The timesheet billed above the clock still waits on its fix. */
const fixing = (ctx: TourContext) => hoursPlan(ctx) && !correctedSince(ctx) && !!proposalButton(ctx)

/** Last night's Harbor bartender billed above the clock, while it's still waiting for approval. */
const paddedSheet = (data: DemoData) =>
  data.timesheets
    .filter((t) => t.buyerId === "levy-chi" && t.status === "pending_approval" && timesheetChecks(t).some((c) => c.id === "above_clock"))
    .sort(newestFirst)[0]

const correctedSince = (ctx: TourContext) => ctx.data.timesheets.some((t) => t.buyerId === "levy-chi" && t.history.some((h) => h.action === "corrected" && h.at >= ctx.base.at))

/** Iris's fix in the chat for the timesheet billed above the clock, or else the first fix she offers. */
const proposalButton = (ctx: TourContext) => {
  const plan = last('[data-tour="agent-plan"]')
  const padded = paddedSheet(ctx.data)
  return (padded && plan?.querySelector(`[data-ts="${padded.id}"] [data-tour="agent-accept-proposal"]`)) || plan?.querySelector('[data-tour="agent-accept-proposal"]') || null
}


/**
 * A clean Levy timesheet on the first page of Needs approval, for a worker their agency also has another approved role
 * and rate for. A concessions worker who could have gone to the suites as a barback if there is one.
 */
const movable = (data: DemoData) => {
  const tipCrew = tipShifts(data)[0]?.id
  const pending = data.timesheets.filter((t) => t.buyerId === "levy-chi" && t.status === "pending_approval" && !t.movedFrom && !t.movedTo)
  const flaggedCount = pending.filter((t) => timesheetChecks(t).length).length
  const page = pending
    .filter((t) => !timesheetChecks(t).length)
    .sort(newestFirst)
    .slice(0, Math.max(0, 25 - flaggedCount))
    .filter((t) => t.groupId !== tipCrew)
  const options = page.flatMap((t) => {
    const pro = data.pros.find((p) => p.id === t.proId)
    if (!pro) return []
    const loc = location(t.locationId)
    return data.rateCards
      .filter((c) => c.supplierId === t.supplierId && c.cityId === loc.cityId && c.status === "active" && c.positionId !== t.positionId && canWork(pro, c.positionId, t.date, t.locationId).ok)
      .map((card) => ({ t, pro, card }))
  })
  return options.find((o) => o.t.positionId === "concessions" && o.card.positionId === "barback") ?? options[0]
}

/** The worker's timesheet, opened on arrival so the step starts at the split. */
const splitHref = (ctx: TourContext) => {
  const m = movable(ctx.data)
  return m ? `/timesheets?ts=${m.t.id}` : "/timesheets"
}

/** What the split step is about: the move dialog, the sheet's Split by role, or the worker's row. */
const splitTarget = (ctx: TourContext) => {
  if (one(MOVE)) return one(MOVE)
  if (one(SHEET)) return one('[data-tour="split-role"]')
  const m = movable(ctx.data)
  return m && one(`tr[data-row-id="${m.t.id}"]`)
}

/** Picks the role the step names, or else any other role the worker can move to. */
const pickRole = async (ctx: TourContext) => {
  const m = movable(ctx.data)
  const want = m ? position(m.card.positionId).name : "Barback"
  const rows = [...document.querySelectorAll<HTMLButtonElement>(`${MOVE} li button:not(:disabled, [data-current])`)]
  await press(rows.find((b) => b.textContent?.includes(want)) ?? rows[0])
}

const movedSince = (ctx: TourContext) => ctx.data.timesheets.find((t) => !!t.movedFrom && t.history.some((h) => h.action === "moved" && h.at >= ctx.base.at))

/* ------------------------------ Invoices, reports ------------------------------ */

/** The consolidated invoice the tour opens: the latest closed week with venue tips on it, the buyer's own when it's the buyer looking. */
const tourWeek = (data: DemoData, buyerId?: string) => {
  const today = todayISO()
  const weeks = data.invoiceGroups.filter((g) => !!g.week && g.invoiceIds.length > 0).sort((a, b) => b.week!.localeCompare(a.week!))
  const ids = new Set(data.invoices.filter((i) => (!buyerId || i.buyerId === buyerId) && i.lines.some((l) => l.tips > 0)).map((i) => i.id))
  const tipped = (g: (typeof weeks)[number]) => g.invoiceIds.some((id) => ids.has(id))
  const closed = weeks.filter((g) => addDaysISO(g.week!, 6) < today)
  return closed.find(tipped) ?? weeks.find(tipped) ?? closed[0] ?? weeks[0]
}

const GROUP = '[data-tour="group-detail"]'
const ACCRUALS = '[data-tour="accruals"]'
const ACCRUE_TAB = '[role="tab"][data-value="accrue"]'
const PREDICTIONS = '[data-tour="predictions"]'

/** Where Iris's latest answer links to its report. */
const reportLink = (ctx: TourContext) => {
  for (const m of [...ctx.thread].reverse()) for (const a of m.actions ?? []) if (a.kind === "link" && a.href.startsWith("/reports")) return a.href
  return undefined
}

const COMPOSER = (id = COMPOSER_ID) => document.getElementById(id)?.closest('[data-slot="input-group"]')
const REPORT_LINK = '[data-tour="agent-link"]'

/** Iris asks, reads her own answer for a beat, then opens the full report. */
async function askAndOpen(ctx: TourContext, api: TourApi) {
  await typeAsk(reportAsk())
  await press(sendButton())
  await until(() => reportLink(api.now()) && last(REPORT_LINK), 15000)
  await sleep(1400)
  await press(last(REPORT_LINK))
  return null
}

export const SCRIPT: TourItem[] = [
  { kind: "intro", id: "intro" },

  /* -------------------- 1. Rate cards and supplier sourcing -------------------- */
  {
    kind: "chapter",
    id: "chapter-rates",
    chapter: "rates",
    title: "Rate cards and supplier sourcing",
    wsId: COMPASS,
    href: `/procurement/${EVENT}`,
    shows: "Next year's renewal: which agency gets the most of your dollar to the worker, and Iris negotiating the rest.",
  },
  {
    kind: "step",
    id: "value",
    chapter: "rates",
    label: "Who pays workers the most",
    wsId: COMPASS,
    path: new RegExp(`^/procurement/${EVENT}$`),
    href: () => `/procurement/${EVENT}`,
    title: "Every agency, out of $100",
    body: (ctx) => {
      const [best, worst] = valueEnds(ctx)
      return best && worst
        ? `Of every $100, ${best.name} puts ${of100(best.worker)} in the worker's pocket and gives ${of100(best.back)} back. ${worst.name}: ${of100(worst.worker)} and ${of100(worst.back)}.`
        : "Of every $100 you pay, what reaches the worker, what the agency keeps, and what comes back to you."
    },
    targets: () => [one('[data-tour="bid-matrix"]')],
    placement: "bottom",
    skip: () => undefined,
  },
  {
    kind: "step",
    id: "negotiate",
    chapter: "rates",
    label: "Negotiate every bid",
    wsId: COMPASS,
    path: new RegExp(`^/procurement/${EVENT}`),
    href: () => `/procurement/${EVENT}`,
    title: (ctx) => (irisSent(ctx).length ? "Answers take a day or two" : "Every bid above the market, countered at once"),
    action: (ctx) => (irisSent(ctx).length ? "Watch the answers come in" : `Click ${one('[data-tour="negotiate"]')?.textContent?.trim() || "Send counters"}`),
    targets: () => [one('[data-tour="iris-negotiate"]')],
    clicks: () => one('[data-tour="negotiate"]'),
    placement: "left",
    status: (ctx) => (irisSent(ctx).length && !negotiated(ctx) ? `${answered(ctx)} of ${irisSent(ctx).length} answered` : undefined),
    done: negotiated,
    success: () => "Every agency answered",
    skip: async (_, api) => {
      if (!irisSent(api.now()).length) await press(one('[data-tour="negotiate"]'))
      await until(() => negotiated(api.now()), 30000)
    },
  },
  {
    kind: "step",
    id: "approve",
    chapter: "rates",
    needs: "negotiate",
    label: "Approve the best bids",
    wsId: COMPASS,
    path: new RegExp(`^/procurement/${EVENT}`),
    href: () => `/procurement/${EVENT}`,
    title: "Approve the best bids",
    body: "Approved bids go live on each agency's rate card.",
    action: () => (approveDialog() ? "Click Approve" : "Click Approve bids"),
    targets: () => (approveDialog() ? [approveButton()] : [one('[data-tour="approve-all"]')]),
    placement: "bottom",
    anchor: () => approveDialog(),
    done: (ctx) => approvedSince(ctx) > 0,
    success: (ctx) => `${plural(approvedSince(ctx), "bid")} approved. The new rates are live`,
    skip: async () => {
      if (!approveDialog()) await press(one('[data-tour="approve-all"]'))
      await sleep(500)
      await press(await until(() => approveButton()))
    },
  },

  /* ----------------------------- 2. Shift creation ----------------------------- */
  {
    kind: "chapter",
    id: "chapter-units",
    chapter: "shifts",
    title: "Shift creation",
    wsId: COMPASS,
    href: "/units",
    shows: "First the venue. Add one by hand, or the whole roster at once.",
  },
  {
    kind: "step",
    id: "unit",
    chapter: "shifts",
    label: "Add a cost center",
    wsId: COMPASS,
    path: /^\/units/,
    href: () => "/units",
    title: () => (one(FORM) ? "Set up Soldier Field" : "Every unit is a cost center"),
    body: () => (one(FORM) ? "From the ZIP, Iris finds the agencies and workers that can staff it." : "It files itself under its sector, with a cost center for each department."),
    action: () => (one(FORM) ? "Type the details in grey, then Add unit" : "Click Add a unit"),
    targets: (ctx) => [unitRow(ctx) ?? one('[data-tour="unit-summary"]') ?? one('[data-tour="add-unit"]')],
    clicks: () => (one(FORM) ? inside(FORM, SUBMIT) : one('[data-tour="add-unit"]')),
    placement: "bottom",
    done: (ctx) => !!newUnit(ctx) && !one(FORM),
    success: (ctx) => `${newUnit(ctx)?.name ?? "The unit"} filed under ${newUnit(ctx) ? buyer(newUnit(ctx)!.buyerId).name : "its buyer"}`,
    fill: {
      when: () => !!one(FORM) && !!(inside(FORM, SUBMIT) as HTMLButtonElement | null)?.disabled,
      run: fillUnit,
    },
    skip: async (_, api) => {
      if (!one(FORM)) api.push("/units/new")
      await until(() => one(FORM), 8000)
      await press(await fillUnit())
      await until(() => !one(FORM), 8000)
    },
  },
  {
    kind: "step",
    id: "units-sheet",
    chapter: "shifts",
    label: "Upload the roster",
    wsId: COMPASS,
    path: /^\/units/,
    href: () => "/units",
    // Filed stays up while the dialog closes after the import, so the card doesn't flash back to the sheet.
    title: (ctx) =>
      one('[data-tour="units-import"]') || sheetFiled(ctx) ? "Filed and checked" : one(UNITS_SHEET) ? "Compass's location roster" : "Or the whole roster at once",
    body: (ctx) =>
      one('[data-tour="units-import"]') || sheetFiled(ctx)
        ? "What it can't place is held back, with the reason."
        : one(UNITS_SHEET) || unitsAdded()
          ? undefined
          : "The file Compass keeps today.",
    action: (ctx) =>
      one('[data-tour="units-import"]')
        ? `Click ${one('[data-tour="units-import"]')?.textContent?.trim()}`
        : sheetFiled(ctx)
          ? undefined
          : one(UNITS_SHEET)
          ? "Click Read the sheet"
          : unitsAdded()
            ? undefined
            : "Click Upload a sheet",
    targets: () => [one(UNITS_SHEET) ?? one('[data-tour="units-upload"]')],
    clicks: () => (one(UNITS_SHEET) ? (one('[data-tour="units-import"]') ?? one('[data-tour="units-read"]')) : unitsAdded() ? undefined : one('[data-tour="units-upload"]')),
    placement: "right",
    done: (ctx) => sheetUnits(ctx).length > 0 && !one(UNITS_SHEET),
    success: (ctx) => `${plural(sheetUnits(ctx).length, "unit")} added, each with its cost centers`,
    // The closed dialog hands focus back to its button, where the next Enter would open it again.
    onDone: () => (document.activeElement as HTMLElement | null)?.blur(),
    skip: async () => {
      if (!one(UNITS_SHEET)) await press(one('[data-tour="units-upload"]'))
      if (!one('[data-tour="units-import"]')) await press(await until(() => one('[data-tour="units-read"]')))
      const add = await until(() => one('[data-tour="units-import"]'), 4000)
      await sleep(1200)
      await press(add)
    },
  },
  {
    kind: "chapter",
    id: "chapter-shifts",
    chapter: "shifts",
    title: "Shift creation",
    wsId: LEVY,
    href: "/",
    shows: "Then order shifts in a sentence, or send them to one agency.",
  },
  {
    kind: "step",
    id: "ask",
    chapter: "shifts",
    label: "Order in a sentence",
    wsId: LEVY,
    path: /^\/$/,
    href: () => "/",
    title: "Order in a sentence",
    action: "Send it with Enter",
    example: askExample,
    targets: () => [COMPOSER()],
    clicks: () => sendButton(),
    fill: { when: (ctx) => !hasDraft(ctx) && canAsk(ctx), run: () => typeAsk(askExample()) },
    placement: "top",
    done: (ctx) => hasDraft(ctx) || !!booked(ctx),
    success: () => "Draft ready",
    startsChat: true,
    skip: askFor(askExample, hasDraft),
  },
  {
    kind: "step",
    id: "create",
    chapter: "shifts",
    label: "Book the shifts",
    wsId: LEVY,
    path: /^\/$/,
    href: () => "/",
    title: "Check it, then book it",
    body: "Priced from the rate cards. The best offer sees it first.",
    action: "Click Create and send",
    targets: () => [last('[data-tour="agent-draft"]')],
    clicks: () => last('[data-tour="agent-create-shift"]'),
    placement: "right",
    done: (ctx) => !!booked(ctx),
    success: () => "Shifts posted",
    onDone: (_, api) => api.push("/shifts/new"),
    back: "ask",
    needs: "ask",
    skip: async (_, api) => {
      await press(last('[data-tour="agent-create-shift"]'))
      await until(() => booked(api.now()))
    },
  },
  {
    kind: "step",
    id: "one-agency",
    chapter: "shifts",
    label: "Send to one agency",
    wsId: LEVY,
    path: /^\/shifts\/new/,
    href: () => "/shifts/new",
    title: () => (one(DISPATCH) ? "One agency, workers by name" : "Or send it to one agency"),
    body: () => (one(DISPATCH) ? "Only that agency sees it. Named workers are booked first." : "Levy's usual order is filled in."),
    action: () =>
      !one(DISPATCH)
        ? "Click Review"
        : !oneAgency()
          ? "Click One agency"
          : !prosPicked()
            ? "Click Request workers by name, and pick two"
            : `Click ${one('[data-tour="booking-post"]')?.textContent?.trim() || "Post"}`,
    targets: () => (!one(DISPATCH) ? [one('[data-tour="booking-review"]')] : prosPicked() ? [one('[data-tour="booking-post"]'), one(DISPATCH)] : [one(DISPATCH)]),
    clicks: () =>
      !one(DISPATCH)
        ? one('[data-tour="booking-review"]')
        : !oneAgency()
          ? one(AGENCY_TAB)
          : !prosPicked()
            ? (one(`${DISPATCH} [data-tour="request-workers"]`) ?? one(DISPATCH))
            : one('[data-tour="booking-post"]'),
    placement: "left",
    done: (ctx) => !!requestedOrder(ctx),
    success: (ctx) => {
      const g = requestedOrder(ctx)
      const asked = new Set(g?.dispatch?.proIds ?? [])
      const placed = g ? g.slots.filter((s) => !!s.proId && asked.has(s.proId)).length : 0
      return placed ? `Booked ${plural(placed, "requested worker")}` : "Posted"
    },
    fill: {
      when: () => !!one(DISPATCH) && (!oneAgency() || prosPicked() < 2),
      run: async () => {
        await pickTwo()
        return one('[data-tour="booking-post"]')
      },
    },
    skip: async () => {
      if (!one(DISPATCH)) await press(one('[data-tour="booking-review"]'))
      await pickTwo()
      await press(one('[data-tour="booking-post"]'))
    },
  },

  /* --------------------- 3. Worker assignment and compliance --------------------- */
  {
    kind: "chapter",
    id: "chapter-workers",
    chapter: "workers",
    title: "Worker assignment and compliance",
    wsId: METRO,
    href: assignHref,
    shows: "Fill the shifts open to the agency. Only cleared workers get through.",
  },
  {
    kind: "step",
    id: "assign",
    chapter: "workers",
    label: "Assign workers",
    wsId: METRO,
    path: /^\/shifts\/(?!new$)[^/]+$/,
    href: assignHref,
    title: () => (one(ASSIGN) ? "Only cleared workers can be picked" : "A shift open to Metro"),
    body: () => (one(ASSIGN) ? "Anyone else shows why not." : "Metro assigns its workers here, or its own system does it through Iris's API."),
    action: () => (!one(ASSIGN) ? "Click Assign workers" : assignReady() ? `Click ${one(ASSIGN_SUBMIT)?.textContent?.trim() || "Assign"}` : "Pick a worker who's ready, then Assign"),
    targets: () => [one(ASSIGN) ?? one('[data-tour="assign"]')],
    clicks: () => (one(ASSIGN) ? one(ASSIGN_SUBMIT) : one('[data-tour="assign"]')),
    placement: "left",
    done: (ctx) => assignedSince(ctx) > 0,
    success: (ctx) => `${plural(assignedSince(ctx), "worker")} assigned and confirmed`,
    fill: { when: () => !!one(ASSIGN) && !assignReady(), run: pickReady },
    skip: async (ctx, api) => {
      if (!one(ASSIGN)) {
        if (!one('[data-tour="assign"]')) api.push(assignHref(ctx))
        await press(await until(() => one('[data-tour="assign"]'), 8000))
      }
      await until(() => one(ASSIGN))
      await sleep(300)
      await press(await pickReady())
      await until(() => assignedSince(api.now()) > 0, 8000)
    },
  },
  {
    kind: "step",
    id: "attest",
    chapter: "workers",
    label: "Attest work authorization",
    wsId: METRO,
    path: /^\/professionals$/,
    href: () => "/professionals?filter=not_compliant",
    title: (ctx) => (openPro(ctx) ? "Metro attests it, in one click" : "Off the schedule until it's fixed"),
    body: (ctx) => {
      if (openPro(ctx)) return "Iris records who attested it, and when."
      const pro = authPro(ctx.data)
      return pro ? `${pro.firstName}'s work authorization expired, so Iris won't place them.` : undefined
    },
    action: (ctx) => (openPro(ctx) ? "Click Attest" : `Open ${authPro(ctx.data)?.firstName ?? "the worker"}`),
    targets: (ctx) => [docTarget(ctx, "i9", authPro)],
    placement: "left",
    anchor: () => one('[data-tour="doc-action"]')?.closest('[role="dialog"]'),
    done: (ctx) => !!verifiedSince(ctx, ["i9"]),
    success: (ctx) => {
      const found = verifiedSince(ctx, ["i9"])
      return found && standingOf(found.pro) === "compliant" ? `Attested. ${found.pro.firstName} can work again` : "Attested"
    },
    onDone: (ctx, api) => api.push(verifyHref(ctx)),
    skip: async (ctx, api) => {
      await clearDoc(ctx, api, "i9", authPro)
      await until(() => verifiedSince(api.now(), ["i9"]), 8000)
    },
  },
  {
    kind: "step",
    id: "verify",
    chapter: "workers",
    label: "Verify a certification",
    wsId: METRO,
    path: /^\/professionals$/,
    href: verifyHref,
    title: (ctx) => (one(DROPZONE) ? "Upload the new card" : one(CERT_UPLOAD) ? "Iris reads it, then checks it" : openPro(ctx) ? "Upload it, Iris verifies it" : "Then a lapsed certification"),
    body: (ctx) => {
      const pro = openPro(ctx) ?? certPro(ctx.data)
      const doc = certOf(pro)
      if (one(CERT_UPLOAD)) return "Iris reads the card, then checks the number with the issuer."
      return pro && doc ? `${pro.firstName}'s ${DOC[doc]} expired. The agency uploads the new one and Iris verifies it.` : undefined
    },
    action: (ctx) => (one(DROPZONE) ? "Drop the card" : one(CERT_UPLOAD) ? undefined : openPro(ctx) ? "Click Upload" : `Open ${certPro(ctx.data)?.firstName ?? "the worker"}`),
    targets: (ctx) => [one(CERT_UPLOAD) ?? docTarget(ctx, certOf(openPro(ctx) ?? certPro(ctx.data)) ?? "foodHandler", certPro)],
    placement: "left",
    anchor: () => (one(CERT_UPLOAD) ?? one('[data-tour="doc-action"]'))?.closest('[role="dialog"]'),
    fill: { when: () => !!one(DROPZONE), run: dropCert },
    done: (ctx) => !!verifiedSince(ctx, CERTS),
    success: (ctx) => {
      const found = verifiedSince(ctx, CERTS)
      return found && standingOf(found.pro) === "compliant" ? `Verified. ${found.pro.firstName} can work again` : "Verified"
    },
    skip: async (ctx, api) => {
      if (!one(DROPZONE)) {
        const pro = openPro(ctx) ?? certPro(ctx.data)
        await clearDoc(ctx, api, certOf(pro) ?? "foodHandler", certPro)
        await until(() => one(DROPZONE), 8000)
      }
      await dropCert(api.now())
      await until(() => verifiedSince(api.now(), CERTS), 8000)
    },
  },

  /* --------------------------------- 4. Timesheets -------------------------------- */
  {
    kind: "chapter",
    id: "chapter-agency-hours",
    chapter: "timesheets",
    title: "Timesheets",
    wsId: HARBOR,
    href: "/timesheets",
    shows: "Agencies send hours. Then the venue splits a shift by role, sees break and overtime flags, and approves the week.",
  },
  {
    kind: "step",
    id: "paper",
    chapter: "timesheets",
    label: "Scan a paper sheet",
    wsId: HARBOR,
    path: /^\/timesheets/,
    href: () => "/timesheets",
    title: () => (one('[data-tour="scan-apply"]') || justScanned() ? "Matched to each worker on the shift" : one(SCAN) ? "Iris reads it" : "A venue that signs in on paper"),
    body: () => (one(SCAN) || justScanned() ? undefined : "Scan the sheet. Iris matches it to each worker."),
    action: () => (one('[data-tour="scan-apply"]') ? "Click Update" : justScanned() ? undefined : one(SCAN) ? "Click Read the sheet" : "Click Scan a sign-in sheet"),
    targets: () => (one(SCAN) ? [one(SCAN)] : [one('[data-tour="scan-sheet-open"]')]),
    clicks: () => (one(SCAN) ? (one('[data-tour="scan-apply"]') ?? one('[data-tour="scan-read"]')) : justScanned() ? undefined : one('[data-tour="scan-sheet-open"]')),
    placement: "right",
    done: (ctx) => scannedSince(ctx) > 0 && !one(SCAN),
    success: (ctx) => `Updated ${plural(scannedSince(ctx), "timesheet")} from the sheet`,
    // The closed dialog hands focus back to its button, where the next Enter would open it again.
    // Its toast would sit over the button the next step points at.
    onDone: () => {
      ;(document.activeElement as HTMLElement | null)?.blur()
      toast.dismiss()
    },
    skip: async () => {
      if (!one(SCAN)) await press(one('[data-tour="scan-sheet-open"]'))
      if (!one('[data-tour="scan-apply"]')) await press(await until(() => one('[data-tour="scan-read"]')))
      const apply = await until(() => one('[data-tour="scan-apply"]'), 4000)
      await sleep(1200)
      await press(apply)
    },
  },
  {
    kind: "step",
    id: "split",
    chapter: "timesheets",
    label: "Split a shift by role",
    wsId: LEVY,
    path: /^\/timesheets/,
    href: splitHref,
    title: () => (one(MOVE) ? "Pick the role and when they switched" : "Someone switched roles mid-shift"),
    body: (ctx) => {
      if (one(MOVE)) return "Each part bills at its own rate, to its department's cost center."
      const m = movable(ctx.data)
      return m ? `${m.pro.firstName} went from ${position(m.t.positionId).name.toLowerCase()} to ${position(m.card.positionId).name.toLowerCase()} partway through.` : undefined
    },
    action: (ctx) => (one(MOVE) ? "Pick a role and a time, then Move" : one(SHEET) ? "Click Split by role" : `Open ${sheetOwner(ctx, movable(ctx.data)?.t)}`),
    targets: (ctx) => [splitTarget(ctx)],
    clicks: (ctx) => (one(MOVE) ? one('[data-tour="move-submit"]') : splitTarget(ctx)),
    placement: "left",
    anchor: () => (one(MOVE) ? undefined : one(SHEET)),
    done: (ctx) => !!movedSince(ctx),
    success: (ctx) => {
      const t = movedSince(ctx)
      return t?.movedFrom ? `Split in two: ${position(t.movedFrom.positionId).name}, then ${position(t.positionId).name}` : "Split by role"
    },
    onDone: (_, api) => api.push("/timesheets"),
    fill: {
      when: () => !!one(MOVE),
      run: async (ctx) => {
        await pickRole(ctx)
        return one('[data-tour="move-submit"]')
      },
    },
    skip: async (ctx, api) => {
      if (!one(SHEET)) {
        const m = movable(ctx.data)
        if (!m) return
        const row = one(`tr[data-row-id="${m.t.id}"]`)
        if (row) await press(row)
        else api.push(`/timesheets?ts=${m.t.id}`)
      }
      if (!one(MOVE)) await press(await until(() => one('[data-tour="split-role"]')))
      await until(() => one(MOVE))
      await sleep(400)
      await pickRole(api.now())
      await press(one('[data-tour="move-submit"]'))
    },
  },
  {
    kind: "step",
    id: "labor",
    chapter: "timesheets",
    label: "Breaks and overtime",
    wsId: LEVY,
    path: /^\/timesheets/,
    href: () => "/timesheets",
    title: "Breaks and overtime, flagged early",
    body: "Every shift checked against its state's meal-break rule, and every week against 40 hours, booked shifts included.",
    targets: () => [one(LABOR)],
    clicks: () => null,
    placement: "bottom",
    skip: async (_, api) => {
      api.push("/timesheets")
      await until(() => one(LABOR), 8000)
    },
  },
  {
    kind: "step",
    id: "approve-week",
    chapter: "timesheets",
    label: "Approve the week",
    wsId: LEVY,
    path: /^\/timesheets/,
    href: () => "/timesheets",
    startsChat: true,
    opensChat: true,
    title: (ctx) => (!hoursPlan(ctx) ? "Then approve the week in a sentence" : fixing(ctx) ? "What doesn't match comes first" : "Then the rest in one click"),
    body: (ctx) => (fixing(ctx) ? "Iris checks every timesheet against the clock, and proposes the clock's hours." : undefined),
    action: (ctx) => {
      if (!hoursPlan(ctx)) return COMPOSER(CHAT_COMPOSER_ID) ? "Send it with Enter" : "Click Agent Chat"
      if (!fixing(ctx)) return `Click ${approveHours()?.textContent?.trim() || "Approve"}`
      const hrs = proposalButton(ctx)?.textContent?.trim()
      const row = proposalButton(ctx)?.closest('[data-tour="agent-flag"]')
      const name = row?.querySelector(".font-semibold")?.textContent?.split(" ")[0]
      return hrs ? `Click ${hrs}${name ? ` for ${name}` : ""}` : "Click the proposed hours"
    },
    example: (ctx) => (hoursPlan(ctx) ? undefined : approveAsk()),
    targets: (ctx) => [hoursPlan(ctx) ? last('[data-tour="agent-plan"]') : (COMPOSER(CHAT_COMPOSER_ID) ?? one(CHAT_OPEN))],
    clicks: (ctx) => (!hoursPlan(ctx) ? (sendButton(CHAT_COMPOSER_ID) ?? one(CHAT_OPEN)) : fixing(ctx) ? proposalButton(ctx) : approveHours()),
    fill: { when: (ctx) => !hoursPlan(ctx) && canAsk(ctx, CHAT_COMPOSER_ID), run: () => typeAsk(approveAsk(), CHAT_COMPOSER_ID) },
    placement: "left",
    done: (ctx) => hoursApproved(ctx) > 0 && !fixing(ctx),
    success: (ctx) => (correctedSince(ctx) ? `Corrected to the clock, and ${plural(hoursApproved(ctx), "timesheet")} approved` : `${plural(hoursApproved(ctx), "timesheet")} approved`),
    skip: async (ctx, api) => {
      if (!hoursPlan(ctx)) {
        if (!COMPOSER(CHAT_COMPOSER_ID)) await press(one(CHAT_OPEN))
        await askFor(approveAsk, (now) => offers(now, "approve-timesheets") || offers(now, "accept-proposal"), CHAT_COMPOSER_ID)(ctx, api)
      }
      if (fixing(api.now())) {
        await press(proposalButton(api.now()))
        await until(() => correctedSince(api.now()))
      }
      await press(await until(approveHours, 8000))
      await until(() => hoursApproved(api.now()) > 0)
    },
  },

  /* ------------------------------ 5. Tips and expenses ------------------------------ */
  {
    kind: "chapter",
    id: "chapter-extras",
    chapter: "extras",
    title: "Tips and expenses",
    wsId: LEVY,
    href: crewHref,
    shows: "The venue covers last night's crew parking, then adds their tips.",
  },
  {
    kind: "step",
    id: "expenses",
    chapter: "extras",
    label: "Add expenses",
    wsId: LEVY,
    path: /^\/timesheets/,
    href: crewHref,
    startsChat: true,
    opensChat: true,
    title: () => (enteringExpenses() ? "Iris adds it to the whole crew" : "Levy covered the crew's parking"),
    body: () =>
      enteringExpenses()
        ? "She selects the shift's timesheets and enters it once. At cost, approved with the hours."
        : "Say it once. When the amounts differ, attach a sheet instead.",
    example: (ctx) => (enteringExpenses() || expensesAdded(ctx) ? undefined : crewAsk(ctx)),
    action: () => {
      if (enteringExpenses()) return "Watch Iris add it"
      return COMPOSER(CHAT_COMPOSER_ID) ? "Send it with Enter" : "Click Agent Chat"
    },
    targets: () => (enteringExpenses() ? [one('[data-tour="bulk-expense-dialog"]') ?? one("table")] : [COMPOSER(CHAT_COMPOSER_ID) ?? one(CHAT_OPEN)]),
    clicks: () => (enteringExpenses() ? null : (sendButton(CHAT_COMPOSER_ID) ?? one(CHAT_OPEN))),
    fill: { when: (ctx) => !enteringExpenses() && !expensesAdded(ctx) && canAsk(ctx, CHAT_COMPOSER_ID), run: (ctx) => typeAsk(crewAsk(ctx), CHAT_COMPOSER_ID) },
    placement: "left",
    done: (ctx) => !!expensesAdded(ctx) && !enteringExpenses(),
    success: (ctx) => expensesAdded(ctx) ?? "Expenses added",
    skip: async (ctx, api) => {
      if (!COMPOSER(CHAT_COMPOSER_ID)) await press(one(CHAT_OPEN))
      await askFor(() => crewAsk(api.now()), (now) => !!expensesAdded(now), CHAT_COMPOSER_ID)(ctx, api)
    },
  },
  {
    kind: "step",
    id: "tips",
    chapter: "extras",
    label: "Add tips",
    wsId: LEVY,
    path: /^\/timesheets/,
    href: tipsHref,
    startsChat: true,
    opensChat: true,
    title: () => (enteringTips() ? "Iris enters each worker's tip" : attached() ? "Last night's tips, one row per worker" : "Then the same crew's tips"),
    body: (ctx) =>
      enteringTips()
        ? "Right on the timesheet, the way you would. No markup."
        : attached()
          ? `A share for each of the ${plural(tipSheets(ctx).length, "worker")}, ${money(tipSheets(ctx).reduce((sum, _, i) => sum + TIP_SHARES[i % TIP_SHARES.length], 0))} in all.`
          : "Drop the tips sheet in Agent Chat.",
    action: () => {
      if (enteringTips()) return "Watch Iris enter each tip"
      if (attached()) return "Send it with Enter"
      return COMPOSER(CHAT_COMPOSER_ID) ? "Attach the tips sheet" : "Click Agent Chat"
    },
    targets: () => (enteringTips() ? [...document.querySelectorAll('[data-tour="tip-input"]')] : [COMPOSER(CHAT_COMPOSER_ID) ?? one(CHAT_OPEN)]),
    clicks: () => (enteringTips() ? null : COMPOSER(CHAT_COMPOSER_ID) ? (attached() ? sendButton(CHAT_COMPOSER_ID) : null) : one(CHAT_OPEN)),
    fill: { when: (ctx) => !enteringTips() && !attached() && !tipsAdded(ctx) && canAsk(ctx, CHAT_COMPOSER_ID), run: attachTips },
    placement: "left",
    done: (ctx) => !!tipsAdded(ctx) && !enteringTips(),
    success: (ctx) => tipsAdded(ctx) ?? "Tips added",
    skip: async (_, api) => {
      if (!COMPOSER(CHAT_COMPOSER_ID)) await press(one(CHAT_OPEN))
      await until(() => COMPOSER(CHAT_COMPOSER_ID), 8000)
      if (!attached()) await attachTips(api.now())
      await press(sendButton(CHAT_COMPOSER_ID))
      await until(() => tipsAdded(api.now()), 30000)
    },
  },

  /* -------------------------- 6. Invoicing and accruals -------------------------- */
  {
    kind: "chapter",
    id: "chapter-invoicing",
    chapter: "invoicing",
    title: "Invoicing and accruals",
    wsId: COMPASS,
    href: "/invoices",
    shows: "One invoice a week for all of Compass, tips by venue, and what to accrue before it lands.",
  },
  {
    kind: "step",
    id: "weekly",
    chapter: "invoicing",
    label: "Open the weekly invoice",
    wsId: COMPASS,
    path: /^\/invoices(\/groups\/[^/]+)?$/,
    href: () => "/invoices",
    title: () => (one(GROUP) ? "Down to each cost center" : "One invoice a week for all of Compass"),
    body: (ctx) => {
      const g = tourWeek(ctx.data)
      return !one(GROUP) && g ? `${plural(g.invoiceIds.length, "agency invoice")}, one number to pay.` : undefined
    },
    action: (ctx) => {
      const g = tourWeek(ctx.data)
      return one(GROUP) ? undefined : `Open ${g?.code ?? "last week's invoice"}`
    },
    targets: (ctx) => {
      if (one(GROUP)) return [one('[data-tour="group-title"]')]
      const g = tourWeek(ctx.data)
      return [g && one(`tr[data-row-id="${g.id}"]`)]
    },
    placement: "right",
    skip: async (ctx, api) => {
      const g = tourWeek(ctx.data)
      if (g) api.push(`/invoices/groups/${g.id}`)
    },
  },
  {
    kind: "step",
    id: "invoice-tips",
    chapter: "invoicing",
    label: "Tips on the invoice",
    wsId: COMPASS,
    path: /^\/invoices\/groups\/[^/]+$/,
    href: (ctx) => {
      const g = tourWeek(ctx.data)
      return g ? `/invoices/groups/${g.id}` : "/invoices"
    },
    title: () => (one('[data-tour="venue-tips"]') ? "One line per venue and night" : "Tips, billed the way venues approve them"),
    body: () => (one('[data-tour="venue-tips"]') ? "Passed through with no markup. Hover for each worker's share." : undefined),
    action: () => (one('[data-tour="venue-tips"]') ? undefined : "Click Tips"),
    targets: () => {
      const rows = [...document.querySelectorAll('[data-tour="venue-tips"]')].slice(0, 3)
      return rows.length ? rows : [one(`${GROUP} [role="tab"][data-value="tips"]`)]
    },
    placement: "bottom",
    skip: () => press(one(`${GROUP} [role="tab"][data-value="tips"]`)),
  },
  {
    kind: "step",
    id: "accruals",
    chapter: "invoicing",
    label: "Review accruals",
    wsId: COMPASS,
    path: /^\/invoices$/,
    href: () => "/invoices?filter=accrue",
    title: () => (one(ACCRUALS) ? "To accrue, by cost center" : "Spend before the invoice lands"),
    body: () => (one(ACCRUALS) ? "Hours worked that no invoice covers yet. Pick a period, like last month, to book it." : undefined),
    action: () => (one(ACCRUALS) ? undefined : "Click Not invoiced yet"),
    targets: () => (one(ACCRUALS) ? [one(ACCRUALS), one('[data-tour="accrual-total"]')] : [one(ACCRUE_TAB)]),
    placement: "bottom",
    skip: () => press(one(ACCRUE_TAB)),
  },

  /* --------------------------------- 7. Reporting -------------------------------- */
  {
    kind: "chapter",
    id: "chapter-reporting",
    chapter: "reporting",
    title: "Reporting",
    wsId: COMPASS,
    href: "/",
    shows: "Any number, in a sentence. Then what Iris expects next.",
  },
  {
    kind: "step",
    id: "ask-report",
    chapter: "reporting",
    label: "Ask for a number",
    wsId: COMPASS,
    path: /^\/$/,
    href: () => "/",
    title: (ctx) => (reportLink(ctx) ? "Iris opens it as a report" : "Ask for any number"),
    body: (ctx) => (reportLink(ctx) ? "Same numbers, with every agency side by side. Your team gets it every Monday." : undefined),
    example: (ctx) => (reportLink(ctx) ? undefined : reportAsk()),
    action: (ctx) => (reportLink(ctx) ? "Watch Iris open the report" : "Send it with Enter"),
    targets: (ctx) => [(reportLink(ctx) && last(REPORT_LINK)) || COMPOSER()],
    clicks: (ctx) => (reportLink(ctx) ? last(REPORT_LINK) : sendButton()),
    fill: { when: (ctx) => !reportLink(ctx) && canAsk(ctx), run: askAndOpen },
    placement: "top",
    done: (ctx) => ctx.path.startsWith("/reports/"),
    success: () => "Your report",
    startsChat: true,
    skip: async (ctx, api) => {
      await askFor(reportAsk, (now) => !!reportLink(now))(ctx, api)
      api.push(reportLink(api.now()) ?? "/reports")
    },
  },
  {
    kind: "step",
    id: "forecast",
    chapter: "reporting",
    label: "See the forecast",
    wsId: COMPASS,
    path: /^\/$/,
    href: () => "/",
    title: "What Iris expects next",
    body: "A location whose last week ran above its normal week, and shifts in the next three days likely to start under 80% filled.",
    targets: () => [one(PREDICTIONS)],
    clicks: () => null,
    placement: "top",
    startsChat: true,
    skip: async (_, api) => {
      useAgentThreads.getState().clear(COMPASS)
      api.push("/")
      await until(() => one(PREDICTIONS), 8000)
    },
  },


  { kind: "finale", id: "finale" },
]

export const STEPS = SCRIPT.filter((item): item is TourStep => item.kind === "step")

export const indexOf = (id: string) => SCRIPT.findIndex((item) => item.id === id)

/** Where a part starts: its first card. */
export const startOf = (chapter: ChapterId) => SCRIPT.findIndex((item) => item.kind === "chapter" && item.chapter === chapter)
