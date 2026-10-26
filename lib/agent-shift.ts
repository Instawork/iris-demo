import { addDaysISO, hhmmFromMinutes, paidHours, todayISO, toISODate, wallClock } from "@/lib/dates"
import { locationsFor } from "@/lib/reference"

const MONTHS: Record<string, number> = {
  january: 0,
  february: 1,
  march: 2,
  april: 3,
  may: 4,
  june: 5,
  july: 6,
  august: 7,
  september: 8,
  october: 9,
  november: 10,
  december: 11,
}

const WEEKDAYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"]

const NUMBER_WORDS: Record<string, number> = {
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
  eleven: 11,
  twelve: 12,
  fifteen: 15,
  twenty: 20,
  dozen: 12,
}

/** Words people use for each role, most specific first so "prep cook" wins over "cook". */
const ROLE_WORDS: { positionId: string; words: string[] }[] = [
  { positionId: "prepcook", words: ["prep cook"] },
  { positionId: "linecook", words: ["line cook", "cook"] },
  { positionId: "barback", words: ["barback", "bar back"] },
  { positionId: "bartender", words: ["bartender", "bar shift"] },
  { positionId: "suite", words: ["suite attendant", "suite server", "suite"] },
  { positionId: "server", words: ["banquet server", "server", "waiter"] },
  { positionId: "concessions", words: ["concessions attendant", "concession attendant", "concessions", "concession"] },
  { positionId: "cashier", words: ["cashier"] },
  { positionId: "dishwasher", words: ["dishwasher", "dish washer"] },
  { positionId: "porter", words: ["event porter", "porter"] },
]

const ROLE_PATTERN = ROLE_WORDS.flatMap((r) => r.words)
  .sort((a, b) => b.length - a.length)
  .map((w) => w.replace(" ", "\\s+"))
  .join("|")

const COUNT = `(\\d{1,3}|${Object.keys(NUMBER_WORDS).join("|")})`

const toCount = (value: string) => (/^\d+$/.test(value) ? Number(value) : (NUMBER_WORDS[value] ?? Number.NaN))

const roleOf = (phrase: string) => {
  const p = phrase.replace(/\s+/g, " ").replace(/s$/, "")
  return ROLE_WORDS.find((r) => r.words.some((w) => p === w || p.endsWith(w)))?.positionId
}

/** The role a sentence names, if any: "bartenders", "line cook". */
export const roleIn = (lower: string) => {
  const match = lower.match(new RegExp(`\\b(${ROLE_PATTERN})(?:es|s)?\\b`))
  return match ? roleOf(match[1]) : undefined
}

const clock = (hourText: string, minuteText: string | undefined, period: "am" | "pm") => {
  let hour = Number(hourText) % 12
  if (period === "pm") hour += 12
  return `${String(hour).padStart(2, "0")}:${minuteText ?? "00"}`
}

export interface ParsedAgentShift {
  locationId: string
  positionId: string
  date: string
  start: string
  end: string
  breakMins: number
  headcount: number
}

