import { addDaysISO, hhmmFromMinutes, instantAt, minutesOf, spanMinutes, wallClock } from "@/lib/dates"
import { credited, type Notice } from "@/lib/domain/commands"
import { eligiblePros, event, joinNames, merge } from "@/lib/domain/core"
import { invoiceApproved, issueOpen } from "@/lib/domain/invoicing"
import { filledCount, groupPhase } from "@/lib/metrics"
import { hashString } from "@/lib/random"
import { location, position, supplier } from "@/lib/reference"
import { change, hoursFor, matchesClock, overtimeKey, partAt, splitForMove, weekClosed, withOvertime } from "@/lib/timesheets"
import type { ClockRecord, DemoData, ShiftGroup, Slot, Timesheet } from "@/lib/types"

/** How fast each agency staffs a shift when nobody is playing it: odds per tick, Pros per burst, and the share it can fill. */
const PACE: Record<string, { chance: number; burst: [number, number]; cap: number }> = {
  instawork: { chance: 0.7, burst: [1, 2], cap: 0.92 },
  crewline: { chance: 0.7, burst: [1, 2], cap: 0.92 },
  harbor: { chance: 0.55, burst: [1, 2], cap: 0.88 },
  metro: { chance: 0.28, burst: [1, 1], cap: 0.7 },
}

const paceOf = (supplierId: string) => PACE[supplierId] ?? PACE.metro

export interface AdvanceOptions {
  now: Date
  /** Agencies the server plays. Agencies a person is playing are left alone. */
  simulated: (supplierId: string) => boolean
}

/**
 * One scheduler tick: release each shift to the next agency when its time comes, let simulated agencies staff what
 * they can see, create timesheets for shifts that ended, and invoice approved hours once their week closes.
 */
export function advance(data: DemoData, options: AdvanceOptions): { data: DemoData; notices: Notice[] } {
  const filled = fill(data, options)
  const closed = closeShifts(filled.data, options)
  const invoiced = closeWeeks(closed.data, options.now)
  const credits = answerSendBacks(invoiced.data, options)
  return { data: credits.data, notices: [...filled.notices, ...closed.notices, ...invoiced.notices, ...credits.notices] }
}

/* ------------------------------- Timesheets ------------------------------- */

/** Minutes after a shift's scheduled end before Iris creates its timesheets. */
const CLOSE_AFTER_MINUTES = 30
/** Hours a simulated CSV agency waits before sending its file. */
const CSV_SUBMIT_AFTER_HOURS = 10

const endsAt = (g: ShiftGroup) => instantAt(addDaysISO(g.date, spanMinutes(g.start, g.end) + minutesOf(g.start) >= 1440 ? 1 : 0), g.end).getTime()

/** The clock for a worker who didn't punch on Iris: drawn the way that agency's workers usually punch, the same every time. */
function usualClock(g: ShiftGroup, slot: Slot, instawork: boolean): ClockRecord | undefined {
  const h = hashString(slot.id)
  if (!instawork && h % 100 >= 92) return undefined
  return {
    in: hhmmFromMinutes(minutesOf(g.start) + ((h >>> 3) % 11) - 6),
    out: hhmmFromMinutes(minutesOf(g.end) + ((h >>> 7) % 14) - 4),
    breakMins: g.breakMins,
    source: instawork ? "instawork_app" : "iris_checkin",
  }
}

const punchedClock = (slot: Slot): ClockRecord | undefined => {
  const p = slot.punches
  if (!p?.in) return undefined
  const breakMins = p.breakStart && p.breakEnd ? spanMinutes(p.breakStart, p.breakEnd) : 0
  return { in: p.in, out: p.out, breakMins, source: "iris_checkin" }
}

/**
 * A Draft timesheet for every worker on a shift that has ended, prefilled from the clock: the worker's own check-in,
 * or the agency's usual clock when they didn't punch on Iris. API agencies send theirs for approval on their own;
 * simulated CSV agencies submit their drafts the next morning.
 */
