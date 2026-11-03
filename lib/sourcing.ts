import { addDaysISO } from "@/lib/dates"
import { billFrom, money, round2 } from "@/lib/format"
import { benchmark } from "@/lib/market"
import { hashString } from "@/lib/random"
import { POSITIONS, SUPPLIERS, afterVa, city, position, supplier, termsOf } from "@/lib/reference"
import type { Bid, BidLine, ContractTerms, DemoData, RateCard, SourcingEvent, SourcingLine, SourcingMessage } from "@/lib/types"

/**
 * Sourcing events: Compass invites agencies to price their roles in each market for the fiscal year, compares the bids side by
 * side, counters line by line, and approves each agency's final prices. Approval is what writes the rate cards, so
 * every rate on the program traces back to the round that won it. Bids compare after VA, the rebate each agency pays
 * back at year end, so a higher rate with a bigger rebate can be the better buy.
 */

export const CATEGORY = "Temporary labor"

/** Hours a year Compass expects to buy per role in Chicago. Other markets scale from it. */
const CHICAGO_HOURS: Record<string, number> = {
  bartender: 22000,
  barback: 9500,
  server: 31000,
  concessions: 48000,
  cashier: 26000,
  suite: 12000,
  linecook: 18000,
  prepcook: 11000,
  dishwasher: 14000,
  porter: 8000,
}
const MARKET_SCALE: Record<string, number> = { chi: 1, atl: 0.7, dal: 0.55 }

/** The lowest markup each agency goes to when Compass pushes. */
const FLOOR_MARKUP: Record<string, number> = { instawork: 28, crewline: 30, harbor: 38, metro: 30 }
const floorOf = (supplierId: string) => FLOOR_MARKUP[supplierId] ?? 30

export const estimatedHours = (positionId: string, cityId: string) =>
  Math.round(((CHICAGO_HOURS[positionId] ?? 8000) * (MARKET_SCALE[cityId] ?? 0.6)) / 100) * 100

/** Compass's fiscal year runs October to September. */
export function fiscalYear(today: string) {
  const [y, m] = today.split("-").map(Number)
  const start = m >= 10 ? y : y - 1
  return { label: `FY${String(start + 1).slice(2)}`, start: `${start}-10-01`, end: `${start + 1}-09-30` }
}

export const activeCard = (cards: RateCard[], supplierId: string, cityId: string, positionId: string) =>
  cards.find((c) => c.supplierId === supplierId && c.cityId === cityId && c.positionId === positionId && c.status === "active")

/** One line per role, with each agency's rate today as its baseline and its share of the hours from its program share. */
export function buildLines(cards: RateCard[], cityId: string, positionIds: string[], supplierIds: string[]): SourcingLine[] {
  return positionIds.map((positionId) => {
    const baseline: Record<string, number> = {}
    for (const s of supplierIds) {
      const card = activeCard(cards, s, cityId, positionId)
      if (card) baseline[s] = card.billRate
    }
    const carrying = Object.keys(baseline)
    const total = carrying.reduce((sum, s) => sum + supplier(s).profile.share, 0)
    const share = Object.fromEntries(carrying.map((s) => [s, total ? round2(supplier(s).profile.share / total) : 1 / carrying.length]))
    return { id: `${cityId}-${positionId}`, cityId, positionId, hours: estimatedHours(positionId, cityId), baseline, share }
  })
}

/** An event's lines: every role in every market, leaving out the ones no invited agency carries there. */
export const eventLines = (cards: RateCard[], cityIds: string[], positionIds: string[], supplierIds: string[]) =>
  cityIds.flatMap((c) => buildLines(cards, c, positionIds, supplierIds)).filter((l) => Object.keys(l.baseline).length)

/** The markets an agency bids in on this event. */
export const marketsOf = (ev: SourcingEvent, supplierId: string) => ev.cityIds.filter((c) => ev.lines.some((l) => l.cityId === c && l.baseline[supplierId] !== undefined))

/** The roles an agency bids on across its markets, counted once each. */
export const rolesOf = (ev: SourcingEvent, supplierId: string) => [...new Set(ev.lines.filter((l) => l.baseline[supplierId] !== undefined).map((l) => l.positionId))]

