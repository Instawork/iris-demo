import { BadgeDollarSign, CalendarPlus, ChartColumn, Clock, FileText, Layers, ShieldCheck, type LucideIcon } from "lucide-react"
import { toast } from "sonner"

import { CHAT_COMPOSER_ID } from "@/components/agent/agent-chat"
import { useAgentThreads, type AgentMessage } from "@/components/agent/agent-store"
import { compose } from "@/components/agent/agent-thread"
import { COMPOSER_ID } from "@/components/home/agent-home"
import type { TourBase, TourPicks } from "@/hooks/use-tour"
import { crewShift } from "@/lib/agent-agency"
import { tipShift } from "@/lib/agent-tips"
import { canWork, requirementRows } from "@/lib/compliance"
import { addDaysISO, formatDay, todayISO } from "@/lib/dates"
import { eligiblePros } from "@/lib/domain/core"
import { fullName, money, plural } from "@/lib/format"
import { filledCount, groupPhase, isOpenTo } from "@/lib/metrics"
import { standingOf } from "@/lib/pro-profile"
import { templateCsv } from "@/lib/csv"
import { buyer, location, position, workspace } from "@/lib/reference"
import { irisCounters } from "@/lib/sourcing"
import { timesheetChecks } from "@/lib/timesheets"
import { SAMPLE_UNIT_SHEET } from "@/lib/unit-sheet"
import type { DemoData, Pro, RequirementId, Timesheet } from "@/lib/types"

/**
 * The guided demo: the core flows of a VMS, in the order of Compass's working sessions, each played as the person who does it. Nothing moves on until the
 * player clicks: "Do it for me" makes their next move on screen, typing a form in or clicking what the card points at.
 */

export type ChapterId = "rates" | "shifts" | "workers" | "timesheets" | "invoicing" | "reporting" | "nuanced"
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
export const CHAPTER_ORDER: ChapterId[] = ["rates", "shifts", "workers", "timesheets", "invoicing", "reporting", "nuanced"]

