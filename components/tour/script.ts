import { ReceiptText, ShieldCheck, SlidersHorizontal, type LucideIcon } from "lucide-react"

import type { AgentMessage } from "@/components/agent/agent-store"
import { compose } from "@/components/agent/agent-thread"
import { COMPOSER_ID } from "@/components/home/agent-home"
import type { TourBase } from "@/hooks/use-tour"
import { requirementRows } from "@/lib/compliance"
import { addDaysISO, formatDay, todayISO } from "@/lib/dates"
import { fullName } from "@/lib/format"
import { filledCount, invoiceBenchmark, needsReview } from "@/lib/metrics"
import { standingOf } from "@/lib/pro-profile"
import { supplier } from "@/lib/reference"
import { useStore } from "@/lib/store"
import type { DemoData, Pro, RequirementId } from "@/lib/types"

export type ChapterId = "control" | "compliance" | "cost"
export type Placement = "top" | "bottom" | "left" | "right"

/** Everything a step needs to decide where it is and whether the player has done it. */
export interface TourContext {
  path: string
  params: URLSearchParams
  wsId: string
  data: DemoData
  thread: AgentMessage[]
  base: TourBase
  proId?: string
  invoiceId?: string
}

export interface TourApi {
  push: (href: string) => void
  remember: (patch: { proId?: string; invoiceId?: string }) => void
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
  action?: string
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
  mission: string
  again?: boolean
}

export type TourItem = { kind: "intro"; id: "intro" } | TourChapter | TourStep | { kind: "finale"; id: "finale" }

export const CHAPTERS: Record<ChapterId, { number: number; label: string; icon: LucideIcon; blurb: string }> = {
  control: { number: 1, label: "Control", icon: SlidersHorizontal, blurb: "Book staff in one sentence and release it to your agencies in order." },
  compliance: { number: 2, label: "Compliance", icon: ShieldCheck, blurb: "See why a Pro is off the schedule, and clear them." },
  cost: { number: 3, label: "Cost", icon: ReceiptText, blurb: "Approve hours checked against the clock, then catch an overpriced invoice." },
}

const LEVY = "ws-levy"
const METRO = "ws-metro"
const COMPASS = "ws-compass"

const one = (selector: string) => document.querySelector(selector)
const last = (selector: string) => {
  const all = document.querySelectorAll(selector)
  return all[all.length - 1] ?? null
}
const click = (selector: string) => (one(selector) as HTMLElement | null)?.click()

export const askExample = () => `Create 8 bartender shifts at West Loop Arena on ${formatDay(addDaysISO(todayISO(), 9), "MMMM do")} from 4pm to 11pm`

const serial = (id: string) => Number(id.split("-")[1]) || 0

const booked = (ctx: TourContext) =>
  ctx.data.groups
    .filter((g) => g.buyerId === "levy-chi" && serial(g.id) >= ctx.base.sg)
    .sort((a, b) => serial(b.id) - serial(a.id))[0]

const generated = (ctx: TourContext) => ctx.data.invoices.filter((i) => serial(i.id) >= ctx.base.inv)

const hasDraft = (ctx: TourContext) => ctx.thread.some((m) => m.actions?.some((a) => a.kind === "create-shift"))

const DOC: Record<RequirementId, string> = {
  background: "background check",
  i9: "I-9",
  orientation: "Compass orientation",
  foodHandler: "food handler card",
  alcohol: "alcohol server cert",
}

const BLOCKING = ["expired", "missing", "pending"]

const blockedPros = (data: DemoData) =>
  data.pros
    .filter((p) => p.supplierId === "metro" && standingOf(p) === "not_compliant")
    .map((pro) => ({ pro, expired: requirementRows(pro).some((r) => r.state === "expired") }))
    .sort((a, b) => Number(b.expired) - Number(a.expired) || fullName(a.pro).localeCompare(fullName(b.pro)))
    .map((x) => x.pro)

const chosenPro = (ctx: TourContext): Pro | undefined => ctx.data.pros.find((p) => p.id === ctx.proId) ?? blockedPros(ctx.data)[0]

const blocker = (pro?: Pro) => (pro ? requirementRows(pro).find((r) => BLOCKING.includes(r.state)) : undefined)

const flagged = (data: DemoData) =>
  data.invoices.filter((i) => needsReview(data, i)).sort((a, b) => b.issuedOn.localeCompare(a.issuedOn) || b.number.localeCompare(a.number))

const pct = (value: number) => `${Math.trunc(value * 100)}%`

