import { Building2, CalendarPlus, ChartColumn, Clock, ShieldCheck, type LucideIcon } from "lucide-react"

import type { AgentMessage } from "@/components/agent/agent-store"
import { compose } from "@/components/agent/agent-thread"
import { COMPOSER_ID } from "@/components/home/agent-home"
import type { TourBase, TourPicks } from "@/hooks/use-tour"
import { canWork, requirementRows } from "@/lib/compliance"
import { addDaysISO, formatDay, todayISO } from "@/lib/dates"
import { fullName, money, plural } from "@/lib/format"
import { billingFindings, billingToReview, complianceScore, filledCount, groupPhase, isOpenTo, needsReview } from "@/lib/metrics"
import { standingOf } from "@/lib/pro-profile"
import { SUPPLIERS, city, location, position, supplier } from "@/lib/reference"
import { eligiblePros, useStore } from "@/lib/store"
import { clockHours, matchesClock, timesheetChecks, withAgency } from "@/lib/timesheets"
import type { DemoData, Pro, RequirementId, Timesheet } from "@/lib/types"
import { reportHref } from "@/lib/reports"
import { CHECKS } from "@/lib/verification"

/**
 * The guided demo: the five core workflows in the order of the Fieldglass modules, each played as the person who does
 * it. Every step says what's on screen and why it matters, waits for the player to do it, and can do it for them.
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
}

export interface TourStep {
  kind: "step"
  id: string
  chapter: ChapterId
  wsId: string
  /** The page the step happens on. Anywhere else, the card offers to take the player there. */
  path: RegExp
  href: (ctx: TourContext) => string
  title: string | ((ctx: TourContext) => string)
  body: string | ((ctx: TourContext) => string)
  /** What the player does. Steps without one are read-only and show Next. */
  action?: string | ((ctx: TourContext) => string)
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
  /** Does the step for the player. */
  skip: (ctx: TourContext, api: TourApi) => void
  onDone?: (ctx: TourContext, api: TourApi) => void
}

export interface TourChapter {
  kind: "chapter"
  id: string
  chapter: ChapterId
  title: string
  line: string
  wsId: string
  href: string
  /** What this stretch shows, in a sentence. */
  shows: string
  again?: boolean
}

export type TourItem = { kind: "intro"; id: "intro" } | TourChapter | TourStep | { kind: "finale"; id: "finale" }

export const CHAPTER_ORDER: ChapterId[] = ["onboarding", "shifts", "compliance", "timesheets", "reporting"]

export const CHAPTERS: Record<ChapterId, { number: number; label: string; short: string; icon: LucideIcon; blurb: string; fieldglass: string }> = {
  onboarding: {
    number: 1,
    label: "Onboarding",
    short: "Onboarding",
    icon: Building2,
    blurb: "Add a unit and an agency in forms Iris checks as you type, then audit an agency's rate card.",
    fieldglass: "Onboarding (upload buyer, supplier and rate card)",
  },
  shifts: {
    number: 2,
    label: "Shift creation",
    short: "Shifts",
    icon: CalendarPlus,
    blurb: "Book in a sentence. Iris prices it, releases it to agencies in order, and routes over-budget orders for approval. Or send it to one agency, or to Pros you name.",
    fieldglass: "Job Posting",
  },
  compliance: {
    number: 3,
    label: "Assignment and compliance",
    short: "Compliance",
    icon: ShieldCheck,
    blurb: "Agencies can only assign Pros who are cleared. Documents are attested, checked with the issuer, and escalated when they fail. Every roster carries a score.",
    fieldglass: "Job Seeker and Attestations",
  },
  timesheets: {
    number: 4,
    label: "Timesheets",
    short: "Timesheets",
    icon: Clock,
    blurb: "Agencies stop uploading hours Iris already has. Buyers approve at the clock, split a shift by role, and send back what an invoice bills anyway.",
    fieldglass: "Timesheet",
  },
  reporting: {
    number: 5,
    label: "Reporting",
    short: "Reporting",
    icon: ChartColumn,
    blurb: "Ask for a number, open it as a report, save it for the team and email it on a schedule.",
    fieldglass: "Reporting",
  },
}

/** What the last card lists, one line per part. */
export const RECAP: { chapter: ChapterId; label: string }[] = [
  { chapter: "onboarding", label: "Added Soldier Field and Northwind Event Staffing, and audited Harbor's rate card" },
  { chapter: "shifts", label: "Booked a shift in a sentence, routed an over-budget order to its approver, and requested Pros by name" },
  { chapter: "compliance", label: "Assigned a Crewline Pro, verified a document with its issuer, reviewed one that failed, and scored every roster" },
  { chapter: "timesheets", label: "Let Harbor's clock-matched hours go in on their own, split a shift by role, approved at the clock, and sent back hours an invoice billed above it" },
  { chapter: "reporting", label: "Turned a question into a saved report emailed every Monday" },
]

const LEVY = "ws-levy"
const DANA = "ws-levy-dm"
const COMPASS = "ws-compass"
const CREWLINE = "ws-crewline"
const METRO = "ws-metro"
const HARBOR = "ws-harbor"

const one = (selector: string) => document.querySelector(selector)
const last = (selector: string) => {
  const all = document.querySelectorAll(selector)
  return all[all.length - 1] ?? null
}
const click = (selector: string) => (one(selector) as HTMLElement | null)?.click()
const later = (fn: () => void, ms = 120) => window.setTimeout(fn, ms)
const inside = (root: string, selector: string) => one(root)?.querySelector(selector) ?? null

/** Types into a field the way a person would, so the form's own state updates. */
function fill(el: Element | null | undefined, value: string) {
  if (!(el instanceof HTMLInputElement)) return
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(el, value)
  el.dispatchEvent(new Event("input", { bubbles: true }))
}

const pressButton = (root: string, text: string, on = false) => {
  const button = [...(one(root)?.querySelectorAll("button") ?? [])].find((b) => b.textContent?.trim() === text)
  if (button && (on || button.getAttribute("aria-pressed") !== "true")) button.click()
}

const tick = (root: string) => {
  const box = inside(root, 'button[role="checkbox"]')
  if (box && box.getAttribute("aria-checked") !== "true") (box as HTMLElement).click()
}

function attach(root: string, name: string) {
  const input = inside(root, 'input[type="file"]')
  if (!(input instanceof HTMLInputElement)) return
  const files = new DataTransfer()
  files.items.add(new File(["Iris demo document"], name, { type: "application/pdf" }))
  input.files = files.files
  input.dispatchEvent(new Event("change", { bubbles: true }))
}

const serial = (id: string) => Number(id.split("-")[1]) || 0
const nextDate = () => formatDay(addDaysISO(todayISO(), 2), "MMMM do")

export const askExample = () => `Create 8 bartender shifts at West Loop Arena on ${nextDate()} from 4pm to 11pm`
const bigAsk = () => `Create 40 bartender shifts at West Loop Arena on ${nextDate()} from 4pm to 11pm`
const reportAsk = () => "What did Harbor bill at West Loop Arena last week?"

/* -------------------------------- Onboarding ------------------------------- */

const UNIT = '[data-tour="unit-dialog"]'
const AGENCY = '[data-tour="agency-dialog"]'
const UNIT_STAGES = ["Unit", "Location", "Requirements", "Ordering", "Review", "done"]
const AGENCY_STAGES = ["Agency", "Coverage", "Paperwork", "Rate card", "Pros and buyers", "Review", "done"]

const stageOf = (dialog: string) => one(dialog)?.getAttribute("data-stage") ?? undefined
const pastStage = (dialog: string, stages: string[], stage: string) => {
  const current = stageOf(dialog)
  return !!current && stages.indexOf(current) > stages.indexOf(stage)
}
const next = (dialog: string) => later(() => (inside(dialog, '[data-tour="wizard-next"]') as HTMLElement | null)?.click())

const newUnit = (ctx: TourContext) => ctx.data.directory.locations[0]
const newAgency = (ctx: TourContext) => ctx.data.directory.suppliers[0]

const unitStage = (id: string, stage: string, title: string, body: string, action: string, fillIn: () => void): TourStep => ({
  kind: "step",
  id,
  chapter: "onboarding",
  wsId: COMPASS,
  path: /^\/units/,
  href: () => "/units",
  title,
  body,
  action,
  targets: () => [one(UNIT)],
  placement: "right",
  done: (ctx) => !!newUnit(ctx) || pastStage(UNIT, UNIT_STAGES, stage),
  back: "units",
  skip: () => {
    fillIn()
    next(UNIT)
  },
})

const agencyStage = (id: string, stage: string, title: string, body: string, action: string, fillIn: () => void): TourStep => ({
  kind: "step",
  id,
  chapter: "onboarding",
  wsId: COMPASS,
  path: /^\/agencies$/,
  href: () => "/agencies",
  title,
  body,
  action,
  targets: () => [one(AGENCY)],
  placement: "right",
  done: (ctx) => !!newAgency(ctx) || pastStage(AGENCY, AGENCY_STAGES, stage),
  back: "agencies",
  skip: () => {
    fillIn()
    next(AGENCY)
  },
})

