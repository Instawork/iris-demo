import Papa from "papaparse"

import { readiness } from "@/lib/compliance"
import { addDaysISO, formatDateShort, paidHours, todayISO } from "@/lib/dates"
import { billFrom, markupFrom, money, plural, round2 } from "@/lib/format"
import { groupPhase } from "@/lib/metrics"
import { hashString } from "@/lib/random"
import { CITIES, LOCATIONS, POSITIONS, buyer, city, location, locationsFor, position, requirementsFor, supplier } from "@/lib/reference"
import { notifiedSuppliers, supplierReleasePlan, type Patch } from "@/lib/store"
import type {
  BusinessActivity,
  ComplianceItem,
  DemoData,
  Location,
  PersonaKind,
  Pro,
  RateCard,
  RequirementId,
  ShiftGroup,
  Timesheet,
  Upload,
  UploadIssue,
  UploadType,
  Workspace,
} from "@/lib/types"

type Row = Record<string, string>

/* --------------------------------- Parsing -------------------------------- */

export function parseCsv(text: string) {
  const result = Papa.parse<Row>(text.trim(), {
    header: true,
    skipEmptyLines: "greedy",
    transformHeader: (h) => h.trim().toLowerCase().replace(/\s+/g, "_"),
    transform: (v) => (typeof v === "string" ? v.trim() : v),
  })
  return {
    headers: (result.meta.fields ?? []).filter(Boolean),
    rows: result.data.filter((r) => Object.values(r).some((v) => v !== "" && v != null)),
    parseErrors: result.errors.slice(0, 5).map((e) => `Row ${(e.row ?? 0) + 2}: ${e.message}`),
  }
}

export function toCsv(rows: Record<string, unknown>[], columns?: string[]) {
  const cols = columns ?? (rows[0] ? Object.keys(rows[0]) : [])
  return Papa.unparse({ fields: cols, data: rows.map((r) => cols.map((c) => r[c] ?? "")) })
}

export function downloadCsv(filename: string, csv: string) {
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" })
  const url = URL.createObjectURL(blob)
  const a = document.createElement("a")
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  window.setTimeout(() => URL.revokeObjectURL(url), 1000)
}

/* -------------------------------- Matching -------------------------------- */

const norm = (v: string) => v.toLowerCase().replace(/[^a-z0-9]/g, "")

function editDistance(a: string, b: string) {
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j)
  for (let i = 1; i <= a.length; i++) {
    const cur = [i]
    for (let j = 1; j <= b.length; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1))
    prev = cur
  }
  return prev[b.length]
}

/** The one candidate a value most likely meant: a near-miss spelling or a unique partial name. Ties mean no guess. */
export function closestMatch<T>(value: string, candidates: T[], names: (candidate: T) => string[]): T | undefined {
  const n = norm(value)
  if (n.length < 3) return undefined
  const scored = candidates
    .map((candidate) => ({
      candidate,
      score: Math.min(
        ...names(candidate).map((name) => {
          const m = norm(name)
          if (!m) return 1
          if (n.length >= 4 && (m.includes(n) || n.includes(m))) return 0.2
          return editDistance(n, m) / Math.max(n.length, m.length)
        }),
      ),
    }))
    .filter((x) => x.score <= 0.34)
    .sort((a, b) => a.score - b.score)
  if (!scored.length || scored[1]?.score === scored[0].score) return undefined
  return scored[0].candidate
}

export const resolveCity = (v: string) => {
  const n = norm(v.split(",")[0] ?? v)
  return CITIES.find((c) => norm(c.name) === n || c.id === n)
}

export const resolvePosition = (v: string) => {
  const n = norm(v).replace(/s$/, "")
  return POSITIONS.find((p) => norm(p.name) === n || norm(p.name).replace(/s$/, "") === n || p.id === n)
}

export const resolveLocation = (v: string, buyerId?: string) => {
  const n = norm(v)
  return locationsFor(buyerId).find((l) => norm(l.name) === n || norm(l.costCenter) === n || l.id === n)
}

export const nearestZip = (zip: string, zips: string[]) =>
  [...zips].sort((a, b) => Math.abs(Number(a) - Number(zip)) - Math.abs(Number(b) - Number(zip)) || a.localeCompare(b))[0]

/* ---------------------------------- Cells ---------------------------------- */

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/
const CLOCK = /^\d{1,2}:\d{2}$/
const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/
const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"]
const AREA_CODES: Record<string, string> = { chi: "312", atl: "404", dal: "214" }

const pad = (n: number) => String(n).padStart(2, "0")

export function parseTime(v: string): string | undefined {
  const m = v.trim().toLowerCase().replace(/\s+/g, "").replace(/\./g, ":").match(/^(\d{1,2})(?::?(\d{2}))?(a|p|am|pm|a:m:|p:m:)?$/)
  if (!m) return undefined
  let h = Number(m[1])
  const min = Number(m[2] ?? 0)
  const ap = m[3]?.[0]
  if (ap && (h < 1 || h > 12)) return undefined
  if (ap === "p" && h < 12) h += 12
  if (ap === "a" && h === 12) h = 0
  if (h > 23 || min > 59) return undefined
  return `${pad(h)}:${pad(min)}`
}

export function parseDateCell(v: string): string | undefined {
  const t = v.trim().toLowerCase()
  const valid = (y: number, m: number, d: number) => {
    const date = new Date(y, m - 1, d)
    return date.getFullYear() === y && date.getMonth() === m - 1 && date.getDate() === d ? `${y}-${pad(m)}-${pad(d)}` : undefined
  }
  const year = Number(todayISO().slice(0, 4))
  let m = t.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/)
  if (m) return valid(Number(m[1]), Number(m[2]), Number(m[3]))
  m = t.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2}|\d{4})$/)
  if (m) return valid(m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3]), Number(m[1]), Number(m[2]))
  m = t.match(/^([a-z]{3})[a-z]*\.?\s+(\d{1,2})(?:st|nd|rd|th)?,?\s*(\d{4})?$/)
  if (m && MONTHS.includes(m[1])) return valid(m[3] ? Number(m[3]) : year, MONTHS.indexOf(m[1]) + 1, Number(m[2]))
  m = t.match(/^(\d{1,2})\s+([a-z]{3})[a-z]*\.?,?\s*(\d{4})?$/)
  if (m && MONTHS.includes(m[2])) return valid(m[3] ? Number(m[3]) : year, MONTHS.indexOf(m[2]) + 1, Number(m[1]))
  return undefined
}

export const parseNumber = (v: string) => {
  if (v == null || v === "") return undefined
  const n = Number(String(v).replace(/[$,%\s]/g, ""))
  return Number.isFinite(n) ? n : undefined
}

const formatPhone = (digits: string) => `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`

/* ---------------------------------- Specs ---------------------------------- */

export interface ColumnSpec {
  key: string
  label: string
  required: boolean
  description: string
}

export interface UploadSpec {
  type: UploadType
  label: string
  description: string
  allowed: PersonaKind[]
  /** Where the saved rows show up. */
  href?: string
  columns: ColumnSpec[]
}

const SHIFT_GROUP_COLUMN: ColumnSpec = { key: "shift_group_id", label: "Shift group ID", required: true, description: "Like SG-48231" }
const PRO_COLUMN: ColumnSpec = { key: "pro_id", label: "Pro ID", required: true, description: "Like P-10241" }