function closeShifts(data: DemoData, { now, simulated }: AdvanceOptions): { data: DemoData; notices: Notice[] } {
  const nowMs = now.getTime()
  const nowISO = now.toISOString()
  const today = wallClock(now).date
  const from = addDaysISO(today, -3)
  const has = new Set<string>()
  for (const t of data.timesheets) if (t.date >= from) has.add(`${t.groupId}|${t.slotId}`)
  const proSupplier = new Map(data.pros.map((p) => [p.id, p.supplierId]))
  let counter = data.counters.ts
  const created: Timesheet[] = []
  const finished = new Map<string, Set<string>>()

  for (const g of data.groups) {
    if (g.date < from || g.date > today || g.cancelledAt) continue
    const endMs = endsAt(g)
    for (const slot of g.slots) {
      if (!slot.proId || slot.status === "no_show" || has.has(`${g.id}|${slot.id}`)) continue
      const clockedOut = !!slot.punches?.out
      if (!clockedOut && nowMs < endMs + CLOSE_AFTER_MINUTES * 60_000) continue
      const supplierId = proSupplier.get(slot.proId) ?? g.supplierId
      const sup = supplier(supplierId)
      const clock = punchedClock(slot) ?? usualClock(g, slot, sup.isInstawork)
      const complete = !!clock?.in && !!clock.out
      const auto = sup.integration === "api" && complete
      const breakMins = clock?.breakMins ?? g.breakMins
      const id = `ts-${counter++}`
      const draft: Timesheet = {
        id,
        groupId: g.id,
        slotId: slot.id,
        proId: slot.proId,
        supplierId,
        buyerId: g.buyerId,
        locationId: g.locationId,
        positionId: g.positionId,
        date: g.date,
        scheduledStart: g.start,
        scheduledEnd: g.end,
        scheduledBreakMins: g.breakMins,
        clockIn: clock?.in,
        clockOut: clock?.out,
        breakMins,
        hours: hoursFor(clock?.in, clock?.out, breakMins, slot.sentHome),
        otHours: 0,
        clock,
        sentHome: slot.sentHome,
        billRate: g.billRate,
        tips: 0,
        status: auto ? "pending_approval" : "draft",
        source: sup.integration === "api" ? "app" : "csv",
        submittedAt: auto ? nowISO : undefined,
        history: [
          change(nowISO, "Iris", "created", { note: clock ? (slot.punches?.in ? "From the worker's check-in" : "From the clock") : "No clock record" }),
          ...(auto ? [change(nowISO, `${sup.shortName} app`, "submitted", { note: "Sent by the agency's system" })] : []),
        ],
      }
      let parts = [draft]
      for (const move of slot.moves ?? []) {
        const current = partAt(parts, move.at)
        const split = current && splitForMove(current, move, `ts-${counter}`, nowISO, { from: position(current.positionId).name, to: position(move.positionId).name })
        if (!split) continue
        counter++
        parts = parts.flatMap((t) => (t.id === current.id ? split : [t]))
      }
      if (data.settings?.autoSubmit?.includes(supplierId))
        parts = parts.map((t) =>
          matchesClock(t)
            ? { ...t, status: "pending_approval" as const, submittedAt: nowISO, history: [...t.history, change(nowISO, "Iris", "submitted", { note: `Matched Iris's clock, so it went in for ${sup.shortName}` })] }
            : t,
        )
      created.push(...parts)
      finished.set(g.id, (finished.get(g.id) ?? new Set()).add(slot.id))
    }
  }

  const seededAt = data.seededAt ?? nowISO
  const stale = data.timesheets.filter((t) => {
    if (t.status !== "draft" || !simulated(t.supplierId) || t.date < from) return false
    const created = t.history[0]?.at ?? nowISO
    return created > seededAt && nowMs - new Date(created).getTime() >= CSV_SUBMIT_AFTER_HOURS * 3600_000
  })
  if (!created.length && !stale.length) return { data, notices: [] }

  const submittedIds = new Set(stale.map((t) => t.id))
  const changed = [
    ...created,
    ...stale.map((t) => {
      const sup = supplier(t.supplierId)
      const fromSchedule = !t.clockIn || !t.clockOut
      const times = fromSchedule ? { clockIn: t.scheduledStart, clockOut: t.scheduledEnd, breakMins: t.scheduledBreakMins } : {}
      const after = { ...t, ...times }
      return {
        ...after,
        hours: hoursFor(after.clockIn, after.clockOut, after.breakMins, t.sentHome),
        status: "pending_approval" as const,
        submittedAt: nowISO,
        history: [
          ...t.history,
          change(nowISO, sup.integration === "api" ? `${sup.shortName} app` : sup.contactName, "submitted", {
            note: fromSchedule ? "Billed to the schedule from the agency's records" : sup.integration === "api" ? "Sent by the agency's system" : "From the agency's CSV",
          }),
        ],
      }
    }),
  ]
  const sheets = withOvertime(
    [...created, ...data.timesheets.map((t) => (submittedIds.has(t.id) ? changed.find((c) => c.id === t.id)! : t))],
    new Set(changed.map(overtimeKey)),
  )
  let next = merge(data, {
    timesheets: sheets,
    groups: finished.size
      ? data.groups.map((g) =>
          finished.has(g.id) ? { ...g, slots: g.slots.map((s) => (finished.get(g.id)!.has(s.id) && s.status === "confirmed" ? { ...s, status: "completed" as const } : s)) } : g,
        )
      : data.groups,
    counters: { ts: counter },
  })

  const notices: Notice[] = []
  const sent = changed.filter((t) => t.status === "pending_approval")
  for (const groupId of new Set(sent.map((t) => t.groupId))) {
    const rows = sent.filter((t) => t.groupId === groupId)
    const g = data.groups.find((x) => x.id === groupId)!
    const who = joinNames([...new Set(rows.map((t) => supplier(t.supplierId).shortName))])
    const text = `${who} submitted ${rows.length} ${position(g.positionId).name} ${rows.length === 1 ? "timesheet" : "timesheets"} for ${location(g.locationId).name}`
    next = merge(next, event(next, { text, actor: who, tone: "primary", buyerId: g.buyerId, supplierId: rows[0].supplierId, groupId }, nowISO))
    notices.push({ text: `${text}. Iris checked them against the clock.`, tone: "info", buyerId: g.buyerId })
  }
  return { data: next, notices }
}

