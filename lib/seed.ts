import { canWork } from "@/lib/compliance"
import { generateBudgets } from "@/lib/domain/budget"
import { addDaysISO, hhmmFromMinutes, minutesOf, paidHours, todayISO, weekStartISO } from "@/lib/dates"
import { billFrom, round2, roundTo } from "@/lib/format"
import { createRandom, hashString, type Random } from "@/lib/random"
import { CITIES, LOCATIONS, POSITIONS, PROGRAM, SUPPLIERS, city, location, position, requirementsFor, supplier } from "@/lib/reference"
import { change, hoursFor, laborAmount, withOvertime } from "@/lib/timesheets"
import type {
  ActivityEvent,
  ClockRecord,
  ComplianceItem,
  Counters,
  DemoData,
  Invoice,
  InvoiceGroup,
  InvoiceLine,
  Pro,
  ProReview,
  RateCard,
  RequirementId,
  RosterEntry,
  ShiftGroup,
  Slot,
  Timesheet,
  TimesheetStatus,
  Upload,
} from "@/lib/types"

export const DATA_VERSION = 12

const FIRST_NAMES = [
  "Aaliyah", "Andre", "Ana", "Brianna", "Carlos", "Chen", "Dario", "Deja", "Elena", "Emeka", "Fatima", "Gabriel",
  "Grace", "Hector", "Imani", "Isaac", "Jasmine", "Javier", "Kayla", "Kenji", "Lauren", "Luis", "Maya", "Malik",
  "Nadia", "Nathan", "Olivia", "Omar", "Priya", "Quentin", "Rosa", "Ryan", "Sade", "Samuel", "Tanya", "Tariq",
  "Uma", "Victor", "Wendy", "Xavier", "Yara", "Zach", "Aisha", "Brandon", "Camila", "Darnell", "Esther", "Felix",
  "Gloria", "Hassan", "Ivy", "Jamal", "Keisha", "Leo", "Monique", "Nico", "Paige", "Rashad", "Sofia", "Trevor",
]

const LAST_NAMES = [
  "Adams", "Alvarez", "Bennett", "Brooks", "Castillo", "Chen", "Coleman", "Diaz", "Ellis", "Evans", "Flores",
  "Foster", "Garcia", "Grant", "Hayes", "Hernandez", "Ito", "Jackson", "Jenkins", "Kim", "Lopez", "Martin", "Mendoza",
  "Moore", "Nguyen", "Okafor", "Ortiz", "Patel", "Perez", "Price", "Ramirez", "Reed", "Rivera", "Robinson", "Sanchez",
  "Scott", "Shah", "Simmons", "Torres", "Turner", "Vasquez", "Walker", "Washington", "Williams", "Wright", "Young",
]

const POSITION_SETS = {
  foh: [
    ["bartender", "barback", "server"],
    ["bartender", "suite", "server"],
    ["concessions", "cashier", "porter"],
    ["concessions", "cashier", "barback"],
    ["server", "suite", "concessions"],
    ["bartender", "barback", "concessions"],
  ],
  boh: [
    ["linecook", "prepcook", "dishwasher"],
    ["prepcook", "dishwasher", "porter"],
    ["linecook", "prepcook"],
    ["dishwasher", "porter", "cashier"],
  ],
  events: [
    ["porter", "concessions", "dishwasher"],
    ["porter", "barback", "cashier"],
  ],
}

const PRO_COUNTS: Record<string, number> = { instawork: 136, crewline: 70, harbor: 48, metro: 46 }
const ONBOARDING_COUNTS: Record<string, number> = { instawork: 4, crewline: 3, harbor: 2, metro: 6 }
const EXPIRED_RATE: Record<string, number> = { instawork: 0.0, crewline: 0.06, harbor: 0.05, metro: 0.14 }
const EXPIRING_RATE: Record<string, number> = { instawork: 0.05, crewline: 0.07, harbor: 0.06, metro: 0.12 }
const CITY_WEIGHT: Record<string, number> = { chi: 0.7, atl: 0.19, dal: 0.11 }

/** Each buyer's approved suppliers on first load. Metro and Harbor are each left unchecked by one buyer. */
export const INITIAL_APPROVALS: Record<string, string[]> = {
  "levy-chi": ["instawork", "crewline", "harbor"],
  "chartwells-south": ["instawork", "crewline", "metro"],
}

interface EventTemplate {
  locationId: string
  weekdays: number[]
  eventName: (dayIndex: number) => string | undefined
  everyOtherWeek?: boolean
  roles: { positionId: string; headcount: number; start: string; end: string; breakMins: number }[]
}

const TEMPLATES: EventTemplate[] = [
  {
    locationId: "loc-lfs",
    weekdays: [0],
    eventName: () => "Game day",
    roles: [
      { positionId: "concessions", headcount: 12, start: "09:30", end: "17:30", breakMins: 30 },
      { positionId: "bartender", headcount: 8, start: "10:00", end: "17:30", breakMins: 30 },
      { positionId: "suite", headcount: 6, start: "10:30", end: "18:00", breakMins: 30 },
      { positionId: "porter", headcount: 4, start: "09:00", end: "17:00", breakMins: 30 },
    ],
  },
  {
    locationId: "loc-wla",
    weekdays: [4, 6],
    eventName: (d) => (d % 3 === 0 ? "Concert night" : d % 3 === 1 ? "Basketball home game" : "Hockey home game"),
    roles: [
      { positionId: "bartender", headcount: 6, start: "16:30", end: "23:30", breakMins: 30 },
      { positionId: "concessions", headcount: 8, start: "17:00", end: "23:00", breakMins: 30 },
      { positionId: "barback", headcount: 3, start: "16:00", end: "23:30", breakMins: 30 },
    ],
  },
  {
    locationId: "loc-rcc",
    weekdays: [2, 3],
    everyOtherWeek: true,
    eventName: () => "Restaurant & Hospitality Expo",
    roles: [
      { positionId: "server", headcount: 10, start: "06:30", end: "15:00", breakMins: 30 },
      { positionId: "linecook", headcount: 3, start: "06:00", end: "14:30", breakMins: 30 },
      { positionId: "porter", headcount: 4, start: "06:30", end: "15:00", breakMins: 30 },
      { positionId: "dishwasher", headcount: 2, start: "08:00", end: "16:30", breakMins: 30 },
    ],
  },
  {
    locationId: "loc-rcc",
    weekdays: [5],
    eventName: () => "Foundation gala",
    roles: [
      { positionId: "server", headcount: 14, start: "16:00", end: "23:30", breakMins: 30 },
      { positionId: "bartender", headcount: 5, start: "16:30", end: "23:30", breakMins: 30 },
      { positionId: "dishwasher", headcount: 3, start: "17:00", end: "23:59", breakMins: 30 },
    ],
  },
  {
    locationId: "loc-nsb",
    weekdays: [5, 0],
    eventName: () => "Day game",
    roles: [
      { positionId: "concessions", headcount: 8, start: "11:00", end: "17:30", breakMins: 30 },
      { positionId: "cashier", headcount: 4, start: "11:00", end: "17:00", breakMins: 30 },
      { positionId: "bartender", headcount: 4, start: "11:30", end: "17:30", breakMins: 30 },
    ],
  },
  {
    locationId: "loc-pu",
    weekdays: [1, 3, 5],
    eventName: () => undefined,
    roles: [
      { positionId: "linecook", headcount: 2, start: "06:30", end: "15:00", breakMins: 30 },
      { positionId: "prepcook", headcount: 2, start: "07:00", end: "15:30", breakMins: 30 },
      { positionId: "dishwasher", headcount: 2, start: "10:00", end: "18:30", breakMins: 30 },
    ],
  },
  {
    locationId: "loc-mtc",
    weekdays: [2, 4],
    eventName: () => undefined,
    roles: [
      { positionId: "cashier", headcount: 2, start: "10:30", end: "15:00", breakMins: 0 },
      { positionId: "prepcook", headcount: 2, start: "07:00", end: "15:30", breakMins: 30 },
    ],
  },
  {
    locationId: "loc-ttu",
    weekdays: [1, 4],
    eventName: () => undefined,
    roles: [
      { positionId: "linecook", headcount: 2, start: "06:30", end: "15:00", breakMins: 30 },
      { positionId: "dishwasher", headcount: 1, start: "10:00", end: "18:30", breakMins: 30 },
    ],
  },
]