/** Key order is the order each persona sees its types in. */
export const UPLOAD_SPECS: Record<UploadType, UploadSpec> = {
  shifts: {
    type: "shifts",
    label: "Shift",
    description: "Post many shifts at once. Rows that share a shift_group_id become one shift group, sent to your approved suppliers.",
    allowed: ["buyer"],
    href: "/shifts",
    columns: [
      { key: "shift_group_id", label: "Shift group ID", required: true, description: "Your ID. Rows that share it are combined" },
      { key: "location", label: "Location", required: true, description: "Location name or cost center" },
      { key: "position", label: "Position", required: true, description: "Like Bartender or Line Cook" },
      { key: "date", label: "Date", required: true, description: "YYYY-MM-DD" },
      { key: "start_time", label: "Start", required: true, description: "24-hour time, HH:MM" },
      { key: "end_time", label: "End", required: true, description: "24-hour time, HH:MM" },
      { key: "pros_needed", label: "Pros needed", required: true, description: "1 to 60" },
      { key: "break_minutes", label: "Break", required: false, description: "Unpaid minutes. Defaults to 30 over 6 hours" },
      { key: "event_name", label: "Event", required: false, description: "Shown on shift cards" },
      { key: "instructions", label: "Instructions", required: false, description: "Duties or check-in notes" },
    ],
  },
  rates: {
    type: "rates",
    label: "Rate",
    description: "Your rate card. Each row is one position in one city.",
    allowed: ["supplier"],
    href: "/rates",
    columns: [
      { key: "city", label: "City", required: true, description: "City the rate applies to" },
      { key: "position", label: "Position", required: true, description: "Position name" },
      { key: "pro_rate", label: "Pay rate", required: true, description: "What the Pro earns per hour" },
      { key: "bill_rate", label: "Bill rate", required: true, description: "What Compass pays per hour. Invoices use this rate" },
      { key: "markup_pct", label: "Markup", required: true, description: "What you keep, as a percent of the pay rate" },
      { key: "zip_codes", label: "Zip codes", required: false, description: "Separated by semicolons. Blank covers the city" },
    ],
  },
  professionals: {
    type: "professionals",
    label: "Professional",
    description: "Add or update your Pros with their onboarding and compliance status.",
    allowed: ["supplier"],
    href: "/professionals",
    columns: [
      { key: "pro_id", label: "Pro ID", required: false, description: "Blank for a new Pro, or an ID to update" },
      { key: "first_name", label: "First name", required: true, description: "First name" },
      { key: "last_name", label: "Last name", required: true, description: "Last name" },
      { key: "email", label: "Email", required: true, description: "Email address" },
      { key: "phone", label: "Phone", required: false, description: "10 digits, like (312) 555-0134" },
      { key: "city", label: "City", required: true, description: "Home city" },
      { key: "zip_code", label: "Zip", required: false, description: "Home zip code" },
      { key: "positions", label: "Positions", required: true, description: "Separated by semicolons" },
      { key: "background_check", label: "Background check", required: true, description: "Date completed, or pending" },
      { key: "i9", label: "I-9", required: true, description: "complete or pending" },
      { key: "orientation", label: "Orientation", required: true, description: "complete or pending" },
      { key: "food_handler_expires", label: "Food handler card", required: false, description: "Expiration date, for food roles" },
      { key: "alcohol_cert_expires", label: "Alcohol cert", required: false, description: "Expiration date, for alcohol roles" },
    ],
  },
  timesheets: {
    type: "timesheets",
    label: "Timesheet",
    description: "Hours worked on finished shifts. They're saved as submitted, ready for approval on Shifts.",
    allowed: ["buyer", "supplier"],
    href: "/shifts",
    columns: [
      SHIFT_GROUP_COLUMN,
      PRO_COLUMN,
      { key: "clock_in", label: "Clock in", required: true, description: "24-hour time, HH:MM" },
      { key: "clock_out", label: "Clock out", required: true, description: "24-hour time, HH:MM" },
      { key: "break_minutes", label: "Break", required: true, description: "Unpaid minutes" },
      { key: "notes", label: "Notes", required: false, description: "Anything the approver should know" },
    ],
  },
  tips: {
    type: "tips",
    label: "Tip",
    description: "Tips earned by Pros. They pass through to the Pro with no markup on the next invoice.",
    allowed: ["buyer", "supplier"],
    href: "/shifts",
    columns: [SHIFT_GROUP_COLUMN, PRO_COLUMN, { key: "tip_amount", label: "Tip", required: true, description: "Dollars" }],
  },
  activity: {
    type: "activity",
    label: "Business activity",
    description: "Events, meals served and revenue by location and day. Stored so labor spend can be compared with business volume later.",
    allowed: ["compass"],
    columns: [
      { key: "location", label: "Location", required: true, description: "Location name or cost center" },
      { key: "date", label: "Date", required: true, description: "YYYY-MM-DD" },
      { key: "events", label: "Events", required: true, description: "Events held that day" },
      { key: "meals_served", label: "Meals served", required: true, description: "Meals and covers served" },
      { key: "revenue", label: "Revenue", required: true, description: "Food and beverage revenue in dollars" },
    ],
  },
}

export const specsFor = (kind: PersonaKind) => Object.values(UPLOAD_SPECS).filter((s) => s.allowed.includes(kind))

export const columnLabel = (type: UploadType, key?: string) =>
  key ? (UPLOAD_SPECS[type].columns.find((c) => c.key === key)?.label ?? key) : "Whole row"

export const isSynced = (ws: Workspace, type: UploadType) => !!ws.supplierId && supplier(ws.supplierId).syncedUploads.includes(type)

/** Each workspace's uploads table only lists the files that workspace sent. */
export const isOwnUpload = (ws: Workspace, u: Upload) =>
  u.type in UPLOAD_SPECS &&
  u.actorKind === ws.kind &&
  (ws.kind === "compass" || (ws.kind === "buyer" ? u.buyerId === ws.buyerId : u.supplierId === ws.supplierId))

export const uploadsFor = (data: DemoData, ws: Workspace) => data.uploads.filter((u) => isOwnUpload(ws, u))

/* ----------------------------- Templates & samples ----------------------------- */

const proCode = (data: DemoData, id?: string) => data.pros.find((p) => p.id === id)?.code ?? ""
const groupCode = (data: DemoData, id: string) => data.groups.find((g) => g.id === id)?.code ?? ""

const twelveHour = (hhmm: string) => {
  const [h, m] = hhmm.split(":").map(Number)
  const h12 = h % 12 === 0 ? 12 : h % 12
  return `${h12}${m ? `:${pad(m)}` : ""}${h >= 12 ? "pm" : "am"}`
}

const usDate = (iso: string) => `${Number(iso.slice(5, 7))}/${Number(iso.slice(8, 10))}/${iso.slice(0, 4)}`

/** Drops one letter near the middle, the kind of slip a spreadsheet picks up. */
const typo = (name: string) => {
  let i = Math.floor(name.length / 2)
  while (i < name.length - 1 && (!/[a-z]/i.test(name[i]) || name[i - 1] === " ")) i++
  return name.slice(0, i) + name.slice(i + 1)
}

const POSITION_CODES: Record<string, string> = {
  bartender: "BAR", barback: "BBK", server: "SRV", concessions: "CON", cashier: "CSH", suite: "STE", linecook: "LCK", prepcook: "PRP", dishwasher: "DSH", porter: "POR",
}

const EVENT_PLANS: Record<string, { event: string; roles: [string, number, string, string][] }> = {
  Stadium: { event: "Game day", roles: [["concessions", 12, "09:30", "17:30"], ["bartender", 8, "10:00", "17:30"], ["suite", 6, "10:30", "18:00"]] },
  Arena: { event: "Concert night", roles: [["bartender", 6, "16:30", "23:30"], ["concessions", 8, "17:00", "23:00"], ["barback", 3, "16:00", "23:30"]] },
  "Convention center": { event: "Winter Hospitality Show", roles: [["server", 10, "06:30", "15:00"], ["porter", 5, "06:00", "14:30"], ["linecook", 3, "06:00", "14:30"]] },
  Ballpark: { event: "Day game", roles: [["concessions", 8, "11:00", "17:30"], ["cashier", 4, "11:00", "17:00"]] },
  "Campus dining": { event: "", roles: [["linecook", 2, "06:30", "15:00"], ["prepcook", 2, "07:00", "15:30"], ["dishwasher", 2, "10:00", "18:30"]] },
}

function shiftRows(data: DemoData, ws: Workspace, withIssues: boolean): Row[] {
  const prefix = (ws.buyerId ? buyer(ws.buyerId).brand : "CRU").toUpperCase().slice(0, 4)
  const used = new Set(data.groups.map((g) => g.code.toLowerCase()))
  const rows = locationsFor(ws.buyerId).flatMap((loc, i) => {
    const plan = EVENT_PLANS[loc.kind] ?? EVENT_PLANS["Campus dining"]
    const date = addDaysISO(todayISO(), 15 + i)
    return plan.roles
      .filter(([positionId]) => ws.buyerId && notifiedSuppliers(data, ws.buyerId, loc.cityId, positionId).length)
      .map(([positionId, count, start, end]) => {
        let code = `${prefix}-${date.slice(5).replace("-", "")}-${POSITION_CODES[positionId]}`
        for (let k = 2; used.has(code.toLowerCase()); k++) code = `${code.replace(/-\d+$/, "")}-${k}`
        return {
          shift_group_id: code,
          location: loc.name,
          position: position(positionId).name,
          date,
          start_time: start,
          end_time: end,
          pros_needed: String(count),
          break_minutes: "30",
          event_name: plan.event,
          instructions: loc.kind === "Convention center" ? "Check in at the loading dock" : "",
        }
      })
  })
  if (withIssues && rows.length >= 6) {
    rows[1] = { ...rows[1], start_time: twelveHour(rows[1].start_time) }
    rows[3] = { ...rows[3], position: typo(rows[3].position) }
    rows[5] = { ...rows[5], date: usDate(rows[5].date) }
  }
  return rows
}

