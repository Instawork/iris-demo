import { eligiblePros, event, joinNames, merge } from "@/lib/domain/core"
import type { Notice } from "@/lib/domain/commands"
import { filledCount, groupPhase } from "@/lib/metrics"
import { location, position, supplier } from "@/lib/reference"
import type { DemoData, ShiftGroup, Slot } from "@/lib/types"

/** How fast each agency staffs a shift when nobody is playing it: odds per tick, Pros per burst, and the share it can fill. */
const PACE: Record<string, { chance: number; burst: [number, number]; cap: number }> = {
  instawork: { chance: 0.95, burst: [1, 3], cap: 1 },
  crewline: { chance: 0.55, burst: [1, 1], cap: 0.92 },
  harbor: { chance: 0.42, burst: [1, 1], cap: 0.85 },
  metro: { chance: 0.28, burst: [1, 1], cap: 0.7 },
}

const paceOf = (supplierId: string) => PACE[supplierId] ?? PACE.metro

export interface AdvanceOptions {
  now: Date
  /** Agencies the server plays. Agencies a person is playing are left alone. */
  simulated: (supplierId: string) => boolean
}

/**
 * One scheduler tick: release each shift to the next agency when its time comes, then let simulated agencies staff
 * what they can see. Releases happen for every agency; filling only for the simulated ones.
 */
export function advance(data: DemoData, { now, simulated }: AdvanceOptions): { data: DemoData; notices: Notice[] } {
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
