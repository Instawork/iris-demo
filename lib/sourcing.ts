import { addDaysISO } from "@/lib/dates"
import { billFrom, money, round2 } from "@/lib/format"
import { hashString } from "@/lib/random"
import { POSITIONS, SUPPLIERS, city, position, supplier } from "@/lib/reference"
import type { Bid, BidLine, DemoData, RateCard, SourcingEvent, SourcingLine, SourcingMessage } from "@/lib/types"

/**
 * Sourcing events: Compass invites agencies to price a market's roles for the fiscal year, compares the bids side by
 * side, counters line by line, and approves each agency's final prices. Approval is what writes the rate cards, so
 * every rate on the program traces back to the round that won it.
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
  return positionIds.map((positionId, i) => {
    const baseline: Record<string, number> = {}
    for (const s of supplierIds) {
      const card = activeCard(cards, s, cityId, positionId)
      if (card) baseline[s] = card.billRate
    }
    const carrying = Object.keys(baseline)
    const total = carrying.reduce((sum, s) => sum + supplier(s).profile.share, 0)
    const share = Object.fromEntries(carrying.map((s) => [s, total ? round2(supplier(s).profile.share / total) : 1 / carrying.length]))
    return { id: `l${i + 1}`, positionId, hours: estimatedHours(positionId, cityId), baseline, share }
  })
}

export const latestBid = (ev: SourcingEvent, supplierId: string): Bid | undefined =>
  ev.bids.reduce<Bid | undefined>((best, b) => (b.supplierId === supplierId && (!best || b.round > best.round) ? b : best), undefined)

export const bidsOf = (ev: SourcingEvent, supplierId: string) => ev.bids.filter((b) => b.supplierId === supplierId).sort((a, b) => a.round - b.round)

export const responded = (ev: SourcingEvent) => ev.invited.filter((s) => latestBid(ev, s))

export const openCounters = (ev: SourcingEvent, supplierId?: string) => ev.messages.filter((m) => m.open && (!supplierId || m.supplierId === supplierId))

export type Stage = "collecting" | "negotiating" | "awarded"

export function stageOf(ev: SourcingEvent, today: string): Stage {
  if (ev.status === "awarded") return "awarded"
  return responded(ev).length === ev.invited.length || today > ev.closesOn ? "negotiating" : "collecting"
}

export const STAGE_LABEL: Record<Stage, string> = { collecting: "Collecting bids", negotiating: "Negotiating", awarded: "Approved" }

/** The rate a line is bought at from an agency: its latest bid, or what it charges today if it hasn't bid. */
const rateFor = (ev: SourcingEvent, line: SourcingLine, supplierId: string) => latestBid(ev, supplierId)?.lines[line.id]?.billRate ?? line.baseline[supplierId]

/** Spend a year on today's rates, on the latest bids at today's shares, and with every hour at the lowest bid. */
export function spendOf(ev: SourcingEvent, supplierId?: string) {
  let baseline = 0
  let proposed = 0
  let lowest = 0
  for (const line of ev.lines) {
    const agencies = Object.keys(line.baseline).filter((s) => !supplierId || s === supplierId)
    for (const s of agencies) {
      const hours = line.hours * (line.share[s] ?? 0)
      baseline += hours * line.baseline[s]
      proposed += hours * (rateFor(ev, line, s) ?? line.baseline[s])
    }
    const bids = Object.keys(line.baseline)
      .map((s) => latestBid(ev, s)?.lines[line.id]?.billRate)
      .filter((r): r is number => r !== undefined)
    if (!supplierId) lowest += line.hours * (bids.length ? Math.min(...bids) : Math.min(...Object.values(line.baseline)))
  }
  return { baseline, proposed, lowest, savings: baseline - proposed, savingsPct: baseline ? (baseline - proposed) / baseline : 0 }
}

/** The agency with the lowest bid on a line. */
export function bestOn(ev: SourcingEvent, lineId: string) {
  let best: { supplierId: string; billRate: number } | undefined
  for (const s of ev.invited) {
    const r = latestBid(ev, s)?.lines[lineId]?.billRate
    if (r !== undefined && (!best || r < best.billRate)) best = { supplierId: s, billRate: r }
  }
  return best
}