const inWorkspace = (ws: Workspace, t: Timesheet) => (ws.kind === "buyer" ? t.buyerId === ws.buyerId : ws.kind === "supplier" ? t.supplierId === ws.supplierId : true)

function timesheetRows(data: DemoData, ws: Workspace, withIssues: boolean): Row[] {
  const order: Record<string, number> = { awaiting_submission: 0, disputed: 1, submitted: 2 }
  const open = data.timesheets.filter((t) => inWorkspace(ws, t) && !t.invoiceId && t.status !== "approved" && (ws.kind !== "buyer" || t.status !== "disputed"))
  const rows = [...open]
    .sort((a, b) => order[a.status] - order[b.status] || b.date.localeCompare(a.date))
    .slice(0, 10)
    .map((t) => ({
      shift_group_id: groupCode(data, t.groupId),
      pro_id: proCode(data, t.proId),
      clock_in: t.clockIn ?? t.scheduledStart,
      clock_out: t.clockOut ?? t.scheduledEnd,
      break_minutes: String(t.breakMins),
      notes: "",
    }))
  if (withIssues && rows.length >= 3) {
    rows[1] = { ...rows[1], clock_out: twelveHour(rows[1].clock_out) }
    rows[2] = { ...rows[2], pro_id: rows[2].pro_id.replace("-", "") }
    rows.push({ ...rows[0] })
  }
  return rows
}

function tipRows(data: DemoData, ws: Workspace, withIssues: boolean): Row[] {
  const open = data.timesheets.filter((t) => inWorkspace(ws, t) && !t.invoiceId)
  const tipped = open.filter((t) => ["bartender", "barback", "server", "suite"].includes(t.positionId))
  const rows = (tipped.length >= 6 ? tipped : open).slice(0, 10).map((t) => ({
    shift_group_id: groupCode(data, t.groupId),
    pro_id: proCode(data, t.proId),
    tip_amount: (28 + (hashString(t.id) % 6200) / 100).toFixed(2),
  }))
  if (withIssues && rows.length >= 3) {
    rows[1] = { ...rows[1], shift_group_id: rows[1].shift_group_id.replace("-", "") }
    rows[2] = { ...rows[2], pro_id: rows[2].pro_id.replace("-", "").toLowerCase() }
    rows.push({ ...rows[0] })
  }
  return rows
}

function rateRows(data: DemoData, ws: Workspace, withIssues: boolean): Row[] {
  const cityOrder = (id: string) => CITIES.findIndex((c) => c.id === id)
  const positionOrder = (id: string) => POSITIONS.findIndex((p) => p.id === id)
  const cards = data.rateCards
    .filter((c) => c.supplierId === ws.supplierId && c.status === "active")
    .sort((a, b) => cityOrder(a.cityId) - cityOrder(b.cityId) || positionOrder(a.positionId) - positionOrder(b.positionId))
    .slice(0, 8)
  const rows = cards.map((c, i) => {
    const pro = round2(c.proRate + (i % 2 ? 0.25 : 0.5))
    return {
      city: city(c.cityId).name,
      position: position(c.positionId).name,
      pro_rate: pro.toFixed(2),
      bill_rate: billFrom(pro, c.markupPct).toFixed(2),
      markup_pct: String(c.markupPct),
      zip_codes: c.zipsAutoFilled ? "" : c.zips.slice(0, 4).join(";"),
    }
  })
  if (withIssues && rows.length >= 4) {
    rows[1] = { ...rows[1], markup_pct: "" }
    rows[2] = { ...rows[2], city: typo(rows[2].city) }
    const zips = CITIES.find((c) => c.name === rows[3].city)?.zips ?? []
    const outside = zips.map((z) => String(Number(z) + 1)).find((z) => !zips.includes(z))
    if (outside) rows[3] = { ...rows[3], zip_codes: [zips[0], zips[1], outside].join(";") }
  }
  return rows
}

const NEW_HIRES: [string, string][] = [
  ["Jalen", "Whitaker"], ["Renata", "Silva"], ["Theo", "Banks"], ["Marisol", "Ibarra"], ["Dmitri", "Volkov"], ["Noor", "Haddad"],
  ["Ezra", "Lindqvist"], ["Bianca", "Moreau"], ["Mateo", "Quintero"], ["Celeste", "Arnaud"], ["Rohan", "Mehta"], ["Talia", "Brennan"],
  ["Wes", "Calloway"], ["Yusuf", "Demir"], ["Zoe", "Fairbanks"], ["Amara", "Nwosu"], ["Dante", "Russo"], ["Freya", "Halvorsen"],
  ["Kofi", "Mensah"], ["Leila", "Farah"], ["Callum", "Prescott"], ["Esme", "Laurent"], ["Hugo", "Sandoval"], ["Simone", "Achebe"],
]

const HIRE_POSITIONS = [["bartender", "barback"], ["server", "suite"], ["linecook", "prepcook"], ["concessions", "cashier"], ["porter", "dishwasher"]]

function proRows(data: DemoData, ws: Workspace, withIssues: boolean): Row[] {
  const sup = supplier(ws.supplierId ?? "")
  const taken = new Set(data.pros.map((p) => p.email.toLowerCase()))
  const today = todayISO()
  const rows = NEW_HIRES.map(([first, last]) => ({ first, last, email: `${first}.${last}@example.com`.toLowerCase() }))
    .filter((h) => !taken.has(h.email))
    .slice(0, 10)
    .map((h, i) => {
      const c = city(sup.cityIds[i % 4 === 3 ? 1 % sup.cityIds.length : 0])
      const positionIds = HIRE_POSITIONS[i % HIRE_POSITIONS.length]
      const needs = requirementsFor(positionIds)
      return {
        pro_id: "",
        first_name: h.first,
        last_name: h.last,
        email: h.email,
        phone: formatPhone(`${AREA_CODES[c.id]}555${String(1000 + ((i * 739) % 9000)).padStart(4, "0")}`),
        city: c.name,
        zip_code: c.zips[(i * 5) % c.zips.length],
        positions: positionIds.map((id) => position(id).name).join(";"),
        background_check: addDaysISO(today, -(3 + i)),
        i9: "complete",
        orientation: i % 5 === 4 ? "pending" : "complete",
        food_handler_expires: needs.includes("foodHandler") ? addDaysISO(today, 420 + i * 37) : "",
        alcohol_cert_expires: needs.includes("alcohol") ? addDaysISO(today, 380 + i * 41) : "",
      }
    })
  if (withIssues && rows.length >= 6) {
    rows[2] = { ...rows[2], phone: rows[2].phone.slice(6) }
    const zips = CITIES.find((c) => c.name === rows[5].city)?.zips ?? []
    const outside = zips.map((z) => String(Number(z) + 4)).find((z) => !zips.includes(z))
    if (outside) rows[5] = { ...rows[5], zip_code: outside }
    rows.push({ ...rows[3] })
  }
  return rows
}

const ACTIVITY: Record<string, { events: [number, number]; meals: [number, number]; check: [number, number] }> = {
  Stadium: { events: [0, 1], meals: [9000, 15000], check: [18, 26] },
  Arena: { events: [0, 1], meals: [5000, 9000], check: [17, 24] },
  Ballpark: { events: [0, 1], meals: [6000, 11000], check: [15, 21] },
  "Convention center": { events: [1, 3], meals: [1800, 4200], check: [24, 36] },
  "Campus dining": { events: [0, 2], meals: [1200, 2600], check: [8, 12] },
}

function activityFor(l: Location, date: string): Row {
  const h = hashString(`${l.id}|${date}`)
  const v = ACTIVITY[l.kind] ?? ACTIVITY["Campus dining"]
  const events = v.events[0] + (h % (v.events[1] - v.events[0] + 1))
  const venue = l.kind !== "Campus dining" && l.kind !== "Convention center"
  const meals = venue && !events ? 0 : Math.round(v.meals[0] + (((h >>> 8) % 1000) / 1000) * (v.meals[1] - v.meals[0]))
  const check = v.check[0] + (((h >>> 18) % 100) / 100) * (v.check[1] - v.check[0])
  return { location: l.name, date, events: String(events), meals_served: String(meals), revenue: (meals * check).toFixed(2) }
}

