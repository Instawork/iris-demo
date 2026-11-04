import { addDaysISO } from "@/lib/dates"
import { billFrom, round2 } from "@/lib/format"
import { marketPay } from "@/lib/market"
import { hashString } from "@/lib/random"
import { POSITIONS, SUPPLIERS, afterVa, city, position, supplier, termsOf } from "@/lib/reference"
import type { Bid, BidLine, ContractTerms, DemoData, RateCard, SourcingEvent, SourcingLine, SourcingMessage } from "@/lib/types"

/**
 * Sourcing events: Compass invites agencies to price their roles in each market for the fiscal year, compares the bids side by
 * side, counters each agency's markup, and approves each agency's final prices. An agency bids one markup on top of
 * its pay for every role, so the markup is what gets negotiated. Approval is what writes the rate cards, so every rate
 * on the program traces back to the round that won it. Bids compare after VA, the rebate each agency pays back at year
 * end, so a higher markup with a bigger rebate can be the better buy.
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
/** The most VA each agency gives when Compass pushes. */
const CEILING_VA: Record<string, number> = { instawork: 14, crewline: 13, harbor: 8, metro: 12 }

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

/** An agency's markup on today's rate cards, weighted by the hours Compass buys from it. */
function markupToday(ev: SourcingEvent, cards: RateCard[], supplierId: string) {
  let pay = 0
  let bill = 0
  for (const line of ev.lines) {
    const card = line.baseline[supplierId] === undefined ? undefined : activeCard(cards, supplierId, line.cityId, line.positionId)
    if (!card) continue
    const hours = line.hours * (line.share[supplierId] ?? 0)
    pay += hours * card.proRate
    bill += hours * card.billRate
  }
  return pay ? (bill / pay - 1) * 100 : 0
}

/**
 * An agency's bid in three numbers: its markup, what it pays workers against the market, and its VA. Pay is weighted
 * by the hours Compass buys from it across every role and market. `cost` is what Compass pays per dollar of wages
 * after VA, the one number that ranks them. Agencies that haven't bid read off today's rate cards.
 */