/** Approved hours from a week that has ended go on each agency's invoice for that week. */
function closeWeeks(data: DemoData, now: Date): { data: DemoData; notices: Notice[] } {
  const today = wallClock(now).date
  const nowISO = now.toISOString()
  const notices: Notice[] = []
  let next = data
  const issued = issueOpen(next, today, nowISO)
  if (issued) {
    next = merge(next, issued.patch)
    const text = `The week closed, so Iris issued ${joinNames(issued.issued.map((i) => i.number))}`
    next = merge(next, event(next, { text, actor: "Iris", tone: "positive" }, nowISO))
    notices.push(...issued.issued.map((i) => ({ text: `${i.number}: last week's approved hours, invoiced`, tone: "success" as const, supplierId: i.supplierId })))
  }
  const stray = new Set(next.timesheets.filter((t) => t.status === "approved" && !t.invoiceId && weekClosed(t.date, today)).map((t) => t.id))
  const placed = stray.size ? invoiceApproved(next, stray, today, nowISO) : undefined
  if (placed?.issued.length) {
    next = merge(next, placed.patch)
    next = merge(next, event(next, { text: `Iris invoiced the week's approved hours on ${joinNames(placed.issued.map((i) => i.number))}`, actor: "Iris", tone: "positive" }, nowISO))
  }
  return { data: next, notices }
}

/** Seconds a simulated agency takes to credit what Compass sent back. */
const CREDIT_AFTER_SECONDS = 12

/** Agencies nobody is playing credit send-backs on their own, a few seconds after Compass sends them. */
function answerSendBacks(data: DemoData, { now, simulated }: AdvanceOptions): { data: DemoData; notices: Notice[] } {
  const due = data.invoices.filter(
    (i) => i.billingReview?.status === "sent_back" && simulated(i.supplierId) && now.getTime() - Date.parse(i.billingReview.at) >= CREDIT_AFTER_SECONDS * 1000,
  )
  let next = data
  const notices: Notice[] = []
  for (const inv of due) {
    const out = credited(next, inv.id, supplier(inv.supplierId).contactName, now.toISOString())
    if (!out) continue
    next = out.data
    notices.push(...(out.notices ?? []))
  }
  return { data: next, notices }
}