/* ------------------------------ Shift creation ----------------------------- */

const ordersSince = (ctx: TourContext) => ctx.data.groups.filter((g) => g.buyerId === "levy-chi" && serial(g.id) >= ctx.base.sg).sort((a, b) => serial(b.id) - serial(a.id))

/** The shift the player booked in the chat. */
const booked = (ctx: TourContext) => ordersSince(ctx).find((g) => !g.approval && !g.dispatch)

/** The order the player sent over budget. */
const bigOrder = (ctx: TourContext) => ordersSince(ctx).find((g) => !!g.approval && !g.dispatch)

/** The order the player posted from the form, asking for Pros by name. */
const requestedOrder = (ctx: TourContext) => ordersSince(ctx).find((g) => !!g.dispatch?.proIds?.length)

const DISPATCH = '[data-tour="dispatch"]'
const prosPicked = () => document.querySelectorAll(`${DISPATCH} li button[aria-pressed="true"]`).length

const hasDraft = (ctx: TourContext, label?: string) => ctx.thread.some((m) => m.actions?.some((a) => a.kind === "create-shift" && (!label || a.label === label)))

/* ------------------------ Assignment and compliance ------------------------ */

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

const assignGroup = (ctx: TourContext) => ctx.data.groups.find((g) => g.id === ctx.groupId) ?? assignable(ctx.data)

const crewlineCheck = (ctx: TourContext) => {
  const g = assignGroup(ctx)
  if (!g) return undefined
  const loc = location(g.locationId)
  const pool = ctx.data.pros.filter((p) => p.supplierId === "crewline" && p.cityId === loc.cityId && p.positionIds.includes(g.positionId))
  const ready = eligiblePros(ctx.data, g, "crewline").length
  const blocked = pool
    .map((p) => ({ p, check: canWork(p, g.positionId, g.date, g.locationId) }))
    .filter((x) => !x.check.ok)
    .sort((a, b) => b.p.rating - a.p.rating)[0]
  return { g, pool: pool.length, ready, blocked }
}

