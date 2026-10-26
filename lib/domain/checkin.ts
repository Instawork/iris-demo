import { addDaysISO, hhmmFromMinutes, instantAt, minutesOf, spanMinutes, wallClock } from "@/lib/dates"
import { eligiblePros, event, merge } from "@/lib/domain/core"
import { CommandError, type Notice } from "@/lib/domain/commands"
import { fullName } from "@/lib/format"
import { city, findLocation, location, position, supplier } from "@/lib/reference"
import type { DemoData, Punches, ShiftGroup, Slot } from "@/lib/types"

/**
 * Iris check-in: the clock a worker punches on their phone at the venue. It is Iris's own record of the time, kept
 * apart from what the agency later bills, which is what lets every timesheet be checked against a clock.
 */

export type PunchAction = "in" | "break_start" | "break_end" | "out"

export interface CheckInView {
  proName: string
  agency: string
  position: string
  location: string
  date: string
  start: string
  end: string
  tz: string
  punches: Punches
  /** The timesheet exists, so the shift can't take more punches. */
  closed: boolean
}

const fail = (message: string, status = 400): never => {
  throw new CommandError(message, status)
}

const find = (data: DemoData, groupId: string, slotId: string) => {
  const g = data.groups.find((x) => x.id === groupId)
  const slot = g?.slots.find((s) => s.id === slotId)
  return g && slot?.proId ? { g, slot } : fail("This check-in link is no longer valid.", 404)
}

export function checkInView(data: DemoData, groupId: string, slotId: string): CheckInView {
  const { g, slot } = find(data, groupId, slotId)
  const pro = data.pros.find((p) => p.id === slot.proId)
  const loc = location(g.locationId)
  return {
    proName: pro ? fullName(pro) : "Worker",
    agency: supplier(pro?.supplierId ?? g.supplierId).shortName,
    position: position(g.positionId).name,
    location: loc.name,
    date: g.date,
    start: g.start,
    end: g.end,
    tz: city(loc.cityId).tz,
    punches: slot.punches ?? {},
    closed: data.timesheets.some((t) => t.groupId === g.id && t.slotId === slot.id),
  }
}

const startsAtMs = (g: ShiftGroup) => instantAt(g.date, g.start).getTime()
const endsAtMs = (g: ShiftGroup) => instantAt(addDaysISO(g.date, minutesOf(g.start) + spanMinutes(g.start, g.end) >= 1440 ? 1 : 0), g.end).getTime()

/** Records one punch on the slot. Clocking out ends the shift for this worker; Iris creates the timesheet on the next tick. */
export function punch(data: DemoData, groupId: string, slotId: string, action: PunchAction, now: Date): { data: DemoData; result: CheckInView; notices: Notice[] } {
  const { g, slot } = find(data, groupId, slotId)
  if (g.cancelledAt) fail("This shift was cancelled.")
  if (slot.status === "no_show") fail("You were marked as a no-show on this shift.")
  if (data.timesheets.some((t) => t.groupId === g.id && t.slotId === slot.id)) fail("This shift is finished. Your timesheet is already with the agency.")
  const p: Punches = { ...(slot.punches ?? {}) }
  const at = hhmmFromMinutes(wallClock(now).minutes)
  const ms = now.getTime()
  if (action === "in") {
    if (p.in) fail("You're already clocked in.")
    if (ms < startsAtMs(g) - 60 * 60_000) fail("Check-in opens an hour before the shift.")
    if (ms > endsAtMs(g)) fail("This shift has ended.")
    p.in = at
  } else if (!p.in) {
    fail("Clock in first.")
  } else if (p.out) {
    fail("You've already clocked out.")
  } else if (action === "break_start") {
    if (p.breakStart) fail("You've already taken your break.")
    p.breakStart = at
  } else if (action === "break_end") {
    if (!p.breakStart || p.breakEnd) fail("Start your break first.")
    p.breakEnd = at
  } else {
    if (p.breakStart && !p.breakEnd) p.breakEnd = at
    p.out = at
  }
  const pro = data.pros.find((x) => x.id === slot.proId)
  const name = pro ? `${pro.firstName} ${pro.lastName}` : "A worker"
  const words: Record<PunchAction, string> = { in: "clocked in", break_start: "started a break", break_end: "ended a break", out: "clocked out" }
  const text = `${name} ${words[action]} at ${location(g.locationId).name} with Iris check-in`
  const slots: Slot[] = g.slots.map((s) => (s.id === slot.id ? { ...s, punches: p } : s))
  const next = merge(data, { groups: data.groups.map((x) => (x.id === g.id ? { ...x, slots } : x)) }, event(data, { text, actor: name, tone: "neutral", buyerId: g.buyerId, supplierId: pro?.supplierId, groupId: g.id }, now.toISOString()))
  const notices: Notice[] =
    action === "in" || action === "out"
      ? [
          { text: action === "out" ? `${text}. Iris is creating the timesheet from the punch.` : `${text}.`, tone: "info", buyerId: g.buyerId },
          { text: `${text}.`, tone: "info", supplierId: pro?.supplierId },
        ]
      : []
  return { data: next, result: checkInView(next, groupId, slotId), notices }
}

