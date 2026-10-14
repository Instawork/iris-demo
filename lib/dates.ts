import { addDays, differenceInCalendarDays, format, parseISO, startOfWeek } from "date-fns"

export const toISODate = (d: Date) => format(d, "yyyy-MM-dd")

export const todayISO = () => toISODate(new Date())

export const parseDate = (iso: string) => parseISO(iso.length === 10 ? `${iso}T00:00:00` : iso)

export const addDaysISO = (iso: string, days: number) => toISODate(addDays(parseDate(iso), days))

export const daysFromToday = (iso: string) => differenceInCalendarDays(parseDate(iso), new Date())

export const weekStartISO = (iso: string) => toISODate(startOfWeek(parseDate(iso), { weekStartsOn: 1 }))

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

/** Shift length in minutes, wrapping past midnight. */
export const spanMinutes = (start: string, end: string) => {
  let diff = minutesOf(end) - minutesOf(start)
  if (diff <= 0) diff += 1440
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

export const formatTimestamp = (iso: string) => format(parseISO(iso), "MMM d, h:mm a")

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
  const today = todayISO()
  if (date < today) return true
  if (date > today) return false
  const now = new Date()
  const nowMins = now.getHours() * 60 + now.getMinutes()
  const endMins = minutesOf(start) + spanMinutes(start, end)
  return nowMins >= endMins
}
