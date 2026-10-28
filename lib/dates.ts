import { addDays, format, parseISO, startOfWeek } from "date-fns"

/**
 * The server and every device read the clock in the program's time zone, the one shift times are written in. A laptop
 * that travels to another zone still shows the same release times and "today" as the server.
 */
export const PROGRAM_TIME_ZONE = "America/Chicago"

const wallParts = new Intl.DateTimeFormat("en-US", {
  timeZone: PROGRAM_TIME_ZONE,
  hourCycle: "h23",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
})

/** The program's wall clock at an instant: the date, and minutes since midnight. */
export function wallClock(at = new Date()) {
  const p: Record<string, string> = {}
  for (const part of wallParts.formatToParts(at)) p[part.type] = part.value
  return { date: `${p.year}-${p.month}-${p.day}`, minutes: Number(p.hour) * 60 + Number(p.minute) }
}

/** The instant a program wall-clock time happens. */
export function instantAt(date: string, hhmm: string) {
  const target = Date.parse(`${date}T${hhmm}:00Z`)
  let t = target
  for (let i = 0; i < 3; i++) {
    const w = wallClock(new Date(t))
    const shown = Date.parse(`${w.date}T${hhmmFromMinutes(w.minutes)}:00Z`)
    if (shown === target) break
    t += target - shown
  }
  return new Date(t)
}

export const toISODate = (d: Date) => format(d, "yyyy-MM-dd")

export const todayISO = () => wallClock().date

export const parseDate = (iso: string) => parseISO(iso.length === 10 ? `${iso}T00:00:00` : iso)

export const addDaysISO = (iso: string, days: number) => toISODate(addDays(parseDate(iso), days))

const dayNumber = (iso: string) => Math.round(Date.parse(`${iso.slice(0, 10)}T00:00:00Z`) / 86_400_000)

export const daysFromToday = (iso: string) => dayNumber(iso) - dayNumber(todayISO())

/** Compass's work week runs Saturday to Friday, as its postings are set up in Fieldglass. Timesheets, invoices and budgets share it. */
export const weekStartISO = (iso: string) => toISODate(startOfWeek(parseDate(iso), { weekStartsOn: 6 }))

export const weekEndISO = (iso: string) => addDaysISO(weekStartISO(iso), 6)

export const minutesOf = (hhmm: string) => {
  const [h, m] = hhmm.split(":").map(Number)
  return h * 60 + (m || 0)
}

export const hhmmFromMinutes = (mins: number) => {
  const wrapped = ((Math.round(mins) % 1440) + 1440) % 1440
  const h = Math.floor(wrapped / 60)
  const m = wrapped % 60
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`
}

/** Shift length in minutes, wrapping past midnight. The same time twice is zero minutes, not a full day. */
export const spanMinutes = (start: string, end: string) => {
  let diff = minutesOf(end) - minutesOf(start)
  if (diff < 0) diff += 1440
  return diff
}

export const paidHours = (start: string, end: string, breakMins: number) =>
  Math.max(0, Math.round(((spanMinutes(start, end) - breakMins) / 60) * 100) / 100)

/** 16:30 -> "04:30 PM", matching the partner dashboard's time format. */
export const formatClock = (hhmm?: string) => {
  if (!hhmm) return "--"
  const mins = minutesOf(hhmm)
  const h = Math.floor(mins / 60)
  const m = mins % 60
  const suffix = h >= 12 ? "PM" : "AM"
  const h12 = h % 12 === 0 ? 12 : h % 12
  return `${String(h12).padStart(2, "0")}:${String(m).padStart(2, "0")} ${suffix}`
}

/** 16:30 -> "4:30pm" for compact places like calendar chips. */
export const formatClockShort = (hhmm: string) => {
  const mins = minutesOf(hhmm)
  const h = Math.floor(mins / 60)
  const m = mins % 60
  const suffix = h >= 12 ? "pm" : "am"
  const h12 = h % 12 === 0 ? 12 : h % 12
  return m === 0 ? `${h12}${suffix}` : `${h12}:${String(m).padStart(2, "0")}${suffix}`
}

export const formatInterval = (start: string, end: string, tz?: string) =>
  `${formatClock(start)} - ${formatClock(end)}${tz ? ` (${tz})` : ""}`

export const formatDay = (iso: string, pattern = "EEE, MMM d") => format(parseDate(iso), pattern)

export const formatDateLong = (iso: string) => format(parseDate(iso), "EEEE, MMMM d")

export const formatDateShort = (iso: string) => format(parseDate(iso), "MMM d")

export const formatDateFull = (iso: string) => format(parseDate(iso), "MMM d, yyyy")

/** "2026-10" as "October 2026". */
export const formatMonth = (month: string) => format(parseDate(`${month}-01`), "MMMM yyyy")

/** Date group header used on the Shifts list: "Today • Tue Oct 13, 2026". */
export const formatGroupHeader = (iso: string) => {
  const diff = daysFromToday(iso)
  const label = format(parseDate(iso), "EEE MMM dd, yyyy")
  if (diff === 0) return `Today • ${label}`
  if (diff === 1) return `Tomorrow • ${label}`
  if (diff === -1) return `Yesterday • ${label}`
  return label
}

export const formatRelativeDay = (iso: string) => {
  const diff = daysFromToday(iso)
  if (diff === 0) return "Today"
  if (diff === 1) return "Tomorrow"
  if (diff === -1) return "Yesterday"
  if (diff > 1 && diff < 7) return format(parseDate(iso), "EEEE")
  return formatDateShort(iso)
}

const stamp = new Intl.DateTimeFormat("en-US", { timeZone: PROGRAM_TIME_ZONE, month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })

export const formatTimestamp = (iso: string) => stamp.format(parseISO(iso)).replace(/\u202f/g, " ")

export const timeAgo = (iso: string) => {
  const diffMs = Date.now() - parseISO(iso).getTime()
  const mins = Math.round(diffMs / 60000)
  if (mins < 1) return "just now"
  if (mins < 60) return `${mins}m ago`
  const hours = Math.round(mins / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.round(hours / 24)
  if (days < 7) return `${days}d ago`
  return formatDateShort(iso.slice(0, 10))
}

export const isPastShift = (date: string, end: string, start: string) => {
  const now = wallClock()
  if (date !== now.date) return date < now.date
  return now.minutes >= minutesOf(start) + spanMinutes(start, end)
}