const isoAt = (date: string, hhmm: string) => new Date(`${date}T${hhmm}:00`).toISOString()

const addHoursISO = (iso: string, h: number) => new Date(new Date(iso).getTime() + h * 3600_000).toISOString()

/** Far enough back to compare this month with the same days last month. */
const historyStart = (today: string) => {
  const lastMonth = `${addDaysISO(`${today.slice(0, 8)}01`, -1).slice(0, 8)}01`
  const threeWeeks = addDaysISO(today, -21)
  return lastMonth < threeWeeks ? lastMonth : threeWeeks
}

export function emptyCounters(): Counters {
  return { sg: 48200, inv: 20400, ig: 37, upl: 1030, pro: 10230, rate: 1, ts: 1, ev: 1, rev: 1, act: 1 }
}

function makeCompliance(r: Random, supplierId: string, positionIds: string[], joinedOn: string, onboarding: boolean, today: string) {
  const required = requirementsFor(positionIds)
  const compliance: Partial<Record<RequirementId, ComplianceItem>> = {}
  const completedOn = addDaysISO(joinedOn, r.int(1, 6))
  for (const id of required) {
    if (onboarding) {
      const roll = r.next()
      compliance[id] =
        id === "i9" && roll < 0.6
          ? { status: "complete", completedOn: addDaysISO(today, -r.int(1, 6)) }
          : roll < 0.45
            ? { status: "pending" }
            : { status: "missing" }
      continue
    }
    if (id === "i9" || id === "orientation") {
      compliance[id] = { status: "complete", completedOn }
      continue
    }
    const years = id === "background" ? 1 : 3
    let expiresOn = addDaysISO(today, r.int(45, 365 * years - 30))
    if (r.chance(EXPIRING_RATE[supplierId] ?? 0.05)) expiresOn = addDaysISO(today, r.int(2, 28))
    compliance[id] = { status: "complete", completedOn, expiresOn }
  }
  if (!onboarding && r.chance(EXPIRED_RATE[supplierId] ?? 0)) {
    const renewable = required.filter((id) => id !== "i9" && id !== "orientation")
    const target = r.pick(renewable)
    compliance[target] = { status: "complete", completedOn, expiresOn: addDaysISO(today, -r.int(3, 40)) }
  }
  return compliance
}

function generatePros(r: Random, counters: Counters, today: string): Pro[] {
  const pros: Pro[] = []
  const used = new Set<string>()
  for (const s of SUPPLIERS) {
    const total = PRO_COUNTS[s.id]
    const onboarding = ONBOARDING_COUNTS[s.id]
    for (let i = 0; i < total; i++) {
      let firstName = r.pick(FIRST_NAMES)
      let lastName = r.pick(LAST_NAMES)
      let guard = 0
      while (used.has(`${firstName} ${lastName}`) && guard++ < 40) {
        firstName = r.pick(FIRST_NAMES)
        lastName = r.pick(LAST_NAMES)
      }
      used.add(`${firstName} ${lastName}`)
      const cityId = r.weighted(s.cityIds.map((id) => ({ value: id, weight: CITY_WEIGHT[id] ?? 0.1 })))
      const family = r.weighted(
        cityId === "chi"
          ? [
              { value: "foh" as const, weight: 0.62 },
              { value: "boh" as const, weight: 0.22 },
              { value: "events" as const, weight: 0.16 },
            ]
          : [
              { value: "foh" as const, weight: 0.25 },
              { value: "boh" as const, weight: 0.65 },
              { value: "events" as const, weight: 0.1 },
            ],
      )
      const positionIds = r.pick(POSITION_SETS[family])
      const isOnboarding = i < onboarding
      const isIW = s.isInstawork
      const shiftsWorked = isOnboarding ? 0 : isIW ? r.int(18, 340) : r.int(6, 160)
      const joinedOn = isOnboarding ? addDaysISO(today, -r.int(2, 12)) : addDaysISO(today, -r.int(40, 980))
      const level = !isIW || isOnboarding
        ? null
        : shiftsWorked > 220
          ? "platinum"
          : shiftsWorked > 110
            ? "gold"
            : shiftsWorked > 45
              ? "silver"
              : "bronze"
      const code = `P-${counters.pro++}`
      pros.push({
        id: code.toLowerCase(),
        code,
        supplierId: s.id,
        firstName,
        lastName,
        email: `${firstName}.${lastName}`.toLowerCase() + `@${s.isInstawork ? "pros.instawork.com" : `${s.shortName.toLowerCase()}.example`}`,
        phone: `(${cityId === "chi" ? "312" : cityId === "atl" ? "404" : "214"}) 555-${String(r.int(100, 9999)).padStart(4, "0")}`,
        cityId,
        positionIds: [...positionIds],
        rating: isOnboarding ? 0 : round2(isIW ? r.float(4.55, 5) : r.float(4.05, 4.9)),
        shiftsWorked,
        reliability: isOnboarding ? 0 : Math.round(Math.min(100, s.profile.fillRate * 100 + r.float(-6, 4))),
        joinedOn,
        status: isOnboarding ? "onboarding" : "active",
        level,
        compliance: makeCompliance(r, s.id, positionIds, joinedOn, isOnboarding, today),
      })
    }
  }
  return pros
}

function generateRateCards(r: Random, counters: Counters, today: string): RateCard[] {
  const cards: RateCard[] = []
  for (const s of SUPPLIERS) {
    for (const cityId of s.cityIds) {
      const c = city(cityId)
      for (const p of POSITIONS) {
        if (s.id === "crewline" && p.id === "suite") continue
        if (s.id === "harbor" && (p.id === "dishwasher" || p.id === "cashier")) continue
        if (s.id === "metro" && p.id === "suite" && cityId !== "dal") continue
        const proRate = roundTo(p.basePay * c.payIndex * s.profile.payIndex * r.float(0.985, 1.03), 0.25)
        let markupPct = Math.round((s.profile.markupPct + r.float(-1.8, 1.8)) * 10) / 10
        const status: RateCard["status"] = "active"
        if (s.id === "metro" && cityId === "dal" && p.id === "suite") markupPct = 49
        if (s.id === "harbor" && cityId === "chi" && p.id === "suite") markupPct = 47.5
        if (s.id === "harbor" && cityId === "chi" && p.id === "bartender") markupPct = 72
        const autoZips = !(s.id === "harbor" && cityId === "chi") && r.chance(0.78)
        const zips = autoZips ? [...c.zips] : r.shuffle(c.zips).slice(0, r.int(6, 10)).sort()
        const effectiveFrom = addDaysISO(today, -r.int(40, 210))
        cards.push({
          id: `rate-${counters.rate++}`,
          supplierId: s.id,
          cityId,
          positionId: p.id,
          proRate,
          markupPct,
          billRate: billFrom(proRate, markupPct),
          zips,
          zipsAutoFilled: autoZips,
          status,
          effectiveFrom,
          updatedAt: new Date(`${effectiveFrom}T10:00:00`).toISOString(),
          source: s.integration === "api" ? "api" : "upload",
        })
      }
    }
  }
  return cards
}

interface FillTarget {
  [supplierId: string]: (daysOut: number) => number
}

const FILL_TARGET: FillTarget = {
  instawork: (d) => (d <= 7 ? 1 : 0.86),
  crewline: (d) => (d <= 2 ? 0.95 : d <= 7 ? 0.8 : 0.55),
  harbor: (d) => (d <= 2 ? 0.9 : d <= 7 ? 0.68 : 0.42),
  metro: (d) => (d <= 2 ? 0.58 : d <= 7 ? 0.44 : 0.28),
}