function activityRows(withIssues: boolean): Row[] {
  const rows = [3, 2, 1].flatMap((ago) => LOCATIONS.map((l) => activityFor(l, addDaysISO(todayISO(), -ago))))
  if (withIssues) {
    rows[1] = { ...rows[1], location: typo(rows[1].location) }
    rows[4] = { ...rows[4], date: usDate(rows[4].date) }
    rows.push({ ...rows[2] })
  }
  return rows
}

/** Rows prefilled from the workspace's own shifts, Pros and rates. A sample adds about three rows the agent can fix. */
export function templateRows(type: UploadType, data: DemoData, ws: Workspace, withIssues = false): Row[] {
  if (type === "shifts") return shiftRows(data, ws, withIssues)
  if (type === "timesheets") return timesheetRows(data, ws, withIssues)
  if (type === "tips") return tipRows(data, ws, withIssues)
  if (type === "rates") return rateRows(data, ws, withIssues)
  if (type === "professionals") return proRows(data, ws, withIssues)
  return activityRows(withIssues)
}

export function templateCsv(type: UploadType, data: DemoData, ws: Workspace, withIssues = false) {
  return toCsv(templateRows(type, data, ws, withIssues), UPLOAD_SPECS[type].columns.map((c) => c.key))
}

export const templateName = (type: UploadType) => `iris-${type}-template.csv`

export const sampleName = (type: UploadType) => `sample_${type}.csv`

/* ---------------------------------- Plans ---------------------------------- */

export interface RowResult {
  row: number
  values: Row
  issues: UploadIssue[]
  ok: boolean
  summary: string
}

export interface ImportPlan {
  type: UploadType
  rows: RowResult[]
  headers: string[]
  missingColumns: string[]
  unknownColumns: string[]
  parseErrors: string[]
  okCount: number
  errorCount: number
  warningCount: number
  summary: string
  apply?: (data: DemoData, uploadId: string) => Patch
}

type Ctx = { data: DemoData; ws: Workspace; today: string; nums: number[] }

type Fix = NonNullable<UploadIssue["suggestion"]>

const REMOVE_ROW: Fix = { removeRow: true, label: "Remove this row" }

const fixTo = (value: string, label = value): Fix => ({ value, label })

const problem = (row: number, column: string | undefined, message: string, suggestion?: Fix): UploadIssue =>
  suggestion ? { row, column, message, level: "error", suggestion } : { row, column, message, level: "error" }

const note = (row: number, column: string | undefined, message: string): UploadIssue => ({ row, column, message, level: "warning" })

const hasErrors = (issues: UploadIssue[]) => issues.some((i) => i.level === "error")

const required = (row: Row, keys: string[], issues: UploadIssue[], n: number) => {
  for (const k of keys) if (!row[k]) issues.push(problem(n, k, "Missing"))
}

/** Remembers the first row with this key, and returns it when the key shows up again. */
const firstSeen = (seen: Map<string, number>, key: string, n: number) => {
  const first = seen.get(key)
  if (first === undefined) seen.set(key, n)
  return first
}

const duplicate = (n: number, values: Row, column: string | undefined, message: string): RowResult => ({
  row: n,
  values,
  issues: [problem(n, column, message, REMOVE_ROW)],
  ok: false,
  summary: "",
})

/** Exact names pass quietly. A near miss is still used for the other checks, and becomes a fix to review. */
function lookup<T>(exact: T | undefined, raw: string, candidates: T[], names: (c: T) => string[], n: number, column: string, issues: UploadIssue[], message: string) {
  if (exact) return exact
  const guess = closestMatch(raw, candidates, names)
  issues.push(problem(n, column, message, guess ? fixTo(names(guess)[0]) : undefined))
  return guess
}

function timeCell(raw: string, n: number, column: string, issues: UploadIssue[]) {
  const parsed = parseTime(raw)
  if (!parsed) issues.push(problem(n, column, "Not a time"))
  else if (!CLOCK.test(raw.trim())) issues.push(problem(n, column, "Use 24-hour time", fixTo(parsed)))
  return parsed
}

function dateCell(raw: string, n: number, column: string, issues: UploadIssue[]) {
  const parsed = parseDateCell(raw)
  if (!parsed) issues.push(problem(n, column, "Not a date"))
  else if (!ISO_DATE.test(raw.trim())) issues.push(problem(n, column, "Use YYYY-MM-DD", fixTo(parsed)))
  return parsed
}

function groupCell(ctx: Ctx, raw: string, n: number, issues: UploadIssue[]) {
  const exact = ctx.data.groups.find((g) => g.code.toLowerCase() === raw.trim().toLowerCase())
  if (exact) return exact
  const key = norm(raw)
  const guess = ctx.data.groups.find((g) => norm(g.code) === key || norm(g.code) === `sg${key}`)
  issues.push(problem(n, "shift_group_id", guess ? "Not a valid ID" : "No shift group with this ID", guess ? fixTo(guess.code) : undefined))
  return guess
}

function proCell(ctx: Ctx, raw: string, n: number, issues: UploadIssue[]) {
  const exact = ctx.data.pros.find((p) => p.code.toLowerCase() === raw.trim().toLowerCase())
  if (exact) return exact
  const key = norm(raw)
  const guess = ctx.data.pros.find((p) => norm(p.code) === key || norm(p.code) === `p${key}`)
  issues.push(problem(n, "pro_id", guess ? "Not a valid ID" : "No Pro with this ID", guess ? fixTo(guess.code) : undefined))
  return guess
}

const tally = (results: RowResult[]) => ({
  okCount: results.filter((r) => r.ok).length,
  errorCount: results.filter((r) => !r.ok).length,
  warningCount: results.reduce((s, r) => s + r.issues.filter((i) => i.level === "warning").length, 0),
})

type Planned = Omit<ImportPlan, "type" | "headers" | "missingColumns" | "unknownColumns" | "parseErrors">

/** Checks every row. Pass rowNumbers when the text is a reviewed copy, so issues keep the row numbers of the original file. */
export function planImport(type: UploadType, text: string, data: DemoData, ws: Workspace, rowNumbers?: number[]): ImportPlan {
  const { headers, rows, parseErrors } = parseCsv(text)
  const spec = UPLOAD_SPECS[type]
  const known = new Set(spec.columns.map((c) => c.key))
  const missingColumns = spec.columns.filter((c) => c.required && !headers.includes(c.key)).map((c) => c.key)
  const unknownColumns = headers.filter((h) => !known.has(h))
  const nums = rows.map((_, i) => rowNumbers?.[i] ?? i + 2)
  const base = { type, headers, missingColumns, unknownColumns, parseErrors }
  if (!rows.length || missingColumns.length) {
    return {
      ...base,
      rows: rows.map((values, i) => ({ row: nums[i], values, issues: [], ok: false, summary: "" })),
      okCount: 0,
      errorCount: rows.length,
      warningCount: 0,
      summary: !rows.length ? "The file has no rows" : `Missing required column${missingColumns.length === 1 ? "" : "s"}: ${missingColumns.join(", ")}`,
    }
  }
  const planners: Record<UploadType, (rows: Row[], ctx: Ctx) => Planned> = {
    shifts: planShifts,
    timesheets: planTimesheets,
    tips: planTips,
    rates: planRates,
    professionals: planPros,
    activity: planActivity,
  }
  return { ...base, ...planners[type](rows, { data, ws, today: todayISO(), nums }) }
}

/* Shifts ---------------------------------------------------------------- */

