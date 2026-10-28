import { Building2, CalendarPlus, ChartColumn, Clock, ShieldCheck, type LucideIcon } from "lucide-react"

import type { AgentMessage } from "@/components/agent/agent-store"
import { compose } from "@/components/agent/agent-thread"
import { COMPOSER_ID } from "@/components/home/agent-home"
import type { TourBase, TourPicks } from "@/hooks/use-tour"
import { canWork, requirementRows } from "@/lib/compliance"
import { addDaysISO, formatDay, todayISO } from "@/lib/dates"
import { fullName, money, plural } from "@/lib/format"
import { benchmark } from "@/lib/market"
import { billingFindings, complianceScore, filledCount, groupPhase, isOpenTo, needsReview, billingToReview } from "@/lib/metrics"
import { standingOf } from "@/lib/pro-profile"
import { SUPPLIERS, location, position, supplier } from "@/lib/reference"
import { eligiblePros } from "@/lib/store"
import { clockHours, matchesClock, timesheetChecks, withAgency } from "@/lib/timesheets"
import type { DemoData, Pro, RequirementId, Timesheet } from "@/lib/types"
import { CHECKS } from "@/lib/verification"

/**
 * The guided demo: the core of a VMS in five parts, each played as the person who does it. Every step waits for the
 * player to do it, and "Do it for me" plays it through on screen, field by field, so it reads like a person did it.
 */

export type ChapterId = "onboarding" | "shifts" | "compliance" | "timesheets" | "reporting"
export type Placement = "top" | "bottom" | "left" | "right"