export function generateDemoData(today = todayISO()): DemoData {
  const r = createRandom(20261013)
  const counters = emptyCounters()
  const pros = generatePros(r, counters, today)
  plantExpiredCert(pros, today)
  const rateCards = generateRateCards(r, counters, today)
  const groups: ShiftGroup[] = []
  const timesheets: Timesheet[] = []
  const busy = new Map<string, Set<string>>()
  const now = new Date()
  const nowISO = now.toISOString()

  const prosBySupplier = new Map<string, Pro[]>()
  for (const p of pros) {
    const list = prosBySupplier.get(p.supplierId) ?? []
    list.push(p)
    prosBySupplier.set(p.supplierId, list)
  }

  const cardFor = (supplierId: string, cityId: string, positionId: string) =>
    rateCards.find((c) => c.supplierId === supplierId && c.cityId === cityId && c.positionId === positionId && c.status === "active")

  const pickPro = (supplierId: string, cityId: string, positionId: string, date: string, taken: Set<string>) => {
    const day = busy.get(date) ?? new Set<string>()
    const candidates = (prosBySupplier.get(supplierId) ?? []).filter(
      (p) => p.cityId === cityId && !day.has(p.id) && !taken.has(p.id) && canWork(p, positionId, date).ok,
    )
    if (!candidates.length) return undefined
    const choice = r.pick(candidates)
    day.add(choice.id)
    busy.set(date, day)
    return choice
  }

  const start = historyStart(today)
  const end = addDaysISO(today, 14)
  const weekZero = weekStartISO(today)
  let dayIndex = 0

  for (let date = start; date <= end; date = addDaysISO(date, 1)) {
    const weekday = new Date(`${date}T12:00:00`).getDay()
    const weekNumber = Math.round((new Date(`${weekStartISO(date)}T12:00:00`).getTime() - new Date(`${weekZero}T12:00:00`).getTime()) / (7 * 86400_000))
    dayIndex++
    for (const t of TEMPLATES) {
      if (!t.weekdays.includes(weekday)) continue
      if (t.everyOtherWeek && Math.abs(weekNumber) % 2 === 1) continue
      const loc = location(t.locationId)
      const eventName = t.eventName(dayIndex)
      for (const role of t.roles) {
        const serving = SUPPLIERS.filter((s) => s.cityIds.includes(loc.cityId) && cardFor(s.id, loc.cityId, role.positionId))
        const approved = serving.filter((s) => INITIAL_APPROVALS[loc.buyerId]?.includes(s.id))
        const eligible = date >= today ? approved : serving
        if (!eligible.length) continue
        const sup = r.weighted(eligible.map((s) => ({ value: s, weight: s.profile.share })))
        const card = cardFor(sup.id, loc.cityId, role.positionId)!
        const conference = loc.id === "loc-rcc" && date > addDaysISO(today, -7) && date <= today ? 2.2 : 1
        const headcount = Math.max(1, Math.round((role.headcount + r.int(-1, 2)) * conference))
        const leadDays = r.int(4, 13)
        const createdAt = isoAt(addDaysISO(date, -leadDays), `${String(r.int(8, 17)).padStart(2, "0")}:${r.pick(["05", "20", "35", "50"])}`)
        const code = `SG-${counters.sg++}`
        const group: ShiftGroup = {
          id: code.toLowerCase(),
          code,
          buyerId: loc.buyerId,
          locationId: loc.id,
          positionId: role.positionId,
          eventName,
          date,
          start: role.start,
          end: role.end === "23:59" ? "00:00" : role.end,
          breakMins: role.breakMins,
          supplierId: sup.id,
          supplierIds: [sup.id, ...approved.filter((s) => s.id !== sup.id).map((s) => s.id)],
          billRate: card.billRate,
          proRate: card.proRate,
          markupPct: card.markupPct,
          slots: [],
          badges: loc.buyerId === "levy-chi" && (role.positionId === "bartender" || role.positionId === "suite") ? ["TIPS"] : [],
          instructions: position(role.positionId).duties,
          attire: position(role.positionId).attire,
          createdAt,
          createdBy: loc.buyerId === "levy-chi" ? "Jordan Ellis" : "Alicia Moreno",
          source: r.chance(0.18) ? "upload" : "booking",
        }

        const shiftStart = new Date(`${date}T${role.start}:00`)
        const ended = new Date(shiftStart.getTime() + (minutesOf(role.end === "23:59" ? "24:00" : role.end) - minutesOf(role.start) + (role.end < role.start ? 1440 : 0)) * 60000) < now
        const daysOut = Math.round((shiftStart.getTime() - now.getTime()) / 86400_000)
        const profile = sup.profile
        const taken = new Set<string>()
        let filledTarget = headcount
        if (!ended) {
          filledTarget = Math.min(headcount, Math.round(headcount * FILL_TARGET[sup.id](Math.max(0, daysOut)) * r.float(0.92, 1.04)))
        }
        for (let i = 0; i < headcount; i++) {
          const slot: Slot = { id: `${group.id}-${i + 1}`, status: "open" }
          const shouldFill = ended ? r.chance(profile.fillRate) : i < filledTarget
          if (shouldFill) {
            const pro = pickPro(sup.id, loc.cityId, role.positionId, date, taken)
            if (pro) {
              taken.add(pro.id)
              slot.proId = pro.id
              const ttf = Math.max(0.05, profile.hoursToFill * r.float(0.25, 1.9))
              let confirmedAt = addHoursISO(createdAt, ttf)
              if (confirmedAt > nowISO) confirmedAt = addHoursISO(nowISO, -r.float(0.2, 6))
              slot.confirmedAt = confirmedAt
              slot.status = ended ? (r.chance(profile.noShowRate) ? "no_show" : "completed") : "confirmed"
            }
          }
          group.slots.push(slot)
        }
        groups.push(group)

        if (!ended) continue
        const endedAt = isoAt(date, group.end === "00:00" ? "23:59" : group.end)
        for (const slot of group.slots) {
          if (slot.status !== "completed" || !slot.proId) continue
          const isApp = sup.integration === "api"
          const drift = isApp ? r.int(-6, 4) : r.int(-10, 10)
          let outDrift = isApp ? r.int(-4, 9) : r.int(-8, 14)
          if (r.chance(sup.isInstawork ? 0.015 : 0.05)) outDrift += r.int(55, 95)
          const inAt = hhmmFromMinutes(minutesOf(group.start) + drift)
          const outAt = hhmmFromMinutes(minutesOf(group.end) + outDrift)
          const breakMins = group.breakMins && r.chance(0.04) ? 0 : group.breakMins
          const clock: ClockRecord | undefined =
            sup.isInstawork || r.chance(0.92) ? { in: inAt, out: outAt, breakMins, source: sup.isInstawork ? "instawork_app" : "iris_checkin" } : undefined
          const age = Math.round((now.getTime() - shiftStart.getTime()) / 86400_000)
          let status: TimesheetStatus = "approved"
          if (isApp ? age <= 2 : age <= 3) status = isApp ? "pending_approval" : r.chance(0.3) ? "pending_approval" : "draft"
          let clockIn: string | undefined = inAt
          let clockOut: string | undefined = outAt
          if (!isApp && status !== "draft") {
            clockIn = hhmmFromMinutes(minutesOf(inAt) - r.int(0, 4))
            clockOut = hhmmFromMinutes(minutesOf(outAt) + r.int(0, 6) + (r.chance(0.03) ? r.int(30, 75) : 0))
          }
          if (status === "draft" && !clock) {
            clockIn = undefined
            clockOut = undefined
          }
          const submitted = status === "draft" ? undefined : addHoursISO(endedAt, isApp ? 0.3 : r.float(14, 30))
          const submittedAt = submitted && submitted > nowISO ? nowISO : submitted
          const created = addHoursISO(endedAt, 0.5)
          const ts: Timesheet = {
            id: `ts-${counters.ts++}`,
            groupId: group.id,
            slotId: slot.id,
            proId: slot.proId,
            supplierId: sup.id,
            buyerId: group.buyerId,
            locationId: group.locationId,
            positionId: group.positionId,
            date,
            scheduledStart: group.start,
            scheduledEnd: group.end,
            scheduledBreakMins: group.breakMins,
            clockIn,
            clockOut,
            breakMins,
            hours: clockIn && clockOut ? paidHours(clockIn, clockOut, breakMins) : 0,
            otHours: 0,
            clock,
            billRate: group.billRate,
            tips: group.badges.includes("TIPS") && age > 3 ? round2(r.float(18, 96)) : 0,
            status,
            source: isApp ? "app" : "csv",
            submittedAt,
            approvedAt: status === "approved" ? addHoursISO(isoAt(date, "12:00"), r.float(24, 60)) : undefined,
            approvedBy: status === "approved" ? group.createdBy : undefined,
            history:
              status === "approved"
                ? []
                : [
                    change(created > nowISO ? nowISO : created, "Iris", "created", { note: clock ? "From the clock" : "No clock record" }),
                    ...(submittedAt ? [change(submittedAt, isApp ? `${sup.shortName} app` : sup.contactName, "submitted", { note: isApp ? "Sent by the agency's system" : "From the agency's CSV" })] : []),
                  ],
          }
          timesheets.push(ts)
        }
      }
    }
  }

  plantStoryGroups(groups, today)
  plantHoursStory(r, counters, groups, timesheets, pros, rateCards, today, nowISO)
  plantOvertime(counters, groups, timesheets, pros, rateCards, today)
  plantSentHome(groups, timesheets, today)
  plantMissingPunch(timesheets, today)
  plantRejections(r, timesheets, today)
  const sheets = withOvertime(timesheets)
  const { invoices, invoiceGroups } = generateInvoices(counters, sheets, pros, today)
  const uploads = generateUploads(counters, today)
  const roster = generateRoster(r, sheets, pros, today)
  const reviews = generateReviews(r, counters, sheets, pros)
  const activity = generateActivity(counters, groups, invoices, uploads, pros, today)

  return {
    version: DATA_VERSION,
    seededOn: today,
    seededAt: nowISO,
    pros,
    rateCards,
    groups,
    timesheets: sheets,
    invoices,
    invoiceGroups,
    uploads,
    roster,
    activity,
    approvals: structuredClone(INITIAL_APPROVALS),
    reviews,
    businessActivity: [],
    budgets: generateBudgets(groups, today),
    counters,
  }
}