/** An agency's markup across its lines, weighted by its hours: on its latest bid, and on its rate cards today. */
export function markupOf(ev: SourcingEvent, cards: RateCard[], supplierId: string) {
  let hours = 0
  let bid = 0
  let today = 0
  const latest = latestBid(ev, supplierId)
  for (const line of ev.lines) {
    if (line.baseline[supplierId] === undefined) continue
    const h = line.hours * (line.share[supplierId] ?? 0)
    const card = activeCard(cards, supplierId, line.cityId, line.positionId)
    hours += h
    bid += h * (latest?.lines[line.id]?.markupPct ?? card?.markupPct ?? 0)
    today += h * (card?.markupPct ?? 0)
  }
  return { bid: hours ? bid / hours : 0, today: hours ? today / hours : 0, bidding: !!latest }
}

/**
 * Of every dollar Compass pays an agency on its latest bid: what reaches the worker as pay, what the agency keeps of its
 * markup after VA, and what comes back to Compass as VA. The three add up to one.
 */
export function dollarSplit(ev: SourcingEvent, cards: RateCard[], supplierId: string) {
  const markup = markupOf(ev, cards, supplierId).bid
  const vaPct = offeredTerms(ev, supplierId).vaPct
  const worker = 1 / (1 + markup / 100)
  const back = vaPct / 100
  return { worker, agency: Math.max(0, 1 - worker - back), back, markup, vaPct }
}

/** What an agency bills Compass in a year on its rate cards today, at its share of each market's hours. */
export function yearlySpend(cards: RateCard[], supplierId: string) {
  let total = 0
  for (const cityId of supplier(supplierId).cityIds) {
    const carrying = SUPPLIERS.filter((s) => s.cityIds.includes(cityId)).map((s) => s.id)
    for (const line of buildLines(cards, cityId, roles, carrying)) {
      const rate = line.baseline[supplierId]
      if (rate !== undefined) total += line.hours * (line.share[supplierId] ?? 0) * rate
    }
  }
  return total
}

export const latestBid = (ev: SourcingEvent, supplierId: string): Bid | undefined =>
  ev.bids.reduce<Bid | undefined>((best, b) => (b.supplierId === supplierId && (!best || b.round > best.round) ? b : best), undefined)

export const bidsOf = (ev: SourcingEvent, supplierId: string) => ev.bids.filter((b) => b.supplierId === supplierId).sort((a, b) => a.round - b.round)

export const responded = (ev: SourcingEvent) => ev.invited.filter((s) => latestBid(ev, s))

/** The terms an agency offers on this event: its latest bid's, else the ones it has now. */
export const offeredTerms = (ev: SourcingEvent, supplierId: string): ContractTerms => latestBid(ev, supplierId)?.terms ?? termsOf(supplierId)

/** A bid line's rate after the VA its agency offers on this event. */
export const netOf = (ev: SourcingEvent, supplierId: string, billRate: number) => afterVa(billRate, offeredTerms(ev, supplierId).vaPct)

/** An agency's terms now: the ones on its most recently approved bid that came with terms, else its contract's. */
export function termsNow(events: SourcingEvent[], supplierId: string): ContractTerms {
  const approved = events
    .filter((e) => e.approved[supplierId] && latestBid(e, supplierId)?.terms)
    .sort((a, b) => b.approved[supplierId].localeCompare(a.approved[supplierId]))[0]
  return approved ? latestBid(approved, supplierId)!.terms! : termsOf(supplierId)
}

export const openCounters = (ev: SourcingEvent, supplierId?: string) => ev.messages.filter((m) => m.open && (!supplierId || m.supplierId === supplierId))

export type Stage = "collecting" | "negotiating" | "awarded"

export function stageOf(ev: SourcingEvent, today: string): Stage {
  if (ev.status === "awarded") return "awarded"
  return responded(ev).length === ev.invited.length || today > ev.closesOn ? "negotiating" : "collecting"
}

export const STAGE_LABEL: Record<Stage, string> = { collecting: "Collecting bids", negotiating: "Negotiating", awarded: "Approved" }

/** The rate a line is bought at from an agency: its latest bid, or what it charges today if it hasn't bid. */
const rateFor = (ev: SourcingEvent, line: SourcingLine, supplierId: string) => latestBid(ev, supplierId)?.lines[line.id]?.billRate ?? line.baseline[supplierId]