/**
 * A shift for the room: a bartender shift at West Loop Arena that started an hour ago and runs two more, with a
 * Crewline bartender already clocked in on Iris check-in. Their phone clocks them out in front of everyone.
 */
export function startLiveShift(data: DemoData, now: Date): { data: DemoData; result: { groupId: string; slotId: string } } {
  const nowISO = now.toISOString()
  const existing = data.groups.find((g) => g.eventName === "Live check-in" && !g.cancelledAt && now.getTime() < endsAtMs(g) && g.slots.some((s) => s.proId && !s.punches?.out))
  if (existing) return { data, result: { groupId: existing.id, slotId: existing.slots.find((s) => s.proId && !s.punches?.out)!.id } }
  const loc = findLocation("loc-wla") ?? fail("West Loop Arena isn't set up.")
  const card = data.rateCards.find((c) => c.supplierId === "crewline" && c.cityId === loc.cityId && c.positionId === "bartender" && c.status === "active") ?? fail("Crewline has no bartender rate in Chicago.")
  const clock = wallClock(now)
  const startMinutes = Math.floor((clock.minutes - 60) / 5) * 5
  const date = startMinutes < 0 ? addDaysISO(clock.date, -1) : clock.date
  const start = hhmmFromMinutes(startMinutes)
  const end = hhmmFromMinutes(startMinutes + 180)
  const code = `SG-${data.counters.sg}`
  const id = code.toLowerCase()
  const draft: ShiftGroup = {
    id,
    code,
    buyerId: loc.buyerId,
    locationId: loc.id,
    positionId: "bartender",
    eventName: "Live check-in",
    date,
    start,
    end,
    breakMins: 0,
    supplierId: "crewline",
    supplierIds: ["crewline"],
    billRate: card.billRate,
    proRate: card.proRate,
    markupPct: card.markupPct,
    slots: [{ id: `${id}-1`, status: "open" }],
    badges: ["TIPS"],
    instructions: position("bartender").duties,
    attire: position("bartender").attire,
    createdAt: new Date(now.getTime() - 26 * 3600_000).toISOString(),
    createdBy: "Jordan Ellis",
    source: "booking",
  }
  const pro = eligiblePros(data, draft, "crewline").sort((a, b) => b.rating - a.rating)[0] ?? fail("No Crewline bartender is free today.")
  const group: ShiftGroup = {
    ...draft,
    slots: [{ id: `${id}-1`, proId: pro.id, status: "confirmed", confirmedAt: new Date(now.getTime() - 20 * 3600_000).toISOString(), punches: { in: hhmmFromMinutes(startMinutes - 2) } }],
  }
  return {
    data: merge(
      data,
      { groups: [group, ...data.groups], counters: { sg: data.counters.sg + 1 } },
      event(data, { text: `${fullName(pro)} clocked in at ${loc.name} with Iris check-in`, actor: fullName(pro), tone: "neutral", buyerId: loc.buyerId, supplierId: "crewline", groupId: id }, nowISO),
    ),
    result: { groupId: id, slotId: `${id}-1` },
  }
}