/** Shape a few upcoming shifts so every persona has a decision to make on first load. */
/**
 * A well-rated Crewline bartender in Chicago whose alcohol server cert lapsed three days ago, so the agency sees Iris
 * keep them off a bar shift and why.
 */
function plantExpiredCert(pros: Pro[], today: string) {
  const pro = pros
    .filter((p) => p.supplierId === "crewline" && p.cityId === "chi" && p.status === "active" && p.positionIds.includes("bartender"))
    .sort((a, b) => b.rating - a.rating)[0]
  if (!pro) return
  pro.compliance = { ...pro.compliance, alcohol: { status: "complete", completedOn: addDaysISO(today, -3 * 365 - 3), expiresOn: addDaysISO(today, -3) } }
}

function plantStoryGroups(groups: ShiftGroup[], today: string) {
  const upcoming = groups.filter((g) => g.date > today).sort((a, b) => a.date.localeCompare(b.date))
  const short = upcoming.find((g) => g.supplierId === "harbor" && g.buyerId === "levy-chi" && g.slots.length >= 3)
  if (short) {
    short.slots.forEach((s, i) => {
      if (i >= Math.ceil(short.slots.length * 0.4)) {
        s.proId = undefined
        s.status = "open"
        s.confirmedAt = undefined
      }
    })
  }
}

/**
 * Last night's concert at West Loop Arena, staffed by Harbor. Harbor's CSV came in this morning, and one bartender is
 * billed at 9.5 hours against 8.0 on Iris's clock: the case the Features and FAQ says Iris catches.
 */
function plantHoursStory(r: Random, counters: Counters, groups: ShiftGroup[], timesheets: Timesheet[], pros: Pro[], rateCards: RateCard[], today: string, nowISO: string) {
  const date = addDaysISO(today, -1)
  const loc = location("loc-wla")
  const card = rateCards.find((c) => c.supplierId === "harbor" && c.cityId === loc.cityId && c.positionId === "bartender" && c.status === "active")
  if (!card) return
  const busy = new Set(groups.filter((g) => g.date === date).flatMap((g) => g.slots.flatMap((s) => (s.proId ? [s.proId] : []))))
  const crew = pros
    .filter((p) => p.supplierId === "harbor" && p.cityId === loc.cityId && !busy.has(p.id) && canWork(p, "bartender", date).ok)
    .sort((a, b) => b.rating - a.rating)
    .slice(0, 6)
  if (crew.length < 3) return
  const code = `SG-${counters.sg++}`
  const id = code.toLowerCase()
  const pos = position("bartender")
  const group: ShiftGroup = {
    id,
    code,
    buyerId: loc.buyerId,
    locationId: loc.id,
    positionId: pos.id,
    eventName: "Concert night",
    date,
    start: "16:00",
    end: "00:30",
    breakMins: 30,
    supplierId: "harbor",
    supplierIds: ["harbor"],
    billRate: card.billRate,
    proRate: card.proRate,
    markupPct: card.markupPct,
    slots: crew.map((p, i) => ({ id: `${id}-${i + 1}`, proId: p.id, status: "completed" as const, confirmedAt: isoAt(addDaysISO(date, -6), "14:20") })),
    badges: ["TIPS"],
    instructions: pos.duties,
    attire: pos.attire,
    createdAt: isoAt(addDaysISO(date, -8), "10:35"),
    createdBy: "Jordan Ellis",
    source: "booking",
  }
  groups.push(group)
  const created = [isoAt(today, "01:00"), nowISO].sort()[0]
  const submittedAt = [isoAt(today, "07:42"), nowISO].sort()[0]
  group.slots.forEach((slot, i) => {
    const padded = i === 0
    const inAt = padded ? "16:00" : hhmmFromMinutes(minutesOf("16:00") + r.int(-5, 3))
    const outAt = padded ? "00:30" : hhmmFromMinutes(minutesOf("00:30") + r.int(-3, 6))
    const clockIn = padded ? "15:30" : inAt
    const clockOut = padded ? "01:30" : outAt
    timesheets.push({
      id: `ts-${counters.ts++}`,
      groupId: group.id,
      slotId: slot.id,
      proId: slot.proId!,
      supplierId: "harbor",
      buyerId: group.buyerId,
      locationId: loc.id,
      positionId: pos.id,
      date,
      scheduledStart: group.start,
      scheduledEnd: group.end,
      scheduledBreakMins: group.breakMins,
      clockIn,
      clockOut,
      breakMins: 30,
      hours: paidHours(clockIn, clockOut, 30),
      otHours: 0,
      clock: { in: inAt, out: outAt, breakMins: 30, source: "iris_checkin" },
      billRate: card.billRate,
      tips: 0,
      status: "pending_approval",
      source: "csv",
      submittedAt,
      history: [change(created, "Iris", "created", { note: "From the clock" }), change(submittedAt, "Renee Park", "submitted", { note: "From the agency's CSV" })],
    })
  })
}

/**
 * Last week's convention move-in at Riverside Convention Center: one Instawork porter booked eight hours a day,
 * Saturday to Thursday. Past 40 hours the rest bills at time and a half, which Iris splits out on the timesheet and
 * the invoice.
 */