function parseDate(lower: string, today: string): { date?: string; invalid?: boolean; weekday?: boolean } {
  if (/\btoday\b|\btonight\b/.test(lower)) return { date: today }
  if (/\btomorrow\b/.test(lower)) return { date: addDaysISO(today, 1) }
  const named = lower.match(/\b(january|february|march|april|may|june|july|august|september|october|november|december)\s+(\d{1,2})(?:st|nd|rd|th)?(?:,?\s+(\d{4}))?/)
  const numeric = lower.match(/\b(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?\b/)
  if (named || numeric) {
    const month = named ? MONTHS[named[1]] : Number(numeric![1]) - 1
    const day = Number(named ? named[2] : numeric![2])
    const yearText = named ? named[3] : numeric![3]
    let year = yearText ? Number(yearText.length === 2 ? `20${yearText}` : yearText) : Number(today.slice(0, 4))
    let candidate = new Date(year, month, day)
    if (!yearText && toISODate(candidate) < today) candidate = new Date(++year, month, day)
    if (candidate.getMonth() !== month || candidate.getDate() !== day || toISODate(candidate) < today) return { invalid: true }
    return { date: toISODate(candidate) }
  }
  const weekday = lower.match(/\b(?:(this|next|on)\s+)?(sunday|monday|tuesday|wednesday|thursday|friday|saturday)s?\b/)
  if (weekday) {
    const target = WEEKDAYS.indexOf(weekday[2])
    const current = new Date(`${today}T12:00:00`).getDay()
    let ahead = (target - current + 7) % 7
    if (weekday[1] === "next" && ahead === 0) ahead = 7
    return { date: addDaysISO(today, ahead), weekday: true }
  }
  return {}
}

/** "Riverside" or "west loop" is enough: a location matches on its full name, first two words, or a distinctive first word. */
export function locationIn(lower: string, buyerId: string) {
  const locations = locationsFor(buyerId)
  const words = (name: string) => name.toLowerCase().split(" ")
  return (
    locations.find((l) => lower.includes(l.name.toLowerCase())) ??
    locations.find((l) => lower.includes(words(l.name).slice(0, 2).join(" "))) ??
    locations.find((l) => words(l.name)[0].length >= 5 && new RegExp(`\\b${words(l.name)[0]}\\b`).test(lower))
  )
}

const nowHHMM = () => hhmmFromMinutes(wallClock().minutes)

function parseTimes(lower: string) {
  const text = lower.replace(/\bnoon\b/g, "12pm").replace(/\bmidnight\b/g, "12am")
  const m = text.match(/\b(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\s*(?:to|-|–|until|till)\s*(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b/)
  if (!m) return undefined
  const endPeriod = m[6] as "am" | "pm"
  const startHour = Number(m[1])
  const endHour = Number(m[4])
  if (startHour < 1 || startHour > 12 || endHour < 1 || endHour > 12) return undefined
  const startPeriod = (m[3] as "am" | "pm" | undefined) ?? (endPeriod === "pm" && startHour % 12 > endHour % 12 ? "am" : endPeriod)
  return { start: clock(m[1], m[2], startPeriod), end: clock(m[4], m[5], endPeriod) }
}

/** True when a buyer's sentence is asking for people, even if details are missing. */
export const looksLikeShiftRequest = (text: string) => {
  const lower = text.toLowerCase()
  return (
    /\b(create|book|post|need|order|staff|request|get me|send me|add)\b/.test(lower) &&
    (/\bshifts?\b/.test(lower) || new RegExp(`\\b(?:${ROLE_PATTERN})s?\\b`).test(lower))
  )
}

/** Turns one sentence into an order: headcount, role, date, times and location. Anything it can't find comes back as missing. */
export function parseAgentShift(text: string, buyerId: string): { draft?: ParsedAgentShift; missing: string[] } {
  const lower = text.toLowerCase().replace(/[’']/g, "")
  const today = todayISO()
  const selectedLocation = locationIn(lower, buyerId) ?? locationsFor(buyerId)[0]

  const counted = lower.match(new RegExp(`\\b${COUNT}\\s+(?:more\\s+|extra\\s+)?(${ROLE_PATTERN})(?:es|s)?\\b`))
  const role = counted ? roleOf(counted[2]) : undefined
  const anyRole = lower.match(new RegExp(`\\b(${ROLE_PATTERN})(?:es|s)?\\b`))
  const positionId = role ?? (anyRole ? roleOf(anyRole[1]) : undefined)
  const countMatch = counted ?? lower.match(new RegExp(`\\b(?:create|book|post|need|order|staff|get me|add)\\s+${COUNT}\\b`)) ?? lower.match(/\b(\d{1,3})\s+[\w\s-]+?\s+shifts?\b/)
  const headcount = countMatch ? toCount(countMatch[1]) : Number.NaN
  const when = parseDate(lower, today)
  const times = parseTimes(lower)

  const missing: string[] = []
  if (!positionId) missing.push("role")
  if (!Number.isFinite(headcount) || headcount < 1 || headcount > 60) missing.push("headcount (1–60)")
  if (when.invalid) missing.push("a future valid date")
  else if (!when.date) missing.push("date")
  if (!times) missing.push("start and end time")
  if (!selectedLocation) missing.push("location")
  if (missing.length || !positionId || !selectedLocation || !when.date || !times) return { missing }

  // "Sunday" said on a Sunday after the start time means next Sunday.
  const date = when.weekday && when.date === today && times.start <= nowHHMM() ? addDaysISO(today, 7) : when.date
  const breakMins = paidHours(times.start, times.end, 0) > 6 ? 30 : 0
  return {
    missing: [],
    draft: { locationId: selectedLocation.id, positionId, date, start: times.start, end: times.end, breakMins, headcount },
  }
}