function planShifts(rows: Row[], ctx: Ctx): Planned {
  const results: RowResult[] = []
  type Draft = { code: string; locationId: string; positionId: string; date: string; start: string; end: string; breakMins: number; headcount: number; eventName?: string; instructions?: string; firstRow: number }
  const drafts = new Map<string, Draft>()
  const seen = new Map<string, number>()
  const taken = new Set([...ctx.data.groups.map((g) => g.code.toLowerCase()), ...rows.map((r) => (r.shift_group_id ?? "").toLowerCase())])
  const freshCode = (code: string) => {
    let k = 2
    while (taken.has(`${code}-${k}`.toLowerCase())) k++
    return `${code}-${k}`
  }
  const keys = UPLOAD_SPECS.shifts.columns.map((c) => c.key)
  const locations = locationsFor(ctx.ws.buyerId)
  rows.forEach((row, i) => {
    const n = ctx.nums[i]
    const same = firstSeen(seen, keys.map((k) => norm(row[k] ?? "")).join("|"), n)
    if (same !== undefined) {
      results.push(duplicate(n, row, undefined, `Same as row ${same}`))
      return
    }
    const issues: UploadIssue[] = []
    required(row, ["shift_group_id", "location", "position", "date", "start_time", "end_time", "pros_needed"], issues, n)
    const code = (row.shift_group_id ?? "").toUpperCase()
    if (code && ctx.data.groups.some((g) => g.code.toLowerCase() === code.toLowerCase())) issues.push(problem(n, "shift_group_id", "ID already used by another shift", fixTo(freshCode(code))))
    const loc = row.location ? lookup(resolveLocation(row.location, ctx.ws.buyerId), row.location, locations, (l) => [l.name, l.costCenter], n, "location", issues, "Not one of your locations") : undefined
    const pos = row.position ? lookup(resolvePosition(row.position), row.position, POSITIONS, (p) => [p.name], n, "position", issues, "Not a position on Iris") : undefined
    const date = row.date ? dateCell(row.date, n, "date", issues) : undefined
    if (date && date < ctx.today) issues.push(problem(n, "date", "Date is in the past"))
    const start = row.start_time ? timeCell(row.start_time, n, "start_time", issues) : undefined
    const end = row.end_time ? timeCell(row.end_time, n, "end_time", issues) : undefined
    const headcount = parseNumber(row.pros_needed ?? "")
    if (row.pros_needed && (headcount === undefined || headcount < 1 || headcount > 60 || !Number.isInteger(headcount))) issues.push(problem(n, "pros_needed", "Use a whole number from 1 to 60"))
    let breakMins = parseNumber(row.break_minutes ?? "")
    if (row.break_minutes && (breakMins === undefined || breakMins < 0 || breakMins > 120)) issues.push(problem(n, "break_minutes", "Use 0 to 120 minutes"))
    if (breakMins === undefined && start && end) breakMins = paidHours(start, end, 0) > 6 ? 30 : 0
    if (loc && pos && !notifiedSuppliers(ctx.data, loc.buyerId, loc.cityId, pos.id).length)
      issues.push(problem(n, "position", `None of your approved suppliers staff ${pos.name} in ${city(loc.cityId).name}`))
    if (!hasErrors(issues) && loc && pos && date && start && end && headcount) {
      const existing = drafts.get(code)
      if (!existing) {
        drafts.set(code, { code, locationId: loc.id, positionId: pos.id, date, start, end, breakMins: breakMins ?? 0, headcount, eventName: row.event_name || undefined, instructions: row.instructions || undefined, firstRow: n })
      } else if (existing.locationId !== loc.id || existing.positionId !== pos.id || existing.date !== date || existing.start !== start || existing.end !== end) {
        issues.push(problem(n, "shift_group_id", `Same ID as row ${existing.firstRow}, but a different shift`, fixTo(freshCode(code))))
      } else {
        existing.headcount += headcount
        issues.push(note(n, "shift_group_id", `Added to row ${existing.firstRow}: ${code} now needs ${existing.headcount} Pros`))
      }
    }
    const ok = !hasErrors(issues)
    results.push({ row: n, values: row, issues, ok, summary: ok && pos && loc && date ? `${headcount} ${pos.name} at ${loc.name}, ${formatDateShort(date)}` : "" })
  })
  const groups = [...drafts.values()]
  const spots = groups.reduce((s, g) => s + g.headcount, 0)
  return {
    rows: results,
    ...tally(results),
    summary: groups.length ? `${plural(groups.length, "shift group")} posted (${plural(spots, "spot")})` : "No shift groups posted",
    apply: groups.length
      ? (data, uploadId) => {
          const created = new Date().toISOString()
          const made = groups.flatMap((d): ShiftGroup[] => {
            const loc = location(d.locationId)
            const notified = notifiedSuppliers(data, loc.buyerId, loc.cityId, d.positionId)
            if (!notified.length) return []
            const card = notified[0].card
            const id = d.code.toLowerCase()
            const pos = position(d.positionId)
            return [
              {
                id,
                code: d.code,
                buyerId: loc.buyerId,
                locationId: loc.id,
                positionId: d.positionId,
                eventName: d.eventName,
                date: d.date,
                start: d.start,
                end: d.end,
                breakMins: d.breakMins,
                supplierId: card.supplierId,
                supplierIds: [card.supplierId],
                supplierReleases: supplierReleasePlan(
                  notified.map((x) => x.card.supplierId),
                  created,
                ),
                billRate: card.billRate,
                proRate: card.proRate,
                markupPct: card.markupPct,
                slots: Array.from({ length: d.headcount }, (_, k) => ({ id: `${id}-${k + 1}`, status: "open" as const })),
                badges: [],
                instructions: d.instructions ?? pos.duties,
                attire: pos.attire,
                createdAt: created,
                createdBy: ctx.ws.user.name,
                source: "upload",
                uploadId,
                liveFill: { startedAt: created },
              },
            ]
          })
          return { groups: [...made, ...data.groups] }
        }
      : undefined,
  }
}

/* Timesheets ------------------------------------------------------------ */

function planTimesheets(rows: Row[], ctx: Ctx): Planned {
  const results: RowResult[] = []
  const updates = new Map<string, Partial<Timesheet>>()
  const creates: Timesheet[] = []
  const seen = new Map<string, number>()
  let tsCounter = ctx.data.counters.ts
  const now = new Date().toISOString()
  rows.forEach((row, i) => {
    const n = ctx.nums[i]
    const issues: UploadIssue[] = []
    required(row, ["shift_group_id", "pro_id", "clock_in", "clock_out"], issues, n)
    const g = row.shift_group_id ? groupCell(ctx, row.shift_group_id, n, issues) : undefined
    const pro = row.pro_id ? proCell(ctx, row.pro_id, n, issues) : undefined
    const same = g && pro ? firstSeen(seen, `${g.id}|${pro.id}`, n) : undefined
    if (same !== undefined) {
      results.push(duplicate(n, row, "pro_id", `Duplicate of row ${same}`))
      return
    }
    if (g && ctx.ws.kind === "buyer" && g.buyerId !== ctx.ws.buyerId) issues.push(problem(n, "shift_group_id", "Not one of your shifts"))
    const phase = g ? groupPhase(g) : undefined
    if (g && phase !== "past") issues.push(problem(n, "shift_group_id", phase === "cancelled" ? "This shift was cancelled" : "This shift hasn't finished yet"))
    if (pro && ctx.ws.kind === "supplier" && pro.supplierId !== ctx.ws.supplierId) issues.push(problem(n, "pro_id", "Not one of your Pros"))
    const slot = g && pro ? g.slots.find((s) => s.proId === pro.id) : undefined
    if (g && pro && !slot) issues.push(problem(n, "pro_id", `Wasn't booked on ${g.code}`))
    if (slot?.status === "no_show") issues.push(problem(n, "pro_id", "Marked as a no-show on this shift"))
    const clockIn = row.clock_in ? timeCell(row.clock_in, n, "clock_in", issues) : undefined
    const clockOut = row.clock_out ? timeCell(row.clock_out, n, "clock_out", issues) : undefined
    let breakMins = parseNumber(row.break_minutes ?? "")
    if (!row.break_minutes) {
      issues.push(problem(n, "break_minutes", "Missing", g ? fixTo(String(g.breakMins), `${g.breakMins} min, as scheduled`) : undefined))
      breakMins = g?.breakMins
    } else if (breakMins === undefined || breakMins < 0 || breakMins > 120) issues.push(problem(n, "break_minutes", "Use 0 to 120 minutes"))
    const existing = g && pro ? ctx.data.timesheets.find((t) => t.groupId === g.id && t.proId === pro.id) : undefined
    if (existing && (existing.status === "approved" || existing.invoiceId)) issues.push(problem(n, undefined, "Already approved, so these hours can't change", REMOVE_ROW))
    let hours = 0
    if (clockIn && clockOut) {
      hours = paidHours(clockIn, clockOut, breakMins ?? 0)
      const over = g ? round2(hours - paidHours(g.start, g.end, g.breakMins)) : 0
      if (hours > 16) issues.push(problem(n, "clock_out", `${hours} hours is longer than a shift can be`))
      else if (over >= 0.75) issues.push(note(n, "clock_out", `${over} hrs over schedule, so it's flagged for the approver`))
    }
    if (existing?.status === "disputed") issues.push(note(n, undefined, "Resubmits a disputed timesheet"))
    const ok = !hasErrors(issues)
    if (ok && g && pro && slot && clockIn && clockOut) {
      const patch = { clockIn, clockOut, breakMins: breakMins ?? 0, hours, status: "submitted" as const, source: "csv" as const, submittedAt: now }
      if (existing) updates.set(existing.id, { ...patch, supplierId: pro.supplierId })
      else {
        const card = ctx.data.rateCards.find((c) => c.supplierId === pro.supplierId && c.cityId === location(g.locationId).cityId && c.positionId === g.positionId && c.status === "active")
        creates.push({
          id: `ts-${tsCounter++}`,
          groupId: g.id,
          slotId: slot.id,
          proId: pro.id,
          supplierId: pro.supplierId,
          buyerId: g.buyerId,
          locationId: g.locationId,
          positionId: g.positionId,
          date: g.date,
          scheduledStart: g.start,
          scheduledEnd: g.end,
          billRate: card?.billRate ?? g.billRate,
          tips: 0,
          ...patch,
        })
      }
    }
    results.push({ row: n, values: row, issues, ok, summary: ok && pro ? `${pro.firstName} ${pro.lastName}: ${hours} hrs` : "" })
  })
  const total = updates.size + creates.length
  return {
    rows: results,
    ...tally(results),
    summary: total ? `${plural(total, "timesheet")} submitted for approval` : "No timesheets submitted",
    apply: total
      ? (data) => ({
          timesheets: [
            ...creates,
            ...data.timesheets.map((ts) =>
              updates.has(ts.id) ? { ...ts, ...updates.get(ts.id), dispute: ts.dispute ? { ...ts.dispute, response: "Resubmitted by CSV", respondedAt: now } : undefined } : ts,
            ),
          ],
          counters: { ts: tsCounter },
        })
      : undefined,
  }
}