function plantOvertime(counters: Counters, groups: ShiftGroup[], timesheets: Timesheet[], pros: Pro[], rateCards: RateCard[], today: string) {
  const loc = location("loc-rcc")
  const card = rateCards.find((c) => c.supplierId === "instawork" && c.cityId === loc.cityId && c.positionId === "porter" && c.status === "active")
  if (!card) return
  const weekStart = addDaysISO(weekStartISO(today), -7)
  const days = Array.from({ length: 6 }, (_, i) => addDaysISO(weekStart, i))
  const busy = new Set(groups.filter((g) => days.includes(g.date)).flatMap((g) => g.slots.flatMap((s) => (s.proId ? [s.proId] : []))))
  const pro = pros.find((p) => p.supplierId === "instawork" && p.cityId === loc.cityId && p.status === "active" && !busy.has(p.id) && days.every((d) => canWork(p, "porter", d).ok))
  if (!pro) return
  const pos = position("porter")
  for (const date of days) {
    const code = `SG-${counters.sg++}`
    const id = code.toLowerCase()
    groups.push({
      id,
      code,
      buyerId: loc.buyerId,
      locationId: loc.id,
      positionId: pos.id,
      eventName: "Convention move-in",
      date,
      start: "07:00",
      end: "15:30",
      breakMins: 30,
      supplierId: "instawork",
      supplierIds: ["instawork"],
      billRate: card.billRate,
      proRate: card.proRate,
      markupPct: card.markupPct,
      slots: [{ id: `${id}-1`, proId: pro.id, status: "completed", confirmedAt: isoAt(addDaysISO(weekStart, -5), "11:10") }],
      badges: [],
      instructions: pos.duties,
      attire: pos.attire,
      createdAt: isoAt(addDaysISO(weekStart, -6), "09:40"),
      createdBy: "Jordan Ellis",
      source: "booking",
    })
    const clockIn = hhmmFromMinutes(minutesOf("07:00") - (hashString(id) % 4))
    const clockOut = hhmmFromMinutes(minutesOf("15:30") + (hashString(id) % 5))
    timesheets.push({
      id: `ts-${counters.ts++}`,
      groupId: id,
      slotId: `${id}-1`,
      proId: pro.id,
      supplierId: "instawork",
      buyerId: loc.buyerId,
      locationId: loc.id,
      positionId: pos.id,
      date,
      scheduledStart: "07:00",
      scheduledEnd: "15:30",
      scheduledBreakMins: 30,
      clockIn,
      clockOut,
      breakMins: 30,
      hours: paidHours(clockIn, clockOut, 30),
      otHours: 0,
      clock: { in: clockIn, out: clockOut, breakMins: 30, source: "instawork_app" },
      billRate: card.billRate,
      tips: 0,
      status: "approved",
      source: "app",
      submittedAt: isoAt(date, "15:50"),
      approvedAt: isoAt(addDaysISO(date, 1), "10:15"),
      approvedBy: "Jordan Ellis",
      history: [],
    })
  }
}

/** A worker sent home early on yesterday's shifts is billed at the four-hour minimum. */
function plantSentHome(groups: ShiftGroup[], timesheets: Timesheet[], today: string) {
  const t = timesheets
    .filter((x) => x.status === "pending_approval" && x.date >= addDaysISO(today, -2) && x.clockIn && x.clock && ["concessions", "porter", "cashier"].includes(x.positionId))
    .sort((a, b) => b.date.localeCompare(a.date) || a.id.localeCompare(b.id))[0]
  if (!t?.clockIn) return
  const out = hhmmFromMinutes(minutesOf(t.clockIn) + 150)
  t.clockOut = out
  t.breakMins = 0
  t.sentHome = true
  t.hours = hoursFor(t.clockIn, out, 0, true)
  t.clock = { ...t.clock!, out, breakMins: 0 }
  const slot = groups.find((g) => g.id === t.groupId)?.slots.find((s) => s.id === t.slotId)
  if (slot) slot.sentHome = true
}

/** A Harbor worker forgot to clock out, so the agency's draft is missing its clock-out. */
function plantMissingPunch(timesheets: Timesheet[], today: string) {
  const t = timesheets.find((x) => x.status === "draft" && x.supplierId === "harbor" && x.date >= addDaysISO(today, -3) && x.clock?.out)
  if (!t) return
  t.clockOut = undefined
  t.hours = 0
  t.clock = { ...t.clock!, out: undefined }
}

/** Three over-schedule timesheets the buyer sent back to Harbor and Metro with a reason. */
function plantRejections(r: Random, timesheets: Timesheet[], today: string) {
  const candidates = timesheets.filter(
    (t) => t.status === "approved" && (t.supplierId === "metro" || t.supplierId === "harbor") && t.date >= addDaysISO(today, -9) && t.hours > 7.6,
  )
  for (const t of r.shuffle(candidates).slice(0, 3)) {
    const by = t.buyerId === "levy-chi" ? "Jordan Ellis" : "Alicia Moreno"
    const at = new Date(`${addDaysISO(t.date, 2)}T09:30:00`).toISOString()
    const reason = "Hours above schedule"
    const note = "Clock-out is more than an hour after the scheduled end. Please confirm with your Pro."
    t.status = "rejected"
    t.approvedAt = undefined
    t.approvedBy = undefined
    t.rejection = { reason, note, at, by }
    t.history = [
      change(addHoursISO(isoAt(t.date, t.scheduledEnd), 0.5), "Iris", "created", { note: t.clock ? "From the clock" : "No clock record" }),
      ...(t.submittedAt ? [change(t.submittedAt, supplierName(t.supplierId), "submitted", { note: "From the agency's CSV" })] : []),
      change(at, by, "rejected", { reason, note }),
    ]
  }
}

const supplierName = (id: string) => {
  const s = SUPPLIERS.find((x) => x.id === id)
  return s ? (s.integration === "api" ? `${s.shortName} app` : s.contactName) : id
}

function lineFrom(t: Timesheet, pros: Map<string, Pro>, idx: number): InvoiceLine {
  const pro = pros.get(t.proId)
  return {
    id: `${t.id}-l${idx}`,
    timesheetId: t.id,
    proId: t.proId,
    proName: pro ? `${pro.firstName} ${pro.lastName}` : "Unknown Pro",
    groupId: t.groupId,
    positionId: t.positionId,
    locationId: t.locationId,
    date: t.date,
    scheduledStart: t.scheduledStart,
    scheduledEnd: t.scheduledEnd,
    clockIn: t.clockIn,
    clockOut: t.clockOut,
    hours: t.hours,
    otHours: t.otHours || undefined,
    billRate: t.billRate,
    amount: laborAmount(t),
    tips: t.tips,
  }
}

function generateInvoices(counters: Counters, timesheets: Timesheet[], pros: Pro[], today: string) {
  const proMap = new Map(pros.map((p) => [p.id, p]))
  const invoices: Invoice[] = []
  const thisWeek = weekStartISO(today)
  const weeksBack = Math.ceil((Date.parse(thisWeek) - Date.parse(historyStart(today))) / (7 * 86_400_000))
  for (let weeksAgo = weeksBack; weeksAgo >= 1; weeksAgo--) {
    const periodStart = addDaysISO(thisWeek, -7 * weeksAgo)
    const periodEnd = addDaysISO(periodStart, 6)
    const issuedOn = addDaysISO(periodEnd, 1)
    const dueOn = addDaysISO(issuedOn, PROGRAM.paymentTermsDays)
    for (const s of SUPPLIERS) {
      for (const buyerId of ["levy-chi", "chartwells-south"]) {
        const rows = timesheets.filter((t) => t.supplierId === s.id && t.buyerId === buyerId && t.date >= periodStart && t.date <= periodEnd && t.status === "approved")
        if (!rows.length) continue
        const id = `inv-${counters.inv}`
        const number = `INV-${counters.inv++}`
        const lines = rows.map((t, i) => lineFrom(t, proMap, i))
        let status: Invoice["status"] = weeksAgo > 3 ? "paid" : "unpaid"
        if (weeksAgo === 3) status = s.id === "metro" ? "unpaid" : s.id === "crewline" && buyerId === "levy-chi" ? "partial" : "paid"
        if (weeksAgo === 2) status = s.id === "instawork" ? "in_process" : s.id === "crewline" ? "paid" : "unpaid"
        const invoice: Invoice = {
          id,
          number,
          supplierId: s.id,
          buyerId,
          periodStart,
          periodEnd,
          issuedOn,
          dueOn,
          status,
          paidAmount: 0,
          lines,
          source: "auto",
        }
        const total = invoiceTotalRaw(invoice)
        invoice.paidAmount = status === "paid" ? total : status === "partial" ? round2(total * 0.5) : 0
        rows.forEach((t) => {
          t.invoiceId = id
          t.status = "invoiced"
        })
        invoices.push(invoice)
      }
    }
  }

  const oldestMetro = invoices
    .filter((i) => i.supplierId === "metro" && i.status === "unpaid")
    .sort((a, b) => a.periodStart.localeCompare(b.periodStart))[0]
  if (oldestMetro) oldestMetro.dueOn = addDaysISO(today, -3)

  const invoiceGroups: InvoiceGroup[] = []
  const groupWeek = (weeksAgo: number, buyerId: string, name: string) => {
    const periodStart = addDaysISO(thisWeek, -7 * weeksAgo)
    const members = invoices.filter((i) => i.buyerId === buyerId && i.periodStart === periodStart)
    if (!members.length) return
    const code = `IG-2026-${String(counters.ig++).padStart(3, "0")}`
    const group: InvoiceGroup = {
      id: code.toLowerCase(),
      code,
      name,
      buyerId,
      createdOn: addDaysISO(periodStart, 8),
      createdBy: "Priya Raman",
      invoiceIds: members.map((m) => m.id),
    }
    members.forEach((m) => (m.groupId = group.id))
    invoiceGroups.push(group)
  }
  const label = (weeksAgo: number) => {
    const d = new Date(`${addDaysISO(thisWeek, -7 * weeksAgo)}T12:00:00`)
    return d.toLocaleDateString("en-US", { month: "short", day: "numeric" })
  }
  groupWeek(3, "levy-chi", `Levy · Chicago, week of ${label(3)}`)
  groupWeek(3, "chartwells-south", `Chartwells · South, week of ${label(3)}`)
  groupWeek(2, "levy-chi", `Levy · Chicago, week of ${label(2)}`)
  return { invoices, invoiceGroups }
}

