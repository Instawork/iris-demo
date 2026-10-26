import { addDaysISO } from "@/lib/dates"
import { billFrom, round2 } from "@/lib/format"
import { WORKSPACES } from "@/lib/reference"
import type { Counters, RateCard, RateChange, RateValues } from "@/lib/types"

/**
 * The rate log: every rate card change with who made it, when, the rate before and after, and where it came from.
 * Commands don't write to it themselves. The command runner compares rate cards before and after each command, so a
 * change from any path, an upload, a review answer, onboarding or a manual edit, is logged the same way.
 */

export const valuesOf = (c: RateCard): RateValues => ({ proRate: c.proRate, billRate: c.billRate, markupPct: c.markupPct, status: c.status })

const same = (a: RateValues, b: RateValues) => a.proRate === b.proRate && a.billRate === b.billRate && a.markupPct === b.markupPct && a.status === b.status

export function rateChanges(
  before: RateCard[],
  after: RateCard[],
  meta: { at: string; by: string; source: (card: RateCard) => RateChange["source"]; note?: (card: RateCard) => string | undefined; firstId: number },
): RateChange[] {
  if (before === after) return []
  const old = new Map(before.map((c) => [c.id, c]))
  const kept = new Set(after.map((c) => c.id))
  let n = meta.firstId
  const out: RateChange[] = []
  const entry = (card: RateCard, action: RateChange["action"], from?: RateValues, to?: RateValues): RateChange => {
    const note = action === "removed" ? undefined : meta.note?.(card)
    return {
      id: `rlog-${n++}`,
      at: meta.at,
      by: meta.by,
      cardId: card.id,
      supplierId: card.supplierId,
      cityId: card.cityId,
      positionId: card.positionId,
      action,
      source: meta.source(card),
      ...(from ? { from } : {}),
      ...(to ? { to } : {}),
      ...(card.uploadId && card.uploadId !== old.get(card.id)?.uploadId ? { uploadId: card.uploadId } : {}),
      ...(note ? { note } : {}),
    }
  }
  for (const card of after) {
    const prev = old.get(card.id)
    if (prev === card) continue
    if (!prev) out.push(entry(card, "added", undefined, valuesOf(card)))
    else if (!same(valuesOf(prev), valuesOf(card))) out.push(entry(card, "changed", valuesOf(prev), valuesOf(card)))
  }
  for (const prev of before) if (!kept.has(prev.id)) out.push(entry(prev, "removed", valuesOf(prev)))
  return out
}

const agencyUser = (supplierId: string) => WORKSPACES.find((w) => w.supplierId === supplierId)?.user.name ?? "The agency"

/** Rates that changed before the demo's history starts, so the invoices billed at them agree with the log. */
const EARLIER: { supplierId: string; cityId: string; positionId: string; daysAgo: number; from: { proRate?: number; markupPct?: number } }[] = [
  { supplierId: "harbor", cityId: "chi", positionId: "bartender", daysAgo: 66, from: { markupPct: 34 } },
  { supplierId: "harbor", cityId: "chi", positionId: "suite", daysAgo: 66, from: { markupPct: 36 } },
  { supplierId: "metro", cityId: "dal", positionId: "suite", daysAgo: 75, from: { markupPct: 38 } },
  { supplierId: "crewline", cityId: "chi", positionId: "server", daysAgo: 58, from: { proRate: -0.5 } },
  { supplierId: "instawork", cityId: "chi", positionId: "concessions", daysAgo: 61, from: { proRate: -0.5 } },
]

/** How long ago each agency joined the program and set its first rate card. */
const JOINED: Record<string, number> = { instawork: 260, crewline: 230, harbor: 205, metro: 190 }

/** Each seeded card's history: the rate the agency set when it joined, and the later changes some went through. */
export function seedRateLog(cards: RateCard[], counters: Counters, today: string): RateChange[] {
  const log: RateChange[] = []
  const id = () => `rlog-${counters.rlog++}`
  for (const card of cards) {
    const planted = EARLIER.find((e) => e.supplierId === card.supplierId && e.cityId === card.cityId && e.positionId === card.positionId)
    const base = { cardId: card.id, supplierId: card.supplierId, cityId: card.cityId, positionId: card.positionId, by: agencyUser(card.supplierId), source: card.source === "api" ? ("api" as const) : ("upload" as const) }
    const joined = addDaysISO(today, -(JOINED[card.supplierId] ?? 180))
    const changedOn = planted ? addDaysISO(today, -planted.daysAgo) : joined
    card.effectiveFrom = changedOn
    card.updatedAt = `${changedOn}T15:00:00.000Z`
    if (!planted) {
      log.push({ ...base, id: id(), at: card.updatedAt, action: "added", to: valuesOf(card) })
      continue
    }
    const proRate = round2(card.proRate + (planted.from.proRate ?? 0))
    const markupPct = planted.from.markupPct ?? card.markupPct
    const from: RateValues = { proRate, markupPct, billRate: billFrom(proRate, markupPct), status: "active" }
    log.push({ ...base, id: id(), at: `${joined}T15:00:00.000Z`, action: "added", to: from })
    log.push({ ...base, id: id(), at: card.updatedAt, action: "changed", from, to: valuesOf(card) })
  }
  return log.sort((a, b) => b.at.localeCompare(a.at))
}
