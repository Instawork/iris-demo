import { addDaysISO, formatDay } from "@/lib/dates"
import { joinNames } from "@/lib/domain/core"
import { money, round2 } from "@/lib/format"
import { LOCATIONS, POSITIONS, location, position } from "@/lib/reference"
import { shareTips, tippable } from "@/lib/timesheets"
import type { DemoData } from "@/lib/types"

/**
 * Tips in a sentence, for the venue. "Split $600 in tips by hours for last night's bartenders at Northside Ballpark"
 * shares the pool between everyone who worked it by their hours; "$40 in tips each" gives each the same. The chat
 * lists every share first, and nothing is saved until the venue clicks.
 */

export type TipsAction = { label: string; kind: "set-tips"; entries: { timesheetId: string; tips: number }[]; total: number; groupId: string }

const LISTED = 3
const AMOUNT = /\$\s?(\d{1,5}(?:\.\d{1,2})?)\b/

const lowerOf = (text: string) => text.toLowerCase().replace(/’/g, "'")

export const asksToTip = (text: string) => /\btips?\b/.test(lowerOf(text)) && AMOUNT.test(text.replace(/,/g, ""))

/** The venue, role and night a request names, like "last night's bartenders at Northside Ballpark". */
function named(text: string, buyerId: string, today: string) {
  const lower = lowerOf(text)
  const loc = LOCATIONS.find((l) => l.buyerId === buyerId && (lower.includes(l.name.toLowerCase()) || lower.includes(l.name.split(" ")[0].toLowerCase())))
  const pos = POSITIONS.find((p) => lower.includes(p.name.toLowerCase()) || lower.includes(p.id))
  const date = /\b(last night|yesterday)\b/.test(lower) ? addDaysISO(today, -1) : /\b(tonight|today)\b/.test(lower) ? today : undefined
  return { locationId: loc?.id, positionId: pos?.id, date }
}

/**
 * The shift the tips are for: the one on screen, else the one the request names, else the venue's latest tipped shift
 * with none entered yet.
 */
export function tipShift(data: DemoData, buyerId: string, today: string, groupId?: string, text = "") {
  const sheets = (id: string) => data.timesheets.filter((t) => t.groupId === id && t.buyerId === buyerId && tippable(data, t))
  const open = groupId ? data.groups.find((g) => g.id === groupId && g.buyerId === buyerId) : undefined
  if (open && sheets(open.id).length) return { group: open, sheets: sheets(open.id) }
  const ask = named(text, buyerId, today)
  const asked = !!(ask.locationId || ask.positionId || ask.date)
  const latest = data.groups
    .filter((g) => g.buyerId === buyerId && g.date <= today && sheets(g.id).length)
    .filter((g) =>
      asked
        ? (!ask.locationId || g.locationId === ask.locationId) && (!ask.positionId || g.positionId === ask.positionId) && (!ask.date || g.date === ask.date)
        : g.badges.includes("TIPS") && sheets(g.id).every((t) => !t.tips),
    )
    .sort((a, b) => b.date.localeCompare(a.date) || b.end.localeCompare(a.end))[0]
  return latest ? { group: latest, sheets: sheets(latest.id) } : undefined
}

export function tipsReply(data: DemoData, buyerId: string, text: string, today: string, groupId?: string): { text: string; actions: TipsAction[] } {
  const amount = round2(Number(AMOUNT.exec(text.replace(/,/g, ""))?.[1] ?? 0))
  const each = /\b(each|apiece|per (worker|person|head))\b/.test(lowerOf(text))
  const shift = tipShift(data, buyerId, today, groupId, text)
  if (!amount) return { text: "How much in tips? Say the pool, like “split $600 in tips by hours”, or “$40 each”.", actions: [] }
  if (!shift) return { text: "None of your shifts has worked hours that can still take tips.", actions: [] }
  const { group, sheets } = shift
  const where = `${position(group.positionId).name}, ${location(group.locationId).name}, ${formatDay(group.date, "EEE MMM d")}`
  const entries = shareTips(sheets, amount, each)
  const total = round2(entries.reduce((s, e) => s + e.tips, 0))
  const named = entries
    .map((e) => {
      const t = sheets.find((s) => s.id === e.timesheetId)!
      return { name: data.pros.find((p) => p.id === t.proId)?.firstName ?? "A worker", tips: e.tips }
    })
    .sort((a, b) => b.tips - a.tips)
  const shown = named.map((n) => `${n.name} ${money(n.tips)}`)
  const list = shown.length > LISTED + 1 ? `${shown.slice(0, LISTED).join(", ")} and ${shown.length - LISTED} more` : joinNames(shown)
  const had = round2(sheets.reduce((s, t) => s + t.tips, 0))
  return {
    text: [`${money(amount)} ${each ? "each" : "split by hours"} on ${where}: ${list}.`, had ? `It replaces the ${money(had)} entered before.` : ""].filter(Boolean).join("\n\n"),
    actions: [{ label: `Add ${money(total)} in tips`, kind: "set-tips", entries, total, groupId: group.id }],
  }
}