function invoiceTotalRaw(inv: Invoice) {
  return round2(inv.lines.reduce((sum, l) => sum + l.amount + l.tips, 0))
}

function generateUploads(counters: Counters, today: string): Upload[] {
  const at = (daysAgo: number, hhmm: string) => new Date(`${addDaysISO(today, -daysAgo)}T${hhmm}:00`).toISOString()
  const make = (u: Omit<Upload, "id" | "code">): Upload => {
    const code = `UPL-${counters.upl++}`
    return { id: code.toLowerCase(), code, ...u }
  }
  const mmdd = (iso: string) => iso.slice(5).replace("-", "")
  const month = (iso: string) => new Date(`${iso}T12:00:00`).toLocaleDateString("en-US", { month: "short" }).toLowerCase()
  const isoWeek = (daysAgo: number) => {
    const d = new Date(`${addDaysISO(today, -daysAgo)}T12:00:00`)
    d.setDate(d.getDate() + 3 - ((d.getDay() + 6) % 7))
    const jan4 = new Date(d.getFullYear(), 0, 4)
    return 1 + Math.round(((d.getTime() - jan4.getTime()) / 86_400_000 - 3 + ((jan4.getDay() + 6) % 7)) / 7)
  }
  const csvText = (rows: string[][]) => rows.map((r) => r.map((v) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v)).join(",")).join("\n")
  const fix = (value: string) => ({ value, label: value })
  const levy = { uploadedBy: "Jordan Ellis", actorKind: "buyer" as const, buyerId: "levy-chi" }
  const chartwells = { uploadedBy: "Alicia Moreno", actorKind: "buyer" as const, buyerId: "chartwells-south" }
  const compass = { uploadedBy: "Priya Raman", actorKind: "compass" as const }
  const instawork = { uploadedBy: "Marcus Lee", actorKind: "supplier" as const, supplierId: "instawork" }
  const crewline = { uploadedBy: "Devon Brooks", actorKind: "supplier" as const, supplierId: "crewline" }
  const harbor = { uploadedBy: "Renee Park", actorKind: "supplier" as const, supplierId: "harbor" }
  const metro = { uploadedBy: "Luis Ortega", actorKind: "supplier" as const, supplierId: "metro" }
  const lastMonthEnd = addDaysISO(`${today.slice(0, 8)}01`, -1)
  const lastMonthDays = Number(lastMonthEnd.slice(8, 10))

  const expo = addDaysISO(today, 9)
  const concert = addDaysISO(today, 10)
  const game = addDaysISO(today, 12)
  const sg = (iso: string, role: string) => `LEVY-${mmdd(iso)}-${role}`
  const eventFile = csvText([
    ["shift_group_id", "location", "position", "date", "start_time", "end_time", "pros_needed", "break_minutes", "event_name", "instructions"],
    [sg(expo, "SRV"), "Riverside Convention Center", "Banquet Server", expo, "06:30", "15:00", "10", "30", "Food & Wine Expo", "Check in at the loading dock"],
    [sg(expo, "SRV"), "Riverside Convention Center", "Banquet Server", expo, "06:30", "15:00", "4", "30", "Food & Wine Expo", "Check in at the loading dock"],
    [sg(expo, "POR"), "Riverside Convention Center", "Event Porter", expo, "06:00", "14:30", "5", "30", "Food & Wine Expo", ""],
    [sg(expo, "LCK"), "Riverside Convention Center", "Line Cook", expo, "06:00", "14:30", "3", "30", "Food & Wine Expo", ""],
    [sg(expo, "DSH"), "Riverside Convention Center", "Dishwasher", expo, "08:00", "16:30", "2", "30", "Food & Wine Expo", ""],
    [sg(concert, "BAR"), "West Loop Arena", "Bartender", concert, "4:30pm", "23:30", "6", "30", "Concert night", ""],
    [sg(concert, "CON"), "West Loop Arena", "Concessions Attendant", concert, "17:00", "23:00", "8", "30", "Concert night", ""],
    [sg(concert, "BBK"), "West Loop Arena", "Barback", concert, "16:00", "23:30", "3", "30", "Concert night", ""],
    [sg(game, "CON"), "Lakefront Stadium", "Concesions Attendant", game, "09:30", "17:30", "12", "30", "Game day", ""],
    [sg(game, "BAR"), "Lakefront Stadium", "Bartender", game, "10:00", "17:30", "8", "30", "Game day", ""],
    [sg(game, "STE"), "Lakefront Stadium", "Suite Attendant", `${Number(game.slice(5, 7))}/${Number(game.slice(8, 10))}/${game.slice(0, 4)}`, "10:30", "18:00", "6", "30", "Game day", ""],
    [sg(game, "POR"), "Lakefront Stadium", "Event Porter", game, "09:00", "17:00", "4", "30", "Game day", ""],
  ])

  const hires: [string, string, string, string][] = [
    ["Aurelia", "Bianchi", "chi", "Banquet Server;Suite Attendant"],
    ["Benedict", "Osei", "chi", "Bartender;Barback"],
    ["Carmen", "Delacroix", "chi", "Banquet Server;Bartender"],
    ["Desmond", "Achterberg", "dal", "Suite Attendant;Banquet Server"],
    ["Elodie", "Fontaine", "chi", "Bartender;Barback"],
    ["Florian", "Gutierrez", "chi", "Banquet Server;Event Porter"],
    ["Giselle", "Harrow", "dal", "Banquet Server;Suite Attendant"],
    ["Hiroshi", "Imamura", "chi", "Line Cook;Prep Cook"],
    ["Isadora", "Jansen", "chi", "Bartender;Banquet Server"],
    ["Joaquin", "Kowalski", "chi", "Suite Attendant;Bartender"],
    ["Katarina", "Lund", "dal", "Line Cook;Prep Cook"],
    ["Lorenzo", "Marchetti", "chi", "Banquet Server;Suite Attendant"],
    ["Magnolia", "Nakamura", "chi", "Bartender;Barback"],
    ["Nikolai", "Orlov", "dal", "Event Porter;Barback"],
    ["Ophelia", "Petrov", "chi", "Banquet Server;Bartender"],
    ["Percival", "Quinn", "chi", "Suite Attendant;Banquet Server"],
    ["Rosalind", "Sterling", "chi", "Prep Cook;Line Cook"],
    ["Sebastian", "Thorne", "dal", "Bartender;Barback"],
    ["Tatiana", "Ueda", "chi", "Banquet Server;Suite Attendant"],
    ["Ulysses", "Varga", "chi", "Event Porter;Banquet Server"],
    ["Valentina", "Wexler", "chi", "Bartender;Suite Attendant"],
    ["Winston", "Yamada", "dal", "Banquet Server;Bartender"],
    ["Ximena", "Zamora", "chi", "Line Cook;Prep Cook"],
  ]
  const proRows = hires.map(([first, last, cityId, positions], i) => {
    const needs = requirementsFor(positions.split(";").map((name) => POSITIONS.find((p) => p.name === name)?.id ?? ""))
    const zips = city(cityId).zips
    return [
      "",
      first,
      last,
      `${first}.${last}@example.com`.toLowerCase(),
      i === 4 ? "555-0134" : `(${cityId === "chi" ? "312" : "214"}) 555-${2100 + i * 37}`,
      city(cityId).name,
      i === 11 ? "60620" : zips[(i * 3) % zips.length],
      positions,
      addDaysISO(today, -(4 + (i % 12))),
      "complete",
      i % 7 === 3 ? "pending" : "complete",
      needs.includes("foodHandler") ? addDaysISO(today, 300 + i * 23) : "",
      needs.includes("alcohol") ? addDaysISO(today, 400 + i * 19) : "",
    ]
  })
  proRows.splice(19, 0, [...proRows[7]])
  const prosFile = csvText([
    ["pro_id", "first_name", "last_name", "email", "phone", "city", "zip_code", "positions", "background_check", "i9", "orientation", "food_handler_expires", "alcohol_cert_expires"],
    ...proRows,
  ])

  return [
    make({
      type: "rates", fileName: `metro_rates_${mmdd(addDaysISO(today, -22))}.csv`, ...metro,
      uploadedAt: at(22, "11:04"), status: "completed", totalRows: 28, successRows: 28, errorRows: 0,
      issues: [],
      summary: "28 rates saved",
    }),
    make({
      type: "rates", fileName: `instawork_rates_${mmdd(addDaysISO(today, -20))}.csv`, ...instawork,
      uploadedAt: at(20, "10:15"), status: "completed", totalRows: 30, successRows: 30, errorRows: 0, issues: [],
      summary: "30 rate cards saved",
    }),
    make({
      type: "shifts", fileName: `levy_events_${mmdd(addDaysISO(today, -16))}.csv`, ...levy,
      uploadedAt: at(16, "15:05"), status: "completed", totalRows: 16, successRows: 16, errorRows: 0,
      issues: [{ row: 3, column: "start_time", message: "Use 24-hour time", level: "warning", suggestion: fix("17:00") }],
      summary: "16 shift groups posted (148 spots)",
    }),
    make({
      type: "rates", fileName: `crewline_rates_${mmdd(addDaysISO(today, -15))}.csv`, ...crewline,
      uploadedAt: at(15, "09:22"), status: "completed", totalRows: 18, successRows: 18, errorRows: 0, issues: [],
      summary: "18 rate cards saved",
    }),
    make({
      type: "activity", fileName: `business_activity_${month(lastMonthEnd)}.csv`, ...compass,
      uploadedAt: at(13, "08:05"), status: "completed", totalRows: 7 * lastMonthDays, successRows: 7 * lastMonthDays, errorRows: 0,
      issues: [{ row: 41, column: "location", message: "Not a Compass location", level: "warning", suggestion: fix("Northside Ballpark") }],
      summary: `Activity saved for 7 locations across ${lastMonthDays} days`,
    }),
    make({
      type: "timesheets", fileName: `metro_timesheets_wk${isoWeek(13)}.csv`, ...metro,
      uploadedAt: at(13, "08:12"), status: "completed_with_errors", totalRows: 34, successRows: 32, errorRows: 2,
      issues: [
        { row: 8, column: "clock_in", message: "Use 24-hour time", level: "warning", suggestion: fix("16:55") },
        { row: 12, column: "clock_out", message: "Not a time. Left out", level: "error" },
        { row: 27, column: "pro_id", message: "No Pro with this ID. Left out", level: "error" },
      ],
      summary: "32 timesheets submitted for approval, 2 rows left out",
    }),
    make({
      type: "professionals", fileName: `metro_new_hires_${mmdd(addDaysISO(today, -12))}.csv`, ...metro,
      uploadedAt: at(12, "11:48"), status: "completed_with_errors", totalRows: 8, successRows: 7, errorRows: 1,
      issues: [
        { row: 3, column: "phone", message: "Missing area code", level: "warning", suggestion: fix("(214) 555-0187") },
        { row: 6, column: "food_handler_expires", message: "Not a date. Left out", level: "error" },
      ],
      summary: "7 Pros saved, 5 ready to work, 1 row left out",
    }),
    make({
      type: "professionals", fileName: "pros_batch1.csv", ...harbor,
      uploadedAt: at(9, "13:15"), status: "completed", totalRows: 12, successRows: 12, errorRows: 0,
      issues: [{ row: 7, column: "email", message: "Has capital letters", level: "warning", suggestion: fix("andre.castillo@example.com") }],
      summary: "12 Pros saved, 10 ready to work",
    }),
    make({
      type: "tips", fileName: `chartwells_tips_${mmdd(addDaysISO(today, -9))}.csv`, ...chartwells,
      uploadedAt: at(9, "17:02"), status: "completed", totalRows: 12, successRows: 12, errorRows: 0, issues: [],
      summary: "$612.00 in tips added to 12 timesheets",
    }),
    make({
      type: "professionals", fileName: `crewline_new_hires_${mmdd(addDaysISO(today, -8))}.csv`, ...crewline,
      uploadedAt: at(8, "14:05"), status: "completed", totalRows: 6, successRows: 6, errorRows: 0, issues: [],
      summary: "6 Pros saved, 4 ready to work",
    }),
    make({
      type: "tips", fileName: `levy_bar_tips_wk${isoWeek(7)}.csv`, ...levy,
      uploadedAt: at(7, "18:20"), status: "completed", totalRows: 24, successRows: 24, errorRows: 0, issues: [],
      summary: "$1,486.50 in tips added to 24 timesheets",
    }),
    make({
      type: "timesheets", fileName: `metro_timesheets_wk${isoWeek(6)}.csv`, ...metro,
      uploadedAt: at(6, "07:55"), status: "completed", totalRows: 29, successRows: 29, errorRows: 0, issues: [],
      summary: "29 timesheets submitted for approval",
    }),
    make({
      type: "activity", fileName: `business_activity_${mmdd(addDaysISO(today, -13))}_${mmdd(addDaysISO(today, -7))}.csv`, ...compass,
      uploadedAt: at(6, "08:12"), status: "completed", totalRows: 49, successRows: 49, errorRows: 0, issues: [],
      summary: "Activity saved for 7 locations across 7 days",
    }),
    make({
      type: "tips", fileName: `instawork_tips_wk${isoWeek(5)}.csv`, ...instawork,
      uploadedAt: at(5, "19:30"), status: "completed", totalRows: 22, successRows: 22, errorRows: 0, issues: [],
      summary: "$1,212.40 in tips added to 22 timesheets",
    }),
    make({
      type: "timesheets", fileName: `levy_suite_hours_wk${isoWeek(4)}.csv`, ...levy,
      uploadedAt: at(4, "09:10"), status: "completed_with_errors", totalRows: 18, successRows: 17, errorRows: 1,
      issues: [
        { row: 4, column: "clock_out", message: "Use 24-hour time", level: "warning", suggestion: fix("17:45") },
        { row: 9, column: "pro_id", message: "Wasn't booked on this shift. Left out", level: "error" },
      ],
      summary: "17 timesheets submitted for approval, 1 row left out",
    }),
    make({
      type: "shifts", fileName: `chartwells_dining_${mmdd(addDaysISO(today, -3))}.csv`, ...chartwells, uploadedBy: "Devin Hart",
      uploadedAt: at(3, "09:40"), status: "completed", totalRows: 14, successRows: 14, errorRows: 0, issues: [],
      summary: "14 shift groups posted (26 spots)",
    }),
    make({
      type: "timesheets", fileName: `hours_wk${isoWeek(3)}.csv`, ...harbor,
      uploadedAt: at(3, "08:30"), status: "completed", totalRows: 41, successRows: 41, errorRows: 0,
      issues: [{ row: 17, column: "clock_out", message: "1.25 hrs over schedule, so it's flagged for the approver", level: "warning" }],
      summary: "41 timesheets submitted for approval",
    }),
    make({
      type: "professionals", fileName: "pros_batch2.csv", ...harbor,
      uploadedAt: at(2, "11:20"), status: "needs_review", totalRows: 24, successRows: 21, errorRows: 3,
      issues: [
        { row: 6, column: "phone", message: "Missing area code", level: "error", suggestion: fix("(312) 555-0134") },
        { row: 13, column: "zip_code", message: "Not a Chicago zip code", level: "error", suggestion: fix("60622") },
        { row: 21, column: "email", message: "Duplicate of row 9", level: "error", suggestion: { removeRow: true, label: "Remove this row" } },
      ],
      summary: "21 rows ready, 3 to review",
      csv: prosFile,
    }),
    make({
      type: "rates", fileName: `rates_${month(today)}_v1.csv`, ...harbor,
      uploadedAt: at(1, "09:12"), status: "failed", totalRows: 16, successRows: 0, errorRows: 16,
      issues: [{ row: 1, message: "Missing required column: bill_rate", level: "error" }],
      summary: "Missing required column: bill_rate",
    }),
    make({
      type: "rates", fileName: `rates_${month(today)}.csv`, ...harbor,
      uploadedAt: at(1, "09:40"), status: "completed", totalRows: 16, successRows: 16, errorRows: 0,
      issues: [],
      summary: "16 rates saved",
    }),
    make({
      type: "shifts", fileName: `levy_events_${mmdd(expo)}.csv`, ...levy,
      uploadedAt: at(1, "16:42"), status: "needs_review", totalRows: 12, successRows: 9, errorRows: 3,
      issues: [
        { row: 7, column: "start_time", message: "Use 24-hour time", level: "error", suggestion: fix("16:30") },
        { row: 10, column: "position", message: "Not a position on Iris", level: "error", suggestion: fix("Concessions Attendant") },
        { row: 12, column: "date", message: "Use YYYY-MM-DD", level: "error", suggestion: fix(game) },
      ],
      summary: "9 rows ready, 3 to review",
      csv: eventFile,
    }),
  ]
}