/* Tips ------------------------------------------------------------------ */

function planTips(rows: Row[], ctx: Ctx): Planned {
  const results: RowResult[] = []
  const tips = new Map<string, number>()
  const seen = new Map<string, number>()
  rows.forEach((row, i) => {
    const n = ctx.nums[i]
    const issues: UploadIssue[] = []
    required(row, ["shift_group_id", "pro_id", "tip_amount"], issues, n)
    const g = row.shift_group_id ? groupCell(ctx, row.shift_group_id, n, issues) : undefined
    const pro = row.pro_id ? proCell(ctx, row.pro_id, n, issues) : undefined
    const same = g && pro ? firstSeen(seen, `${g.id}|${pro.id}`, n) : undefined
    if (same !== undefined) {
      results.push(duplicate(n, row, "pro_id", `Duplicate of row ${same}`))
      return
    }
    if (g && ctx.ws.kind === "buyer" && g.buyerId !== ctx.ws.buyerId) issues.push(problem(n, "shift_group_id", "Not one of your shifts"))
    const ts = g && pro ? ctx.data.timesheets.find((t) => t.groupId === g.id && t.proId === pro.id) : undefined
    if (g && pro && !ts) issues.push(problem(n, "pro_id", `No hours for this Pro on ${g.code}`))
    if (ts && ctx.ws.kind === "supplier" && ts.supplierId !== ctx.ws.supplierId) issues.push(problem(n, "pro_id", "Not one of your Pros"))
    if (ts?.invoiceId) issues.push(problem(n, undefined, "Already invoiced, so tips can't change", REMOVE_ROW))
    const amount = parseNumber(row.tip_amount ?? "")
    if (row.tip_amount && (amount === undefined || amount < 0 || amount > 1000)) issues.push(problem(n, "tip_amount", "Use an amount from $0 to $1,000"))
    const ok = !hasErrors(issues)
    if (ok && ts && amount !== undefined) tips.set(ts.id, round2(amount))
    results.push({ row: n, values: row, issues, ok, summary: ok && pro ? `${money(amount ?? 0)} for ${pro.firstName} ${pro.lastName}` : "" })
  })
  const total = round2([...tips.values()].reduce((s, v) => s + v, 0))
  return {
    rows: results,
    ...tally(results),
    summary: tips.size ? `${money(total)} in tips added to ${plural(tips.size, "timesheet")}` : "No tips added",
    apply: tips.size ? (data) => ({ timesheets: data.timesheets.map((ts) => (tips.has(ts.id) && !ts.invoiceId ? { ...ts, tips: tips.get(ts.id)! } : ts)) }) : undefined,
  }
}

/* Rates ----------------------------------------------------------------- */

function planRates(rows: Row[], ctx: Ctx): Planned {
  const results: RowResult[] = []
  const cards: Omit<RateCard, "id">[] = []
  const seen = new Map<string, number>()
  const supplierId = ctx.ws.supplierId
  rows.forEach((row, i) => {
    const n = ctx.nums[i]
    const issues: UploadIssue[] = []
    if (!supplierId) issues.push(problem(n, undefined, "Only suppliers upload rates"))
    required(row, ["city", "position", "pro_rate", "bill_rate"], issues, n)
    const c = row.city ? lookup(resolveCity(row.city), row.city, CITIES, (x) => [x.name], n, "city", issues, "Not an Iris city") : undefined
    if (c && supplierId && !supplier(supplierId).cityIds.includes(c.id)) issues.push(problem(n, "city", `You're not set up in ${c.name}`))
    const pos = row.position ? lookup(resolvePosition(row.position), row.position, POSITIONS, (p) => [p.name], n, "position", issues, "Not a position on Iris") : undefined
    const same = c && pos ? firstSeen(seen, `${c.id}|${pos.id}`, n) : undefined
    if (same !== undefined) {
      results.push(duplicate(n, row, "position", `Duplicate of row ${same}`))
      return
    }
    const proRate = parseNumber(row.pro_rate ?? "")
    const billRate = parseNumber(row.bill_rate ?? "")
    const markup = parseNumber(row.markup_pct ?? "")
    if (row.pro_rate && proRate === undefined) issues.push(problem(n, "pro_rate", "Not a number"))
    else if (proRate !== undefined && proRate < 7.25) issues.push(problem(n, "pro_rate", "Below the $7.25 minimum wage"))
    if (row.bill_rate && (billRate === undefined || billRate <= 0)) issues.push(problem(n, "bill_rate", "Not a number"))
    let finalMarkup = markup ?? 0
    if (proRate && proRate >= 7.25 && billRate && billRate > 0) {
      if (billRate <= proRate) issues.push(problem(n, "bill_rate", "Must be more than the pay rate"))
      else {
        finalMarkup = markupFrom(proRate, billRate)
        const fix = fixTo(String(finalMarkup), `${finalMarkup}%`)
        if (!row.markup_pct) issues.push(problem(n, "markup_pct", "Missing markup", fix))
        else if (markup === undefined) issues.push(problem(n, "markup_pct", "Not a number", fix))
        else if (Math.abs(finalMarkup - markup) > 0.5) issues.push(problem(n, "markup_pct", "Doesn't match the pay rate and bill rate", fix))
      }
    } else if (!row.markup_pct) issues.push(problem(n, "markup_pct", "Missing"))
    let zips: string[] = []
    let autoFilled = false
    if (c && !row.zip_codes) {
      zips = [...c.zips]
      autoFilled = true
    } else if (c) {
      const list = row.zip_codes.split(/[;,|\s]+/).filter(Boolean)
      const malformed = list.filter((z) => !/^\d{5}(-\d{4})?$/.test(z))
      const outside = list.filter((z) => !malformed.includes(z) && !c.zips.includes(z.slice(0, 5)))
      zips = [...new Set(list.filter((z) => !malformed.includes(z)).map((z) => (c.zips.includes(z.slice(0, 5)) ? z.slice(0, 5) : nearestZip(z.slice(0, 5), c.zips))))]
      if (malformed.length || outside.length) {
        const message = malformed.length
          ? `${malformed.join(", ")} ${malformed.length === 1 ? "isn't a zip code" : "aren't zip codes"}`
          : `${outside.join(", ")} ${outside.length === 1 ? "isn't" : "aren't"} in ${c.name}`
        issues.push(problem(n, "zip_codes", message, fixTo(zips.join(";"), zips.length ? zips.join(";") : `Blank, for all of ${c.name}`)))
      }
    }
    const ok = !hasErrors(issues)
    const existing = ok && supplierId && c && pos ? ctx.data.rateCards.find((x) => x.supplierId === supplierId && x.cityId === c.id && x.positionId === pos.id) : undefined
    if (ok && supplierId && c && pos && proRate && billRate) {
      cards.push({
        supplierId,
        cityId: c.id,
        positionId: pos.id,
        proRate: round2(proRate),
        billRate: round2(billRate),
        markupPct: finalMarkup,
        zips,
        zipsAutoFilled: autoFilled,
        status: "active",
        effectiveFrom: ctx.today,
        updatedAt: new Date().toISOString(),
        source: "upload",
      })
    }
    results.push({
      row: n,
      values: row,
      issues,
      ok,
      summary: ok && pos && c && billRate ? `${existing ? "Update" : "New"}: ${pos.name}, ${c.name} at ${money(billRate)}/hr${existing ? ` (was ${money(existing.billRate)})` : ""}` : "",
    })
  })
  const waiting = cards.filter((c) => c.status === "pending_review").length
  return {
    rows: results,
    ...tally(results),
    summary: cards.length ? `${plural(cards.length, "rate card")} saved${waiting ? `, ${waiting} waiting on Compass` : ""}` : "No rate cards changed",
    apply: cards.length
      ? (data, uploadId) => {
          let counter = data.counters.rate
          const next = [...data.rateCards]
          for (const card of cards) {
            const idx = next.findIndex((x) => x.supplierId === card.supplierId && x.cityId === card.cityId && x.positionId === card.positionId)
            const full: RateCard = { ...card, id: idx >= 0 ? next[idx].id : `rate-${counter++}`, uploadId }
            if (idx >= 0) next[idx] = full
            else next.unshift(full)
          }
          return { rateCards: next, counters: { rate: counter } }
        }
      : undefined,
  }
}