/**
 * Spend a year on today's rates, on the latest bids at today's shares, and with every hour at the best bid. It's after
 * VA, which is what Compass really pays, unless `gross` asks for what the agencies bill.
 */
export function spendOf(ev: SourcingEvent, supplierId?: string, gross = false) {
  const was = (s: string, r: number) => (gross ? r : afterVa(r, termsOf(s).vaPct))
  const offered = (s: string, r: number) => (gross ? r : netOf(ev, s, r))
  let baseline = 0
  let proposed = 0
  let lowest = 0
  for (const line of ev.lines) {
    const agencies = Object.keys(line.baseline).filter((s) => !supplierId || s === supplierId)
    for (const s of agencies) {
      const hours = line.hours * (line.share[s] ?? 0)
      baseline += hours * was(s, line.baseline[s])
      proposed += hours * offered(s, rateFor(ev, line, s) ?? line.baseline[s])
    }
    const bids = Object.keys(line.baseline).flatMap((s) => {
      const r = latestBid(ev, s)?.lines[line.id]?.billRate
      return r === undefined ? [] : [offered(s, r)]
    })
    if (!supplierId) lowest += line.hours * (bids.length ? Math.min(...bids) : Math.min(...Object.entries(line.baseline).map(([s, r]) => was(s, r))))
  }
  return { baseline, proposed, lowest, savings: baseline - proposed, savingsPct: baseline ? (baseline - proposed) / baseline : 0 }
}

/** The agency with the lowest bid on a line after VA. */
export function bestOn(ev: SourcingEvent, lineId: string) {
  let best: { supplierId: string; billRate: number; net: number } | undefined
  for (const s of ev.invited) {
    const r = latestBid(ev, s)?.lines[lineId]?.billRate
    if (r === undefined) continue
    const net = netOf(ev, s, r)
    if (!best || net < best.net) best = { supplierId: s, billRate: r, net }
  }
  return best
}

/** Who counters on Compass's behalf when Iris negotiates. */
export const IRIS = "Iris"

export interface PlannedCounter {
  supplierId: string
  lineId: string
  from: number
  ask: number
  /** A year at the agency's share of the hours, after its VA, if it meets the ask. */
  saves: number
}

/**
 * The counters Iris would send: every bid above the market median that isn't approved and hasn't been countered on that
 * role, asked down to the median but never more than 5% in one go. Biggest savings first.
 */
export function counterPlan(ev: SourcingEvent): PlannedCounter[] {
  if (ev.status !== "open") return []
  const plan: PlannedCounter[] = []
  for (const line of ev.lines) {
    const median = benchmark(line.cityId, line.positionId).median
    for (const s of ev.invited) {
      const bid = latestBid(ev, s)?.lines[line.id]
      if (!bid || ev.approved[s] || bid.billRate <= median) continue
      if (ev.messages.some((m) => m.from === "compass" && m.supplierId === s && m.lineId === line.id)) continue
      const ask = round2(Math.max(median, bid.billRate * 0.95))
      if (ask >= bid.billRate) continue
      const hours = line.hours * (line.share[s] ?? 0)
      plan.push({ supplierId: s, lineId: line.id, from: bid.billRate, ask, saves: afterVa(hours * (bid.billRate - ask), offeredTerms(ev, s).vaPct) })
    }
  }
  return plan.sort((a, b) => b.saves - a.saves)
}

export type CounterOutcome = "waiting" | "met" | "down" | "held"

/** Every counter Iris sent on this event, with where the agency's rate stands now. */
export function irisCounters(ev: SourcingEvent) {
  return ev.messages
    .filter((m) => m.from === "compass" && m.by === IRIS && m.ask !== undefined && m.lineId)
    .map((m) => {
      const before = bidsOf(ev, m.supplierId).filter((b) => b.at <= m.at).pop()?.lines[m.lineId!]?.billRate ?? m.ask!
      const now = latestBid(ev, m.supplierId)?.lines[m.lineId!]?.billRate ?? before
      const outcome: CounterOutcome = m.open ? "waiting" : now <= m.ask! ? "met" : now < before ? "down" : "held"
      const line = lineOf(ev, m.lineId!)
      const saves = afterVa(line.hours * (line.share[m.supplierId] ?? 0) * (before - now), offeredTerms(ev, m.supplierId).vaPct)
      return { message: m, supplierId: m.supplierId, lineId: m.lineId!, from: before, ask: m.ask!, now, outcome, saves }
    })
}