const REVIEW_TEXT: Record<number, string[]> = {
  5: [
    "Showed up early, knew the menu cold and kept the line moving all night.",
    "Guests asked for them by name. Book again.",
    "Calm under pressure during the rush. Helped train two new Pros.",
    "Spotless station and great with guests. Exactly what we want.",
  ],
  4: [
    "Solid shift. Needed a little direction at the start, then ran with it.",
    "Reliable and friendly. Slightly slow on close-out.",
    "Good attitude and on time. Would book again.",
  ],
  3: [
    "Got the job done, but took long breaks during the rush.",
    "Arrived 15 minutes late. Work itself was fine.",
  ],
  2: ["Left the station unstocked at close. Needed reminders on uniform."],
}

function generateReviews(r: Random, counters: Counters, timesheets: Timesheet[], pros: Pro[]): ProReview[] {
  const proMap = new Map(pros.map((p) => [p.id, p]))
  const reviews: ProReview[] = []
  const seen = new Set<string>()
  for (const t of [...timesheets].sort((a, b) => b.date.localeCompare(a.date))) {
    const pro = proMap.get(t.proId)
    const key = `${t.buyerId}|${t.proId}`
    if (!pro || seen.has(key) || !r.chance(0.35)) continue
    seen.add(key)
    const rating = Math.max(2, Math.min(5, Math.round(pro.rating + r.float(-0.6, 0.4))))
    reviews.push({
      id: `rev-${counters.rev++}`,
      proId: t.proId,
      buyerId: t.buyerId,
      groupId: t.groupId,
      rating,
      text: r.pick(REVIEW_TEXT[rating]),
      by: t.buyerId === "levy-chi" ? "Jordan Ellis" : "Alicia Moreno",
      at: new Date(`${addDaysISO(t.date, 1)}T10:00:00`).toISOString(),
    })
  }
  return reviews
}

