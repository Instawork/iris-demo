import { paidHours, todayISO, toISODate } from "@/lib/dates"
import { POSITIONS, locationsFor } from "@/lib/reference"

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

const time = (hourText: string, minuteText: string | undefined, period: string) => {
  let hour = Number(hourText) % 12
  if (period.toLowerCase() === "pm") hour += 12
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

export function parseAgentShift(text: string, buyerId: string): { draft?: ParsedAgentShift; missing: string[] } {
  const lower = text.toLowerCase()
  const locations = locationsFor(buyerId)
  const selectedLocation = locations.find((item) => lower.includes(item.name.toLowerCase())) ?? locations[0]
  const selectedPosition = POSITIONS.find((item) => lower.includes(item.name.toLowerCase()) || lower.includes(item.id.toLowerCase()))
  const countMatch = lower.match(/\b(?:create|book|post|need)\s+(\d+)\b/) ?? lower.match(/\b(\d+)\s+[\w\s-]+?\s+shifts?\b/)
  const dateMatch = lower.match(/\b(january|february|march|april|may|june|july|august|september|october|november|december)\s+(\d{1,2})(?:st|nd|rd|th)?(?:,?\s+(\d{4}))?/)
  const timeMatch = lower.match(/\bfrom\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)\s+(?:to|-)\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b/)
  const missing: string[] = []
  if (!selectedPosition) missing.push("role")
  if (!countMatch || Number(countMatch[1]) < 1 || Number(countMatch[1]) > 60) missing.push("headcount (1–60)")
  if (!dateMatch) missing.push("date")
  if (!timeMatch) missing.push("start and end time")
  if (!selectedLocation) missing.push("location")
  if (missing.length || !selectedPosition || !selectedLocation || !countMatch || !dateMatch || !timeMatch) return { missing }

  const now = new Date()
  const month = MONTHS[dateMatch[1]]
  const day = Number(dateMatch[2])
  let year = dateMatch[3] ? Number(dateMatch[3]) : now.getFullYear()
  let candidate = new Date(year, month, day)
  if (!dateMatch[3] && toISODate(candidate) < todayISO()) candidate = new Date(++year, month, day)
  if (candidate.getMonth() !== month || candidate.getDate() !== day || toISODate(candidate) < todayISO()) return { missing: ["a future valid date"] }

  const start = time(timeMatch[1], timeMatch[2], timeMatch[3])
  const end = time(timeMatch[4], timeMatch[5], timeMatch[6])
  const breakMins = paidHours(start, end, 0) > 6 ? 30 : 0
  return {
    missing: [],
    draft: {
      locationId: selectedLocation.id,
      positionId: selectedPosition.id,
      date: toISODate(candidate),
      start,
      end,
      breakMins,
      headcount: Number(countMatch[1]),
    },
  }
}