/** Everything a step needs to decide where it is and whether the player has done it. */
export interface TourContext extends TourPicks {
  path: string
  params: URLSearchParams
  wsId: string
  data: DemoData
  thread: AgentMessage[]
  base: TourBase
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
  placement?: Placement
  /** What the card sits beside when that isn't the target itself, like the sheet a target lives in. */
  anchor?: () => Element | null | undefined
  done?: (ctx: TourContext) => boolean
  status?: (ctx: TourContext) => string | undefined
  success?: (ctx: TourContext) => string
  /** Where to return when the target disappears, like a dialog the player closed. */
  back?: string
  /** Does the step for the player, on screen. */
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

export const CHAPTER_ORDER: ChapterId[] = ["onboarding", "shifts", "compliance", "timesheets", "reporting"]

export const CHAPTERS: Record<ChapterId, { number: number; label: string; short: string; icon: LucideIcon }> = {
  onboarding: { number: 1, label: "Onboarding and rates", short: "Onboarding", icon: Building2 },
  shifts: { number: 2, label: "Ordering shifts", short: "Ordering", icon: CalendarPlus },
  compliance: { number: 3, label: "Compliance", short: "Compliance", icon: ShieldCheck },
  timesheets: { number: 4, label: "Timesheets", short: "Timesheets", icon: Clock },
  reporting: { number: 5, label: "Invoices and reporting", short: "Reporting", icon: ChartColumn },
}

const LEVY = "ws-levy"
const COMPASS = "ws-compass"
const CREWLINE = "ws-crewline"
const METRO = "ws-metro"
const HARBOR = "ws-harbor"

const one = (selector: string) => document.querySelector(selector)
const last = (selector: string) => {
  const all = document.querySelectorAll(selector)
  return all[all.length - 1] ?? null
}
const later = (fn: () => void, ms = 120) => window.setTimeout(fn, ms)
const inside = (root: string | Element | null | undefined, selector: string) => (typeof root === "string" ? one(root) : root)?.querySelector(selector) ?? null
const buttonIn = (root: string | Element | null | undefined, text: string) =>
  [...((typeof root === "string" ? one(root) : root)?.querySelectorAll("button") ?? [])].find((b) => b.textContent?.trim() === text) ?? null
/* -------------------------------- Autopilot -------------------------------- */

/** Bumped when the step changes or the tour ends, so a "Do it for me" in progress stops where it is. */
let pilot = 0
const STOPPED = new Error("Tour autopilot stopped")
export const stopPilot = () => {
  pilot++
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

/** Types into a field a few letters at a time, through the field's own change handler. */
async function type(el: Element | null | undefined, value: string) {
  if (!(el instanceof HTMLInputElement)) throw STOPPED
  if (el.value === value) return
  const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set
  el.scrollIntoView({ block: "nearest" })
  el.focus()
  const pace = value.length > 20 ? 22 : 38
  for (let i = 1; i <= value.length; i++) {
    setValue?.call(el, value.slice(0, i))
    el.dispatchEvent(new Event("input", { bubbles: true }))
    await sleep(pace)
  }
  await sleep(220)
}

/** Presses a button the way a person would: it lights up for a moment, then clicks. */
async function press(el: Element | null | undefined) {
  if (!(el instanceof HTMLElement)) throw STOPPED
  el.scrollIntoView({ block: "nearest" })
  el.setAttribute("data-tour-press", "")
  try {
    await sleep(360)
  } finally {
    el.removeAttribute("data-tour-press")
  }
  el.click()
  await sleep(300)
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

/* -------------------------------- Onboarding ------------------------------- */

const UNIT = '[data-tour="unit-dialog"]'
const AGENCY = '[data-tour="agency-dialog"]'
const NEXT = '[data-tour="wizard-next"]'
const SUBMIT = '[data-tour="wizard-submit"]'
const DONE = '[data-tour="wizard-done"]'

const stageOf = (dialog: string) => one(dialog)?.getAttribute("data-stage") ?? undefined

const newUnit = (ctx: TourContext) => ctx.data.directory.locations[0]
const newAgency = (ctx: TourContext) => ctx.data.directory.suppliers[0]

interface StageCopy {
  title: string
  body?: string
  action: string
}

const UNIT_COPY: Record<string, StageCopy> = {
  Unit: { title: "Name it and give it a cost center", action: "Type Soldier Field and LEV-4450, then Next" },
  Location: { title: "Where it is", body: "From the ZIP, Iris finds the agencies that cover it.", action: "Type the address and ZIP in grey, then Next" },
  Roles: { title: "What it orders", action: "Click Food handler card for every role, then Next" },
  Departments: { title: "Departments, each with a cost center", body: "Concessions, bars and suites bill separately.", action: "Click Next" },
  Review: { title: "Add it", action: "Click Add unit" },
}

const unitCopy = (ctx: TourContext): StageCopy => {
  const stage = stageOf(UNIT)
  if (stage === "done") return { title: `${newUnit(ctx)?.name ?? "The unit"} is live`, action: "Click Done" }
  return UNIT_COPY[stage ?? ""] ?? { title: "Add a unit", body: "Each unit, and each department in it, bills to its own cost center.", action: "Click Add a unit" }
}

/** Plays a wizard stage by stage: fills what the stage asks for, then moves on once the dialog does. */
async function playWizard(dialog: string, open: string, fillIn: (stage: string) => Promise<void>) {
  if (!one(dialog)) {
    await press(one(open))
    await until(() => one(dialog))
  }
  for (let guard = 0; guard < 12; guard++) {
    const stage = stageOf(dialog)
    if (!stage) return
    if (stage === "done") {
      await sleep(900)
      await press(inside(dialog, DONE))
      return
    }
    await fillIn(stage)
    const button = inside(dialog, SUBMIT) ?? inside(dialog, NEXT)
    await press(button)
    await until(() => stageOf(dialog) !== stage, 6000)
  }
}

const toggleOn = async (root: string, text: string) => {
  const button = buttonIn(root, text)
  if (button && button.getAttribute("aria-pressed") !== "true") await press(button)
}

const AGENCY_COPY: Record<string, StageCopy> = {
  Agency: { title: "Who they are", body: "It can send workers and hours by CSV, API or both.", action: "Type the name, contact and email in grey, then Next" },
  Coverage: { title: "Where they work and what they staff", action: "Add Suite Attendant, then Next" },
  Paperwork: { title: "Insurance and the master agreement", action: "Tick Master services agreement signed, then Next" },
  Rates: { title: "Its rate card", body: "Rates start at the market. Markups over the 45% cap are blocked.", action: "Click Next" },
  Workers: { title: "Bring over its workers", body: "Iris checks each worker's documents as they arrive.", action: "Click Use a sample roster, then Next" },
  Review: { title: "Add it", action: "Click Add agency" },
}

const agencyCopy = (ctx: TourContext): StageCopy => {
  const stage = stageOf(AGENCY)
  if (stage === "done") {
    const sup = newAgency(ctx)
    const pros = sup ? ctx.data.pros.filter((p) => p.supplierId === sup.id) : []
    const waiting = pros.filter((p) => p.compliance.background?.status === "pending").length
    return {
      title: `${sup?.name ?? "The agency"} is on Iris`,
      body: `${plural(pros.length, "worker")} came over${waiting ? `; ${waiting} wait on a background check` : ""}.`,
      action: "Click Done",
    }
  }
  return AGENCY_COPY[stage ?? ""] ?? { title: "Add an agency", action: "Click Add an agency" }
}

/* ------------------------------- Procurement ------------------------------- */

const EVENT = "rfp-chi-27"
const event = (ctx: TourContext) => ctx.data.sourcing?.find((e) => e.id === EVENT)
const BARTENDER_ROW = '[data-tour="role-row"][data-position="bartender"]'
const bidRows = () => [...document.querySelectorAll('[role="dialog"] [data-tour="bid-row"][data-position="bartender"]')]
/** The highest bid on Bartender Compass can still counter. */
const counterable = () => bidRows().filter((row) => row.querySelector('[data-tour="counter"], [data-tour="send-counter"]')).pop()
const counteredSince = (ctx: TourContext) => event(ctx)?.messages.find((m) => m.from === "compass" && m.ask !== undefined && m.at >= ctx.base.at)
const approvedSince = (ctx: TourContext) => Object.values(event(ctx)?.approved ?? {}).filter((at) => at >= ctx.base.at).length
const approveDialog = () => [...document.querySelectorAll('[role="dialog"]')].find((d) => d.querySelector("h2")?.textContent?.trim() === "Approve bids")
const approveButton = () => [...(approveDialog()?.querySelectorAll("button") ?? [])].find((b) => /^Approve \d/.test(b.textContent?.trim() ?? ""))
const closeSheet = () => (one('[data-slot="sheet-content"] [data-slot="sheet-close"]') as HTMLElement | null)?.click()

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

const hasDraft = (ctx: TourContext) => ctx.thread.some((m) => m.actions?.some((a) => a.kind === "create-shift"))

/* ------------------------------- Compliance -------------------------------- */

/** An upcoming Levy shift released to Crewline that still has open spots, a West Loop bartender shift if there is one. */
const assignable = (data: DemoData) =>
  data.groups
    .filter((g) => g.buyerId === "levy-chi" && isOpenTo(g, "crewline") && groupPhase(g) === "upcoming" && !g.cancelledAt && filledCount(g) < g.slots.length)
    .sort(
      (a, b) =>
        Number(b.positionId === "bartender") - Number(a.positionId === "bartender") ||
        Number(location(b.locationId).name.includes("West Loop")) - Number(location(a.locationId).name.includes("West Loop")) ||
        a.date.localeCompare(b.date) ||
        a.start.localeCompare(b.start),
    )[0]

const shownGroup = (ctx: TourContext) => {
  const id = ctx.path.match(/^\/shifts\/(sg-\d+)$/)?.[1]
  return id ? ctx.data.groups.find((g) => g.id === id) : undefined
}

const ASSIGN_DIALOG = '[data-tour="assign-dialog"]'

const crewlineCheck = (ctx: TourContext) => {
  const g = shownGroup(ctx) ?? assignable(ctx.data)
  if (!g) return undefined
  const loc = location(g.locationId)
  const pool = ctx.data.pros.filter((p) => p.supplierId === "crewline" && p.cityId === loc.cityId && p.positionIds.includes(g.positionId))
  const ready = eligiblePros(ctx.data, g, "crewline").length
  const blocked = pool
    .map((p) => ({ p, check: canWork(p, g.positionId, g.date, g.locationId) }))
    .filter((x) => !x.check.ok)
    .sort((a, b) => b.p.rating - a.p.rating)[0]
  return { pool: pool.length, ready, blocked }
}

const assignedSince = (ctx: TourContext) => {
  const g = shownGroup(ctx)
  return !!g && g.slots.some((s) => !!s.proId && !!s.confirmedAt && s.confirmedAt >= ctx.base.at && ctx.data.pros.find((p) => p.id === s.proId)?.supplierId === "crewline")
}

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

/** Agencies with workers on the program, best roster first. */
const scored = (data: DemoData) =>
  SUPPLIERS.map((s) => ({ s, c: complianceScore(data, s.id) }))
    .filter((x) => x.c.active > 0)
    .sort((a, b) => b.c.score - a.c.score)

/* -------------------------------- Timesheets ------------------------------- */

const SCAN = '[data-tour="scan-sheet"]'

/** Harbor's timesheets still with Harbor, and the ones that match Iris's clock exactly. */
const harborDrafts = (data: DemoData) => {
  const mine = data.timesheets.filter((t) => t.supplierId === "harbor")
  const waiting = mine.filter(withAgency)
  return { waiting, matching: waiting.filter((t) => matchesClock(t, mine.filter((o) => o.proId === t.proId))) }
}

const scannedSince = (ctx: TourContext) =>
  ctx.data.timesheets.filter((t) => t.supplierId === "harbor" && t.history.some((h) => h.at >= ctx.base.at && `${h.note ?? ""} ${h.reason ?? ""}`.includes("sign-in sheet"))).length

const newestFirst = (a: Timesheet, b: Timesheet) => b.date.localeCompare(a.date) || b.scheduledStart.localeCompare(a.scheduledStart)

const SHEET = '[data-tour="timesheet-sheet"]'
const MOVE = '[data-tour="move-dialog"]'

/** Last night's Harbor bartender billed above the clock, while it's still waiting for approval. */
const paddedSheet = (data: DemoData) =>
  data.timesheets
    .filter((t) => t.buyerId === "levy-chi" && t.status === "pending_approval" && timesheetChecks(t).some((c) => c.id === "above_clock"))
    .sort(newestFirst)[0]

const correctedSince = (ctx: TourContext) => ctx.data.timesheets.some((t) => t.buyerId === "levy-chi" && t.history.some((h) => h.action === "corrected" && h.at >= ctx.base.at))

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

const movedSince = (ctx: TourContext) => ctx.data.timesheets.find((t) => !!t.movedFrom && t.history.some((h) => h.action === "moved" && h.at >= ctx.base.at))

/* ------------------------------ Invoices, reports ------------------------------ */

/** Waiting on Compass, the ones with hours billed above the clock first. */
const flagged = (data: DemoData) =>
  data.invoices
    .filter((i) => needsReview(data, i))
    .sort((a, b) => Number(billingToReview(data, b)) - Number(billingToReview(data, a)) || b.issuedOn.localeCompare(a.issuedOn) || b.number.localeCompare(a.number))

const shownInvoice = (ctx: TourContext) => {
  const id = ctx.path.match(/^\/invoices\/(inv-[\w-]+)$/)?.[1]
  return id ? ctx.data.invoices.find((i) => i.id === id) : undefined
}

const reviewedSince = (ctx: TourContext) => ctx.data.invoices.find((i) => !!i.billingReview && i.billingReview.at >= ctx.base.at)

/** Where Iris's latest answer links to its report. */
const reportLink = (ctx: TourContext) => {
  for (const m of [...ctx.thread].reverse()) for (const a of m.actions ?? []) if (a.kind === "link" && a.href.startsWith("/reports")) return a.href
  return undefined
}

const COMPOSER = () => document.getElementById(COMPOSER_ID)?.closest('[data-slot="input-group"]')

export const SCRIPT: TourItem[] = [
  { kind: "intro", id: "intro" },

  /* ------------------------- 1. Onboarding and rates ------------------------- */
  {
    kind: "chapter",
    id: "chapter-onboarding",
    chapter: "onboarding",
    title: "Onboarding and rates",
    wsId: COMPASS,
    href: "/units",
    shows: "Add a unit and an agency, then set next year's rates.",
  },
  {
    kind: "step",
    id: "unit",
    chapter: "onboarding",
    wsId: COMPASS,
    path: /^\/units/,
    href: () => "/units",
    title: (ctx) => unitCopy(ctx).title,
    body: (ctx) => unitCopy(ctx).body,
    action: (ctx) => unitCopy(ctx).action,
    targets: () => (one(UNIT) ? [one(UNIT)] : [one('[data-tour="add-unit"]')]),
    placement: "right",
    done: (ctx) => !!newUnit(ctx) && !one(UNIT),
    onDone: (_, api) => later(() => api.push("/agencies"), 250),
    skip: () =>
      playWizard(UNIT, '[data-tour="add-unit"]', async (stage) => {
        if (stage === "Unit") {
          await type(inside(UNIT, 'input[placeholder="Soldier Field"]'), "Soldier Field")
          await type(inside(UNIT, 'input[placeholder="LEV-4450"]'), "LEV-4450")
        }
        if (stage === "Location") {
          await type(inside(UNIT, 'input[placeholder="1410 Special Olympics Dr, Chicago, IL"]'), "1410 Special Olympics Dr, Chicago, IL")
          await type(inside(UNIT, 'input[placeholder="60605"]'), "60605")
        }
        if (stage === "Roles") await toggleOn(UNIT, "Food handler card for every role")
        if (stage === "Departments") await sleep(700)
      }),
  },
  {
    kind: "step",
    id: "agency",
    chapter: "onboarding",
    wsId: COMPASS,
    path: /^\/agencies$/,
    href: () => "/agencies",
    title: (ctx) => agencyCopy(ctx).title,
    body: (ctx) => agencyCopy(ctx).body,
    action: (ctx) => agencyCopy(ctx).action,
    targets: () => (one(AGENCY) ? [one(AGENCY)] : [one('[data-tour="add-agency"]')]),
    placement: "right",
    done: (ctx) => !!newAgency(ctx) && !one(AGENCY),
    onDone: (_, api) => later(() => api.push(`/procurement/${EVENT}`), 250),
    skip: () =>
      playWizard(AGENCY, '[data-tour="add-agency"]', async (stage) => {
        if (stage === "Agency") {
          await type(inside(AGENCY, 'input[placeholder="Northwind Event Staffing"]'), "Northwind Event Staffing")
          await type(inside(AGENCY, 'input[placeholder="Alex Rivera"]'), "Alex Rivera")
          await type(inside(AGENCY, 'input[placeholder="alex@northwindstaff.com"]'), "alex@northwindstaff.com")
          await toggleOn(AGENCY, "API connection")
        }
        if (stage === "Coverage") await toggleOn(AGENCY, "Suite Attendant")
        if (stage === "Paperwork") {
          const box = inside(AGENCY, 'button[role="checkbox"]')
          if (box?.getAttribute("aria-checked") !== "true") await press(box)
        }
        if (stage === "Rates") await sleep(700)
        if (stage === "Workers") await press(buttonIn(AGENCY, "Use a sample roster"))
      }),
  },
  {
    kind: "step",
    id: "counter",
    chapter: "onboarding",
    wsId: COMPASS,
    path: new RegExp(`^/procurement/${EVENT}`),
    href: () => `/procurement/${EVENT}`,
    title: () => (bidRows().length ? "Counter the highest bid" : "Next year's rates, against the market"),
    body: () => (bidRows().length ? "Iris suggests the ask from the market and the other bids." : `Each role's bids next to what ${benchmark("chi", "bartender").agencies} Chicago agencies charge.`),
    action: () => (one('[data-tour="send-counter"]') ? "Click Send" : bidRows().length ? "Click Counter, then Send" : "Open Bartender"),
    targets: () => (bidRows().length ? [counterable()] : [one(BARTENDER_ROW)]),
    placement: "left",
    anchor: () => (bidRows().length ? one('[data-slot="sheet-content"]') : undefined),
    done: (ctx) => !!counteredSince(ctx),
    success: (ctx) => `Counter sent to ${supplier(counteredSince(ctx)!.supplierId).shortName}`,
    onDone: () => later(closeSheet, 1000),
    skip: async () => {
      if (!bidRows().length) {
        await press(one(BARTENDER_ROW))
        await until(() => counterable())
        await sleep(500)
      }
      const row = counterable()
      if (!row?.querySelector('[data-tour="send-counter"]')) await press(inside(row, '[data-tour="counter"]'))
      await press(await until(() => inside(row, '[data-tour="send-counter"]')))
    },
  },
  {
    kind: "step",
    id: "approve",
    chapter: "onboarding",
    wsId: COMPASS,
    path: new RegExp(`^/procurement/${EVENT}`),
    href: () => `/procurement/${EVENT}`,
    title: "Approve the rest",
    body: "Approved bids go live on each agency's rate card.",
    action: () => (approveDialog() ? "Click Approve" : "Click Approve bids"),
    targets: () => (approveDialog() ? [approveButton()] : [one('[data-tour="approve-all"]')]),
    placement: "bottom",
    anchor: () => approveDialog(),
    done: (ctx) => approvedSince(ctx) > 0,
    success: (ctx) => `${plural(approvedSince(ctx), "bid")} approved. The new rates are live`,
    onDone: (_, api) => later(() => api.push("/procurement?tab=rates"), 1100),
    skip: async () => {
      if (!approveDialog()) await press(one('[data-tour="approve-all"]'))
      await sleep(500)
      await press(await until(() => approveButton()))
    },
  },
  {
    kind: "step",
    id: "market",
    chapter: "onboarding",
    wsId: COMPASS,
    path: /^\/procurement$/,
    href: () => "/procurement?tab=rates",
    title: "Every rate, against the market",
    body: "Open a role to rank your agencies on it.",
    targets: () => [one('[data-tour="market-rates"]')],
    placement: "top",
    skip: () => undefined,
  },

  /* --------------------------- 2. Ordering shifts ---------------------------- */
  {
    kind: "chapter",
    id: "chapter-shifts",
    chapter: "shifts",
    title: "Ordering shifts",
    wsId: LEVY,
    href: "/",
    shows: "Book shifts in a sentence, or send them to one agency.",
  },
  {
    kind: "step",
    id: "ask",
    chapter: "shifts",
    wsId: LEVY,
    path: /^\/$/,
    href: () => "/",
    title: "Order in a sentence",
    action: "Send it with Enter",
    example: askExample,
    targets: () => [COMPOSER()],
    placement: "top",
    done: (ctx) => hasDraft(ctx) || !!booked(ctx),
    success: () => "Draft ready",
    skip: async (_, api) => {
      compose(COMPOSER_ID, askExample(), true)
      await until(() => hasDraft(api.now()), 15000)
    },
  },
  {
    kind: "step",
    id: "create",
    chapter: "shifts",
    wsId: LEVY,
    path: /^\/$/,
    href: () => "/",
    title: "Check it, then book it",
    body: "Priced from the rate cards. The best offer sees it first.",
    action: "Click Create and send",
    targets: () => [last('[data-tour="agent-draft"]')],
    placement: "right",
    done: (ctx) => !!booked(ctx),
    success: () => "Shifts posted",
    onDone: (_, api) => later(() => api.push("/shifts/new"), 1100),
    back: "ask",
    skip: async (_, api) => {
      await press(last('[data-tour="agent-create-shift"]'))
      await until(() => booked(api.now()))
    },
  },
  {
    kind: "step",
    id: "one-agency",
    chapter: "shifts",
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
    skip: async () => {
      if (!one(DISPATCH)) await press(one('[data-tour="booking-review"]'))
      await until(() => one(AGENCY_TAB))
      if (!oneAgency()) await press(one(AGENCY_TAB))
      if (!one(PRO_PICKER)) await press(await until(() => one(`${DISPATCH} [data-tour="request-workers"]`)))
      await until(() => one(PRO_PICKER))
      while (prosPicked() < 2) {
        const row = [...document.querySelectorAll<HTMLButtonElement>(`${PRO_PICKER} li button:not(:disabled)`)].find((b) => b.getAttribute("aria-pressed") !== "true")
        if (!row) break
        await press(row)
      }
      await press(one('[data-tour="booking-post"]'))
    },
  },

  /* ------------------------------ 3. Compliance ------------------------------ */
  {
    kind: "chapter",
    id: "chapter-compliance",
    chapter: "compliance",
    title: "Compliance",
    wsId: CREWLINE,
    href: "/shifts",
    shows: "Only workers who are cleared can be assigned.",
  },
  {
    kind: "step",
    id: "assign",
    chapter: "compliance",
    wsId: CREWLINE,
    path: /^\/shifts/,
    href: () => "/shifts",
    title: (ctx) => (one(ASSIGN_DIALOG) ? "Who can work it, and why not" : shownGroup(ctx) ? "Assign from Crewline's roster" : "Shifts released to Crewline"),
    body: (ctx) => {
      if (one(ASSIGN_DIALOG)) {
        const c = crewlineCheck(ctx)
        return c ? `${c.ready} of ${c.pool} can work it.${c.blocked ? ` ${fullName(c.blocked.p)}: "${c.blocked.check.reason}".` : ""}` : undefined
      }
      if (shownGroup(ctx)) return undefined
      const g = assignable(ctx.data)
      return g ? `${location(g.locationId).name} needs ${plural(g.slots.length - filledCount(g), position(g.positionId).name.toLowerCase())} on ${formatDay(g.date, "EEEE")}.` : undefined
    },
    action: (ctx) => (one(ASSIGN_DIALOG) ? "Pick a worker marked Ready, then Assign" : shownGroup(ctx) ? "Click Assign workers" : "Open the highlighted shift"),
    targets: (ctx) => {
      if (one(ASSIGN_DIALOG)) return [one(ASSIGN_DIALOG)]
      if (shownGroup(ctx)) return [one('[data-tour="assign"]')]
      const g = assignable(ctx.data)
      return [g && one(`tr[data-row-id="${g.id}"]`)]
    },
    placement: "right",
    done: assignedSince,
    success: () => "Assigned",
    skip: async (_, api) => {
      if (!shownGroup(api.now())) {
        const g = assignable(api.now().data)
        await press(g && one(`tr[data-row-id="${g.id}"]`))
        await until(() => one('[data-tour="assign"]'))
        await sleep(400)
      }
      if (!one(ASSIGN_DIALOG)) await press(one('[data-tour="assign"]'))
      await press(await until(() => one(`${ASSIGN_DIALOG} [data-tour="assign-row"][data-ready]`)))
      await press(one('[data-tour="assign-submit"]'))
    },
  },
  {
    kind: "chapter",
    id: "chapter-documents",
    chapter: "compliance",
    title: "Compliance",
    wsId: METRO,
    href: "/professionals?filter=not_compliant",
    shows: "Renew an expired document. Iris checks it with the issuer.",
  },
  {
    kind: "step",
    id: "renew",
    chapter: "compliance",
    wsId: METRO,
    path: /^\/professionals$/,
    href: () => "/professionals?filter=not_compliant",
    title: (ctx) => (one(VERIFY) ? "Metro attests it. Iris checks it" : openPro(ctx) ? "Renew it" : "Expired means off the schedule"),
    body: (ctx) => {
      if (one(VERIFY)) return `Iris confirms it with ${CHECKS[(one(VERIFY)?.getAttribute("data-doc-id") as RequirementId) ?? "background"].providers[0]}.`
      if (openPro(ctx)) return undefined
      const pro = chosenPro(ctx)
      const doc = blocker(pro)
      return pro && doc ? `${pro.firstName}'s ${DOC[doc.id]} ${doc.state === "expired" ? "expired" : `is ${doc.state}`}, so Iris won't place them.` : undefined
    },
    action: (ctx) => (one(VERIFY) ? "Attach any file, tick the attestation, then Verify" : openPro(ctx) ? "Click the highlighted button" : "Open the highlighted worker"),
    targets: (ctx) => {
      if (one(VERIFY)) return [one(VERIFY)]
      const pro = openPro(ctx)
      if (pro) {
        const doc = blocker(pro)
        return [doc ? one(`[data-tour="doc-action"][data-doc-id="${doc.id}"]`) : one('[data-tour="doc-action"]')]
      }
      if (ctx.params.get("filter") !== "not_compliant") return [one('[role="tab"][data-value="not_compliant"]')]
      const first = chosenPro(ctx)
      return [(first && one(`tr[data-row-id="${first.id}"]`)) || one("tbody tr[data-row-id]")]
    },
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
      await attach(VERIFY, `${doc?.id ?? "document"}.pdf`)
      await sleep(1100)
      const box = inside(VERIFY, 'button[role="checkbox"]')
      if (box?.getAttribute("aria-checked") !== "true") await press(box)
      await press(one('[data-tour="verify-submit"]'))
      await until(() => !one(VERIFY), 8000)
    },
  },

  /* ------------------------------ 4. Timesheets ------------------------------ */
  {
    kind: "chapter",
    id: "chapter-agency-hours",
    chapter: "timesheets",
    title: "Timesheets",
    wsId: HARBOR,
    href: "/timesheets",
    shows: "Drafted from the clock, or read off a paper sheet.",
  },
  {
    kind: "step",
    id: "paper",
    chapter: "timesheets",
    wsId: HARBOR,
    path: /^\/timesheets/,
    href: () => "/timesheets",
    title: () => (one('[data-tour="scan-apply"]') ? "Matched to workers, checked against the clock" : one(SCAN) ? "Iris reads it" : "Venue still on paper?"),
    action: () => (one('[data-tour="scan-apply"]') ? "Click Update" : one(SCAN) ? "Click Read the sheet" : "Click Scan a sign-in sheet"),
    targets: () => (one(SCAN) ? [one(SCAN)] : [one('[data-tour="scan-sheet-open"]')]),
    placement: "right",
    done: (ctx) => scannedSince(ctx) > 0 && !one(SCAN),
    success: (ctx) => `Updated ${plural(scannedSince(ctx), "timesheet")} from the sheet`,
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
    id: "auto-submit",
    chapter: "timesheets",
    wsId: HARBOR,
    path: /^\/timesheets/,
    href: () => "/timesheets",
    title: "Already drafted from the clock",
    body: (ctx) => {
      const { waiting, matching } = harborDrafts(ctx.data)
      return waiting.length ? `${matching.length} of ${waiting.length} match it exactly.` : undefined
    },
    action: "Turn on Auto-submit",
    targets: () => [one('[data-tour="auto-submit"]')],
    placement: "bottom",
    done: (ctx) => !!ctx.data.settings?.autoSubmit?.includes("harbor"),
    success: () => "Matching timesheets now submit themselves",
    skip: () => press(inside('[data-tour="auto-submit"]', '[role="switch"]')),
  },
  {
    kind: "chapter",
    id: "chapter-timesheets",
    chapter: "timesheets",
    title: "Timesheets",
    wsId: LEVY,
    href: "/timesheets",
    shows: "Approve the hours, and split one by role.",
  },
  {
    kind: "step",
    id: "hours",
    chapter: "timesheets",
    wsId: LEVY,
    path: /^\/timesheets/,
    href: () => "/timesheets",
    title: () => (one(SHEET) ? "Approve at the clock's hours" : "Checked against the clock"),
    body: (ctx) => {
      if (one(SHEET)) return undefined
      const t = paddedSheet(ctx.data)
      return t?.clock ? `A Harbor bartender billed ${t.hours} hours. The clock shows ${clockHours(t.clock)}.` : undefined
    },
    action: () => (one(SHEET) ? "Click Approve at the clock's hours" : "Open the flagged timesheet"),
    targets: () => (one(SHEET) ? [one('[data-tour="accept-proposal"]')] : [one(".tour-flagged")]),
    placement: "left",
    anchor: () => one(SHEET),
    done: correctedSince,
    success: () => "Corrected to the clock and approved",
    onDone: (_, api) => later(() => api.push("/timesheets"), 1000),
    skip: async () => {
      if (!one(SHEET)) await press(one(".tour-flagged"))
      await press(await until(() => one('[data-tour="accept-proposal"]')))
    },
  },
  {
    kind: "step",
    id: "split",
    chapter: "timesheets",
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
    onDone: (_, api) => later(() => api.push("/timesheets"), 1000),
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
      const rows = [...document.querySelectorAll<HTMLButtonElement>(`${MOVE} li button:not(:disabled)`)]
      await press(rows.find((b) => b.textContent?.includes("Barback")) ?? rows[0])
      await press(one('[data-tour="move-submit"]'))
    },
  },

  /* ------------------------- 5. Invoices and reporting ------------------------ */
  {
    kind: "chapter",
    id: "chapter-reporting",
    chapter: "reporting",
    title: "Invoices and reporting",
    wsId: COMPASS,
    href: "/invoices?filter=flagged",
    shows: "Catch hours billed past the clock, then ask for a number.",
  },
  {
    kind: "step",
    id: "invoice",
    chapter: "reporting",
    wsId: COMPASS,
    path: /^\/invoices/,
    href: () => "/invoices?filter=flagged",
    title: (ctx) => (shownInvoice(ctx) ? "Send back what the clock doesn't support" : "Every invoice, checked against the clock"),
    body: (ctx) => {
      const inv = shownInvoice(ctx)
      if (inv) {
        const f = billingFindings(ctx.data, inv.id)[0]
        return f ? `${f.hours} hours past the clock. Ask ${supplier(inv.supplierId).shortName} to credit ${money(f.amount)}.` : undefined
      }
      const top = flagged(ctx.data)[0]
      return top ? `${top.number} from ${supplier(top.supplierId).shortName} bills hours above the clock.` : undefined
    },
    action: (ctx) => (shownInvoice(ctx) ? "Click Send back for a credit" : "Open the highlighted invoice"),
    targets: (ctx) => {
      if (shownInvoice(ctx)) return [one('[data-tour="send-back"]') ?? one('[data-tour="billing-review"]')]
      if (ctx.params.get("filter") !== "flagged") return [one('[role="tab"][data-value="flagged"]')]
      const top = flagged(ctx.data)[0]
      return [(top && one(`tbody tr[data-row-id="${top.id}"]`)) || one("tbody tr[data-row-id]")]
    },
    placement: "bottom",
    anchor: () => one('[data-tour="billing-review"]'),
    done: (ctx) => !!reviewedSince(ctx),
    success: (ctx) => {
      const inv = reviewedSince(ctx)
      return inv?.billingReview?.status === "accepted" ? "Accepted as billed" : `Sent back to ${inv ? supplier(inv.supplierId).shortName : "the agency"} for a credit`
    },
    onDone: (_, api) => later(() => api.push("/agencies"), 800),
    skip: async (ctx, api) => {
      if (!shownInvoice(ctx)) {
        const top = flagged(ctx.data)[0]
        if (!top) return
        const row = one(`tbody tr[data-row-id="${top.id}"]`)
        if (row) await press(row)
        else api.push(`/invoices/${top.id}`)
      }
      await press(await until(() => one('[data-tour="send-back"]')))
    },
  },
  {
    kind: "step",
    id: "scores",
    chapter: "reporting",
    wsId: COMPASS,
    path: /^\/agencies$/,
    href: () => "/agencies",
    title: "Every agency, scored on compliance",
    body: (ctx) => {
      const list = scored(ctx.data)
      if (list.length < 2) return undefined
      const top = list[0]
      const low = list[list.length - 1]
      return `${top.s.shortName} leads at ${top.c.score}. ${low.s.shortName} trails at ${low.c.score}.`
    },
    targets: () => [one('[data-tour="agencies-table"]')],
    placement: "top",
    onDone: (_, api) => api.push("/"),
    skip: () => undefined,
  },
  {
    kind: "step",
    id: "ask-report",
    chapter: "reporting",
    wsId: COMPASS,
    path: /^\/$/,
    href: () => "/",
    title: "Ask for any number",
    example: reportAsk,
    action: "Send it with Enter",
    targets: () => [COMPOSER()],
    placement: "top",
    done: (ctx) => !!reportLink(ctx),
    success: () => "Answered",
    skip: async (_, api) => {
      compose(COMPOSER_ID, reportAsk(), true)
      await until(() => reportLink(api.now()), 15000)
    },
  },
  {
    kind: "step",
    id: "open-report",
    chapter: "reporting",
    wsId: COMPASS,
    path: /^\/$/,
    href: () => "/",
    title: "Open it as a report",
    body: "Save it, or have it emailed every week.",
    action: "Click Open the report",
    targets: () => [last('[data-tour="agent-link"]')],
    placement: "bottom",
    done: (ctx) => ctx.path === "/reports",
    back: "ask-report",
    skip: (ctx, api) => api.push(reportLink(ctx) ?? "/reports"),
  },

  { kind: "finale", id: "finale" },
]

export const STEPS = SCRIPT.filter((item): item is TourStep => item.kind === "step")

export const indexOf = (id: string) => SCRIPT.findIndex((item) => item.id === id)
