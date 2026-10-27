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
import { SUPPLIERS, location, position, supplier } from "@/lib/reference"
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
  wsId: string
  href: string
  /** What this part does, in a few words. */
  shows: string
}

export type TourItem = { kind: "intro"; id: "intro" } | TourChapter | TourStep | { kind: "finale"; id: "finale" }

export const CHAPTER_ORDER: ChapterId[] = ["onboarding", "shifts", "compliance", "timesheets", "reporting"]

export const CHAPTERS: Record<ChapterId, { number: number; label: string; short: string; icon: LucideIcon; fieldglass: string }> = {
  onboarding: {
    number: 1,
    label: "Onboarding",
    short: "Onboarding",
    icon: Building2,
    fieldglass: "Onboarding",
  },
  shifts: {
    number: 2,
    label: "Shift creation",
    short: "Shifts",
    icon: CalendarPlus,
    fieldglass: "Job Posting",
  },
  compliance: {
    number: 3,
    label: "Assignment and compliance",
    short: "Compliance",
    icon: ShieldCheck,
    fieldglass: "Job Seeker and Attestations",
  },
  timesheets: {
    number: 4,
    label: "Timesheets",
    short: "Timesheets",
    icon: Clock,
    fieldglass: "Timesheet",
  },
  reporting: {
    number: 5,
    label: "Reporting",
    short: "Reporting",
    icon: ChartColumn,
    fieldglass: "Reporting",
  },
}

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
    wsId: COMPASS,
    href: "/units",
    shows: "Add a unit and an agency, then check an agency's rates.",
  },
  {
    kind: "step",
    id: "units",
    chapter: "onboarding",
    wsId: COMPASS,
    path: /^\/units/,
    href: () => "/units",
    title: "Every unit on the program",
    body: "Every unit, with its cost center, roles and agencies.",
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
    "The cost center is what every invoice line for this unit is charged to.",
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
    "From the ZIP, Iris finds the market and the agencies that cover it.",
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
    "Iris shows right away how many Pros still qualify.",
    "Click Food handler card for every role, then Next",
    () => pressButton(UNIT, "Food handler card for every role"),
  ),
  unitStage(
    "unit-ordering",
    "Ordering",
    "Set what it orders and who signs off",
    "Orders over the weekly budget wait for Dana Ruiz.",
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
    body: "Nothing is saved until you add it.",
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
    body: "Its first order is priced, released and staffed without re-keying anything.",
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
    body: "Agencies have their own list.",
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
    body: "Insurance, rates and cleared Pros for every agency.",
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
    "The contact becomes the agency's first sign-in.",
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
    "Each market and role becomes a row on the rate card.",
    "Add Suite Attendant, then Next",
    () => pressButton(AGENCY, "Suite Attendant"),
  ),
  agencyStage(
    "agency-paperwork",
    "Paperwork",
    "Insurance and the master agreement",
    "Next stays off until the master agreement is signed.",
    "Tick Master services agreement signed, then Next",
    () => tick(AGENCY),
  ),
  agencyStage(
    "agency-rates",
    "Rate card",
    "The rate card",
    "Rates start at the Chicago market. Markups over the 45% cap are blocked.",
    "Check the rates, then Next",
    () => undefined,
  ),
  agencyStage(
    "agency-buyers",
    "Pros and buyers",
    "Its Pros and its buyers",
    "Northwind's 18 Pros come over, each checked as they arrive.",
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
    body: "Adding it creates the agency, its rates, Pros and approvals at once.",
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
      return `${plural(pros.length, "Pro")} came over${waiting ? `; ${waiting} wait on background checks` : ""}.`
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
    body: "Everything about one agency lives on its page.",
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
    body: "Harbor's bartender markup is 72%, over the 45% cap.",
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
    body: "Every rate change and who made it. Harbor's bartender rate jumped by CSV upload.",
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
    wsId: LEVY,
    href: "/",
    shows: "Book shifts in a sentence, send one over budget, and request Pros by name.",
  },
  {
    kind: "step",
    id: "predict-orders",
    chapter: "shifts",
    wsId: LEVY,
    path: /^\/$/,
    href: () => "/",
    title: "Orders Iris expects",
    body: "Iris drafts the recurring orders it sees coming.",
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
    body: "Priced from each agency's rate and checked against the budget. Nothing is booked yet.",
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
    body: "Forty bartenders takes the venue over its weekly budget.",
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
    body: "Over budget, so it goes to Dana Ruiz before any agency sees it.",
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
    body: "The first order is live. The second waits for Dana.",
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
      return g && filledCount(g) >= g.slots.length ? "Instawork filled it, so the other agencies never saw it." : "Instawork has it first. The next agencies see only what's left."
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
    body: "An order can also go to one agency, or to Pros you name.",
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
    body: "Levy's usual order is filled in.",
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
    body: "Favorites and Pros who've worked here, each checked for the date.",
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
    body: "Named Pros are booked first. The rest go out in release order.",
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
    wsId: DANA,
    href: "/approvals",
    shows: "Approve the order that went over budget.",
  },
  {
    kind: "step",
    id: "approve-order",
    chapter: "shifts",
    wsId: DANA,
    path: /^\/approvals/,
    href: () => "/approvals",
    title: "Approve or decline it",
    body: "Approving releases it to Levy's agencies. Declining tells Jordan why.",
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
    wsId: CREWLINE,
    href: "/shifts",
    shows: "Assign a Pro to a Levy shift.",
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
      return g ? `${location(g.locationId).name} needs ${plural(g.slots.length - filledCount(g), position(g.positionId).name.toLowerCase())} on ${formatDay(g.date, "EEEE")}.` : "Crewline sees only shifts released to it."
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
    body: "The agency assigns its own Pros.",
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
      if (!c) return "Iris shows who can work it, and why not."
      return `${c.ready} of ${c.pool} can work it.${c.blocked ? ` ${fullName(c.blocked.p)}: "${c.blocked.check.reason}".` : ""}`
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
    wsId: METRO,
    href: "/",
    shows: "Renew an expired document, then submit one that fails the check.",
  },
  {
    kind: "step",
    id: "flagged-pros",
    chapter: "compliance",
    wsId: METRO,
    path: /^\/$/,
    href: () => "/",
    title: "Iris flags it first",
    body: (ctx) => `${plural(blockedPros(ctx.data).length, "Pro")} can't work until a document is current.`,
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
      return pro && doc ? `${pro.firstName}'s ${DOC[doc.id]} ${doc.state === "expired" ? "expired" : `is ${doc.state}`}, so Iris won't place them.` : "Open a Pro Iris is keeping off shifts."
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
      return `Renew the ${doc ? DOC[doc.id] : "document"}.`
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
    body: (ctx) => `Metro attests it. Iris confirms it with ${ctx.docId ? CHECKS[ctx.docId].providers[0] : "the issuer"}.`,
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
      return `Now the ${spare ? DOC[spare.id] : "next document"}, attested without proof.`
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
    body: "The issuer has no record of it, so Iris holds it for Compass.",
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
    wsId: COMPASS,
    href: "/",
    shows: "Review the failed document and see each agency's score.",
  },
  {
    kind: "step",
    id: "review-todo",
    chapter: "compliance",
    wsId: COMPASS,
    path: /^\/$/,
    href: () => "/",
    title: "Only what Iris couldn't verify",
    body: "Verified documents clear themselves. Only this one reached Priya.",
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
      return `${v?.reason ? `The issuer: "${v.reason}". ` : ""}Accept it, or send it back to Metro.`
    },
    action: "Click Accept, or Send back with a note",
    targets: () => [one('[data-tour="doc-accept"]')],
    placement: "left",
    anchor: () => one('[data-tour="doc-accept"]')?.closest('[role="dialog"]'),
    done: (ctx) => !!ctx.docId && !held(ctx),
    success: (ctx) => (docItem(ctx)?.status === "complete" ? "Accepted by Compass" : "Sent back to Metro"),
    onDone: (_, api) => later(() => api.push("/professionals?filter=not_compliant"), 1100),
    skip: (ctx, api) => {
      if (ctx.proId && ctx.docId) void useStore.getState().reviewDocument(ctx.proId, ctx.docId, "accept")
      api.push("/professionals?filter=not_compliant")
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
    body: "Each agency gets a compliance score.",
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
      const lead = "Mostly the share of Pros cleared to work today."
      if (list.length < 2) return lead
      const top = list[0]
      const low = list[list.length - 1]
      return `${lead} ${top.s.shortName} leads at ${top.c.score}; ${low.s.shortName} trails at ${low.c.score}.`
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
    wsId: HARBOR,
    href: "/timesheets",
    shows: "Let timesheets that match the clock submit themselves.",
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
      return `Iris drafts every timesheet from its clock.${waiting.length ? ` ${matching.length} of ${waiting.length} match exactly.` : ""}`
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
    body: "Matching timesheets go to the buyer on their own. Exceptions stay with Harbor.",
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
    wsId: LEVY,
    href: "/",
    shows: "Approve last night's hours and split one by role.",
  },
  {
    kind: "step",
    id: "hours-todo",
    chapter: "timesheets",
    wsId: LEVY,
    path: /^\/$/,
    href: () => "/",
    title: "Hours, checked before you see them",
    body: "Every billed hour is checked against Iris's clock.",
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
      return t && t.clock ? `A Harbor bartender billed ${t.hours} hours; the clock shows ${clockHours(t.clock)}.` : "Flagged timesheets come first."
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
    body: "Approve at the clock's hours, or correct or reject it.",
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
      return m ? `Say ${m.pro.firstName} moved from ${position(m.t.positionId).name.toLowerCase()} to ${position(m.card.positionId).name.toLowerCase()} partway through.` : "Open a timesheet to split it by role."
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
    body: "So each role bills at its own rate.",
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
    body: "Only roles they're cleared for, at the agency's rates. The timesheet splits at that time.",
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
    body: "These match the clock and the schedule.",
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
    wsId: COMPASS,
    href: "/",
    shows: "Send back hours an invoice billed above the clock.",
  },
  {
    kind: "step",
    id: "anomalies",
    chapter: "timesheets",
    wsId: COMPASS,
    path: /^\/$/,
    href: () => "/",
    title: "Invoices Iris flagged",
    body: "Invoices are checked against the clock and other agencies' rates.",
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
      return inv ? `${inv.number} from ${supplier(inv.supplierId).shortName} bills hours above the clock.` : "Open a flagged invoice."
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
      return inv && f ? `${f.hours} hours past the clock. Ask ${supplier(inv.supplierId).shortName} to credit ${money(f.amount)}.` : "Send back what the clock doesn't support."
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
      if (inv?.billingReview?.status === "accepted") return "Accepted, so the invoice stays as billed."
      return `${inv ? supplier(inv.supplierId).shortName : "The agency"} credits it, and the timesheet is revised to the clock.`
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
    wsId: COMPASS,
    href: "/",
    shows: "Ask a spend question and save the answer as a scheduled report.",
  },
  {
    kind: "step",
    id: "predict-spend",
    chapter: "reporting",
    wsId: COMPASS,
    path: /^\/$/,
    href: () => "/",
    title: "Spend before the invoices arrive",
    body: "Where spend runs hot, and which shifts will start short.",
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
    body: "Iris answers and turns the question into a report.",
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
    body: "Same numbers as every other screen.",
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
    body: "Compass's saved reports. A clock icon means it's emailed on a schedule.",
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
    body: "It redraws as you change it.",
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
    body: "Saved reports are shared across Compass.",
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
    body: "Pick how often and who gets it.",
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