export function agencyValue(ev: SourcingEvent, cards: RateCard[], supplierId: string) {
  const latest = latestBid(ev, supplierId)
  let pay = 0
  let market = 0
  for (const line of ev.lines) {
    if (line.baseline[supplierId] === undefined) continue
    const rate = latest?.lines[line.id] ?? activeCard(cards, supplierId, line.cityId, line.positionId)
    if (!rate) continue
    const hours = line.hours * (line.share[supplierId] ?? 0)
    pay += hours * rate.proRate
    market += hours * marketPay(line.cityId, line.positionId)
  }
  const markupPct = latest?.markupPct ?? markupToday(ev, cards, supplierId)
  const vaPct = offeredTerms(ev, supplierId).vaPct
  return { markupPct, vaPct, payVsMarket: market ? pay / market - 1 : 0, cost: (1 + markupPct / 100) * (1 - vaPct / 100), bidding: !!latest }
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

/** Compass has decided on this agency's bid: approved or rejected. */
export const decided = (ev: SourcingEvent, supplierId: string) => !!ev.approved[supplierId] || !!ev.rejected?.[supplierId]

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

/** Who counters on Compass's behalf when Iris negotiates. */
export const IRIS = "Iris"

export interface PlannedCounter {
  supplierId: string
  /** The markup it bid, and the one Iris asks for. */
  from: number
  ask: number
  /** A year at the agency's share of the hours, after its VA, if it meets the ask. */
  saves: number
}

/** A year of what an agency's markup earns it on its bid, per point of markup, after its VA. */
function perPoint(ev: SourcingEvent, supplierId: string) {
  const bid = latestBid(ev, supplierId)
  if (!bid) return 0
  const pay = ev.lines.reduce((sum, l) => sum + (bid.lines[l.id] ? l.hours * (l.share[supplierId] ?? 0) * bid.lines[l.id].proRate : 0), 0)
  return afterVa(pay / 100, offeredTerms(ev, supplierId).vaPct)
}

/** The lowest markup bid on the event, the one every other agency is pushed toward. */
export const bestMarkup = (ev: SourcingEvent) => Math.min(...responded(ev).map((s) => latestBid(ev, s)!.markupPct))

/** The most Iris asks an agency to move in one counter, in points of markup. */
const STEP = 3

/**
 * The counters Iris would send: every agency whose markup is above the lowest on the event, that isn't approved and
 * that Iris hasn't countered yet, asked down toward the lowest but never more than three points in one go. Biggest
 * savings first.
 */
export function counterPlan(ev: SourcingEvent): PlannedCounter[] {
  if (ev.status !== "open" || responded(ev).length < 2) return []
  const best = bestMarkup(ev)
  const plan: PlannedCounter[] = []
  for (const s of responded(ev)) {
    const from = latestBid(ev, s)!.markupPct
    if (decided(ev, s) || from <= best) continue
    if (ev.messages.some((m) => m.from === "compass" && m.supplierId === s && (m.open || m.by === IRIS))) continue
    const ask = Math.max(best, Math.ceil(from) - STEP)
    if (ask >= from) continue
    plan.push({ supplierId: s, from, ask, saves: perPoint(ev, s) * (from - ask) })
  }
  return plan.sort((a, b) => b.saves - a.saves)
}

export type CounterOutcome = "waiting" | "met" | "down" | "held"

/** Every counter Iris sent on this event, with where the agency's markup stands now. */
export function irisCounters(ev: SourcingEvent) {
  return ev.messages
    .filter((m) => m.from === "compass" && m.by === IRIS && m.ask !== undefined)
    .map((m) => {
      const before = bidsOf(ev, m.supplierId).filter((b) => b.at <= m.at).pop()?.markupPct ?? m.ask!
      const now = latestBid(ev, m.supplierId)?.markupPct ?? before
      const outcome: CounterOutcome = m.open ? "waiting" : now <= m.ask! ? "met" : now < before ? "down" : "held"
      return { message: m, supplierId: m.supplierId, from: before, ask: m.ask!, now, outcome, saves: perPoint(ev, m.supplierId) * (before - now) }
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

/** The same pay on every line at a new markup. */
export const atMarkup = (lines: Record<string, BidLine>, markupPct: number) =>
  Object.fromEntries(Object.entries(lines).map(([id, l]) => [id, bidLine(l.proRate, markupPct)]))

export const pct = (n: number) => `${round2(n)}%`

const messageId = (ev: SourcingEvent) => `${ev.id}-m${ev.messages.length + 1}`

/** "a 30% markup and 12% VA", naming only what the counter asked about. */
const offerText = (markupPct: number | undefined, vaPct: number | undefined) =>
  [markupPct !== undefined && `a ${pct(markupPct)} markup`, vaPct !== undefined && `${pct(vaPct)} VA`].filter(Boolean).join(" and ")

/**
 * How an agency answers a counter on its markup, its VA or both: it meets each ask that clears its floor on markup and
 * its ceiling on VA, goes as far as it can on the rest, and holds if its bid is already there.
 */
export function agencyAnswer(ev: SourcingEvent, counter: SourcingMessage, now: string): { event: SourcingEvent; text: string } | undefined {
  const bid = latestBid(ev, counter.supplierId)
  if (!bid || (counter.ask === undefined && counter.askVa === undefined)) return undefined
  const s = supplier(counter.supplierId)
  const terms = offeredTerms(ev, s.id)
  const markup = counter.ask === undefined ? bid.markupPct : Math.min(bid.markupPct, Math.max(counter.ask, floorOf(s.id)))
  const va = counter.askVa === undefined ? terms.vaPct : Math.max(terms.vaPct, Math.min(counter.askVa, CEILING_VA[s.id] ?? terms.vaPct + 2))
  const messages = ev.messages.map((m) => (m.id === counter.id ? { ...m, open: false } : m))
  const asked = (n: number | undefined, value: number) => (n === undefined ? undefined : value)
  const offer = offerText(asked(counter.ask, markup), asked(counter.askVa, va))
  if (markup === bid.markupPct && va === terms.vaPct) {
    const text = `We're at our limit. ${offer[0].toUpperCase()}${offer.slice(1)} is as far as we can go and still cover pay and burden.`
    return { event: { ...ev, messages: [...messages, reply(ev, s.id, s.contactName, text, now)] }, text: `${s.shortName} is holding at ${offer}` }
  }
  const met = (counter.ask === undefined || markup === counter.ask) && (counter.askVa === undefined || va === counter.askVa)
  const next: Bid = { supplierId: s.id, round: bid.round + 1, at: now, by: s.contactName, markupPct: markup, lines: atMarkup(bid.lines, markup), terms: { ...terms, vaPct: va } }
  const text = met ? `We can do ${offer}${counter.ask !== undefined ? " on every role" : ""}.` : `We can do ${offer}. That's as far as we can go and still cover pay and burden.`
  return {
    event: { ...ev, bids: [...ev.bids, next], messages: [...messages, reply(ev, s.id, s.contactName, text, now)] },
    text: met ? `${s.shortName} met your ask: ${offer}` : `${s.shortName} came back with ${offer}`,
  }
}

const reply = (ev: SourcingEvent, supplierId: string, by: string, text: string, at: string): SourcingMessage => ({
  id: messageId(ev),
  at,
  by,
  supplierId,
  from: "agency",
  text,
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

/** A first-round bid: wages go up a little, the same every time for an agency and role, all at one markup. */
function firstRound(lines: SourcingLine[], cards: RateCard[], supplierId: string, markupPct: number) {
  const out: Record<string, BidLine> = {}
  for (const line of lines) {
    const card = activeCard(cards, supplierId, line.cityId, line.positionId)
    if (!card) continue
    const h = hashString(`${supplierId}:${line.cityId}:${line.positionId}`)
    const pay = Math.round(card.proRate * ((WAGE_BUMP[supplierId] ?? 1.01) + (h % 3) * 0.005) * 4) / 4
    out[line.id] = bidLine(pay, markupPct)
  }
  return out
}

const roles = POSITIONS.map((p) => p.id)
const MARKETS = ["chi", "atl", "dal"]

/** Each agency's first-round markup. Harbor's is the highest by a distance, and Priya has already pushed it. */
const BID_MARKUP: Record<string, number> = { instawork: 29, crewline: 32, metro: 37, harbor: 42 }

/** Last year's award, and this year's renewal mid-negotiation: every agency on the program, across all its markets. */
export function seedSourcing(data: Pick<DemoData, "rateCards">, today: string): SourcingEvent[] {
  const cards = data.rateCards
  const fy = fiscalYear(today)
  const lastFy = fiscalYear(addDaysISO(fy.start, -1))

  const invited = SUPPLIERS.filter((s) => s.cityIds.some((c) => MARKETS.includes(c))).map((s) => s.id)
  const lines = eventLines(cards, MARKETS, roles, invited)
  const bids: Bid[] = invited.map((s, i) => {
    const markupPct = BID_MARKUP[s] ?? 34
    return { supplierId: s, round: 1, at: at(addDaysISO(today, -11 + i), 14 + i), by: supplier(s).contactName, markupPct, lines: firstRound(lines, cards, s, markupPct), ...offerOf(s) }
  })
  const secondRound = (supplierId: string, markupPct: number, at: string, by: string, note?: string): Bid => {
    const r1 = bids.find((b) => b.supplierId === supplierId)!
    return { supplierId, round: 2, at, by, markupPct, lines: atMarkup(r1.lines, markupPct), ...(note ? { note } : {}), ...offerOf(supplierId) }
  }
  const harborR2 = secondRound("harbor", 40, at(addDaysISO(today, -4), 11), "Renee Park", "Revised markup after Compass's counter.")
  const crewR2 = secondRound("crewline", 31, at(addDaysISO(today, -3), 16), "Devon Brooks")
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
        ask: 38,
        text: "Your 42% markup is the highest of the four. Can you get to 38%?",
      },
      {
        id: "rfp-27-m2",
        at: harborR2.at,
        by: "Renee Park",
        supplierId: "harbor",
        from: "agency",
        text: "We can come down to 40%. Our bartenders are alcohol-certified and work the premium suites.",
      },
      {
        id: "rfp-27-m3",
        at: at(addDaysISO(today, -4), 15),
        by: "Priya Raman",
        supplierId: "crewline",
        from: "compass",
        ask: 31,
        text: "Can you sharpen your markup to 31%? You're our second-largest agency at the stadiums.",
      },
      {
        id: "rfp-27-m4",
        at: crewR2.at,
        by: "Devon Brooks",
        supplierId: "crewline",
        from: "agency",
        text: "Done. 31% on every role.",
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
    bids: invited.map((s, i) => {
      const lines: Record<string, BidLine> = Object.fromEntries(
        lastLines.flatMap((l) => {
          const card = activeCard(cards, s, l.cityId, l.positionId)
          return card ? [[l.id, { proRate: card.proRate, markupPct: card.markupPct, billRate: card.billRate }]] : []
        }),
      )
      const pay = Object.values(lines).reduce((sum, l) => sum + l.proRate, 0)
      const bill = Object.values(lines).reduce((sum, l) => sum + l.billRate, 0)
      return { supplierId: s, round: 1, at: at(addDaysISO(lastFy.start, -38 + i), 12), by: supplier(s).contactName, markupPct: pay ? Math.round((bill / pay - 1) * 100) : 0, lines }
    }),
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