/* --------------------------------- Filling -------------------------------- */

function fill(data: DemoData, { now, simulated }: AdvanceOptions): { data: DemoData; notices: Notice[] } {
  const nowISO = now.toISOString()
  const notices: Notice[] = []
  let next = data
  const replace = (g: ShiftGroup) => {
    next = merge(next, { groups: next.groups.map((x) => (x.id === g.id ? g : x)) })
  }

  for (const original of data.groups) {
    if (!original.liveFill || original.cancelledAt) continue
    let current = next.groups.find((x) => x.id === original.id)
    if (!current?.liveFill) continue

    if (current.supplierReleases?.length) {
      const released = current.supplierReleases.filter((r) => r.releasedAt <= nowISO).map((r) => r.supplierId)
      const fresh = released.filter((id) => !current!.supplierIds.includes(id))
      if (fresh.length && filledCount(current) < current.slots.length) {
        current = { ...current, supplierIds: released }
        replace(current)
        next = merge(
          next,
          event(
            next,
            {
              text: `${joinNames(fresh.map((id) => supplier(id).shortName))} can now staff ${current.code} (${position(current.positionId).name}, ${location(current.locationId).name})`,
              actor: "Iris",
              tone: "neutral",
              buyerId: current.buyerId,
              supplierId: fresh[0],
              groupId: current.id,
            },
            nowISO,
          ),
        )
        for (const id of fresh) notices.push({ text: `New shift released to you: ${current.code} at ${location(current.locationId).name}`, tone: "info", supplierId: id })
      }
    }

    const filled = filledCount(current)
    const stop = () => replace({ ...current!, liveFill: undefined })
    if (groupPhase(current) !== "upcoming" || filled >= current.slots.length) {
      stop()
      continue
    }

    const players = current.supplierIds.filter(simulated)
    if (!players.length) continue
    const pool = players.flatMap((id) => (Math.random() <= paceOf(id).chance ? eligiblePros(next, current!, id).map((pro) => ({ pro, id })) : []))
    if (!pool.length) continue
    const lead = players.map(paceOf).sort((a, b) => b.chance - a.chance)[0]
    const cap = Math.max(1, Math.floor(current.slots.length * lead.cap))
    if (filled >= cap) continue
    const burst = Math.min(pool.length, cap - filled, lead.burst[0] + Math.floor(Math.random() * (lead.burst[1] - lead.burst[0] + 1)))
    const picks = [...pool].sort(() => Math.random() - 0.5).slice(0, burst)
    let i = 0
    const slots: Slot[] = current.slots.map((s) => {
      if (s.proId || i >= picks.length) return s
      return { ...s, proId: picks[i++].pro.id, status: "confirmed", confirmedAt: nowISO }
    })
    const nowFilled = slots.filter((s) => s.proId).length
    const full = nowFilled >= current.slots.length
    current = { ...current, slots, liveFill: full ? undefined : current.liveFill }
    replace(current)
    if (full || nowFilled >= cap) {
      const proSupplier = new Map(next.pros.map((p) => [p.id, p.supplierId]))
      const fillers = [...new Set(slots.map((s) => (s.proId ? proSupplier.get(s.proId) : undefined)).filter(Boolean) as string[])]
      const who = joinNames(fillers.map((id) => supplier(id).shortName))
      const secs = Math.max(1, Math.round((now.getTime() - new Date(current.liveFill?.startedAt ?? original.liveFill.startedAt).getTime()) / 1000))
      const text = full
        ? `${who} filled all ${current.slots.length} ${position(current.positionId).name} spots at ${location(current.locationId).name}`
        : `${who} confirmed ${nowFilled} of ${current.slots.length} ${position(current.positionId).name} spots at ${location(current.locationId).name}`
      next = merge(next, event(next, { text, actor: who, tone: full ? "positive" : "warning", buyerId: current.buyerId, supplierId: fillers[0], groupId: current.id }, nowISO))
      notices.push({
        text: full ? `${text} in ${secs < 90 ? `${secs} seconds` : `${Math.round(secs / 60)} minutes`}.` : `${text}.`,
        tone: full ? "success" : "warning",
        buyerId: current.buyerId,
      })
    }
  }
  return { data: next, notices }
}