/* Professionals --------------------------------------------------------- */

const STATUS_WORDS: Record<string, ComplianceItem["status"]> = {
  complete: "complete", completed: "complete", done: "complete", yes: "complete", y: "complete", cleared: "complete", passed: "complete",
  pending: "pending", inprogress: "pending", submitted: "pending",
  missing: "missing", no: "missing", n: "missing", none: "missing",
}

function planPros(rows: Row[], ctx: Ctx): Planned {
  const results: RowResult[] = []
  const upserts: Pro[] = []
  const seen = new Map<string, number>()
  const supplierId = ctx.ws.supplierId
  let counter = ctx.data.counters.pro
  const status = (raw: string, n: number, column: string, issues: UploadIssue[]): ComplianceItem | undefined => {
    if (!raw) return undefined
    const word = STATUS_WORDS[norm(raw)]
    if (word) return word === "complete" ? { status: "complete", completedOn: ctx.today } : { status: word }
    if (parseDateCell(raw)) {
      const d = dateCell(raw, n, column, issues)
      return d ? { status: "complete", completedOn: d } : undefined
    }
    const guess = closestMatch(raw, ["complete", "pending"], (w) => [w])
    issues.push(problem(n, column, column === "background_check" ? "Use a date, complete or pending" : "Use complete or pending", guess ? fixTo(guess) : undefined))
    return guess === "complete" ? { status: "complete", completedOn: ctx.today } : guess ? { status: "pending" } : undefined
  }
  rows.forEach((row, i) => {
    const n = ctx.nums[i]
    const email = (row.email ?? "").toLowerCase().replace(/\s+/g, "")
    const same = email ? firstSeen(seen, email, n) : undefined
    if (same !== undefined) {
      results.push(duplicate(n, row, "email", `Duplicate of row ${same}`))
      return
    }
    const issues: UploadIssue[] = []
    if (!supplierId) issues.push(problem(n, undefined, "Only suppliers upload Pros"))
    required(row, ["first_name", "last_name", "email", "city", "positions", "background_check", "i9", "orientation"], issues, n)
    if (row.email && !EMAIL.test(email)) issues.push(problem(n, "email", "Not an email address"))
    else if (row.email && email !== row.email) issues.push(problem(n, "email", /\s/.test(row.email) ? "Has spaces" : "Has capital letters", fixTo(email)))
    const existing = row.pro_id ? proCell(ctx, row.pro_id, n, issues) : undefined
    if (existing && existing.supplierId !== supplierId) issues.push(problem(n, "pro_id", "Belongs to another supplier"))
    const twin = !row.pro_id && email ? ctx.data.pros.find((p) => p.supplierId === supplierId && p.email.toLowerCase() === email) : undefined
    if (twin) issues.push(problem(n, "pro_id", `Same email as ${twin.firstName} ${twin.lastName}`, fixTo(twin.code, `Update ${twin.code}`)))
    const c = row.city ? lookup(resolveCity(row.city), row.city, CITIES, (x) => [x.name], n, "city", issues, "Not an Iris city") : undefined
    if (c && supplierId && !supplier(supplierId).cityIds.includes(c.id)) issues.push(problem(n, "city", `You're not set up in ${c.name}`))
    let phone = existing?.phone ?? ""
    if (row.phone) {
      const digits = row.phone.replace(/\D/g, "").replace(/^1(?=\d{10}$)/, "")
      if (digits.length === 10) phone = formatPhone(digits)
      else if (digits.length === 7) issues.push(problem(n, "phone", "Missing area code", c ? fixTo(formatPhone(`${AREA_CODES[c.id]}${digits}`)) : undefined))
      else issues.push(problem(n, "phone", "Not a phone number"))
    }
    if (row.zip_code && c) {
      if (!/^\d{5}(-\d{4})?$/.test(row.zip_code)) issues.push(problem(n, "zip_code", "Not a zip code"))
      else if (!c.zips.includes(row.zip_code.slice(0, 5))) issues.push(problem(n, "zip_code", `Not a ${c.name} zip code`, fixTo(nearestZip(row.zip_code.slice(0, 5), c.zips))))
    }
    const names = (row.positions ?? "").split(/[;|,]+/).map((x) => x.trim()).filter(Boolean)
    const matched = names.map((x) => resolvePosition(x) ?? closestMatch(x, POSITIONS, (p) => [p.name]))
    const unknown = names.filter((x) => !resolvePosition(x))
    if (unknown.length)
      issues.push(
        problem(
          n,
          "positions",
          unknown.length === 1 ? `"${unknown[0]}" isn't a position` : `${unknown.map((x) => `"${x}"`).join(", ")} aren't positions`,
          matched.every(Boolean) ? fixTo(matched.map((p) => p!.name).join(";")) : undefined,
        ),
      )
    const positionIds = [...new Set(matched.filter(Boolean).map((p) => p!.id))]
    const compliance: Partial<Record<RequirementId, ComplianceItem>> = {}
    const bg = status(row.background_check, n, "background_check", issues)
    if (bg) compliance.background = bg.status === "complete" ? { ...bg, expiresOn: addDaysISO(bg.completedOn ?? ctx.today, 365) } : bg
    const i9 = status(row.i9, n, "i9", issues)
    if (i9) compliance.i9 = i9
    const orientation = status(row.orientation, n, "orientation", issues)
    if (orientation) compliance.orientation = orientation
    const needs = requirementsFor(positionIds)
    for (const [key, column] of [["foodHandler", "food_handler_expires"], ["alcohol", "alcohol_cert_expires"]] as const) {
      if (row[column]) {
        const d = dateCell(row[column], n, column, issues)
        if (d) compliance[key] = { status: "complete", completedOn: ctx.today, expiresOn: d }
      } else if (needs.includes(key)) {
        compliance[key] = { status: "missing" }
        const roles = positionIds.map((id) => position(id)).filter((p) => (key === "alcohol" ? p.alcohol : p.foodHandler))
        issues.push(note(n, column, `Needed for ${roles.map((p) => p.name).join(" and ")}. The Pro stays in onboarding until it's added`))
      }
    }
    const ok = !hasErrors(issues)
    if (ok && supplierId && c) {
      const code = existing?.code ?? `P-${counter++}`
      const draft: Pro = {
        id: existing?.id ?? code.toLowerCase(),
        code,
        supplierId,
        firstName: row.first_name,
        lastName: row.last_name,
        email,
        phone,
        cityId: c.id,
        positionIds,
        rating: existing?.rating ?? 0,
        shiftsWorked: existing?.shiftsWorked ?? 0,
        reliability: existing?.reliability ?? 0,
        joinedOn: existing?.joinedOn ?? ctx.today,
        status: "onboarding",
        level: existing?.level ?? null,
        compliance: { ...(existing?.compliance ?? {}), ...compliance },
      }
      draft.status = readiness({ ...draft, status: "active" }).ready ? "active" : "onboarding"
      if (draft.status === "onboarding" && !issues.length) issues.push(note(n, undefined, "Starts in onboarding: some documents are still pending"))
      upserts.push(draft)
    }
    results.push({ row: n, values: row, issues, ok, summary: ok ? `${existing ? "Update" : "New"}: ${row.first_name} ${row.last_name}` : "" })
  })
  const ready = upserts.filter((p) => p.status === "active").length
  return {
    rows: results,
    ...tally(results),
    summary: upserts.length ? `${plural(upserts.length, "Pro")} saved, ${ready} ready to work` : "No Pros saved",
    apply: upserts.length
      ? (data) => {
          const byId = new Map(upserts.map((p) => [p.id, p]))
          return {
            pros: [...upserts.filter((p) => !data.pros.some((x) => x.id === p.id)), ...data.pros.map((p) => byId.get(p.id) ?? p)],
            counters: { pro: counter },
          }
        }
      : undefined,
  }
}