export const lineOf = (ev: SourcingEvent, lineId: string) => ev.lines.find((l) => l.id === lineId)!

export const lineLabel = (ev: SourcingEvent, lineId: string) => position(lineOf(ev, lineId).positionId).name

/** The role and, when the event spans markets, where: "Bartender in Chicago". */
export const lineName = (ev: SourcingEvent, lineId: string) => {
  const line = lineOf(ev, lineId)
  return ev.cityIds.length > 1 ? `${position(line.positionId).name} in ${city(line.cityId).name}` : position(line.positionId).name
}

export const bidLine = (proRate: number, markupPct: number): BidLine => ({ proRate: round2(proRate), markupPct: round2(markupPct), billRate: billFrom(proRate, markupPct) })

const messageId = (ev: SourcingEvent) => `${ev.id}-m${ev.messages.length + 1}`

/**
 * How an agency answers a counter it can live with: it meets the ask if that still clears its floor markup, comes down
 * to its floor if not, and holds if its bid is already there.
 */
export function agencyAnswer(ev: SourcingEvent, counter: SourcingMessage, now: string): { event: SourcingEvent; text: string } | undefined {
  const bid = latestBid(ev, counter.supplierId)
  const line = counter.lineId ? bid?.lines[counter.lineId] : undefined
  if (!bid || !line || counter.ask === undefined) return undefined
  const s = supplier(counter.supplierId)
  const role = lineName(ev, counter.lineId!)
  const floor = billFrom(line.proRate, floorOf(s.id))
  const target = round2(Math.max(counter.ask, floor))
  const messages = ev.messages.map((m) => (m.id === counter.id ? { ...m, open: false } : m))
  if (target >= line.billRate) {
    const text = `We're at our floor on ${role}. Pay is ${money(line.proRate)}, so ${money(line.billRate)} is as low as we can go.`
    return { event: { ...ev, messages: [...messages, reply(ev, s.id, s.contactName, text, counter.lineId, now)] }, text: `${s.shortName} is holding at ${money(line.billRate)} on ${role}` }
  }
  const met = target === round2(counter.ask)
  const next: Bid = {
    supplierId: s.id,
    round: bid.round + 1,
    at: now,
    by: s.contactName,
    lines: { ...bid.lines, [counter.lineId!]: bidLine(line.proRate, (target / line.proRate - 1) * 100) },
    ...(bid.terms ? { terms: bid.terms } : {}),
  }
  const text = met ? `We can do ${money(target)} on ${role}.` : `We can come down to ${money(target)} on ${role}. Below that we can't cover pay and burden.`
  return {
    event: { ...ev, bids: [...ev.bids, next], messages: [...messages, reply(ev, s.id, s.contactName, text, counter.lineId, now)] },
    text: met ? `${s.shortName} met your ask on ${role}: ${money(target)}` : `${s.shortName} came down to ${money(target)} on ${role}`,
  }
}

const reply = (ev: SourcingEvent, supplierId: string, by: string, text: string, lineId: string | undefined, at: string): SourcingMessage => ({
  id: messageId(ev),
  at,
  by,
  supplierId,
  from: "agency",
  text,
  lineId,
})

export const nextNumber = (events: SourcingEvent[], today: string) => {
  const fy = fiscalYear(today).label.slice(2)
  const n = events.filter((e) => e.number.startsWith(`RFP-${fy}-`)).length + 1
  return `RFP-${fy}-${String(n).padStart(2, "0")}`
}

/* ---------------------------------- Seed ---------------------------------- */

const at = (date: string, hour: number) => new Date(`${date}T${String(hour).padStart(2, "0")}:00:00`).toISOString()

