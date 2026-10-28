import { round2 } from "@/lib/format"
import { hashString } from "@/lib/random"
import { city, position } from "@/lib/reference"

/**
 * What a role bills at across a whole market, not just the agencies on Compass's program, so every rate card and bid
 * can be read against it. It's fixed per role and city: Compass's own rates moving doesn't move the market.
 */
export interface Benchmark {
  median: number
  /** The middle half of the market. */
  p25: number
  p75: number
  low: number
  high: number
  agencies: number
}

const AGENCIES: Record<string, number> = { chi: 46, atl: 34, dal: 27 }
const MARKET_MARKUP = 1.37

export function benchmark(cityId: string, positionId: string): Benchmark {
  const h = hashString(`market:${cityId}:${positionId}`)
  const wobble = ((h % 7) - 3) / 100
  const median = round2(position(positionId).basePay * city(cityId).payIndex * 1.01 * MARKET_MARKUP * (1 + wobble))
  return {
    median,
    p25: round2(median * 0.94),
    p75: round2(median * 1.065),
    low: round2(median * 0.86),
    high: round2(median * 1.2),
    agencies: AGENCIES[cityId] ?? 24,
  }
}

/** How far a rate sits from the market median, as a ratio: -0.03 is 3% under. */
export const vsMarket = (rate: number, b: Benchmark) => rate / b.median - 1