const assignedSince = (ctx: TourContext) => {
  const g = assignGroup(ctx)
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

/** Documents the agency can add or renew on this Pro. */
const renewable = (pro?: Pro) => (pro ? requirementRows(pro).filter((r) => r.state !== "complete" && r.state !== "not_required") : [])

/** Another one after the first is renewed, for the document Iris can't verify. */
const spareDoc = (pro?: Pro, besides?: RequirementId) => renewable(pro).find((r) => r.id !== besides)

/** Metro's Pros kept off shifts, expired documents first, then the ones that also have a second document to renew. */
const blockedPros = (data: DemoData) =>
  data.pros
    .filter((p) => p.supplierId === "metro" && standingOf(p) === "not_compliant")
    .map((pro) => ({ pro, expired: requirementRows(pro).some((r) => r.state === "expired"), spare: renewable(pro).length > 1 }))
    .sort((a, b) => Number(b.expired) - Number(a.expired) || Number(b.spare) - Number(a.spare) || fullName(a.pro).localeCompare(fullName(b.pro)))
    .map((x) => x.pro)

const chosenPro = (ctx: TourContext): Pro | undefined => ctx.data.pros.find((p) => p.id === ctx.proId) ?? blockedPros(ctx.data)[0]

const docItem = (ctx: TourContext) => (ctx.docId ? chosenPro(ctx)?.compliance[ctx.docId] : undefined)

const held = (ctx: TourContext) => {
  const item = docItem(ctx)
  return item?.status === "pending" && item.verification?.result === "needs_review"
}

const verifyingFor = () => one('[data-tour="verify-dialog"]')?.getAttribute("data-doc-id") ?? undefined

const submitVerify = () => {
  later(() => tick('[data-tour="verify-dialog"]'), 1300)
  later(() => click('[data-tour="verify-submit"]'), 1600)
}

/** Agencies with Pros on the program, best roster first. */
const scored = (data: DemoData) =>
  SUPPLIERS.map((s) => ({ s, c: complianceScore(data, s.id) }))
    .filter((x) => x.c.active > 0)
    .sort((a, b) => b.c.score - a.c.score)

/* -------------------------------- Timesheets ------------------------------- */

/** Harbor's timesheets still with Harbor, and the ones that match Iris's clock exactly. */
const harborDrafts = (data: DemoData) => {
  const mine = data.timesheets.filter((t) => t.supplierId === "harbor")
  const waiting = mine.filter(withAgency)
  return { waiting, matching: waiting.filter((t) => matchesClock(t, mine.filter((o) => o.proId === t.proId))) }
}

const newestFirst = (a: Timesheet, b: Timesheet) => b.date.localeCompare(a.date) || b.scheduledStart.localeCompare(a.scheduledStart)

/**
 * A clean Levy timesheet on the first page of Needs approval, for a Pro their agency also has another approved role and
 * rate for. A concessions worker who could have gone to the suites as a barback if there is one.
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

const article = (word: string) => (/^[aeiou]/i.test(word) ? "an" : "a")

const tourSheet = (ctx: TourContext) => ctx.data.timesheets.find((t) => t.id === ctx.sheetId)

const movedSince = (ctx: TourContext) => ctx.data.timesheets.find((t) => !!t.movedFrom && t.history.some((h) => h.action === "moved" && h.at >= ctx.base.at))

const generated = (ctx: TourContext) => ctx.data.invoices.filter((i) => serial(i.id) >= ctx.base.inv && i.status !== "open")

const openInvoices = (ctx: TourContext) => ctx.data.invoices.filter((i) => i.buyerId === "levy-chi" && i.status === "open")

/** Last night's Harbor bartender billed above the clock, while it's still waiting for approval: the newest such timesheet, the one the table lists first. */
const paddedSheet = (data: DemoData) =>
  data.timesheets
    .filter((t) => t.buyerId === "levy-chi" && t.status === "pending_approval" && timesheetChecks(t).some((c) => c.id === "above_clock"))
    .sort((a, b) => b.date.localeCompare(a.date) || b.scheduledStart.localeCompare(a.scheduledStart))[0]

/** Waiting on Compass, the ones with hours billed above the clock first. */
const flagged = (data: DemoData) =>
  data.invoices
    .filter((i) => needsReview(data, i))
    .sort((a, b) => Number(billingToReview(data, b)) - Number(billingToReview(data, a)) || b.issuedOn.localeCompare(a.issuedOn) || b.number.localeCompare(a.number))

const tourInvoice = (ctx: TourContext) => ctx.data.invoices.find((i) => i.id === ctx.invoiceId)

/* -------------------------------- Reporting -------------------------------- */

/** Where Iris's latest answer links to its report. */
const reportLink = (ctx: TourContext) => {
  for (const m of [...ctx.thread].reverse()) for (const a of m.actions ?? []) if (a.kind === "link" && a.href.startsWith("/reports")) return a.href
  return undefined
}

const newReport = (ctx: TourContext) => ctx.data.reports.filter((r) => serial(r.id) >= ctx.base.rep).sort((a, b) => serial(b.id) - serial(a.id))[0]

export const SCRIPT: TourItem[] = [
  { kind: "intro", id: "intro" },

  /* ------------------------------ 1. Onboarding ------------------------------ */
  {
    kind: "chapter",
    id: "chapter-onboarding",
    chapter: "onboarding",
    title: "Onboarding",
    line: "Units and agencies are added in a form, checked as you type, and live everywhere the moment they're saved.",
    wsId: COMPASS,
    href: "/units",
    shows: "Add Soldier Field for Levy and Northwind Event Staffing for Chicago, then audit an agency's rates.",
  },
  {
    kind: "step",
    id: "units",
    chapter: "onboarding",
    wsId: COMPASS,
    path: /^\/units/,
    href: () => "/units",
    title: "Every unit on the program",
    body: "Seven units across Levy · Chicago and Chartwells · South. Each carries its cost center, the roles it orders, anything it requires beyond the program, and the agencies that staff it, in release order.",
    action: "Click Add a unit",
    targets: () => [one('[data-tour="add-unit"]'), one('[data-tour="units-table"]')],
    placement: "bottom",
    done: (ctx) => !!newUnit(ctx) || !!one(UNIT),
    skip: () => click('[data-tour="add-unit"]'),
  },
  unitStage(
    "unit-name",
    "Unit",
    "Name it and give it a cost center",
    "Levy · Chicago and Stadium are already picked. The cost center is what every invoice line for this unit is charged to.",
    "Type Soldier Field and LEV-4450, then Next",
    () => {
      fill(inside(UNIT, 'input[placeholder="Soldier Field"]'), "Soldier Field")
      fill(inside(UNIT, 'input[placeholder="LEV-4450"]'), "LEV-4450")
    },
  ),
  unitStage(
    "unit-location",
    "Location",
    "Place it",
    "From the ZIP code Iris names the market, its time zone, and the agencies with rates there. A ZIP no agency covers stops you here, not after the first order fails.",
    "Type the address and ZIP shown in grey, then Next",
    () => {
      fill(inside(UNIT, 'input[placeholder="1410 Special Olympics Dr, Chicago, IL"]'), "1410 Special Olympics Dr, Chicago, IL")
      fill(inside(UNIT, 'input[placeholder="60605"]'), "60605")
    },
  ),
  unitStage(
    "unit-requirements",
    "Requirements",
    "Say what every Pro here needs",
    "Background check, I-9 and Compass orientation apply everywhere, and food and bar roles add their certificates. Requiring a food handler card for every role drops the count of Pros who could work here today, before anyone is booked.",
    "Click Food handler card for every role, then Next",
    () => pressButton(UNIT, "Food handler card for every role"),
  ),
  unitStage(
    "unit-ordering",
    "Ordering",
    "Set what it orders and who signs off",
    "Stadium roles come preselected. With a weekly budget, any order that takes the week over it waits for Dana Ruiz. Orders go to Levy's agencies in its release order: Instawork, Crewline, then Harbor.",
    "Type 12000 as the weekly budget, then Next",
    () => fill(inside(UNIT, 'input[placeholder="No budget"]'), "12000"),
  ),
  {
    kind: "step",
    id: "unit-review",
    chapter: "onboarding",
    wsId: COMPASS,
    path: /^\/units/,
    href: () => "/units",
    title: "Check it and add it",
    body: "One summary of what was entered, the agencies that will staff it, and how many Pros qualify today.",
    action: "Click Add unit",
    targets: () => [one(UNIT)],
    placement: "right",
    done: (ctx) => !!newUnit(ctx),
    success: (ctx) => `${newUnit(ctx)?.name ?? "The unit"} is live`,
    back: "units",
    skip: () => click(`${UNIT} [data-tour="wizard-submit"]`),
  },
  {
    kind: "step",
    id: "unit-live",
    chapter: "onboarding",
    wsId: COMPASS,
    path: /^\/units/,
    href: () => "/units",
    title: (ctx) => `${newUnit(ctx)?.name ?? "The unit"} can book now`,
    body: "Its first order prices from the agencies' rate cards, goes out in Levy's release order, checks the budget, and places only Pros with a current food handler card. Nobody re-keys it anywhere else.",
    action: "Click Done",
    targets: () => [one(UNIT)],
    placement: "right",
    done: (ctx) => !!newUnit(ctx) && !one(UNIT),
    skip: () => click(`${UNIT} [data-tour="wizard-done"]`),
  },
  {
    kind: "step",
    id: "open-agencies",
    chapter: "onboarding",
    wsId: COMPASS,
    path: /^\/units/,
    href: () => "/units",
    title: "Now an agency",
    body: "Agencies have their own list, with one page each for everything about them.",
    action: "Open Agencies in the menu",
    targets: () => [one('nav a[href="/agencies"], aside a[href="/agencies"]')],
    placement: "right",
    done: (ctx) => ctx.path.startsWith("/agencies"),
    skip: (_, api) => api.push("/agencies"),
  },
  {
    kind: "step",
    id: "agencies",
    chapter: "onboarding",
    wsId: COMPASS,
    path: /^\/agencies$/,
    href: () => "/agencies",
    title: "Every agency on the program",
    body: "Insurance status, rate cards, how many of each agency's Pros are cleared, and which buyers approved it. Metro's certificate of insurance expires in 9 days; Iris stops sending it shifts the day it lapses.",
    action: "Click Add an agency",
    targets: () => [one('[data-tour="add-agency"]'), one('[data-tour="agencies-table"]')],
    placement: "bottom",
    done: (ctx) => !!newAgency(ctx) || !!one(AGENCY),
    skip: () => click('[data-tour="add-agency"]'),
  },
  agencyStage(
    "agency-who",
    "Agency",
    "Who they are",
    "The contact becomes the agency's first sign-in. How it sends hours decides whether its timesheets arrive by API or by CSV.",
    "Type the name, contact and email shown in grey, then Next",
    () => {
      fill(inside(AGENCY, 'input[placeholder="Northwind Event Staffing"]'), "Northwind Event Staffing")
      fill(inside(AGENCY, 'input[placeholder="Alex Rivera"]'), "Alex Rivera")
      fill(inside(AGENCY, 'input[placeholder="alex@northwindstaff.com"]'), "alex@northwindstaff.com")
    },
  ),
  agencyStage(
    "agency-coverage",
    "Coverage",
    "Where they work and what they staff",
    "Chicago and three venue roles are preselected. Every market and role picked here becomes a row on the rate card two steps on.",
    "Add Suite Attendant, then Next",
    () => pressButton(AGENCY, "Suite Attendant"),
  ),
  agencyStage(
    "agency-paperwork",
    "Paperwork",
    "Insurance and the master agreement",
    "The certificate of insurance expiry is prefilled eight months out, and the program's terms are shown beside it: net payment, the 45% markup cap, and the documents every Pro needs. Next stays off until the agreement is signed.",
    "Tick Master services agreement signed, then Next",
    () => tick(AGENCY),
  ),
  agencyStage(
    "agency-rates",
    "Rate card",
    "The rate card",
    "Each rate starts at what agencies in Chicago already pay, with a 32% markup, and the last column compares the bill rate with the market. Type 46 into a markup and Iris blocks it as over the 45% cap.",
    "Check the rates, then Next",
    () => undefined,
  ),
  agencyStage(
    "agency-buyers",
    "Pros and buyers",
    "Its Pros and its buyers",
    "18 Pros come over from Northwind's roster, each checked as it arrives. Levy · Chicago is ticked, so Northwind joins the end of Levy's release order.",
    "Click Next",
    () => undefined,
  ),
  {
    kind: "step",
    id: "agency-review",
    chapter: "onboarding",
    wsId: COMPASS,
    path: /^\/agencies$/,
    href: () => "/agencies",
    title: "Check it and add it",
    body: "Nothing was saved until now. Adding it creates the agency, its rate card, its Pros and its approvals in one go.",
    action: "Click Add agency",
    targets: () => [one(AGENCY)],
    placement: "right",
    done: (ctx) => !!newAgency(ctx),
    success: (ctx) => `${newAgency(ctx)?.name ?? "The agency"} is on Iris`,
    back: "agencies",
    skip: () => click(`${AGENCY} [data-tour="wizard-submit"]`),
  },
  {
    kind: "step",
    id: "agency-live",
    chapter: "onboarding",
    wsId: COMPASS,
    path: /^\/agencies$/,
    href: () => "/agencies",
    title: "Live, with its exceptions already caught",
    body: (ctx) => {
      const sup = newAgency(ctx)
      const pros = sup ? ctx.data.pros.filter((p) => p.supplierId === sup.id) : []
      const waiting = pros.filter((p) => p.compliance.background?.status === "pending").length
      return `${plural(pros.length, "Pro")} came over${waiting ? `, and Iris is holding ${waiting} until their background checks clear` : ""}. Levy's next order that its other agencies leave open reaches ${sup?.shortName ?? "it"} last.`
    },
    action: "Click Done",
    targets: () => [one(AGENCY)],
    placement: "right",
    done: (ctx) => !!newAgency(ctx) && !one(AGENCY),
    skip: () => click(`${AGENCY} [data-tour="wizard-done"]`),
  },
  {
    kind: "step",
    id: "open-harbor",
    chapter: "onboarding",
    wsId: COMPASS,
    path: /^\/agencies/,
    href: () => "/agencies",
    title: "One agency, one page",
    body: "Harbor Hospitality staffs Levy's venues by CSV upload. Everything about it lives on its page.",
    action: "Click Harbor",
    targets: () => [one('tr[data-row-id="harbor"]')],
    placement: "bottom",
    done: (ctx) => ctx.path === "/agencies/harbor",
    skip: (_, api) => api.push("/agencies/harbor"),
  },
  {
    kind: "step",
    id: "harbor-rates",
    chapter: "onboarding",
    wsId: COMPASS,
    path: /^\/agencies\/harbor/,
    href: () => "/agencies/harbor",
    title: "Performance, rates, Pros and paperwork",
    body: "Fill rate, time to fill, no-shows and compliance across every buyer, then its rates by city with pay, markup and bill. Its bartender markup is 72%, over the program's 45% cap, so it shows in red.",
    targets: () => [one('[data-tour="agency-rates"]')],
    placement: "right",
    skip: () => undefined,
  },
  {
    kind: "step",
    id: "rate-log",
    chapter: "onboarding",
    wsId: COMPASS,
    path: /^\/agencies\/harbor/,
    href: () => "/agencies/harbor",
    title: "Every change to its rates",
    body: "Each change keeps the rate before and after, who made it and how it came in. The top one: Harbor's bartender rate went from $27.81 to $35.69 by CSV upload, and Iris flagged it over the cap. Supplier Rates has the same log for every agency.",
    targets: () => [one('[data-tour="rate-changes"]')],
    placement: "top",
    skip: () => undefined,
  },

  /* ---------------------------- 2. Shift creation ---------------------------- */
  {
    kind: "chapter",
    id: "chapter-shifts",
    chapter: "shifts",
    title: "Shift creation",
    line: "Booking takes a sentence. The program's rules apply on their own.",
    wsId: LEVY,
    href: "/",
    shows: "Book a concert night at West Loop Arena, send an order over the week's budget to its approver, and ask for Pros by name.",
  },
  {
    kind: "step",
    id: "predict-orders",
    chapter: "shifts",
    wsId: LEVY,
    path: /^\/$/,
    href: () => "/",
    title: "Orders Iris expects",
    body: "From the last six weeks of shifts, Iris predicts the recurring orders, like the Riverside expo's banquet servers every other Tuesday, and drafts each one. Shifts also come from the New shift form and CSV uploads.",
    targets: () => [one('[data-tour="predictions"]')],
    placement: "top",
    skip: () => undefined,
  },
  {
    kind: "step",
    id: "ask",
    chapter: "shifts",
    wsId: LEVY,
    path: /^\/$/,
    href: () => "/",
    title: "Ask in a sentence",
    body: "Role, venue, date, time and headcount in plain English.",
    action: "Send it with Enter",
    example: askExample,
    targets: () => [document.getElementById(COMPOSER_ID)?.closest('[data-slot="input-group"]')],
    placement: "top",
    done: (ctx) => hasDraft(ctx) || !!booked(ctx),
    success: () => "Draft ready",
    skip: () => compose(COMPOSER_ID, askExample(), true),
  },
  {
    kind: "step",
    id: "create",
    chapter: "shifts",
    wsId: LEVY,
    path: /^\/$/,
    href: () => "/",
    title: "Check the draft",
    body: "The estimate is a range because each Pro bills at their own agency's rate. The card shows the paid hours after the break, where the order lands against West Loop Arena's weekly budget, and the release order with each agency's bill rate. Nothing is booked yet.",
    action: "Click Create and send",
    targets: () => [last('[data-tour="agent-draft"]')],
    placement: "right",
    done: (ctx) => !!booked(ctx),
    success: () => "Shift posted",
    back: "ask",
    skip: () => (last('[data-tour="agent-create-shift"]') as HTMLElement | null)?.click(),
  },
  {
    kind: "step",
    id: "big-ask",
    chapter: "shifts",
    wsId: LEVY,
    path: /^\/$/,
    href: () => "/",
    title: "Ask for more than the budget allows",
    body: "Forty bartenders for the same night takes West Loop Arena past its weekly budget.",
    action: "Send it with Enter",
    example: bigAsk,
    targets: () => [document.getElementById(COMPOSER_ID)?.closest('[data-slot="input-group"]')],
    placement: "top",
    done: (ctx) => hasDraft(ctx, "Send for approval") || !!bigOrder(ctx),
    success: () => "Draft ready",
    skip: () => compose(COMPOSER_ID, bigAsk(), true),
  },
  {
    kind: "step",
    id: "send-approval",
    chapter: "shifts",
    wsId: LEVY,
    path: /^\/$/,
    href: () => "/",
    title: "It goes to the approver first",
    body: "The draft says how far over the budget this takes the week and that Dana Ruiz approves it, so the button reads Send for approval. Agencies see nothing until she does.",
    action: "Click Send for approval",
    targets: () => [last('[data-tour="agent-draft"]')],
    placement: "right",
    done: (ctx) => !!bigOrder(ctx),
    success: () => "Sent to Dana Ruiz",
    back: "big-ask",
    skip: () => (last('[data-tour="agent-create-shift"]') as HTMLElement | null)?.click(),
  },
  {
    kind: "step",
    id: "open",
    chapter: "shifts",
    wsId: LEVY,
    path: /^\/$/,
    href: () => "/",
    title: "Open the shift you booked",
    body: "The first order is live with Instawork, first in Levy's release order. The second waits for Dana.",
    action: "Click View created shift",
    targets: (ctx) => {
      const g = booked(ctx)
      return [g ? one(`[data-tour="agent-link"][href="/shifts/${g.id}"]`) : last('[data-tour="agent-link"]')]
    },
    placement: "bottom",
    done: (ctx) => {
      const g = booked(ctx)
      return !!g && ctx.path === `/shifts/${g.id}`
    },
    skip: (ctx, api) => {
      const g = booked(ctx)
      api.push(g ? `/shifts/${g.id}` : "/shifts")
    },
  },
  {
    kind: "step",
    id: "watch",
    chapter: "shifts",
    wsId: LEVY,
    path: /^\/shifts\/sg-/,
    href: (ctx) => {
      const g = booked(ctx)
      return g ? `/shifts/${g.id}` : "/shifts"
    },
    title: "Released in the order Levy set",
    body: (ctx) => {
      const g = booked(ctx)
      return g && filledCount(g) >= g.slots.length
        ? "Instawork had first look and filled every spot, so Crewline and Harbor never needed to see it. Each Pro shows their agency, rating and status."
        : "Instawork has first look and is filling it now. Crewline and Harbor see only what's still open, four hours apart. Each Pro shows their agency, rating and status."
    },
    targets: () => [one('[data-tour="release"]'), one('[data-tour="roster"]')],
    placement: "bottom",
    status: (ctx) => {
      const g = booked(ctx)
      if (!g) return undefined
      const filled = filledCount(g)
      return filled >= g.slots.length ? `All ${g.slots.length} spots filled` : `${filled} of ${g.slots.length} spots filled`
    },
    skip: () => undefined,
  },
  {
    kind: "step",
    id: "form-open",
    chapter: "shifts",
    wsId: LEVY,
    path: /^\/shifts/,
    href: (ctx) => {
      const g = booked(ctx)
      return g ? `/shifts/${g.id}` : "/shifts"
    },
    title: "Or say who gets it",
    body: "The release order is the default, not the only way. From the New shift form an order can go to one agency only, or to Pros Levy already knows.",
    action: "Click New shift",
    targets: () => [one('[data-tour="book"]')],
    placement: "bottom",
    done: (ctx) => ctx.path === "/shifts/new",
    skip: (_, api) => api.push("/shifts/new"),
  },
  {
    kind: "step",
    id: "form-review",
    chapter: "shifts",
    wsId: LEVY,
    path: /^\/shifts\/new/,
    href: () => "/shifts/new",
    title: "Keep the defaults",
    body: "Venue, role, date, times and headcount are filled in from Levy's usual order. The form can book several dates at once.",
    action: "Click Review",
    targets: () => [one('[data-tour="booking-review"]')],
    placement: "top",
    done: () => !!one(DISPATCH),
    skip: () => click('[data-tour="booking-review"]'),
  },
  {
    kind: "step",
    id: "form-pros",
    chapter: "shifts",
    wsId: LEVY,
    path: /^\/shifts\/new/,
    href: () => "/shifts/new",
    title: "Ask for Pros by name",
    body: "Levy's Favorites and the Pros who've worked this venue in this role, each with Iris's check for the date. Iris books the ones still cleared and free and tells their agencies. The spots left over go out in the release order.",
    action: "Click Specific Pros, then pick two",
    targets: () => [one(DISPATCH)],
    placement: "left",
    done: () => !!one(`${DISPATCH} [role="tab"][data-value="pros"][aria-selected="true"]`) && prosPicked() >= 1,
    status: () => (prosPicked() ? `${plural(prosPicked(), "Pro")} picked` : undefined),
    back: "form-review",
    skip: () => {
      click(`${DISPATCH} [role="tab"][data-value="pros"]`)
      const pick = (left: number) => {
        if (left <= 0) return
        const row = [...document.querySelectorAll<HTMLButtonElement>(`${DISPATCH} li button:not(:disabled)`)].find((b) => b.getAttribute("aria-pressed") !== "true")
        row?.click()
        if (row) later(() => pick(left - 1), 200)
      }
      later(() => pick(2 - prosPicked()), 250)
    },
  },
  {
    kind: "step",
    id: "form-post",
    chapter: "shifts",
    wsId: LEVY,
    path: /^\/shifts\/new/,
    href: () => "/shifts/new",
    title: "Post it",
    body: "The budget check and the release rule still apply. The Pros you named are placed first; nobody else sees those spots.",
    action: () => `Click ${one('[data-tour="booking-post"]')?.textContent?.trim() || "Post"}`,
    targets: () => [one('[data-tour="booking-post"]')],
    placement: "top",
    done: (ctx) => !!requestedOrder(ctx),
    success: (ctx) => {
      const g = requestedOrder(ctx)
      if (g?.approval?.status === "pending") return "Sent for approval. Iris books them once it's approved"
      const asked = new Set(g?.dispatch?.proIds ?? [])
      const placed = g ? g.slots.filter((s) => !!s.proId && asked.has(s.proId)).length : 0
      return placed ? `Booked ${plural(placed, "requested Pro")}` : "Posted"
    },
    back: "form-pros",
    skip: () => click('[data-tour="booking-post"]'),
  },
  {
    kind: "chapter",
    id: "chapter-approval",
    chapter: "shifts",
    title: "Shift creation",
    line: "Over-budget orders wait for one decision.",
    wsId: DANA,
    href: "/approvals",
    shows: "Approve the order Jordan sent over West Loop Arena's budget, from the inbox built for a phone.",
  },
  {
    kind: "step",
    id: "approve-order",
    chapter: "shifts",
    wsId: DANA,
    path: /^\/approvals/,
    href: () => "/approvals",
    title: "Approve or decline it",
    body: "The order, how far over the week's budget it goes, and an optional note for the buyer. Approving releases it to Levy's agencies in order; declining tells Jordan why.",
    action: "Click Approve",
    targets: () => [one('[data-tour="approval"]')],
    placement: "bottom",
    done: (ctx) => {
      const status = bigOrder(ctx)?.approval?.status
      return !!status && status !== "pending"
    },
    success: (ctx) => (bigOrder(ctx)?.approval?.status === "approved" ? "Approved and released to Instawork" : "Declined. Jordan has been told"),
    skip: (ctx) => {
      const g = bigOrder(ctx)
      if (g) void useStore.getState().decideApproval([g.id], "approve")
    },
  },

  /* ----------------------- 3. Assignment and compliance ---------------------- */
  {
    kind: "chapter",
    id: "chapter-compliance",
    chapter: "compliance",
    title: "Assignment and compliance",
    line: "Every agency, one standard, checked before every shift.",
    wsId: CREWLINE,
    href: "/shifts",
    shows: "Assign a Crewline Pro to a Levy shift and see who Iris keeps off it and why.",
  },
  {
    kind: "step",
    id: "released",
    chapter: "compliance",
    wsId: CREWLINE,
    path: /^\/shifts/,
    href: () => "/shifts",
    title: "Shifts released to Crewline",
    body: (ctx) => {
      const g = assignable(ctx.data)
      return g
        ? `Crewline sees only what buyers released to it. ${location(g.locationId).name} needs ${plural(g.slots.length - filledCount(g), position(g.positionId).name.toLowerCase())} on ${formatDay(g.date, "EEEE")}.`
        : "Crewline sees only the shifts buyers released to it."
    },
    action: "Open the highlighted shift",
    targets: (ctx) => {
      const g = assignable(ctx.data)
      return [g && one(`tr[data-row-id="${g.id}"]`)]
    },
    placement: "bottom",
    done: (ctx) => {
      const id = ctx.path.match(/^\/shifts\/(sg-\d+)$/)?.[1]
      const g = id ? ctx.data.groups.find((x) => x.id === id) : undefined
      return !!g && isOpenTo(g, "crewline") && filledCount(g) < g.slots.length
    },
    onDone: (ctx, api) => api.remember({ groupId: ctx.path.split("/")[2] }),
    skip: (ctx, api) => {
      const g = assignable(ctx.data)
      if (!g) return
      api.remember({ groupId: g.id })
      api.push(`/shifts/${g.id}`)
    },
  },
  {
    kind: "step",
    id: "assign-open",
    chapter: "compliance",
    wsId: CREWLINE,
    path: /^\/shifts\/sg-/,
    href: (ctx) => `/shifts/${assignGroup(ctx)?.id ?? ""}`,
    title: "Assign from Crewline's roster",
    body: "The agency assigns its own Pros. Levy sees each one, with their agency, the moment they're on.",
    action: "Click Assign Pros",
    targets: () => [one('[data-tour="assign"]')],
    placement: "bottom",
    done: () => !!one('[data-tour="assign-dialog"]'),
    skip: () => click('[data-tour="assign"]'),
  },
  {
    kind: "step",
    id: "assign-check",
    chapter: "compliance",
    wsId: CREWLINE,
    path: /^\/shifts\/sg-/,
    href: (ctx) => `/shifts/${assignGroup(ctx)?.id ?? ""}`,
    title: "Who can work it, and why not",
    body: (ctx) => {
      const c = crewlineCheck(ctx)
      if (!c) return "Iris lists who can work this shift and, for everyone else, the reason."
      const why = c.blocked ? ` ${fullName(c.blocked.p)}, rated ${c.blocked.p.rating.toFixed(2)}, shows "${c.blocked.check.reason}".` : ""
      return `${c.ready} of Crewline's ${c.pool} ${position(c.g.positionId).name.toLowerCase()}s in ${city(location(c.g.locationId).cityId).name} can work it.${why} The same check runs whoever assigns: the agency, the buyer, an upload, or Iris filling it.`
    },
    action: "Pick a Pro marked Ready, then Assign",
    targets: () => [one('[data-tour="assign-dialog"]')],
    placement: "right",
    done: assignedSince,
    success: () => "Assigned",
    back: "assign-open",
    skip: () => {
      click('[data-tour="assign-dialog"] [data-tour="assign-row"][data-ready]')
      later(() => click('[data-tour="assign-submit"]'))
    },
  },
  {
    kind: "chapter",
    id: "chapter-documents",
    chapter: "compliance",
    title: "Assignment and compliance",
    line: "The agency attests. Iris checks with the issuer. Compass sees only what fails.",
    wsId: METRO,
    href: "/",
    shows: "Clear a Pro Iris pulled off the schedule, then attest a document that doesn't check out.",
  },
  {
    kind: "step",
    id: "flagged-pros",
    chapter: "compliance",
    wsId: METRO,
    path: /^\/$/,
    href: () => "/",
    title: "Iris flags it first",
    body: (ctx) => {
      const n = blockedPros(ctx.data).length
      return `Metro's Dashboard leads with the ${plural(n, "Pro")} Iris won't place until a missing or expired document is current.`
    },
    action: "Open the to-do",
    targets: () => [one('[data-tour="todo-documents"]')],
    placement: "bottom",
    done: (ctx) => ctx.path === "/professionals",
    skip: (_, api) => api.push("/professionals?filter=not_compliant"),
  },
  {
    kind: "step",
    id: "pick-pro",
    chapter: "compliance",
    wsId: METRO,
    path: /^\/professionals$/,
    href: () => "/professionals?filter=not_compliant",
    title: "Expired means off the schedule",
    body: (ctx) => {
      const pro = chosenPro(ctx)
      const doc = blocker(pro)
      if (!pro || !doc) return "These Pros have a document that's missing or expired, so Iris won't place them. Open one."
      return `${pro.firstName}'s ${DOC[doc.id]} ${doc.state === "expired" ? "expired" : `is ${doc.state}`}, so Iris keeps them off every shift, from any buyer.`
    },
    action: "Click the highlighted Pro",
    targets: (ctx) => {
      if (ctx.params.get("filter") !== "not_compliant") return [one('[role="tab"][data-value="not_compliant"]')]
      const pro = chosenPro(ctx)
      return [(pro && one(`tr[data-row-id="${pro.id}"]`)) || one("tbody tr[data-row-id]")]
    },
    placement: "bottom",
    done: (ctx) => {
      const id = ctx.params.get("pro")
      const pro = id ? ctx.data.pros.find((p) => p.id === id) : undefined
      return !!pro && pro.supplierId === "metro" && standingOf(pro) === "not_compliant"
    },
    onDone: (ctx, api) => api.remember({ proId: ctx.params.get("pro") ?? undefined }),
    skip: (ctx, api) => {
      const pro = chosenPro(ctx)
      if (!pro) return
      api.remember({ proId: pro.id })
      api.push(`/professionals?filter=not_compliant&pro=${pro.id}`)
    },
  },
  {
    kind: "step",
    id: "renew-open",
    chapter: "compliance",
    wsId: METRO,
    path: /^\/professionals$/,
    href: (ctx) => (ctx.proId ? `/professionals?filter=not_compliant&pro=${ctx.proId}` : "/professionals?filter=not_compliant"),
    title: "Renew it",
    body: (ctx) => {
      const doc = blocker(chosenPro(ctx))
      return `Documents shows only what ${chosenPro(ctx)?.firstName ?? "this Pro"}'s roles need, with the ${doc ? DOC[doc.id] : "expired one"} at the top.`
    },
    action: "Click the highlighted button",
    targets: (ctx) => {
      const doc = blocker(chosenPro(ctx))
      return [doc ? one(`[data-tour="doc-action"][data-doc-id="${doc.id}"]`) : one('[data-tour="doc-action"]')]
    },
    placement: "left",
    anchor: () => one('[data-tour="doc-action"]')?.closest('[role="dialog"]'),
    done: (ctx) => {
      const doc = blocker(chosenPro(ctx))
      return !!doc && verifyingFor() === doc.id
    },
    onDone: (ctx, api) => api.remember({ docId: blocker(chosenPro(ctx))?.id }),
    back: "pick-pro",
    skip: (ctx, api) => {
      const doc = blocker(chosenPro(ctx))
      if (!doc) return
      api.remember({ docId: doc.id })
      click(`[data-tour="doc-action"][data-doc-id="${doc.id}"]`)
    },
  },
  {
    kind: "step",
    id: "renew-verify",
    chapter: "compliance",
    wsId: METRO,
    path: /^\/professionals$/,
    href: (ctx) => (ctx.proId ? `/professionals?filter=not_compliant&pro=${ctx.proId}` : "/professionals?filter=not_compliant"),
    title: "Attest it, and Iris checks with the issuer",
    body: (ctx) => {
      const doc = ctx.docId
      return `Attach the document and Iris reads the issuer, ${doc ? CHECKS[doc].reference.label.toLowerCase() : "reference"} and dates off it. Metro attests it's genuine and belongs to ${chosenPro(ctx)?.firstName ?? "the Pro"}, then Iris checks it with ${doc ? CHECKS[doc].providers[0] : "the issuer"} before clearing them.`
    },
    action: "Attach any file, tick the attestation, then Verify and clear",
    targets: () => [one('[data-tour="verify-dialog"]')],
    placement: "right",
    done: (ctx) => {
      const v = docItem(ctx)?.verification
      return v?.result === "verified" && v.at >= ctx.base.at
    },
    success: (ctx) => {
      const pro = chosenPro(ctx)
      const v = docItem(ctx)?.verification
      return pro && standingOf(pro) === "compliant" ? `Verified with ${v?.checkedWith ?? "the issuer"}. ${pro.firstName} is cleared to work` : `Verified with ${v?.checkedWith ?? "the issuer"}`
    },
    back: "renew-open",
    skip: (ctx) => {
      attach('[data-tour="verify-dialog"]', `${ctx.docId ?? "document"}.pdf`)
      submitVerify()
    },
  },
  {
    kind: "step",
    id: "held-open",
    chapter: "compliance",
    wsId: METRO,
    path: /^\/professionals$/,
    href: (ctx) => (ctx.proId ? `/professionals?filter=not_compliant&pro=${ctx.proId}` : "/professionals"),
    title: "When a document doesn't check out",
    body: (ctx) => {
      const spare = spareDoc(chosenPro(ctx), ctx.docId)
      return `Now ${chosenPro(ctx)?.firstName ?? "the Pro"}'s ${spare ? DOC[spare.id] : "next document"}, attested without the paperwork to back it.`
    },
    action: "Click the highlighted button",
    targets: (ctx) => {
      const spare = spareDoc(chosenPro(ctx), ctx.docId)
      return [spare && one(`[data-tour="doc-action"][data-doc-id="${spare.id}"]`)]
    },
    placement: "left",
    anchor: () => one('[data-tour="doc-action"]')?.closest('[role="dialog"]'),
    done: (ctx) => {
      const spare = spareDoc(chosenPro(ctx), ctx.docId)
      return !spare || verifyingFor() === spare.id
    },
    onDone: (ctx, api) => {
      const spare = spareDoc(chosenPro(ctx), ctx.docId)
      if (spare) api.remember({ docId: spare.id })
    },
    skip: (ctx, api) => {
      const spare = spareDoc(chosenPro(ctx), ctx.docId)
      if (!spare) return
      api.remember({ docId: spare.id })
      click(`[data-tour="doc-action"][data-doc-id="${spare.id}"]`)
    },
  },
  {
    kind: "step",
    id: "held-verify",
    chapter: "compliance",
    wsId: METRO,
    path: /^\/professionals$/,
    href: (ctx) => (ctx.proId ? `/professionals?filter=not_compliant&pro=${ctx.proId}` : "/professionals"),
    title: "Iris holds it for Compass",
    body: (ctx) => {
      const check = ctx.docId ? CHECKS[ctx.docId] : undefined
      return `With no attachment and a ${check ? check.reference.label.toLowerCase() : "reference"} the issuer has no record of, Iris doesn't clear it. It holds the document for Compass and keeps the Pro off shifts until someone decides.`
    },
    action: (ctx) => `Type 4471 as the ${ctx.docId ? CHECKS[ctx.docId].reference.label.toLowerCase() : "reference"}, tick the attestation, then verify`,
    targets: () => [one('[data-tour="verify-dialog"]')],
    placement: "right",
    done: (ctx) => held(ctx) || !ctx.docId,
    success: (ctx) => `${docItem(ctx)?.verification?.reason ?? "The issuer has no record of it"}. Held for Compass`,
    back: "held-open",
    skip: () => {
      fill(inside('[data-tour="verify-dialog"]', '[data-tour="verify-reference"]'), "4471")
      submitVerify()
    },
  },
  {
    kind: "chapter",
    id: "chapter-review",
    chapter: "compliance",
    title: "Assignment and compliance",
    line: "Compass reviews the exceptions, not every document.",
    wsId: COMPASS,
    href: "/",
    shows: "Decide on the document Iris couldn't verify, then see every agency's roster scored.",
    again: true,
  },
  {
    kind: "step",
    id: "review-todo",
    chapter: "compliance",
    wsId: COMPASS,
    path: /^\/$/,
    href: () => "/",
    title: "Only what Iris couldn't verify",
    body: "Every document Iris verified cleared on its own. The one it couldn't reaches Priya as a to-do.",
    action: "Open the to-do",
    targets: () => [one('[data-tour="todo-verify"]')],
    placement: "bottom",
    done: (ctx) => ctx.wsId === COMPASS && !!one('[data-tour="doc-accept"]'),
    skip: (ctx, api) => api.push(ctx.proId ? `/professionals?filter=not_compliant&pro=${ctx.proId}` : "/professionals?filter=not_compliant"),
  },
  {
    kind: "step",
    id: "review-decide",
    chapter: "compliance",
    wsId: COMPASS,
    path: /^\/professionals$/,
    href: (ctx) => (ctx.proId ? `/professionals?filter=not_compliant&pro=${ctx.proId}` : "/professionals?filter=not_compliant"),
    title: "Accept it or send it back",
    body: (ctx) => {
      const v = docItem(ctx)?.verification
      return `The document shows what Metro attested, who attested it, and what the issuer said${v?.reason ? `: "${v.reason}"` : ""}. Accepting clears it on Compass's word; sending it back returns it to Metro with a note.`
    },
    action: "Click Accept, or Send back with a note",
    targets: () => [one('[data-tour="doc-accept"]')],
    placement: "left",
    anchor: () => one('[data-tour="doc-accept"]')?.closest('[role="dialog"]'),
    done: (ctx) => !!ctx.docId && !held(ctx),
    success: (ctx) => (docItem(ctx)?.status === "complete" ? "Accepted by Compass" : "Sent back to Metro"),
    skip: (ctx) => {
      if (ctx.proId && ctx.docId) void useStore.getState().reviewDocument(ctx.proId, ctx.docId, "accept")
    },
  },
  {
    kind: "step",
    id: "scores-open",
    chapter: "compliance",
    wsId: COMPASS,
    path: /^\/professionals/,
    href: () => "/professionals",
    title: "One score per roster",
    body: "Decisions like that one add up to a number Compass can hold each agency to, instead of a stack of attestations.",
    action: "Open Agencies in the menu",
    targets: () => [one('nav a[href="/agencies"], aside a[href="/agencies"]')],
    placement: "right",
    done: (ctx) => ctx.path === "/agencies",
    skip: (_, api) => api.push("/agencies"),
  },
  {
    kind: "step",
    id: "scores",
    chapter: "compliance",
    wsId: COMPASS,
    path: /^\/agencies$/,
    href: () => "/agencies",
    title: "Compliance, scored",
    body: (ctx) => {
      const list = scored(ctx.data)
      const lead = "Each agency's roster out of 100: mostly the share of its Pros cleared to work today, the rest the share with nothing expiring in the next 30 days."
      if (list.length < 2) return lead
      const top = list[0]
      const low = list[list.length - 1]
      const off = low.c.active - low.c.cleared
      return `${lead} ${top.s.shortName} leads at ${top.c.score}. ${low.s.shortName} trails at ${low.c.score}${off ? `, with ${plural(off, "Pro")} kept off shifts` : ""}. Each agency's page shows the same score.`
    },
    targets: () => [one('[data-tour="agencies-table"]')],
    placement: "top",
    skip: () => undefined,
  },

  /* ------------------------------ 4. Timesheets ------------------------------ */
  {
    kind: "chapter",
    id: "chapter-agency-hours",
    chapter: "timesheets",
    title: "Timesheets",
    line: "Agencies stop uploading hours Iris already has.",
    wsId: HARBOR,
    href: "/timesheets",
    shows: "See the timesheets Iris drafted for Harbor from its clock, and let the ones that match go in on their own.",
  },
  {
    kind: "step",
    id: "agency-drafts",
    chapter: "timesheets",
    wsId: HARBOR,
    path: /^\/timesheets/,
    href: () => "/timesheets",
    title: "Already drafted",
    body: (ctx) => {
      const { waiting, matching } = harborDrafts(ctx.data)
      const lead = "Harbor sends hours by CSV. Iris drafts a timesheet for every finished shift from its own clock, the worker's check-in at the venue, so there's nothing to upload."
      return waiting.length ? `${lead} ${matching.length} of the ${plural(waiting.length, "timesheet")} waiting match the clock exactly; the rest have a missing punch or hours that differ.` : lead
    },
    targets: () => [one("table")],
    placement: "top",
    skip: () => undefined,
  },
  {
    kind: "step",
    id: "auto-submit",
    chapter: "timesheets",
    wsId: HARBOR,
    path: /^\/timesheets/,
    href: () => "/timesheets",
    title: "Let the clean ones go in",
    body: "With this on, every timesheet that matches the clock goes to the buyer for approval without Harbor touching it, starting with the ones waiting now. Only the exceptions stay with Harbor.",
    action: "Turn on Send clock-matched hours automatically",
    targets: () => [one('[data-tour="auto-submit"]')],
    placement: "bottom",
    done: (ctx) => !!ctx.data.settings?.autoSubmit?.includes("harbor"),
    success: () => "Clock-matched hours now go in on their own",
    skip: () => void useStore.getState().setAutoSubmit("harbor", true),
  },
  {
    kind: "chapter",
    id: "chapter-timesheets",
    chapter: "timesheets",
    title: "Timesheets",
    line: "Every billed hour, lined up against Iris's own clock.",
    wsId: LEVY,
    href: "/",
    shows: "Approve last night's hours: correct the one billed above the clock, split one by role, and approve the rest.",
    again: true,
  },
  {
    kind: "step",
    id: "hours-todo",
    chapter: "timesheets",
    wsId: LEVY,
    path: /^\/$/,
    href: () => "/",
    title: "Hours, checked before you see them",
    body: "Iris keeps its own clock: the Instawork app, or the worker's check-in at the venue. Every hour an agency bills is compared with it and with the schedule.",
    action: "Open the to-do",
    targets: () => [one('[data-tour="todo-approve"]')],
    placement: "bottom",
    done: (ctx) => ctx.path === "/timesheets" && !one('[data-tour="auto-submit"]'),
    skip: (_, api) => api.push("/timesheets"),
  },
  {
    kind: "step",
    id: "review-hours",
    chapter: "timesheets",
    wsId: LEVY,
    path: /^\/timesheets/,
    href: () => "/timesheets",
    title: "The one that doesn't match",
    body: (ctx) => {
      const t = paddedSheet(ctx.data)
      const lead = "Flagged timesheets come first. Where the clock disagrees with what was billed, it shows in red underneath."
      return t && t.clock ? `${lead} A Harbor bartender was billed ${t.hours} hours for last night's concert; Iris's clock shows ${clockHours(t.clock)}.` : lead
    },
    action: "Open the flagged timesheet",
    targets: () => [one(".tour-flagged")],
    placement: "bottom",
    done: () => !!one('[data-tour="timesheet-sheet"]'),
    skip: () => click(".tour-flagged"),
  },
  {
    kind: "step",
    id: "approve",
    chapter: "timesheets",
    wsId: LEVY,
    path: /^\/timesheets/,
    href: () => "/timesheets",
    title: "Approve at the clock's hours",
    body: "The schedule, the clock and what was billed side by side, with the times that differ marked. Iris proposes the clock's hours and the saving. Correct the times or reject it with a reason instead, and the reason goes on the record Harbor sees.",
    action: "Click Approve at the clock's hours",
    targets: () => [one('[data-tour="accept-proposal"]')],
    placement: "left",
    anchor: () => one('[data-tour="timesheet-sheet"]'),
    done: (ctx) => ctx.data.timesheets.some((t) => t.buyerId === "levy-chi" && t.history.some((h) => h.action === "corrected")),
    success: () => "Corrected to the clock and approved",
    back: "review-hours",
    skip: () => click('[data-tour="accept-proposal"]'),
  },
  {
    kind: "step",
    id: "move-pick",
    chapter: "timesheets",
    wsId: LEVY,
    path: /^\/timesheets/,
    href: () => "/timesheets",
    title: "Someone changed roles",
    body: (ctx) => {
      const m = movable(ctx.data)
      if (!m) return "On an event floor people move mid-shift. Open a timesheet to split it by role."
      const from = position(m.t.positionId).name.toLowerCase()
      const to = position(m.card.positionId).name.toLowerCase()
      return `${fullName(m.pro)} worked as ${article(from)} ${from} at ${location(m.t.locationId).name}. Say ${m.pro.firstName} moved to ${to} partway through: the hours after that bill at the ${to} rate.`
    },
    action: "Open the highlighted timesheet",
    targets: (ctx) => {
      const m = movable(ctx.data)
      return [m && one(`tr[data-row-id="${m.t.id}"]`)]
    },
    placement: "bottom",
    done: (ctx) => {
      const t = ctx.data.timesheets.find((x) => x.id === ctx.params.get("ts"))
      return !!t && t.status === "pending_approval" && !t.movedFrom && !t.movedTo && !timesheetChecks(t).length && !!one('[data-tour="split-role"]')
    },
    onDone: (ctx, api) => api.remember({ sheetId: ctx.params.get("ts") ?? undefined }),
    skip: (ctx, api) => {
      const m = movable(ctx.data)
      if (!m) return
      api.remember({ sheetId: m.t.id })
      api.push(`/timesheets?ts=${m.t.id}`)
    },
  },
  {
    kind: "step",
    id: "move-split",
    chapter: "timesheets",
    wsId: LEVY,
    path: /^\/timesheets/,
    href: (ctx) => (ctx.sheetId ? `/timesheets?ts=${ctx.sheetId}` : "/timesheets"),
    title: "Split it by role",
    body: "Without this, the whole shift bills at one rate, or an agency reissues the timesheet by hand.",
    action: "Click Split by role",
    targets: () => [one('[data-tour="split-role"]')],
    placement: "top",
    anchor: () => one('[data-tour="timesheet-sheet"]'),
    done: () => !!one('[data-tour="move-dialog"]'),
    back: "move-pick",
    skip: () => click('[data-tour="split-role"]'),
  },
  {
    kind: "step",
    id: "move-confirm",
    chapter: "timesheets",
    wsId: LEVY,
    path: /^\/timesheets/,
    href: (ctx) => (ctx.sheetId ? `/timesheets?ts=${ctx.sheetId}` : "/timesheets"),
    title: "Pick the role and the minute",
    body: (ctx) => {
      const t = tourSheet(ctx)
      const sup = t ? supplier(t.supplierId).shortName : "the agency"
      return `Only roles the Pro is cleared for, at ${sup}'s rate for each. The timesheet splits at that minute into two, each checked against its share of the clock, and the invoice bills each part at its own rate.`
    },
    action: "Pick a role, set when they switched, then Move",
    targets: () => [one('[data-tour="move-dialog"]')],
    placement: "right",
    done: (ctx) => !!movedSince(ctx),
    success: (ctx) => {
      const t = movedSince(ctx)
      return t?.movedFrom ? `Split in two: ${position(t.movedFrom.positionId).name} then ${position(t.positionId).name}` : "Split by role"
    },
    onDone: (_, api) => api.push("/timesheets"),
    back: "move-split",
    skip: (_, api) => {
      const rows = [...document.querySelectorAll<HTMLButtonElement>('[data-tour="move-dialog"] li button:not(:disabled)')]
      ;(rows.find((b) => b.textContent?.includes("Barback")) ?? rows[0])?.click()
      later(() => {
        click('[data-tour="move-submit"]')
        later(() => api.push("/timesheets"), 900)
      }, 200)
    },
  },
  {
    kind: "step",
    id: "approve-clean",
    chapter: "timesheets",
    wsId: LEVY,
    path: /^\/timesheets/,
    href: () => "/timesheets",
    title: "Approve the clean ones together",
    body: "These match the clock and the schedule. Approved hours go onto each agency's invoice for the week, which Iris issues on Saturday.",
    action: "Click Approve",
    targets: () => [one('[data-tour="approve-clean"]')],
    placement: "bottom",
    done: (ctx) => !ctx.data.timesheets.some((t) => t.buyerId === "levy-chi" && t.status === "pending_approval" && !timesheetChecks(t).length),
    success: (ctx) =>
      generated(ctx).length
        ? `Approved. Iris invoiced last week's hours on ${generated(ctx).map((i) => i.number).join(" and ")}`
        : `Approved. They're on ${plural(openInvoices(ctx).length, "open invoice")} for the week`,
    skip: () => click('[data-tour="approve-clean"]'),
  },
  {
    kind: "chapter",
    id: "chapter-invoices",
    chapter: "timesheets",
    title: "Timesheets",
    line: "What a buyer approves anyway still gets checked.",
    wsId: COMPASS,
    href: "/",
    shows: "Send back hours an invoice billed above the clock, and watch the agency credit them.",
    again: true,
  },
  {
    kind: "step",
    id: "anomalies",
    chapter: "timesheets",
    wsId: COMPASS,
    path: /^\/$/,
    href: () => "/",
    title: "Invoices Iris flagged",
    body: "Every invoice is checked against Iris's clock, and against what the other agencies would charge for the same hours, weighted by how well each performs.",
    action: "Open the to-do",
    targets: () => [one('[data-tour="todo-anomalies"]')],
    placement: "bottom",
    done: (ctx) => ctx.path === "/invoices",
    skip: (_, api) => api.push("/invoices?filter=flagged"),
  },
  {
    kind: "step",
    id: "open-invoice",
    chapter: "timesheets",
    wsId: COMPASS,
    path: /^\/invoices/,
    href: () => "/invoices?filter=flagged",
    title: "Open the top one",
    body: (ctx) => {
      const inv = flagged(ctx.data)[0]
      if (!inv) return "Open a flagged invoice to see what Iris found."
      return `${inv.number} from ${supplier(inv.supplierId).shortName} has hours a buyer approved as billed, above Iris's clock.`
    },
    action: "Click the highlighted invoice",
    targets: (ctx) => {
      if (ctx.path !== "/invoices") return []
      if (ctx.params.get("filter") !== "flagged") return [one('[role="tab"][data-value="flagged"]')]
      const top = flagged(ctx.data)[0]
      return [(top && one(`tbody tr[data-row-id="${top.id}"]`)) || one("tbody tr[data-row-id]")]
    },
    placement: "bottom",
    done: (ctx) => {
      const id = ctx.path.match(/^\/invoices\/(inv-[\w-]+)$/)?.[1]
      const inv = id ? ctx.data.invoices.find((i) => i.id === id) : undefined
      return !!inv && needsReview(ctx.data, inv)
    },
    onDone: (ctx, api) => api.remember({ invoiceId: ctx.path.split("/")[2] }),
    skip: (ctx, api) => {
      const inv = flagged(ctx.data)[0]
      if (!inv) return
      api.remember({ invoiceId: inv.id })
      api.push(`/invoices/${inv.id}`)
    },
  },
  {
    kind: "step",
    id: "send-back",
    chapter: "timesheets",
    wsId: COMPASS,
    path: /^\/invoices\/inv-/,
    href: (ctx) => (ctx.invoiceId ? `/invoices/${ctx.invoiceId}` : "/invoices?filter=flagged"),
    title: "Send back what the clock doesn't support",
    body: (ctx) => {
      const inv = tourInvoice(ctx)
      const f = inv ? billingFindings(ctx.data, inv.id)[0] : undefined
      if (!inv || !f) return "Send back what Iris's clock doesn't support, and the agency credits it."
      return `${f.approvedBy} approved ${f.proName}'s hours as billed, ${f.hours} hours past Iris's clock. Sending them back asks ${supplier(inv.supplierId).shortName} to credit ${money(f.amount)}.`
    },
    action: "Click Send back for a credit",
    targets: () => [one('[data-tour="send-back"]') ?? one('[data-tour="billing-review"]')],
    anchor: () => one('[data-tour="billing-review"]'),
    placement: "bottom",
    done: (ctx) => {
      const inv = tourInvoice(ctx)
      return !inv || !!inv.billingReview || !billingFindings(ctx.data, inv.id).length
    },
    success: (ctx) => {
      const inv = tourInvoice(ctx)
      if (!inv?.billingReview) return "Nothing billed above the clock here"
      return inv.billingReview.status === "accepted" ? "Accepted as billed" : `Sent back to ${supplier(inv.supplierId).shortName}`
    },
    back: "open-invoice",
    skip: (ctx) => {
      if (ctx.invoiceId) void useStore.getState().decideBilling(ctx.invoiceId, "send_back")
    },
  },
  {
    kind: "step",
    id: "credit",
    chapter: "timesheets",
    wsId: COMPASS,
    path: /^\/invoices\/inv-/,
    href: (ctx) => (ctx.invoiceId ? `/invoices/${ctx.invoiceId}` : "/invoices?filter=flagged"),
    title: "The agency credits it",
    body: (ctx) => {
      const inv = tourInvoice(ctx)
      const sup = inv ? supplier(inv.supplierId).shortName : "The agency"
      if (inv?.billingReview?.status === "accepted") return "Accepted as billed, so the hours stay on the invoice as they are."
      return `${sup}'s system answers on its own. The credit comes off this invoice, and the timesheet is revised to the clock where ${sup} and Levy can both see it.`
    },
    targets: () => [one('[data-tour="billing-review"]')],
    placement: "bottom",
    status: (ctx) => {
      const inv = tourInvoice(ctx)
      const r = inv?.billingReview
      if (!inv || !r) return undefined
      const sup = supplier(inv.supplierId).shortName
      return r.status === "credited" ? `${sup} credited ${money(r.amount)}` : r.status === "sent_back" ? `Waiting on ${sup}` : undefined
    },
    skip: () => undefined,
  },

  /* ------------------------------- 5. Reporting ------------------------------ */
  {
    kind: "chapter",
    id: "chapter-reporting",
    chapter: "reporting",
    title: "Reporting",
    line: "Anyone can build the report they need, keep it, and have it arrive.",
    wsId: COMPASS,
    href: "/",
    shows: "Ask Iris a spend question, open the answer as a report, save it for the team and schedule it.",
    again: true,
  },
  {
    kind: "step",
    id: "predict-spend",
    chapter: "reporting",
    wsId: COMPASS,
    path: /^\/$/,
    href: () => "/",
    title: "Spend before the invoices arrive",
    body: "Iris compares each location's last seven days with its normal week and shows where spend is running hot, and which shifts will start short.",
    targets: () => [one('[data-tour="predictions"]')],
    placement: "top",
    skip: () => undefined,
  },
  {
    kind: "step",
    id: "ask-report",
    chapter: "reporting",
    wsId: COMPASS,
    path: /^\/$/,
    href: () => "/",
    title: "Ask for a number",
    body: "Iris answers with the totals and turns the question into a report.",
    action: "Send it with Enter",
    example: reportAsk,
    targets: () => [document.getElementById(COMPOSER_ID)?.closest('[data-slot="input-group"]')],
    placement: "top",
    done: (ctx) => !!reportLink(ctx),
    success: () => "Answered",
    skip: () => compose(COMPOSER_ID, reportAsk(), true),
  },
  {
    kind: "step",
    id: "open-report",
    chapter: "reporting",
    wsId: COMPASS,
    path: /^\/$/,
    href: () => "/",
    title: "Open it as a report",
    body: "The answer comes from the same numbers as every other screen: invoices, timesheets, the Dashboard.",
    action: "Click Open the report",
    targets: () => [last('[data-tour="agent-link"]')],
    placement: "bottom",
    done: (ctx) => ctx.path === "/reports",
    back: "ask-report",
    skip: (ctx, api) => api.push(reportLink(ctx) ?? "/reports"),
  },
  {
    kind: "step",
    id: "saved-reports",
    chapter: "reporting",
    wsId: COMPASS,
    path: /^\/reports/,
    href: (ctx) => reportLink(ctx) ?? "/reports",
    title: "Saved for the team",
    body: "Compass's own reports: weekly spend by agency, the agency scorecard, spend by location, cost per hour by market, and hours billed above the clock. A clock icon means it's emailed on a schedule.",
    targets: () => [one('[data-tour="saved-reports"]')],
    placement: "right",
    skip: () => undefined,
  },
  {
    kind: "step",
    id: "report-period",
    chapter: "reporting",
    wsId: COMPASS,
    path: /^\/reports/,
    href: (ctx) => reportLink(ctx) ?? "/reports",
    title: "Change it",
    body: "What to show, what to group and split it by, the period, and filters for buyer, unit, market, agency and role. The report redraws as you change it, and its link opens it the same way for anyone.",
    action: "Set Period to Last 28 days",
    targets: () => [one('[data-tour="report-builder"]')],
    placement: "bottom",
    done: (ctx) => ctx.params.get("period") === "last_28",
    skip: (ctx, api) => {
      const params = new URLSearchParams(ctx.params)
      params.set("period", "last_28")
      api.push(`/reports?${params}`)
    },
  },
  {
    kind: "step",
    id: "report-save",
    chapter: "reporting",
    wsId: COMPASS,
    path: /^\/reports/,
    href: (ctx) => reportLink(ctx) ?? "/reports",
    title: "Save it for the team",
    body: "Saved reports are shared with everyone at Compass, and only show what each person is allowed to see.",
    action: "Click Save report",
    targets: () => [one('[data-tour="report-save"]')],
    placement: "bottom",
    done: (ctx) => !!newReport(ctx),
    success: (ctx) => `Saved “${newReport(ctx)?.name ?? "the report"}”`,
    skip: () => click('[data-tour="report-save"]'),
  },
  {
    kind: "step",
    id: "report-schedule",
    chapter: "reporting",
    wsId: COMPASS,
    path: /^\/reports/,
    href: (ctx) => {
      const r = newReport(ctx)
      return r ? reportHref(r.spec, r.id) : "/reports"
    },
    title: "Have it arrive",
    body: "Pick how often, what time and who gets it. Iris emails the report with its numbers as of that morning.",
    action: "Click Email on a schedule and save one",
    targets: () => [one('[data-tour="report-schedule"]')],
    placement: "bottom",
    done: (ctx) => !!newReport(ctx)?.schedule,
    success: () => "Scheduled",
    skip: (ctx) => {
      const r = newReport(ctx)
      if (r) void useStore.getState().scheduleReport(r.id, { cadence: "weekly", time: "07:00", recipients: ["Priya Raman"] })
    },
  },

  { kind: "finale", id: "finale" },
]

export const STEPS = SCRIPT.filter((item): item is TourStep => item.kind === "step")

export const indexOf = (id: string) => SCRIPT.findIndex((item) => item.id === id)