/** What each agency offers for the new term. Instawork keeps its 12% VA on a three-year renewal. */
const OFFERED: Record<string, ContractTerms> = {
  instawork: { vaPct: 12, vaTiers: [[0, 8], [2_000_000, 10], [4_000_000, 12]], netDays: 30, years: 3 },
  crewline: { vaPct: 12, vaTiers: [[0, 8], [1_000_000, 10], [2_500_000, 12]], netDays: 45, years: 2 },
  harbor: { vaPct: 5, vaTiers: [[0, 3], [1_500_000, 5], [3_000_000, 8]], netDays: 45, years: 1 },
  metro: { vaPct: 10, vaTiers: [[0, 6], [1_500_000, 10], [3_000_000, 12]], netDays: 15, years: 2 },
}
const offerOf = (supplierId: string) => (OFFERED[supplierId] ? { terms: OFFERED[supplierId] } : {})

/** Metro is raising wages to fix its fill rate, so its prices go up while the others sharpen theirs. */
const WAGE_BUMP: Record<string, number> = { metro: 1.045, harbor: 1.015 }

/** A first-round bid: wages go up a little, markup comes down a little, the same every time for an agency and role. */
function firstRound(lines: SourcingLine[], cards: RateCard[], supplierId: string, cut: number, override: Record<string, number> = {}) {
  const out: Record<string, BidLine> = {}
  for (const line of lines) {
    const card = activeCard(cards, supplierId, line.cityId, line.positionId)
    if (!card) continue
    const h = hashString(`${supplierId}:${line.cityId}:${line.positionId}`)
    const pay = Math.round(card.proRate * ((WAGE_BUMP[supplierId] ?? 1.01) + (h % 3) * 0.005) * 4) / 4
    const markup = override[line.id] ?? Math.max(floorOf(supplierId) + 1, Math.round((card.markupPct - cut - ((h >>> 4) % 3) * 0.5) * 10) / 10)
    out[line.id] = bidLine(pay, markup)
  }
  return out
}

const roles = POSITIONS.map((p) => p.id)
const MARKETS = ["chi", "atl", "dal"]