export const lineOf = (ev: SourcingEvent, lineId: string) => ev.lines.find((l) => l.id === lineId)!

export const lineLabel = (ev: SourcingEvent, lineId: string) => position(lineOf(ev, lineId).positionId).name

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
  const role = lineLabel(ev, counter.lineId!)
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
  }
  const text = met ? `We can do ${money(target)} on ${role}. Round ${next.round} is in.` : `We can come down to ${money(target)} on ${role}. Below that we can't cover pay and burden.`
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

/** Metro is raising wages to fix its fill rate, so its prices go up while the others sharpen theirs. */
const WAGE_BUMP: Record<string, number> = { metro: 1.045, harbor: 1.015 }

/** A first-round bid: wages go up a little, markup comes down a little, the same every time for an agency and role. */
function firstRound(lines: SourcingLine[], cards: RateCard[], cityId: string, supplierId: string, cut: number, override: Record<string, number> = {}) {
  const out: Record<string, BidLine> = {}
  for (const line of lines) {
    const card = activeCard(cards, supplierId, cityId, line.positionId)
    if (!card) continue
    const h = hashString(`${supplierId}:${cityId}:${line.positionId}`)
    const pay = Math.round(card.proRate * ((WAGE_BUMP[supplierId] ?? 1.01) + (h % 3) * 0.005) * 4) / 4
    const markup = override[line.positionId] ?? Math.max(floorOf(supplierId) + 1, Math.round((card.markupPct - cut - ((h >>> 4) % 3) * 0.5) * 10) / 10)
    out[line.id] = bidLine(pay, markup)
  }
  return out
}

const roles = POSITIONS.map((p) => p.id)
const invitedIn = (cityId: string) => SUPPLIERS.filter((s) => s.cityIds.includes(cityId)).map((s) => s.id)

