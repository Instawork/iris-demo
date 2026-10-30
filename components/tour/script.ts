import { BadgeDollarSign, CalendarPlus, ChartColumn, Clock, MapPinned, ShieldCheck, UsersRound, type LucideIcon } from "lucide-react"
import { toast } from "sonner"

import { CHAT_COMPOSER_ID } from "@/components/agent/agent-chat"
import { useAgentThreads, type AgentMessage } from "@/components/agent/agent-store"
import { compose } from "@/components/agent/agent-thread"
import { COMPOSER_ID } from "@/components/home/agent-home"
import type { TourBase, TourPicks } from "@/hooks/use-tour"
import { canWork, requirementRows } from "@/lib/compliance"
import { addDaysISO, formatDay, formatMonth, todayISO } from "@/lib/dates"
import { fullName, money, plural } from "@/lib/format"
import { standingOf } from "@/lib/pro-profile"
import { buyer, location, position } from "@/lib/reference"
import { irisCounters } from "@/lib/sourcing"
import { timesheetChecks } from "@/lib/timesheets"
import { SAMPLE_UNIT_SHEET } from "@/lib/unit-sheet"
import type { DemoData, Pro, RequirementId, Timesheet } from "@/lib/types"
import { CHECKS } from "@/lib/verification"

/**
 * The guided demo: the core flows of a VMS, in the order Compass walks through them, each played as the person who does it. Nothing moves on until the
 * player clicks: "Do it for me" makes their next move on screen, typing a form in or clicking what the card points at.
 */

export type ChapterId = "units" | "shifts" | "assignments" | "compliance" | "timesheets" | "reporting" | "procurement"
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
  example?: (ctx: TourContext) => string
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
  /** Starts from an empty chat, so the answer it waits for is the one the player asks for. */
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
  href: string
  /** What this part does, in a few words. */
  shows: string
}

export type TourItem = { kind: "intro"; id: "intro" } | TourChapter | TourStep | { kind: "finale"; id: "finale" }

export const CHAPTER_ORDER: ChapterId[] = ["units", "shifts", "assignments", "compliance", "timesheets", "reporting", "procurement"]