/** Last year's award, and this year's renewal mid-negotiation: every agency on the program, across all its markets. */
export function seedSourcing(data: Pick<DemoData, "rateCards">, today: string): SourcingEvent[] {
  const cards = data.rateCards
  const fy = fiscalYear(today)
  const lastFy = fiscalYear(addDaysISO(fy.start, -1))

  const invited = SUPPLIERS.filter((s) => s.cityIds.some((c) => MARKETS.includes(c))).map((s) => s.id)
  const lines = eventLines(cards, MARKETS, roles, invited)
  const cut: Record<string, number> = { instawork: 6, crewline: 5.5, harbor: 2.5, metro: 0.5 }
  const bids: Bid[] = invited.map((s, i) => ({
    supplierId: s,
    round: 1,
    at: at(addDaysISO(today, -11 + i), 14 + i),
    by: supplier(s).contactName,
    lines: firstRound(lines, cards, s, cut[s] ?? 3, s === "harbor" ? { "chi-bartender": 45, "chi-suite": 44.5 } : {}),
    ...offerOf(s),
  }))
  const bartender = lines.find((l) => l.id === "chi-bartender")!
  const barback = lines.find((l) => l.id === "chi-barback")!
  const harborR1 = bids.find((b) => b.supplierId === "harbor")!
  const crewR1 = bids.find((b) => b.supplierId === "crewline")!
  const fieldBartender = Math.min(...bids.filter((b) => b.supplierId !== "harbor").map((b) => b.lines[bartender.id]?.billRate ?? Infinity))
  const harborAsk = round2(fieldBartender * 1.04)
  const harborPay = harborR1.lines[bartender.id].proRate
  const harborR2: Bid = {
    supplierId: "harbor",
    round: 2,
    at: at(addDaysISO(today, -4), 11),
    by: "Renee Park",
    lines: { ...harborR1.lines, [bartender.id]: bidLine(harborPay, Math.min(44.5, Math.max(floorOf("harbor"), (harborAsk / harborPay - 1) * 100 + 2))) },
    note: "Revised bartender rate after Compass's counter.",
    ...offerOf("harbor"),
  }
  const crewAsk = round2(crewR1.lines[barback.id].billRate * 0.97)
  const crewR2: Bid = {
    supplierId: "crewline",
    round: 2,
    at: at(addDaysISO(today, -3), 16),
    by: "Devon Brooks",
    lines: { ...crewR1.lines, [barback.id]: bidLine(crewR1.lines[barback.id].proRate, (crewAsk / crewR1.lines[barback.id].proRate - 1) * 100) },
    ...offerOf("crewline"),
  }
  const renewal: SourcingEvent = {
    id: "rfp-27",
    number: `RFP-${fy.label.slice(2)}-01`,
    title: `${fy.label} rate renewal`,
    category: CATEGORY,
    cityIds: MARKETS,
    status: "open",
    createdBy: "Priya Raman",
    openedAt: at(addDaysISO(today, -27), 9),
    closesOn: addDaysISO(today, -6),
    termStart: fy.start,
    termEnd: fy.end,
    lines,
    invited,
    bids: [...bids, harborR2, crewR2],
    messages: [
      {
        id: "rfp-27-m1",
        at: at(addDaysISO(today, -5), 10),
        by: "Priya Raman",
        supplierId: "harbor",
        from: "compass",
        lineId: bartender.id,
        ask: harborAsk,
        text: `Your Chicago Bartender rate is well above the field. Can you get to ${money(harborAsk)}?`,
      },
      {
        id: "rfp-27-m2",
        at: harborR2.at,
        by: "Renee Park",
        supplierId: "harbor",
        from: "agency",
        lineId: bartender.id,
        text: `We can come down to ${money(harborR2.lines[bartender.id].billRate)}. Our bartenders are alcohol-certified and work the premium suites.`,
      },
      {
        id: "rfp-27-m3",
        at: at(addDaysISO(today, -4), 15),
        by: "Priya Raman",
        supplierId: "crewline",
        from: "compass",
        lineId: barback.id,
        ask: crewAsk,
        text: `Can you sharpen Chicago Barback to ${money(crewAsk)}? It's our third-largest line at the stadiums.`,
      },
      {
        id: "rfp-27-m4",
        at: crewR2.at,
        by: "Devon Brooks",
        supplierId: "crewline",
        from: "agency",
        lineId: barback.id,
        text: `Done. ${money(crewAsk)} on Barback, round 2 is in.`,
      },
    ],
    approved: {},
  }

  const lastLines = lines.map((l) => ({ ...l, baseline: Object.fromEntries(Object.entries(l.baseline).map(([s, r]) => [s, round2(r * 1.035)])) }))
  const awardedAt = at(addDaysISO(lastFy.start, -9), 15)
  const last: SourcingEvent = {
    id: "rfp-26",
    number: `RFP-${lastFy.label.slice(2)}-01`,
    title: `${lastFy.label} rate renewal`,
    category: CATEGORY,
    cityIds: MARKETS,
    status: "awarded",
    createdBy: "Priya Raman",
    openedAt: at(addDaysISO(lastFy.start, -62), 9),
    closesOn: addDaysISO(lastFy.start, -35),
    termStart: lastFy.start,
    termEnd: lastFy.end,
    lines: lastLines,
    invited,
    bids: invited.map((s, i) => ({
      supplierId: s,
      round: 1,
      at: at(addDaysISO(lastFy.start, -38 + i), 12),
      by: supplier(s).contactName,
      lines: Object.fromEntries(
        lastLines.flatMap((l) => {
          const card = activeCard(cards, s, l.cityId, l.positionId)
          return card ? [[l.id, { proRate: card.proRate, markupPct: card.markupPct, billRate: card.billRate }]] : []
        }),
      ),
    })),
    messages: [],
    approved: Object.fromEntries(invited.map((s) => [s, awardedAt])),
    awardedAt,
  }
  return [renewal, last]
}

/** "Chicago, Atlanta and Dallas", or the one market with its state. */
export const marketName = (ev: SourcingEvent) =>
  ev.cityIds.length === 1 ? `${city(ev.cityIds[0]).name}, ${city(ev.cityIds[0]).state}` : joinWords(ev.cityIds.map((c) => city(c).name))

const joinWords = (xs: string[]) => (xs.length < 2 ? (xs[0] ?? "") : `${xs.slice(0, -1).join(", ")} and ${xs[xs.length - 1]}`)