/** Last year's award, this year's Chicago renewal mid-negotiation, and a Dallas renewal still collecting bids. */
export function seedSourcing(data: Pick<DemoData, "rateCards">, today: string): SourcingEvent[] {
  const cards = data.rateCards
  const fy = fiscalYear(today)
  const lastFy = fiscalYear(addDaysISO(fy.start, -1))

  const chiInvited = invitedIn("chi")
  const chiLines = buildLines(cards, "chi", roles, chiInvited)
  const cut: Record<string, number> = { instawork: 6, crewline: 5.5, harbor: 2.5, metro: 0.5 }
  const chiBids: Bid[] = chiInvited.map((s, i) => ({
    supplierId: s,
    round: 1,
    at: at(addDaysISO(today, -11 + i), 14 + i),
    by: supplier(s).contactName,
    lines: firstRound(chiLines, cards, "chi", s, cut[s] ?? 3, s === "harbor" ? { bartender: 45, suite: 44.5 } : {}),
  }))
  const bartender = chiLines.find((l) => l.positionId === "bartender")!
  const barback = chiLines.find((l) => l.positionId === "barback")!
  const harborR1 = chiBids.find((b) => b.supplierId === "harbor")!
  const crewR1 = chiBids.find((b) => b.supplierId === "crewline")!
  const fieldBartender = Math.min(...chiBids.filter((b) => b.supplierId !== "harbor").map((b) => b.lines[bartender.id]?.billRate ?? Infinity))
  const harborAsk = round2(fieldBartender * 1.04)
  const harborPay = harborR1.lines[bartender.id].proRate
  const harborR2: Bid = {
    supplierId: "harbor",
    round: 2,
    at: at(addDaysISO(today, -4), 11),
    by: "Renee Park",
    lines: { ...harborR1.lines, [bartender.id]: bidLine(harborPay, Math.min(44.5, Math.max(floorOf("harbor"), (harborAsk / harborPay - 1) * 100 + 2))) },
    note: "Revised bartender rate after Compass's counter.",
  }
  const crewAsk = round2(crewR1.lines[barback.id].billRate * 0.97)
  const crewR2: Bid = {
    supplierId: "crewline",
    round: 2,
    at: at(addDaysISO(today, -3), 16),
    by: "Devon Brooks",
    lines: { ...crewR1.lines, [barback.id]: bidLine(crewR1.lines[barback.id].proRate, (crewAsk / crewR1.lines[barback.id].proRate - 1) * 100) },
  }
  const chi: SourcingEvent = {
    id: "rfp-chi-27",
    number: `RFP-${fy.label.slice(2)}-01`,
    title: `${fy.label} rate renewal · Chicago`,
    category: CATEGORY,
    cityId: "chi",
    status: "open",
    createdBy: "Priya Raman",
    openedAt: at(addDaysISO(today, -27), 9),
    closesOn: addDaysISO(today, -6),
    termStart: fy.start,
    termEnd: fy.end,
    lines: chiLines,
    invited: chiInvited,
    bids: [...chiBids, harborR2, crewR2],
    messages: [
      {
        id: "rfp-chi-27-m1",
        at: at(addDaysISO(today, -5), 10),
        by: "Priya Raman",
        supplierId: "harbor",
        from: "compass",
        lineId: bartender.id,
        ask: harborAsk,
        text: `Your Bartender rate is well above the field. Can you get to ${money(harborAsk)}?`,
      },
      {
        id: "rfp-chi-27-m2",
        at: harborR2.at,
        by: "Renee Park",
        supplierId: "harbor",
        from: "agency",
        lineId: bartender.id,
        text: `We can come down to ${money(harborR2.lines[bartender.id].billRate)}. Our bartenders are alcohol-certified and work the premium suites.`,
      },
      {
        id: "rfp-chi-27-m3",
        at: at(addDaysISO(today, -4), 15),
        by: "Priya Raman",
        supplierId: "crewline",
        from: "compass",
        lineId: barback.id,
        ask: crewAsk,
        text: `Can you sharpen Barback to ${money(crewAsk)}? It's our third-largest line at the stadiums.`,
      },
      {
        id: "rfp-chi-27-m4",
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

  const dalInvited = invitedIn("dal")
  const dalLines = buildLines(cards, "dal", roles, dalInvited)
  const dal: SourcingEvent = {
    id: "rfp-dal-27",
    number: `RFP-${fy.label.slice(2)}-02`,
    title: `${fy.label} rate renewal · Dallas`,
    category: CATEGORY,
    cityId: "dal",
    status: "open",
    createdBy: "Priya Raman",
    openedAt: at(addDaysISO(today, -5), 9),
    closesOn: addDaysISO(today, 9),
    termStart: fy.start,
    termEnd: fy.end,
    lines: dalLines,
    invited: dalInvited,
    bids: dalInvited
      .filter((s) => s !== "harbor")
      .map((s, i) => ({ supplierId: s, round: 1, at: at(addDaysISO(today, -2 + i), 13), by: supplier(s).contactName, lines: firstRound(dalLines, cards, "dal", s, cut[s] ?? 3) })),
    messages: [],
    approved: {},
  }

  const lastLines = chiLines.map((l) => ({ ...l, baseline: Object.fromEntries(Object.entries(l.baseline).map(([s, r]) => [s, round2(r * 1.035)])) }))
  const awardedAt = at(addDaysISO(lastFy.start, -9), 15)
  const last: SourcingEvent = {
    id: "rfp-chi-26",
    number: `RFP-${lastFy.label.slice(2)}-01`,
    title: `${lastFy.label} rate renewal · Chicago`,
    category: CATEGORY,
    cityId: "chi",
    status: "awarded",
    createdBy: "Priya Raman",
    openedAt: at(addDaysISO(lastFy.start, -62), 9),
    closesOn: addDaysISO(lastFy.start, -35),
    termStart: lastFy.start,
    termEnd: lastFy.end,
    lines: lastLines,
    invited: chiInvited,
    bids: chiInvited.map((s, i) => ({
      supplierId: s,
      round: 1,
      at: at(addDaysISO(lastFy.start, -38 + i), 12),
      by: supplier(s).contactName,
      lines: Object.fromEntries(
        lastLines.flatMap((l) => {
          const card = activeCard(cards, s, "chi", l.positionId)
          return card ? [[l.id, { proRate: card.proRate, markupPct: card.markupPct, billRate: card.billRate }]] : []
        }),
      ),
    })),
    messages: [],
    approved: Object.fromEntries(chiInvited.map((s) => [s, awardedAt])),
    awardedAt,
  }
  return [dal, chi, last]
}

export const marketName = (ev: SourcingEvent) => `${city(ev.cityId).name}, ${city(ev.cityId).state}`