export const CHAPTERS: Record<ChapterId, { number: number; label: string; short: string; icon: LucideIcon }> = {
  units: { number: 1, label: "Units and cost centers", short: "Units", icon: MapPinned },
  shifts: { number: 2, label: "Job postings", short: "Postings", icon: CalendarPlus },
  assignments: { number: 3, label: "Worker assignments", short: "Assignments", icon: UsersRound },
  compliance: { number: 4, label: "Worker compliance", short: "Compliance", icon: ShieldCheck },
  timesheets: { number: 5, label: "Timesheets", short: "Timesheets", icon: Clock },
  reporting: { number: 6, label: "Invoices and reporting", short: "Reporting", icon: ChartColumn },
  procurement: { number: 7, label: "Procurement", short: "Procurement", icon: BadgeDollarSign },
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
export const handedOff = () => (handoff?.isConnected ? handoff : undefined)
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

async function attach(root: string, name: string) {
  const input = inside(root, 'input[type="file"]')
  if (!(input instanceof HTMLInputElement)) throw STOPPED
  const files = new DataTransfer()
  files.items.add(new File(["Iris demo document"], name, { type: "application/pdf" }))
  input.files = files.files
  input.dispatchEvent(new Event("change", { bubbles: true }))
  await sleep(300)
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

/* ------------------------------- Compliance -------------------------------- */

const DOC: Record<RequirementId, string> = {
  background: "background check",
  i9: "I-9",
  orientation: "Compass orientation",
  foodHandler: "food handler card",
  alcohol: "alcohol server cert",
}

const BLOCKING = ["expired", "missing", "pending"]

const blocker = (pro?: Pro) => (pro ? requirementRows(pro).find((r) => BLOCKING.includes(r.state)) : undefined)

/** Metro's workers kept off shifts, expired documents first. */
const blockedPros = (data: DemoData) =>
  data.pros
    .filter((p) => p.supplierId === "metro" && standingOf(p) === "not_compliant")
    .map((pro) => ({ pro, expired: requirementRows(pro).some((r) => r.state === "expired") }))
    .sort((a, b) => Number(b.expired) - Number(a.expired) || fullName(a.pro).localeCompare(fullName(b.pro)))
    .map((x) => x.pro)

const openPro = (ctx: TourContext) => {
  const id = ctx.params.get("pro")
  return id ? ctx.data.pros.find((p) => p.id === id && p.supplierId === "metro") : undefined
}
const chosenPro = (ctx: TourContext): Pro | undefined => openPro(ctx) ?? blockedPros(ctx.data)[0]

const VERIFY = '[data-tour="verify-dialog"]'

/** The document Metro renewed during the tour, once Iris has checked it. */
const verifiedSince = (ctx: TourContext) => {
  for (const pro of ctx.data.pros) {
    if (pro.supplierId !== "metro") continue
    for (const item of Object.values(pro.compliance)) if (item?.verification?.result === "verified" && item.verification.at >= ctx.base.at) return { pro, v: item.verification }
  }
  return undefined
}

/** Where the player clicks next on the way to the expired document: the tab, the worker, then the document. */
const renewTarget = (ctx: TourContext) => {
  const pro = openPro(ctx)
  if (pro) {
    const doc = blocker(pro)
    const action = doc ? one(`[data-tour="doc-action"][data-doc-id="${doc.id}"]`) : one('[data-tour="doc-action"]')
    return action ?? one('[role="dialog"] [role="tab"][data-value="documents"]')
  }
  if (ctx.params.get("filter") !== "not_compliant") return one('[role="tab"][data-value="not_compliant"]')
  const first = chosenPro(ctx)
  return (first && one(`tr[data-row-id="${first.id}"]`)) || one("tbody tr[data-row-id]")
}

const askedIssuer = () => one(VERIFY)?.getAttribute("data-provider") ?? undefined

/** Attaches a certificate and ticks the attestation. A document Iris asks the issuer for is already one click. */
async function attest() {
  if (askedIssuer()) return one('[data-tour="verify-submit"]')
  const doc = one(VERIFY)?.getAttribute("data-doc-id") ?? "document"
  await attach(VERIFY, `${doc}.pdf`)
  await sleep(1100)
  const box = inside(VERIFY, 'button[role="checkbox"]')
  if (box?.getAttribute("aria-checked") !== "true") await press(box)
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

/** Picks the role the step names, or else any other role the worker can move to. */
const pickRole = async (ctx: TourContext) => {
  const m = movable(ctx.data)
  const want = m ? position(m.card.positionId).name : "Barback"
  const rows = [...document.querySelectorAll<HTMLButtonElement>(`${MOVE} li button:not(:disabled, [data-current])`)]
  await press(rows.find((b) => b.textContent?.includes(want)) ?? rows[0])
}

const movedSince = (ctx: TourContext) => ctx.data.timesheets.find((t) => !!t.movedFrom && t.history.some((h) => h.action === "moved" && h.at >= ctx.base.at))

/* ------------------------------ Invoices, reports ------------------------------ */

/** The latest month's consolidated invoice for all of Compass. */
const thisMonth = (data: DemoData) =>
  data.invoiceGroups.filter((g) => !!g.month && g.invoiceIds.length > 0).sort((a, b) => b.month!.localeCompare(a.month!))[0]

const GROUP = '[data-tour="group-detail"]'
const ACCRUALS = '[data-tour="accruals"]'
const ACCRUE_TAB = '[role="tab"][data-value="accrue"]'

/** Where Iris's latest answer links to its report. */
const reportLink = (ctx: TourContext) => {
  for (const m of [...ctx.thread].reverse()) for (const a of m.actions ?? []) if (a.kind === "link" && a.href.startsWith("/reports")) return a.href
  return undefined
}

const COMPOSER = (id = COMPOSER_ID) => document.getElementById(id)?.closest('[data-slot="input-group"]')

export const SCRIPT: TourItem[] = [
  { kind: "intro", id: "intro" },

  /* ------------------------- 1. Units and cost centers ------------------------ */
  {
    kind: "chapter",
    id: "chapter-units",
    chapter: "units",
    title: "Units and cost centers",
    wsId: COMPASS,
    href: "/units",
    shows: "Add a venue by hand, or the whole roster at once.",
  },
  {
    kind: "step",
    id: "unit",
    chapter: "units",
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
    chapter: "units",
    label: "Upload the roster",
    wsId: COMPASS,
    path: /^\/units/,
    href: () => "/units",
    title: () => (one('[data-tour="units-import"]') ? "Filed and checked" : one(UNITS_SHEET) ? "Compass's location roster" : "Or the whole roster at once"),
    body: () =>
      one('[data-tour="units-import"]') ? "What it can't place is held back, with the reason." : one(UNITS_SHEET) || unitsAdded() ? undefined : "The file Compass keeps today.",
    action: () =>
      one('[data-tour="units-import"]')
        ? `Click ${one('[data-tour="units-import"]')?.textContent?.trim()}`
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

  /* ------------------------------ 2. Job postings ----------------------------- */
  {
    kind: "chapter",
    id: "chapter-shifts",
    chapter: "shifts",
    title: "Job postings",
    wsId: LEVY,
    href: "/",
    shows: "Post shifts in a sentence.",
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
    fill: { when: canAsk, run: () => typeAsk(askExample()) },
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
    label: "Book it",
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

  /* --------------------------- 3. Worker assignments --------------------------- */
  {
    kind: "chapter",
    id: "chapter-assignments",
    chapter: "assignments",
    title: "Worker assignments",
    wsId: LEVY,
    href: "/shifts/new",
    shows: "Send it to one agency and ask for workers by name.",
  },
  {
    kind: "step",
    id: "one-agency",
    chapter: "assignments",
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

  /* ------------------------------ 4. Compliance ------------------------------ */
  {
    kind: "chapter",
    id: "chapter-compliance",
    chapter: "compliance",
    title: "Worker compliance",
    wsId: METRO,
    href: "/professionals?filter=not_compliant",
    shows: "Renew an expired document. Iris checks it with the issuer.",
  },
  {
    kind: "step",
    id: "renew",
    chapter: "compliance",
    label: "Renew a document",
    wsId: METRO,
    path: /^\/professionals$/,
    href: () => "/professionals?filter=not_compliant",
    title: (ctx) => (one(VERIFY) ? (askedIssuer() ? `Iris asks ${askedIssuer()}` : "Metro attests it. Iris checks it") : openPro(ctx) ? "Renew it" : "Expired means off the schedule"),
    body: (ctx) => {
      if (one(VERIFY)) return askedIssuer() ? `Nothing to upload. ${askedIssuer()} already has it.` : `Iris confirms it with ${CHECKS[(one(VERIFY)?.getAttribute("data-doc-id") as RequirementId) ?? "background"].providers[0]}.`
      if (openPro(ctx)) return undefined
      const pro = chosenPro(ctx)
      const doc = blocker(pro)
      return pro && doc ? `${pro.firstName}'s ${DOC[doc.id]} ${doc.state === "expired" ? "expired" : `is ${doc.state}`}, so Iris won't place them.` : undefined
    },
    action: (ctx) => (one(VERIFY) ? (askedIssuer() ? `Click Ask ${askedIssuer()}` : "Attach any file, tick the attestation, then Verify") : openPro(ctx) ? "Click the highlighted button" : "Open the highlighted worker"),
    fill: { when: () => inside(VERIFY, 'button[role="checkbox"]')?.getAttribute("aria-checked") === "false", run: attest },
    targets: (ctx) => [one(VERIFY) ?? renewTarget(ctx)],
    clicks: (ctx) => (one(VERIFY) ? one('[data-tour="verify-submit"]') : renewTarget(ctx)),
    placement: "left",
    anchor: () => (one(VERIFY) ? undefined : one('[data-tour="doc-action"]')?.closest('[role="dialog"]')),
    done: (ctx) => !!verifiedSince(ctx) && !one(VERIFY),
    success: (ctx) => {
      const found = verifiedSince(ctx)
      return found && standingOf(found.pro) === "compliant" ? `Verified with ${found.v.checkedWith}. ${found.pro.firstName} can work again` : `Verified with ${found?.v.checkedWith ?? "the issuer"}`
    },
    skip: async (ctx, api) => {
      let pro = openPro(ctx)
      if (!pro) {
        pro = chosenPro(ctx)
        if (!pro) return
        const row = one(`tr[data-row-id="${pro.id}"]`)
        if (row) await press(row)
        else api.push(`/professionals?filter=not_compliant&pro=${pro.id}`)
      }
      const doc = blocker(pro)
      if (!one(VERIFY)) await press(await until(() => (doc ? one(`[data-tour="doc-action"][data-doc-id="${doc.id}"]`) : one('[data-tour="doc-action"]'))))
      await until(() => one(VERIFY))
      await sleep(400)
      await press(await attest())
      await until(() => !one(VERIFY), 8000)
    },
  },

  /* ------------------------------ 5. Timesheets ------------------------------ */
  {
    kind: "chapter",
    id: "chapter-agency-hours",
    chapter: "timesheets",
    title: "Timesheets",
    wsId: HARBOR,
    href: "/timesheets",
    shows: "Agencies send hours already checked against the clock, and what they paid for the shift.",
  },
  {
    kind: "step",
    id: "paper",
    chapter: "timesheets",
    label: "Scan a paper sheet",
    wsId: HARBOR,
    path: /^\/timesheets/,
    href: () => "/timesheets",
    title: () => (one('[data-tour="scan-apply"]') || justScanned() ? "Matched to each worker on the shift" : one(SCAN) ? "Iris reads it" : "First, what doesn't match the clock"),
    body: () => (one(SCAN) || justScanned() ? undefined : "It's at the top. Here, a venue that still signs in on paper."),
    action: () => (one('[data-tour="scan-apply"]') ? "Click Update" : one(SCAN) ? "Click Read the sheet" : justScanned() ? undefined : "Click Scan a sign-in sheet"),
    targets: () => (one(SCAN) ? [one(SCAN)] : [one('[data-tour="scan-sheet-open"]')]),
    clicks: () => (one(SCAN) ? (one('[data-tour="scan-apply"]') ?? one('[data-tour="scan-read"]')) : justScanned() ? undefined : one('[data-tour="scan-sheet-open"]')),
    placement: "right",
    done: (ctx) => scannedSince(ctx) > 0 && !one(SCAN),
    success: (ctx) => `Updated ${plural(scannedSince(ctx), "timesheet")} from the sheet`,
    // The closed dialog hands focus back to its button, where the next Enter would open it again.
    // Its toast would sit over the button the next step points at.
    onDone: (ctx, api) => {
      ;(document.activeElement as HTMLElement | null)?.blur()
      toast.dismiss()
      api.push(parkingHref(ctx))
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
    id: "expense",
    chapter: "timesheets",
    label: "Bill an expense",
    wsId: HARBOR,
    path: /^\/timesheets/,
    href: parkingHref,
    title: () => (one(EXPENSE_FORM) ? "Parking, at cost" : "Then what it paid for the shift"),
    body: () => (one(EXPENSE_FORM) ? "No markup. The buyer approves it with the hours." : "Event parking, or a background check the event required."),
    action: () => (one(EXPENSE_FORM) ? `Enter $${PARKING}, then Add` : one(SHEET) ? "Click Add expense" : "Open the highlighted timesheet"),
    targets: (ctx) => {
      if (one(EXPENSE_FORM)) return [one(EXPENSE_FORM)]
      if (one(SHEET)) return [one('[data-tour="expense-add"]')]
      const t = parkingSheet(ctx.data)
      return [t && one(`tr[data-row-id="${t.id}"]`)]
    },
    clicks: () => (one(EXPENSE_FORM) ? inside(EXPENSE_FORM, '[data-tour="expense-save"]') : one('[data-tour="expense-add"]')),
    placement: "left",
    done: (ctx) => !!expenseSince(ctx),
    success: (ctx) => `${money(expenseSince(ctx)?.expenses?.at(-1)?.amount ?? Number(PARKING))} parking added`,
    onDone: (_, api) => api.push("/timesheets"),
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
    kind: "chapter",
    id: "chapter-timesheets",
    chapter: "timesheets",
    title: "Timesheets",
    wsId: LEVY,
    href: "/timesheets",
    shows: "Split a shift by role, then approve the week in one message.",
  },
  {
    kind: "step",
    id: "split",
    chapter: "timesheets",
    label: "Split by role",
    wsId: LEVY,
    path: /^\/timesheets/,
    href: () => "/timesheets",
    title: () => (one(MOVE) ? "Pick the role and when they switched" : one(SHEET) ? "Split it by role" : "Someone switched roles mid-shift"),
    body: (ctx) => {
      if (one(MOVE)) return "Each part bills at its own rate, to its department's cost center."
      if (one(SHEET)) return undefined
      const m = movable(ctx.data)
      return m ? `${m.pro.firstName} went from ${position(m.t.positionId).name.toLowerCase()} to ${position(m.card.positionId).name.toLowerCase()} partway through.` : undefined
    },
    action: () => (one(MOVE) ? "Pick a role and a time, then Move" : one(SHEET) ? "Click Split by role" : "Open the highlighted timesheet"),
    targets: (ctx) => {
      if (one(MOVE)) return [one(MOVE)]
      if (one(SHEET)) return [one('[data-tour="split-role"]')]
      const m = movable(ctx.data)
      return [m && one(`tr[data-row-id="${m.t.id}"]`)]
    },
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
    id: "approve-ask",
    chapter: "timesheets",
    label: "Approve in a sentence",
    wsId: LEVY,
    path: /^\/timesheets/,
    href: () => "/timesheets",
    title: "Then approve the week at once",
    action: () => (COMPOSER(CHAT_COMPOSER_ID) ? "Send it with Enter" : "Click Agent Chat"),
    example: approveAsk,
    targets: () => [COMPOSER(CHAT_COMPOSER_ID) ?? one(CHAT_OPEN)],
    clicks: () => sendButton(CHAT_COMPOSER_ID) ?? one(CHAT_OPEN),
    fill: { when: (ctx) => canAsk(ctx, CHAT_COMPOSER_ID), run: () => typeAsk(approveAsk(), CHAT_COMPOSER_ID) },
    placement: "left",
    done: (ctx) => offers(ctx, "approve-timesheets") || hoursApproved(ctx) > 0,
    success: () => "Checked against the clock",
    startsChat: true,
    skip: async (ctx, api) => {
      if (!COMPOSER(CHAT_COMPOSER_ID)) await press(one(CHAT_OPEN))
      await askFor(approveAsk, (now) => offers(now, "approve-timesheets"), CHAT_COMPOSER_ID)(ctx, api)
    },
  },
  {
    kind: "step",
    id: "fix",
    chapter: "timesheets",
    label: "Fix what doesn't match",
    wsId: LEVY,
    path: /^\/timesheets/,
    href: () => "/timesheets",
    title: "What doesn't match comes first",
    body: (ctx) => (proposalButton(ctx) ? "Iris proposes the clock's hours." : undefined),
    action: (ctx) => {
      const hrs = proposalButton(ctx)?.textContent?.trim()
      const row = proposalButton(ctx)?.closest('[data-tour="agent-flag"]')
      const name = row?.querySelector(".font-semibold")?.textContent?.split(" ")[0]
      return hrs ? `Click ${hrs}${name ? ` for ${name}` : ""}` : "Click the proposed hours"
    },
    targets: () => [last('[data-tour="agent-plan"]')],
    clicks: proposalButton,
    placement: "left",
    done: correctedSince,
    inChat: true,
    success: () => "Corrected to the clock and approved",
    back: "approve-ask",
    needs: "approve-ask",
    skip: async (ctx, api) => {
      await press(proposalButton(ctx))
      await until(() => correctedSince(api.now()))
    },
  },
  {
    kind: "step",
    id: "approve-hours",
    chapter: "timesheets",
    label: "Approve the rest",
    wsId: LEVY,
    path: /^\/timesheets/,
    href: () => "/timesheets",
    title: "Then the rest in one click",
    action: () => `Click ${last('[data-tour="agent-approve-timesheets"]')?.textContent?.trim() || "Approve"}`,
    targets: () => [last('[data-tour="agent-plan"]')],
    clicks: () => last('[data-tour="agent-approve-timesheets"]'),
    placement: "left",
    done: (ctx) => hoursApproved(ctx) > 0,
    inChat: true,
    success: (ctx) => `${plural(hoursApproved(ctx), "timesheet")} approved`,
    back: "approve-ask",
    needs: "fix",
    skip: async (_, api) => {
      await press(last('[data-tour="agent-approve-timesheets"]'))
      await until(() => hoursApproved(api.now()) > 0)
    },
  },

  /* ------------------------- 6. Invoices and reporting ------------------------ */
  {
    kind: "chapter",
    id: "chapter-reporting",
    chapter: "reporting",
    title: "Invoices and reporting",
    wsId: COMPASS,
    href: "/invoices",
    shows: "One invoice a month, and any number you ask for.",
  },
  {
    kind: "step",
    id: "monthly",
    chapter: "reporting",
    label: "Monthly invoice",
    wsId: COMPASS,
    path: /^\/invoices(\/groups\/[^/]+)?$/,
    href: () => "/invoices",
    title: () => (one(GROUP) ? "Down to each cost center" : "One invoice a month for all of Compass"),
    body: (ctx) => {
      const g = thisMonth(ctx.data)
      return !one(GROUP) && g ? `${plural(g.invoiceIds.length, "agency invoice")} in one.` : undefined
    },
    action: (ctx) => {
      const g = thisMonth(ctx.data)
      return one(GROUP) ? undefined : `Open ${g?.month ? formatMonth(g.month) : "this month"}`
    },
    targets: (ctx) => {
      if (one(GROUP)) return [one('[data-tour="group-title"]')]
      const g = thisMonth(ctx.data)
      return [g && one(`tr[data-row-id="${g.id}"]`)]
    },
    placement: "right",
    skip: async (ctx, api) => {
      const g = thisMonth(ctx.data)
      if (g) api.push(`/invoices/groups/${g.id}`)
    },
  },
  {
    kind: "step",
    id: "tips",
    chapter: "reporting",
    label: "Tips",
    wsId: COMPASS,
    path: /^\/invoices\/groups\/[^/]+$/,
    href: (ctx) => {
      const g = thisMonth(ctx.data)
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
    onDone: (_, api) => api.push("/invoices?filter=accrue"),
    skip: () => press(one(`${GROUP} [role="tab"][data-value="tips"]`)),
  },
  {
    kind: "step",
    id: "accruals",
    chapter: "reporting",
    label: "Accruals",
    wsId: COMPASS,
    path: /^\/invoices$/,
    href: () => "/invoices?filter=accrue",
    title: () => (one(ACCRUALS) ? "To accrue, by cost center" : "Spend before the invoice lands"),
    body: () => (one(ACCRUALS) ? "Hours worked that no invoice covers yet. Accounting books it at month end." : undefined),
    action: () => (one(ACCRUALS) ? undefined : "Click Not invoiced yet"),
    targets: () => (one(ACCRUALS) ? [one(ACCRUALS), one('[data-tour="accrual-total"]')] : [one(ACCRUE_TAB)]),
    placement: "bottom",
    onDone: (_, api) => api.push("/"),
    skip: () => press(one(ACCRUE_TAB)),
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
    fill: { when: canAsk, run: () => typeAsk(reportAsk()) },
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

  /* ------------------------------ 7. Procurement ----------------------------- */
  {
    kind: "chapter",
    id: "chapter-procurement",
    chapter: "procurement",
    title: "Procurement",
    wsId: COMPASS,
    href: `/procurement/${EVENT}`,
    shows: "Next year's rates, every agency's bids, countered at once.",
  },
  {
    kind: "step",
    id: "negotiate",
    chapter: "procurement",
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
    chapter: "procurement",
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
    chapter: "procurement",
    label: "Market rates",
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

  { kind: "finale", id: "finale" },
]

export const STEPS = SCRIPT.filter((item): item is TourStep => item.kind === "step")

export const indexOf = (id: string) => SCRIPT.findIndex((item) => item.id === id)

/** Where a part starts: its first card. */
export const startOf = (chapter: ChapterId) => SCRIPT.findIndex((item) => item.kind === "chapter" && item.chapter === chapter)