export const SCRIPT: TourItem[] = [
  { kind: "intro", id: "intro" },

  {
    kind: "chapter",
    id: "chapter-control",
    chapter: "control",
    title: "Control",
    line: "Book in a sentence. Release to your agencies in the order you set.",
    wsId: LEVY,
    href: "/",
    mission: "Staff a concert night at West Loop Arena.",
  },
  {
    kind: "step",
    id: "ask",
    chapter: "control",
    wsId: LEVY,
    path: /^\/$/,
    href: () => "/",
    title: "Just ask",
    body: "Tell Iris what you need in plain English. One sentence is enough.",
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
    chapter: "control",
    wsId: LEVY,
    path: /^\/$/,
    href: () => "/",
    title: "Check the draft",
    body: "Iris priced it from each agency's rate card and set the release order. Nothing is booked until you say so.",
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
    id: "open",
    chapter: "control",
    wsId: LEVY,
    path: /^\/$/,
    href: () => "/",
    title: "Open the shift",
    body: "It's live with your agencies. Let's see who picks it up.",
    action: "Click View created shift",
    targets: () => [last('[data-tour="agent-link"]')],
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
    chapter: "control",
    wsId: LEVY,
    path: /^\/shifts\/sg-/,
    href: (ctx) => {
      const g = booked(ctx)
      return g ? `/shifts/${g.id}` : "/shifts"
    },
    title: "Your agencies, in the order you set",
    body: (ctx) => {
      const g = booked(ctx)
      return g && filledCount(g) >= g.slots.length
        ? "Instawork got first look and filled every spot, so Crewline and Harbor never needed to see it."
        : "Instawork gets first look and is filling it now. Crewline and Harbor only see it if spots are still open four hours later."
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
    kind: "chapter",
    id: "chapter-compliance",
    chapter: "compliance",
    title: "Compliance",
    line: "Every agency. One standard.",
    wsId: METRO,
    href: "/",
    mission: "Find the Pro Iris pulled off the schedule, and clear them.",
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
      return `Iris checks every Pro's documents before every shift. ${n === 1 ? "One of yours needs" : `${n} of yours need`} attention.`
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
      return `${pro.firstName}'s ${DOC[doc.id]} ${doc.state === "expired" ? "expired" : `is ${doc.state}`}, so Iris keeps them off every shift. Open their profile.`
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
    id: "renew",
    chapter: "compliance",
    wsId: METRO,
    path: /^\/professionals$/,
    href: (ctx) => (ctx.proId ? `/professionals?filter=not_compliant&pro=${ctx.proId}` : "/professionals?filter=not_compliant"),
    title: "Renew it",
    body: (ctx) => `Add the new document and Iris clears ${chosenPro(ctx)?.firstName ?? "them"} for shifts again.`,
    action: "Click the highlighted button",
    targets: () => [
      one('[data-tour="doc-action"][data-doc-state="expired"]') ??
        one('[data-tour="doc-action"][data-doc-state="missing"]') ??
        one('[data-tour="doc-action"][data-doc-state="pending"]'),
    ],
    placement: "left",
    anchor: () => one('[data-tour="doc-action"]')?.closest('[role="dialog"]'),
    done: (ctx) => {
      const pro = ctx.data.pros.find((p) => p.id === ctx.proId)
      return !!pro && standingOf(pro) === "compliant"
    },
    success: (ctx) => `${chosenPro(ctx)?.firstName ?? "They're"} cleared to work`,
    back: "pick-pro",
    skip: (ctx) => {
      const pro = chosenPro(ctx)
      if (!pro) return
      const { completeRequirement } = useStore.getState()
      for (const row of requirementRows(pro)) if (BLOCKING.includes(row.state)) completeRequirement(pro.id, row.id)
    },
  },

  {
    kind: "chapter",
    id: "chapter-cost",
    chapter: "cost",
    title: "Cost",
    line: "Every hour checked against the clock.",
    wsId: LEVY,
    href: "/",
    mission: "Approve last week's hours. Iris writes the invoice.",
    again: true,
  },
  {
    kind: "step",
    id: "hours-todo",
    chapter: "cost",
    wsId: LEVY,
    path: /^\/$/,
    href: () => "/",
    title: "Hours, checked against the clock",
    body: "Agencies submit hours from real clock-ins. Iris lines each one up with the schedule before you see it.",
    action: "Open the to-do",
    targets: () => [one('[data-tour="todo-approve"]')],
    placement: "bottom",
    done: (ctx) => ctx.path === "/shifts",
    skip: (_, api) => api.push("/shifts?filter=hours"),
  },
  {
    kind: "step",
    id: "review-hours",
    chapter: "cost",
    wsId: LEVY,
    path: /^\/shifts/,
    href: () => "/shifts?filter=hours",
    title: "Review a shift's hours",
    body: "Open one shift to see every Pro's clock-in and clock-out.",
    action: "Click the highlighted button",
    targets: () => [one('[data-tour="hours-action"]') ?? one('[role="tab"][data-value="hours"]')],
    placement: "left",
    done: () => !!one('[data-tour="hours-dialog"]'),
    skip: () => click('[data-tour="hours-action"]'),
  },
  {
    kind: "step",
    id: "approve",
    chapter: "cost",
    wsId: LEVY,
    path: /^\/shifts/,
    href: () => "/shifts?filter=hours",
    title: "Approve, and the invoice writes itself",
    body: "Hours that don't match the schedule get a warning sign. When it all checks out, approve and Iris builds the agency's invoice.",
    action: "Click Approve",
    targets: () => [one('[data-tour="approve-hours"]')],
    placement: "bottom",
    anchor: () => one('[data-tour="hours-dialog"]'),
    done: (ctx) => generated(ctx).length > 0,
    success: (ctx) => `Iris generated ${generated(ctx).map((i) => i.number).join(" and ")}`,
    back: "review-hours",
    skip: () => click('[data-tour="approve-hours"]'),
  },

  {
    kind: "chapter",
    id: "chapter-program",
    chapter: "cost",
    title: "Cost",
    line: "Then Iris shows you where to cut it.",
    wsId: COMPASS,
    href: "/",
    mission: "Every agency's invoices land with you. Catch the one priced above the market.",
  },
  {
    kind: "step",
    id: "predict",
    chapter: "cost",
    wsId: COMPASS,
    path: /^\/$/,
    href: () => "/",
    title: "See spend before it happens",
    body: "Iris watches spend at every location and tells you where it's running hot, before the invoices arrive.",
    targets: () => [one('[data-tour="predictions"]')],
    placement: "top",
    skip: () => undefined,
  },
  {
    kind: "step",
    id: "anomalies",
    chapter: "cost",
    wsId: COMPASS,
    path: /^\/$/,
    href: () => "/",
    title: "Where to cut",
    body: "Iris prices every invoice against what the other agencies would charge for the same hours, weighted by how well each one performs.",
    action: "Open the to-do",
    targets: () => [one('[data-tour="todo-anomalies"]')],
    placement: "bottom",
    done: (ctx) => ctx.path === "/invoices",
    skip: (_, api) => api.push("/invoices?filter=flagged"),
  },
  {
    kind: "step",
    id: "open-invoice",
    chapter: "cost",
    wsId: COMPASS,
    path: /^\/invoices/,
    href: () => "/invoices?filter=flagged",
    title: "Open the top one",
    body: (ctx) => {
      const inv = flagged(ctx.data)[0]
      if (!inv) return "Open a flagged invoice to see how it compares."
      return `${inv.number} from ${supplier(inv.supplierId).shortName} came in ${pct(invoiceBenchmark(ctx.data, inv.id).deltaPct)} above its rating-weighted benchmark.`
    },
    action: "Click the highlighted invoice",
    targets: (ctx) => {
      if (ctx.path !== "/invoices") return []
      if (ctx.params.get("filter") !== "flagged") return [one('[role="tab"][data-value="flagged"]')]
      return [one("tbody tr[data-row-id]")]
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
    id: "review-invoice",
    chapter: "cost",
    wsId: COMPASS,
    path: /^\/invoices\/inv-/,
    href: (ctx) => (ctx.invoiceId ? `/invoices/${ctx.invoiceId}` : "/invoices?filter=flagged"),
    title: "Send it back, or clear it",
    body: "The benchmark prices the same hours at the other agencies' rates, weighted by rating. Send it back for correction, or mark it reviewed.",
    action: "Choose Send back or Mark reviewed",
    targets: () => [one('[data-tour="peer"]')],
    placement: "bottom",
    done: (ctx) => !!ctx.data.invoices.find((i) => i.id === ctx.invoiceId)?.review,
    success: (ctx) => {
      const inv = ctx.data.invoices.find((i) => i.id === ctx.invoiceId)
      return inv?.review?.status === "sent_back" ? `Sent back to ${supplier(inv.supplierId).shortName}` : "Cleared for payment"
    },
    back: "open-invoice",
    skip: (ctx) => {
      if (ctx.invoiceId) useStore.getState().reviewInvoice(ctx.invoiceId, "sent_back", "Rates are above the program benchmark for these hours.")
    },
  },

  { kind: "finale", id: "finale" },
]

export const STEPS = SCRIPT.filter((item): item is TourStep => item.kind === "step")

export const indexOf = (id: string) => SCRIPT.findIndex((item) => item.id === id)

/** What the finale checks off, in the order the film recaps it. */
export const RECAP: { label: string; step: string }[] = [
  { label: "Booked staff with one sentence", step: "create" },
  { label: "Released it to your agencies in order", step: "watch" },
  { label: "Cleared a Pro with an expired document", step: "renew" },
  { label: "Approved hours checked against the clock", step: "approve" },
  { label: "Caught an invoice priced above the market", step: "review-invoice" },
]