export const CHAPTERS: Record<ChapterId, { number: number; label: string; short: string; icon: LucideIcon }> = {
  rates: { number: 1, label: "Rate cards and supplier sourcing", short: "Rate cards", icon: BadgeDollarSign },
  shifts: { number: 2, label: "Shift creation", short: "Shifts", icon: CalendarPlus },
  workers: { number: 3, label: "Worker assignment and compliance", short: "Workers", icon: ShieldCheck },
  timesheets: { number: 4, label: "Timesheets, tips and expenses", short: "Timesheets", icon: Clock },
  invoicing: { number: 5, label: "Invoicing and accruals", short: "Invoicing", icon: FileText },
  reporting: { number: 6, label: "Reporting", short: "Reporting", icon: ChartColumn },
  nuanced: { number: 7, label: "Nuanced features", short: "Nuanced", icon: Layers },
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

/** Bumped when the step changes or the tour ends, so Iris stops where she is. */
let pilot = 0
const STOPPED = new Error("Tour autopilot stopped")
export const stopPilot = () => {
  pilot++
  clearHandoff()
  restCursor(250)
}
export const pilotStopped = (error: unknown) => error === STOPPED

const sleep = (ms: number) => {
  const run = pilot
  return new Promise<void>((resolve, reject) => window.setTimeout(() => (run === pilot ? resolve() : reject(STOPPED)), ms))
}

/** Waits for the next screen, or gives up and hands the step back to the player. */
async function until<T>(find: () => T | null | undefined | false, ms = 5000): Promise<T> {
  const end = performance.now() + ms
  for (;;) {
    const found = find()
    if (found) return found
    if (performance.now() > end) throw STOPPED
    await sleep(80)
  }
}

/** Iris's cursor, drawn over the page while she works so everyone watching sees what she clicks. */
let cursor: HTMLElement | undefined
let cursorAt = { x: 0, y: 0 }
let resting = 0

const CURSOR = `<svg width="27" height="29" viewBox="0 0 22 24" aria-hidden="true"><path d="M3 2.5v16.2l4.3-4.1 2.9 6.4 2.9-1.3-2.8-6.3 6-.3z" fill="#16130f" stroke="#fff" stroke-width="1.6" stroke-linejoin="round"/></svg><span>Iris</span>`

const cursorEl = () => {
  if (cursor?.isConnected) return cursor
  cursor = document.createElement("div")
  cursor.setAttribute("data-tour-cursor", "")
  cursor.setAttribute("aria-hidden", "true")
  cursor.innerHTML = CURSOR
  document.body.append(cursor)
  return cursor
}

const moveCursor = (el: HTMLElement, x: number, y: number, ms: number) => {
  el.style.setProperty("--glide", `${ms}ms`)
  el.style.transform = `translate(${x}px, ${y}px)`
  cursorAt = { x, y }
}

function restCursor(after = 850) {
  window.clearTimeout(resting)
  resting = window.setTimeout(() => cursor?.removeAttribute("data-on"), after)
}

/** Glides the cursor onto an element, from the tour card's button if it isn't on screen yet. */
async function point(target: Element) {
  const c = cursorEl()
  window.clearTimeout(resting)
  const r = target.getBoundingClientRect()
  const to = { x: r.left + Math.min(r.width / 2, 140), y: r.top + Math.min(r.height / 2, 24) }
  if (!c.hasAttribute("data-on")) {
    const from = document.querySelector("[data-tour-do]")?.getBoundingClientRect()
    moveCursor(c, from ? from.left + from.width / 2 : window.innerWidth / 2, from ? from.top + from.height / 2 : window.innerHeight - 80, 0)
    c.getBoundingClientRect()
    c.setAttribute("data-on", "")
  }
  const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches
  const ms = still ? 0 : Math.round(Math.min(750, Math.max(300, 240 + Math.hypot(to.x - cursorAt.x, to.y - cursorAt.y) * 0.5)))
  moveCursor(c, to.x, to.y, ms)
  await sleep(ms + 60)
}

/** Types into a field a few letters at a time, through the field's own change handler. */
async function type(el: Element | null | undefined, value: string) {
  if (!(el instanceof HTMLInputElement)) throw STOPPED
  if (el.value === value) return
  const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set
  el.scrollIntoView({ block: "nearest" })
  await point(el)
  el.focus()
  const pace = value.length > 20 ? 22 : 38
  for (let i = 1; i <= value.length; i++) {
    setValue?.call(el, value.slice(0, i))
    el.dispatchEvent(new Event("input", { bubbles: true }))
    await sleep(pace)
  }
  await sleep(220)
}

/** Presses a button the way a person would: the cursor goes to it, it lights up for a moment, then clicks. */
async function press(el: Element | null | undefined) {
  if (!(el instanceof HTMLElement)) throw STOPPED
  el.scrollIntoView({ block: "nearest" })
  await point(el)
  const c = cursorEl()
  el.setAttribute("data-tour-press", "")
  c.setAttribute("data-down", "")
  try {
    await sleep(300)
  } finally {
    el.removeAttribute("data-tour-press")
    c.removeAttribute("data-down")
  }
  el.click()
  restCursor()
  await sleep(300)
}

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

const EVENT = "rfp-chi-27"
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

const VERIFY = '[data-tour="verify-dialog"]'

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

/** Opens the worker and the document's dialog, from wherever the player is. */
async function openDoc(ctx: TourContext, api: TourApi, doc: RequirementId, pick: (data: DemoData) => Pro | undefined) {
  if (!openPro(ctx)) {
    const pro = pick(ctx.data)
    if (!pro) throw STOPPED
    const row = one(`tr[data-row-id="${pro.id}"]`)
    if (row) await press(row)
    else api.push(`/professionals?filter=not_compliant&pro=${pro.id}`)
  }
  if (!one(VERIFY)) await press(await until(() => one(`[data-tour="doc-action"][data-doc-id="${doc}"]`), 8000))
  await until(() => one(VERIFY))
  await sleep(400)
}

const askedIssuer = () => one(VERIFY)?.getAttribute("data-provider") ?? undefined

/** Ticks the agency's attestation, leaving Attest for the player. */
async function tickAttest() {
  const box = inside(VERIFY, 'button[role="checkbox"]')
  if (box && box.getAttribute("aria-checked") !== "true") await press(box)
  return one('[data-tour="verify-submit"]')
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
const EXPENSE_FORM = '[data-tour="expense-form"]'
const PARKING = "20.00"

/** Last night's Harbor draft at the arena, where the agency paid for its workers' event parking. */
const parkingSheet = (data: DemoData) =>
  data.timesheets
    .filter((t) => t.supplierId === "harbor" && t.status === "draft" && t.clockIn && t.clockOut && !t.expenses?.length && location(t.locationId).kind !== "Stadium")
    .sort((a, b) => Number(b.locationId === "loc-wla") - Number(a.locationId === "loc-wla") || newestFirst(a, b))[0]

const expenseSince = (ctx: TourContext) =>
  ctx.data.timesheets.find((t) => t.supplierId === "harbor" && t.expenses?.some((e) => e.at >= ctx.base.at))

const parkingHref = (ctx: TourContext) => {
  const t = parkingSheet(ctx.data)
  return t ? `/timesheets?ts=${t.id}` : "/timesheets"
}

async function fillParking() {
  await type(inside(EXPENSE_FORM, '[data-tour="expense-amount"]'), PARKING)
  return inside(EXPENSE_FORM, '[data-tour="expense-save"]')
}

const EXPENSE_FILE = "harbor_expenses.csv"
const chatReview = () => last('[data-tour="agent-review"]')
const uploadSave = () => one('[data-tour="upload-save"]')
const expenseUpload = (ctx: TourContext) => ctx.data.uploads.find((u) => u.type === "expenses" && u.uploadedAt >= ctx.base.at && u.status.startsWith("completed"))

/** Drops Harbor's week of expenses into Agent Chat, built from its own unsubmitted shifts. */
async function attachExpenses(ctx: TourContext) {
  const input = last("input[data-agent-file]")
  if (!(input instanceof HTMLInputElement)) throw STOPPED
  const files = new DataTransfer()
  files.items.add(new File([templateCsv("expenses", ctx.data, workspace(HARBOR))], EXPENSE_FILE, { type: "text/csv" }))
  input.files = files.files
  input.dispatchEvent(new Event("change", { bubbles: true }))
  return until(chatReview, 8000)
}

/** Harbor's latest shift with timesheets it can still bill: the crew that paid for parking. */
const crewHref = (ctx: TourContext) => {
  const shift = crewShift(ctx.data, "harbor", todayISO())
  return shift ? `/shifts/${shift.group.id}` : "/shifts"
}
const crewAsk = () => "Add a $20 parking expense to everyone who worked this shift"
const crewButton = () => last('[data-tour="agent-add-expenses"]')
/** Iris's confirmation once the crew's expense is on their timesheets. */
const crewAdded = (ctx: TourContext) => ctx.thread.find((m) => m.from === "agent" && /^Added \$/.test(m.text))?.text.split(". ")[0]

/** Last night's Levy bar shifts the agencies sent, with no hours flagged and no tips yet: the first takes tips by hand, the next in a sentence. */
/** Tips don't count against a shift here, so the two tips steps land on the same one before and after the first adds them. */
const tipShifts = (data: DemoData) =>
  data.groups
    .filter((g) => g.buyerId === "levy-chi" && g.badges.includes("TIPS") && groupPhase(g) === "past")
    .map((g) => ({ g, sheets: data.timesheets.filter((t) => t.groupId === g.id && t.status !== "removed" && t.clockIn && t.clockOut) }))
    .filter(({ sheets }) => sheets.length >= 2 && sheets.every((t) => t.status === "pending_approval" && !t.invoiceId && !timesheetChecks(t).length))
    .sort((a, b) => b.g.date.localeCompare(a.g.date) || b.g.end.localeCompare(a.g.end))
    .map(({ g }) => g)

const tipsHref = (ctx: TourContext) => {
  const g = tipShifts(ctx.data)[0] ?? tipShift(ctx.data, "levy-chi", todayISO())?.group
  return g ? `/shifts/${g.id}` : "/shifts"
}

const TIPS_DIALOG = '[data-tour="tips-dialog"]'
const TIPS_POOL = "480"
/** The pool is split once each worker's box has an amount. */
const tipsSplit = () => [...(one(TIPS_DIALOG)?.querySelectorAll<HTMLInputElement>('input:not([data-tour="tips-pool"])') ?? [])].some((i) => !!i.value)
/** Tips on the shift open on screen. */
const tipsOnScreen = (ctx: TourContext) => {
  const id = /^\/shifts\/([^/]+)$/.exec(ctx.path)?.[1]
  return id ? ctx.data.timesheets.filter((t) => t.groupId === id).reduce((s, t) => s + t.tips, 0) : 0
}
const tipsAsk = () => "Split $600 in tips by hours for this shift"
const tipsButton = () => last('[data-tour="agent-set-tips"]')
const tipsAdded = (ctx: TourContext) => ctx.thread.find((m) => m.from === "agent" && /^Added \$[\d,.]+ in tips/.test(m.text))?.text.split(" on ")[0]
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
  const pending = data.timesheets.filter((t) => t.buyerId === "levy-chi" && t.status === "pending_approval" && !t.movedFrom && !t.movedTo)
  const flaggedCount = pending.filter((t) => timesheetChecks(t).length).length
  const page = pending
    .filter((t) => !timesheetChecks(t).length)
    .sort(newestFirst)
    .slice(0, Math.max(0, 25 - flaggedCount))
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
    shows: "Next year's rates: every agency's bid, countered at once, approved and benchmarked.",
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
    body: (ctx) => (irisSent(ctx).length ? "Sped up here so you can watch." : undefined),
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
    onDone: (_, api) => api.push("/procurement?tab=rates"),
    skip: async () => {
      if (!approveDialog()) await press(one('[data-tour="approve-all"]'))
      await sleep(500)
      await press(await until(() => approveButton()))
    },
  },
  {
    kind: "step",
    id: "coverage",
    chapter: "rates",
    label: "Compare market rates",
    wsId: COMPASS,
    path: /^\/procurement$/,
    href: () => "/procurement?tab=rates",
    title: () => (one('[data-tour="market-rates"]') ? "Every role, every market, one standard" : "Who has a rate where"),
    body: () => (one('[data-tour="market-rates"]') ? "Agencies price Compass's definition of each role, so every rate compares like for like." : undefined),
    action: () => (one('[data-tour="market-rates"]') ? undefined : "Click Market rates"),
    targets: () => [one('[data-tour="market-rates"]') ?? one('[role="tab"][data-value="rates"]')],
    placement: "top",
    skip: () => press(one('[role="tab"][data-value="rates"]')),
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
    title: (ctx) => (one(VERIFY) ? "Metro attests it" : openPro(ctx) ? "Work authorization is attested" : "Off the schedule until it's fixed"),
    body: (ctx) => {
      if (one(VERIFY)) return "Iris records who attested it, and when."
      if (openPro(ctx)) return "The agency redoes the I-9 as the employer."
      const pro = authPro(ctx.data)
      return pro ? `${pro.firstName}'s work authorization expired, so Iris won't place them.` : undefined
    },
    action: (ctx) => (one(VERIFY) ? "Tick the attestation, then Attest" : openPro(ctx) ? "Click Attest" : `Open ${authPro(ctx.data)?.firstName ?? "the worker"}`),
    fill: { when: () => inside(VERIFY, 'button[role="checkbox"]')?.getAttribute("aria-checked") === "false", run: tickAttest },
    targets: (ctx) => [one(VERIFY) ?? docTarget(ctx, "i9", authPro)],
    clicks: (ctx) => (one(VERIFY) ? one('[data-tour="verify-submit"]') : docTarget(ctx, "i9", authPro)),
    placement: "left",
    anchor: () => (one(VERIFY) ? undefined : one('[data-tour="doc-action"]')?.closest('[role="dialog"]')),
    done: (ctx) => !!verifiedSince(ctx, ["i9"]),
    success: (ctx) => {
      const found = verifiedSince(ctx, ["i9"])
      return found && standingOf(found.pro) === "compliant" ? `Attested. ${found.pro.firstName} can work again` : "Attested"
    },
    onDone: (ctx, api) => api.push(verifyHref(ctx)),
    skip: async (ctx, api) => {
      await openDoc(ctx, api, "i9", authPro)
      await press(await tickAttest())
      await until(() => !one(VERIFY), 8000)
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
    title: (ctx) => (one(VERIFY) ? `Iris asks ${askedIssuer() ?? "the issuer"}` : openPro(ctx) ? "Certifications are verified" : "Then a lapsed certification"),
    body: (ctx) => {
      if (one(VERIFY)) return `Nothing to upload. ${askedIssuer() ?? "The issuer"} already has the current one.`
      const pro = openPro(ctx) ?? certPro(ctx.data)
      const doc = certOf(pro)
      return pro && doc ? `${pro.firstName}'s ${DOC[doc]} expired. Iris checks with whoever issued it.` : undefined
    },
    action: (ctx) => {
      if (one(VERIFY)) return `Click Ask ${askedIssuer() ?? "the issuer"}`
      if (!openPro(ctx)) return `Open ${certPro(ctx.data)?.firstName ?? "the worker"}`
      return `Click ${docTarget(ctx, certOf(openPro(ctx)) ?? "foodHandler", certPro)?.textContent?.trim() || "Ask"}`
    },
    targets: (ctx) => [one(VERIFY) ?? docTarget(ctx, certOf(openPro(ctx) ?? certPro(ctx.data)) ?? "foodHandler", certPro)],
    clicks: (ctx) => (one(VERIFY) ? one('[data-tour="verify-submit"]') : docTarget(ctx, certOf(openPro(ctx) ?? certPro(ctx.data)) ?? "foodHandler", certPro)),
    placement: "left",
    anchor: () => (one(VERIFY) ? undefined : one('[data-tour="doc-action"]')?.closest('[role="dialog"]')),
    done: (ctx) => !!verifiedSince(ctx, CERTS),
    success: (ctx) => {
      const found = verifiedSince(ctx, CERTS)
      return found && standingOf(found.pro) === "compliant" ? `Verified with ${found.v.checkedWith}. ${found.pro.firstName} can work again` : `Verified with ${found?.v.checkedWith ?? "the issuer"}`
    },
    skip: async (ctx, api) => {
      const pro = openPro(ctx) ?? certPro(ctx.data)
      await openDoc(ctx, api, certOf(pro) ?? "foodHandler", certPro)
      await press(one('[data-tour="verify-submit"]'))
      await until(() => !one(VERIFY), 8000)
    },
  },

  /* ----------------------- 4. Timesheets, tips and expenses ----------------------- */
  {
    kind: "chapter",
    id: "chapter-agency-hours",
    chapter: "timesheets",
    title: "Timesheets, tips and expenses",
    wsId: HARBOR,
    href: (ctx) => parkingHref(ctx),
    shows: "Agencies add what they paid for a shift, on one timesheet or for the whole crew at once.",
  },
  {
    kind: "step",
    id: "expense",
    chapter: "timesheets",
    label: "Add an expense",
    wsId: HARBOR,
    path: /^\/timesheets/,
    href: parkingHref,
    title: () => (one(EXPENSE_FORM) ? "Parking, at cost" : "What Harbor paid for the shift"),
    body: () => (one(EXPENSE_FORM) ? "No markup. The buyer approves it with the hours." : "Event parking, or a background check the event required."),
    action: (ctx) => (one(EXPENSE_FORM) ? `Enter $${PARKING}, then Add` : one(SHEET) ? "Click Add expense" : `Open ${sheetOwner(ctx, parkingSheet(ctx.data))}`),
    targets: (ctx) => {
      if (one(EXPENSE_FORM)) return [one(EXPENSE_FORM)]
      if (one(SHEET)) return [one('[data-tour="expense-add"]')]
      const t = parkingSheet(ctx.data)
      return [t && one(`tr[data-row-id="${t.id}"]`)]
    },
    clicks: () => (one(EXPENSE_FORM) ? inside(EXPENSE_FORM, '[data-tour="expense-save"]') : one('[data-tour="expense-add"]')),
    // The button sits in the sheet's bottom bar, so a card beside it lands on top of the click.
    placement: "top",
    done: (ctx) => !!expenseSince(ctx),
    success: (ctx) => `${money(expenseSince(ctx)?.expenses?.at(-1)?.amount ?? Number(PARKING))} parking added`,
    fill: {
      when: () => !!one(EXPENSE_FORM) && !!(inside(EXPENSE_FORM, '[data-tour="expense-save"]') as HTMLButtonElement | null)?.disabled,
      run: fillParking,
    },
    skip: async (ctx, api) => {
      if (!one(SHEET)) api.push(parkingHref(ctx))
      if (!one(EXPENSE_FORM)) await press(await until(() => one('[data-tour="expense-add"]'), 8000))
      await until(() => one(EXPENSE_FORM))
      await press(await fillParking())
      await until(() => expenseSince(api.now()), 8000)
    },
  },
  {
    kind: "step",
    id: "crew-expense",
    chapter: "timesheets",
    label: "Or for the whole crew",
    wsId: HARBOR,
    path: /^\/shifts\/(?!new$)[^/]+$/,
    href: crewHref,
    startsChat: true,
    title: () => (crewButton() ? "Only what Harbor can still bill" : "Or the whole crew, in a sentence"),
    body: () => (crewButton() ? "Already submitted timesheets stay as they are." : undefined),
    action: () => {
      const add = crewButton()
      if (add) return `Click ${add.textContent?.trim()}`
      return COMPOSER(CHAT_COMPOSER_ID) ? "Send it with Enter" : "Click Agent Chat"
    },
    example: () => (crewButton() ? undefined : crewAsk()),
    targets: () => [crewButton()?.closest('[data-tour="agent-plan"]') ?? COMPOSER(CHAT_COMPOSER_ID) ?? one(CHAT_OPEN)],
    clicks: () => crewButton() ?? sendButton(CHAT_COMPOSER_ID) ?? one(CHAT_OPEN),
    fill: { when: (ctx) => !crewButton() && !crewAdded(ctx) && canAsk(ctx, CHAT_COMPOSER_ID), run: () => typeAsk(crewAsk(), CHAT_COMPOSER_ID) },
    placement: "left",
    done: (ctx) => !!crewAdded(ctx),
    success: (ctx) => crewAdded(ctx) ?? "Added",
    skip: async (ctx, api) => {
      if (!crewButton()) {
        if (!COMPOSER(CHAT_COMPOSER_ID)) await press(one(CHAT_OPEN))
        await askFor(crewAsk, () => !!crewButton(), CHAT_COMPOSER_ID)(ctx, api)
      }
      await press(await until(crewButton, 8000))
      await until(() => crewAdded(api.now()), 8000)
    },
  },
  {
    kind: "chapter",
    id: "chapter-timesheets",
    chapter: "timesheets",
    title: "Timesheets, tips and expenses",
    wsId: LEVY,
    href: (ctx) => tipsHref(ctx),
    shows: "Venues add tips and approve the week, by hand or in a sentence.",
  },
  {
    kind: "step",
    id: "tips",
    chapter: "timesheets",
    label: "Add tips",
    wsId: LEVY,
    path: /^\/shifts\/(?!new$)[^/]+$/,
    href: tipsHref,
    title: () => (tipsSplit() ? "Each worker's share" : one(TIPS_DIALOG) ? "Split the pool by hours" : "Tips, right on the shift"),
    body: () => (tipsSplit() ? "No markup. Approved with the hours." : one(TIPS_DIALOG) ? "Or type each worker's tip." : "Each worker's tip goes on their timesheet."),
    action: () => (tipsSplit() ? "Click Save tips" : one(TIPS_DIALOG) ? `Enter $${TIPS_POOL}, then Split by hours` : "Click Add tips"),
    targets: () => [one(TIPS_DIALOG) ?? one('[data-tour="tips-open"]')],
    clicks: () => (one(TIPS_DIALOG) ? one(tipsSplit() ? '[data-tour="tips-save"]' : '[data-tour="tips-split"]') : one('[data-tour="tips-open"]')),
    placement: "left",
    done: (ctx) => !one(TIPS_DIALOG) && tipsOnScreen(ctx) > 0,
    success: (ctx) => `${money(tipsOnScreen(ctx))} in tips added`,
    // The saved toast would sit over the agent's button the next step points at.
    onDone: () => toast.dismiss(),
    fill: {
      when: () => !!one(TIPS_DIALOG) && !tipsSplit() && !(inside(TIPS_DIALOG, '[data-tour="tips-pool"]') as HTMLInputElement | null)?.value,
      run: async () => {
        await type(inside(TIPS_DIALOG, '[data-tour="tips-pool"]'), TIPS_POOL)
        return inside(TIPS_DIALOG, '[data-tour="tips-split"]')
      },
    },
    skip: async (ctx, api) => {
      if (!one(TIPS_DIALOG)) await press(await until(() => one('[data-tour="tips-open"]'), 8000))
      await until(() => one(TIPS_DIALOG))
      if (!tipsSplit()) {
        await type(inside(TIPS_DIALOG, '[data-tour="tips-pool"]'), TIPS_POOL)
        await press(inside(TIPS_DIALOG, '[data-tour="tips-split"]'))
      }
      await press(await until(() => tipsSplit() && one('[data-tour="tips-save"]')))
      await until(() => tipsOnScreen(api.now()) > 0, 8000)
    },
  },
  {
    kind: "step",
    id: "tips-ask",
    chapter: "timesheets",
    label: "Or tips in a sentence",
    wsId: LEVY,
    path: /^\/shifts\/(?!new$)[^/]+$/,
    href: tipsHref,
    startsChat: true,
    title: () => (tipsButton() ? "Every worker's share, by hours" : "Or the whole pool, in a sentence"),
    action: () => {
      const add = tipsButton()
      if (add) return `Click ${add.textContent?.trim()}`
      return COMPOSER(CHAT_COMPOSER_ID) ? "Send it with Enter" : "Click Agent Chat"
    },
    example: () => (tipsButton() ? undefined : tipsAsk()),
    targets: () => [tipsButton()?.closest('[data-tour="agent-plan"]') ?? COMPOSER(CHAT_COMPOSER_ID) ?? one(CHAT_OPEN)],
    clicks: () => tipsButton() ?? sendButton(CHAT_COMPOSER_ID) ?? one(CHAT_OPEN),
    fill: { when: (ctx) => !tipsButton() && !tipsAdded(ctx) && canAsk(ctx, CHAT_COMPOSER_ID), run: () => typeAsk(tipsAsk(), CHAT_COMPOSER_ID) },
    placement: "left",
    done: (ctx) => !!tipsAdded(ctx),
    success: (ctx) => tipsAdded(ctx) ?? "Tips added",
    skip: async (ctx, api) => {
      if (!tipsButton()) {
        if (!COMPOSER(CHAT_COMPOSER_ID)) await press(one(CHAT_OPEN))
        await askFor(tipsAsk, () => !!tipsButton(), CHAT_COMPOSER_ID)(ctx, api)
      }
      await press(await until(tipsButton, 8000))
      await until(() => tipsAdded(api.now()), 8000)
    },
  },
  {
    kind: "step",
    id: "approve-week",
    chapter: "timesheets",
    label: "Approve in a sentence",
    wsId: LEVY,
    path: /^\/timesheets/,
    href: () => "/timesheets",
    startsChat: true,
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

  /* -------------------------- 5. Invoicing and accruals -------------------------- */
  {
    kind: "chapter",
    id: "chapter-invoicing",
    chapter: "invoicing",
    title: "Invoicing and accruals",
    wsId: COMPASS,
    href: "/invoices",
    shows: "One invoice a week for all of Compass, and what to accrue before it lands.",
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

  /* --------------------------------- 6. Reporting -------------------------------- */
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
    title: "Ask for any number",
    example: reportAsk,
    action: "Send it with Enter",
    targets: () => [COMPOSER()],
    clicks: () => sendButton(),
    fill: { when: (ctx) => !reportLink(ctx) && canAsk(ctx), run: () => typeAsk(reportAsk()) },
    placement: "top",
    done: (ctx) => !!reportLink(ctx),
    success: () => "Answered",
    startsChat: true,
    skip: askFor(reportAsk, (ctx) => !!reportLink(ctx)),
  },
  {
    kind: "step",
    id: "open-report",
    chapter: "reporting",
    label: "Open the report",
    wsId: COMPASS,
    path: /^\/$/,
    href: () => "/",
    title: "Open it as a report",
    body: "Same numbers, with every agency side by side. Your team gets it every Monday.",
    action: "Click Open the report",
    targets: () => [last('[data-tour="agent-link"]')],
    placement: "bottom",
    done: (ctx) => ctx.path.startsWith("/reports/"),
    success: () => "Your report",
    back: "ask-report",
    needs: "ask-report",
    skip: (ctx, api) => api.push(reportLink(ctx) ?? "/reports"),
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

  /* ------------------------------ 7. Nuanced features ------------------------------ */
  {
    kind: "chapter",
    id: "chapter-more-agency",
    chapter: "nuanced",
    title: "Nuanced features",
    wsId: HARBOR,
    href: "/timesheets",
    shows: "Hours from a paper sign-in sheet, and a week of expenses from a spreadsheet.",
  },
  {
    kind: "step",
    id: "paper",
    chapter: "nuanced",
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
    id: "expense-sheet",
    chapter: "nuanced",
    label: "Upload an expense sheet",
    wsId: HARBOR,
    path: /^\/timesheets/,
    href: () => "/timesheets",
    needs: "paper",
    startsChat: true,
    title: () => (uploadSave() ? "Matched to every shift" : "A week of expenses, from a sheet"),
    body: () => (uploadSave() ? "Billed at cost, with the hours." : chatReview() ? undefined : "Drop it in Agent Chat. Iris checks each row."),
    action: () => {
      const next = uploadSave() ?? chatReview()
      if (next) return `Click ${next.textContent?.trim()}`
      return COMPOSER(CHAT_COMPOSER_ID) ? "Attach Harbor's expense sheet" : "Click Agent Chat"
    },
    targets: () => [uploadSave() ?? chatReview() ?? COMPOSER(CHAT_COMPOSER_ID) ?? one(CHAT_OPEN)],
    clicks: () => uploadSave() ?? chatReview() ?? (COMPOSER(CHAT_COMPOSER_ID) ? null : one(CHAT_OPEN)),
    fill: { when: () => !!COMPOSER(CHAT_COMPOSER_ID) && !chatReview() && !uploadSave(), run: attachExpenses },
    placement: "left",
    anchor: () => uploadSave()?.closest('[role="dialog"]'),
    done: (ctx) => !!expenseUpload(ctx),
    success: (ctx) => expenseUpload(ctx)?.summary ?? "Expenses added",
    skip: async (_, api) => {
      if (!uploadSave() && !chatReview()) {
        if (!COMPOSER(CHAT_COMPOSER_ID)) await press(one(CHAT_OPEN))
        await until(() => COMPOSER(CHAT_COMPOSER_ID))
        await attachExpenses(api.now())
      }
      if (!uploadSave()) await press(await until(chatReview, 8000))
      await press(await until(uploadSave, 8000))
      await until(() => expenseUpload(api.now()), 8000)
    },
  },
  {
    kind: "chapter",
    id: "chapter-more-venue",
    chapter: "nuanced",
    title: "Nuanced features",
    wsId: LEVY,
    href: (ctx) => splitHref(ctx),
    shows: "A worker who switched roles mid-shift, and where tips land on the invoice.",
  },
  {
    kind: "step",
    id: "split",
    chapter: "nuanced",
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
    id: "invoice-tips",
    chapter: "nuanced",
    label: "Tips on the invoice",
    wsId: LEVY,
    path: /^\/invoices\/groups\/[^/]+$/,
    href: (ctx) => {
      const g = tourWeek(ctx.data, "levy-chi")
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

  { kind: "finale", id: "finale" },
]

export const STEPS = SCRIPT.filter((item): item is TourStep => item.kind === "step")

export const indexOf = (id: string) => SCRIPT.findIndex((item) => item.id === id)

/** Where a part starts: its first card. */
export const startOf = (chapter: ChapterId) => SCRIPT.findIndex((item) => item.kind === "chapter" && item.chapter === chapter)