/* Business activity ----------------------------------------------------- */

function planActivity(rows: Row[], ctx: Ctx): Planned {
  const results: RowResult[] = []
  const entries: Omit<BusinessActivity, "id" | "uploadId">[] = []
  const seen = new Map<string, number>()
  const saved = ctx.data.businessActivity ?? []
  const whole = (raw: string | undefined, n: number, column: string, issues: UploadIssue[]) => {
    const v = parseNumber(raw ?? "")
    if (raw && (v === undefined || v < 0 || !Number.isInteger(v))) issues.push(problem(n, column, "Use a whole number"))
    return v
  }
  rows.forEach((row, i) => {
    const n = ctx.nums[i]
    const issues: UploadIssue[] = []
    required(row, ["location", "date", "events", "meals_served", "revenue"], issues, n)
    const loc = row.location ? lookup(resolveLocation(row.location), row.location, LOCATIONS, (l) => [l.name, l.costCenter], n, "location", issues, "Not a Compass location") : undefined
    const date = row.date ? dateCell(row.date, n, "date", issues) : undefined
    const same = loc && date ? firstSeen(seen, `${loc.id}|${date}`, n) : undefined
    if (same !== undefined) {
      results.push(duplicate(n, row, "date", `Duplicate of row ${same}`))
      return
    }
    if (date && date > ctx.today) issues.push(problem(n, "date", "Date is in the future"))
    const events = whole(row.events, n, "events", issues)
    const meals = whole(row.meals_served, n, "meals_served", issues)
    const revenue = parseNumber(row.revenue ?? "")
    if (row.revenue && (revenue === undefined || revenue < 0)) issues.push(problem(n, "revenue", "Not a dollar amount"))
    if (loc && date && saved.some((a) => a.locationId === loc.id && a.date === date)) issues.push(note(n, undefined, `Replaces the figures saved earlier for ${formatDateShort(date)}`))
    const ok = !hasErrors(issues)
    if (ok && loc && date && events !== undefined && meals !== undefined && revenue !== undefined) entries.push({ locationId: loc.id, date, events, mealsServed: meals, revenue: round2(revenue) })
    results.push({ row: n, values: row, issues, ok, summary: ok && loc && date ? `${loc.name}, ${formatDateShort(date)}: ${(meals ?? 0).toLocaleString("en-US")} meals, ${money(revenue ?? 0)}` : "" })
  })
  const locations = new Set(entries.map((e) => e.locationId)).size
  const days = new Set(entries.map((e) => e.date)).size
  return {
    rows: results,
    ...tally(results),
    summary: entries.length ? `Activity saved for ${plural(locations, "location")} across ${plural(days, "day")}` : "No activity saved",
    apply: entries.length
      ? (data, uploadId) => {
          let counter = data.counters.act ?? 1
          const replaced = new Set(entries.map((e) => `${e.locationId}|${e.date}`))
          const made: BusinessActivity[] = entries.map((e) => ({ id: `act-${counter++}`, ...e, uploadId }))
          return {
            businessActivity: [...made, ...(data.businessActivity ?? []).filter((a) => !replaced.has(`${a.locationId}|${a.date}`))],
            counters: { act: counter },
          }
        }
      : undefined,
  }
}

/* ---------------------------------- Review --------------------------------- */

export type FixAction = "accept" | "edit" | "reject"

export interface FixDecision {
  action: FixAction
  value?: string
}

export type FixDecisions = Record<string, FixDecision>

export interface ReviewItem {
  key: string
  issue: UploadIssue
  /** The cell as written in the file. */
  value: string
}

/** Every problem that needs a person to accept, edit or reject a fix before the row can be saved. */
export function reviewItems(plan: ImportPlan): ReviewItem[] {
  const counts = new Map<string, number>()
  return plan.rows.flatMap((r) =>
    r.issues
      .filter((issue) => issue.level === "error")
      .map((issue) => {
        const base = `${issue.row}|${issue.column ?? ""}|${issue.message}`
        const k = (counts.get(base) ?? 0) + 1
        counts.set(base, k)
        return { key: k > 1 ? `${base}|${k}` : base, issue, value: issue.column ? (r.values[issue.column] ?? "") : "" }
      }),
  )
}

/** Rows a decision leaves out: rejected rows, and rows whose accepted fix is to remove them. */
export const droppedRows = (items: ReviewItem[], decisions: FixDecisions) =>
  new Set(
    items
      .filter(({ key, issue }) => decisions[key]?.action === "reject" || (decisions[key]?.action === "accept" && !!issue.suggestion?.removeRow))
      .map(({ issue }) => issue.row),
  )

export function reviewTally(plan: ImportPlan, items: ReviewItem[], decisions: FixDecisions) {
  const dropped = droppedRows(items, decisions)
  return {
    rows: plan.rows.length - dropped.size,
    pending: items.filter((it) => !decisions[it.key] && !dropped.has(it.issue.row)).length,
    dropped,
  }
}

/** Writes the decisions into the file: accepted and edited values replace cells, rejected and removed rows drop out. */
export function applyFixes(text: string, items: ReviewItem[], decisions: FixDecisions, rowNumbers?: number[]) {
  const { headers, rows } = parseCsv(text)
  const nums = rows.map((_, i) => rowNumbers?.[i] ?? i + 2)
  const index = new Map(nums.map((n, i) => [n, i]))
  const values = rows.map((r) => ({ ...r }))
  const columns = [...headers]
  const rejected = new Set<number>()
  const removed = new Set<number>()
  for (const { key, issue } of items) {
    const d = decisions[key]
    const i = index.get(issue.row)
    if (!d || i === undefined) continue
    if (d.action === "reject") rejected.add(issue.row)
    else if (d.action === "accept" && issue.suggestion?.removeRow) removed.add(issue.row)
    else if (issue.column) {
      const value = d.action === "edit" ? (d.value ?? "") : issue.suggestion?.value
      if (value === undefined) continue
      values[i][issue.column] = value
      if (!columns.includes(issue.column)) columns.push(issue.column)
    }
  }
  const kept = nums.map((n, i) => ({ n, i })).filter(({ n }) => !rejected.has(n) && !removed.has(n))
  return {
    csv: toCsv(kept.map(({ i }) => values[i]), columns),
    rowNumbers: kept.map(({ n }) => n),
    rejected: [...rejected].filter((n) => !removed.has(n)).length,
    removed: removed.size,
  }
}

/** What happened to each reviewed problem, kept on the upload as its history. */
export function fixOutcomes(items: ReviewItem[], decisions: FixDecisions): UploadIssue[] {
  return items.flatMap(({ key, issue }): UploadIssue[] => {
    const d = decisions[key]
    const base = { row: issue.row, column: issue.column, message: issue.message }
    if (!d) return []
    if (d.action === "reject") return [{ ...base, message: `${issue.message}. Left out`, level: "error" }]
    if (issue.suggestion?.removeRow && d.action === "accept") return [{ ...base, level: "warning", suggestion: { removeRow: true, label: "Removed" } }]
    const value = d.action === "edit" ? (d.value ?? "") : (issue.suggestion?.value ?? "")
    const label = d.action === "edit" ? `${value || "blank"} (edited)` : (issue.suggestion?.label ?? value)
    return [{ ...base, level: "warning", suggestion: { value, label } }]
  })
}

/* Exports --------------------------------------------------------------- */

export const exportName = (base: string) => `iris-${base}-${todayISO()}.csv`