function generateRoster(r: Random, timesheets: Timesheet[], pros: Pro[], today: string): RosterEntry[] {
  const roster: RosterEntry[] = []
  const proMap = new Map(pros.map((p) => [p.id, p]))
  for (const buyerId of ["levy-chi", "chartwells-south"]) {
    const counts = new Map<string, number>()
    for (const t of timesheets) if (t.buyerId === buyerId) counts.set(t.proId, (counts.get(t.proId) ?? 0) + 1)
    const ranked = [...counts.entries()]
      .sort((a, b) => b[1] - a[1] || (proMap.get(b[0])?.rating ?? 0) - (proMap.get(a[0])?.rating ?? 0))
      .map(([id]) => id)
    const favorites = ranked.slice(0, buyerId === "levy-chi" ? 18 : 8)
    const okToReturn = ranked.slice(favorites.length, favorites.length + (buyerId === "levy-chi" ? 10 : 5))
    const lowRated = ranked
      .slice(favorites.length + okToReturn.length)
      .sort((a, b) => (proMap.get(a)?.rating ?? 5) - (proMap.get(b)?.rating ?? 5))
      .slice(0, buyerId === "levy-chi" ? 3 : 1)
    const add = (proId: string, status: RosterEntry["status"]) =>
      roster.push({ id: `${buyerId}-${proId}`, buyerId, proId, status, addedOn: addDaysISO(today, -r.int(12, 220)) })
    favorites.forEach((id) => add(id, "favorite"))
    okToReturn.forEach((id) => add(id, "ok_to_return"))
    lowRated.forEach((id) => add(id, "blocked"))
  }
  return roster
}

function generateActivity(
  counters: Counters,
  groups: ShiftGroup[],
  invoices: Invoice[],
  uploads: Upload[],
  pros: Pro[],
  today: string,
): ActivityEvent[] {
  const events: ActivityEvent[] = []
  const push = (e: Omit<ActivityEvent, "id">) => events.push({ id: `ev-${counters.ev++}`, ...e })
  const recentGroups = groups.filter((g) => g.date >= addDaysISO(today, -2) && g.date <= addDaysISO(today, 4))
  for (const g of recentGroups.slice(0, 40)) {
    const filled = g.slots.filter((s) => s.proId).length
    const last = g.slots.map((s) => s.confirmedAt).filter(Boolean).sort().pop()
    if (!filled || !last) continue
    const s = supplier(g.supplierId)
    push({
      at: last,
      text: `${s.shortName} confirmed ${filled} of ${g.slots.length} ${position(g.positionId).name} Pros at ${location(g.locationId).name}`,
      actor: s.name,
      tone: filled === g.slots.length ? "positive" : "neutral",
      buyerId: g.buyerId,
      supplierId: g.supplierId,
      groupId: g.id,
    })
  }
  for (const u of uploads) {
    push({
      at: u.uploadedAt,
      text: `${u.uploadedBy} uploaded ${u.fileName}: ${u.summary.toLowerCase()}`,
      actor: u.uploadedBy,
      tone: u.status === "failed" ? "critical" : u.status === "completed_with_errors" ? "warning" : "neutral",
      buyerId: u.buyerId,
      supplierId: u.supplierId,
    })
  }
  for (const inv of invoices.filter((i) => i.issuedOn >= addDaysISO(today, -10))) {
    push({
      at: new Date(`${inv.issuedOn}T07:00:00`).toISOString(),
      text: `${supplier(inv.supplierId).shortName} issued ${inv.number} for the week of ${inv.periodStart.slice(5).replace("-", "/")}`,
      actor: supplier(inv.supplierId).name,
      tone: "neutral",
      buyerId: inv.buyerId,
      supplierId: inv.supplierId,
      invoiceId: inv.id,
    })
  }
  const onboarding = pros.filter((p) => p.status === "onboarding").slice(0, 6)
  for (const p of onboarding) {
    push({
      at: new Date(`${p.joinedOn}T13:00:00`).toISOString(),
      text: `${p.firstName} ${p.lastName} started onboarding with ${supplier(p.supplierId).shortName}`,
      actor: supplier(p.supplierId).name,
      tone: "primary",
      supplierId: p.supplierId,
    })
  }
  return events.sort((a, b) => b.at.localeCompare(a.at)).slice(0, 120)
}

export const zipsForCity = (cityId: string) => CITIES.find((c) => c.id === cityId)?.zips ?? []

export const LOCATION_IDS = LOCATIONS.map((l) => l.id)
