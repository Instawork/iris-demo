import { STOPPED, cursorStopped, press, restCursor, sleep, type, until } from "@/components/tour/cursor"
import { useUi } from "@/hooks/use-ui"
import { useStore } from "@/lib/store"
import type { ExpenseKind } from "@/lib/types"

/**
 * Iris enters an agency's expenses the way the agency would: on the shift's timesheets she selects the crew, clicks Add
 * expense, types the amount once and saves it to all of them, so the room sees the form do the work. Anything she can't
 * do in that one pass, like a different amount or a row on another page of the table, is saved directly, so every
 * expense still lands.
 */

export interface ExpenseEntry {
  timesheetId: string
  kind: ExpenseKind
  amount: number
  note?: string
}

const DIALOG = '[data-tour="bulk-expense-dialog"]'

let entering = false
/** Iris is entering expenses on the timesheets page right now. */
export const enteringExpenses = () => entering

let draft: { kind: ExpenseKind; note?: string } | undefined
/** The kind and note Iris is about to enter, read by the expense dialog as it opens. */
export const expenseDraft = () => draft

const one = (selector: string) => document.querySelector<HTMLElement>(selector)
const row = (timesheetId: string) => one(`tr[data-row-id="${timesheetId}"]`)
const box = (timesheetId: string) => row(timesheetId)?.querySelector<HTMLButtonElement>('[aria-label="Select row"]:not([disabled])') ?? null
const sheetOf = (timesheetId: string) => useStore.getState().data.timesheets.find((t) => t.id === timesheetId)
const countOf = (timesheetId: string) => sheetOf(timesheetId)?.expenses?.length ?? 0

/** The shift most of the entries are on, so Iris works from that shift's table. */
const shiftOf = (entries: ExpenseEntry[]) => {
  const groups = entries.map((e) => sheetOf(e.timesheetId)?.groupId)
  return groups.find((g, _, all) => g && all.filter((x) => x === g).length * 2 > all.length) ?? groups[0]
}

export async function enterExpenses(entries: ExpenseEntry[], push: (href: string) => void): Promise<number> {
  const done = new Set<ExpenseEntry>()
  const groupId = shiftOf(entries)
  const href = groupId ? `/timesheets?shift=${groupId}&filter=all` : "/timesheets?filter=all"
  const lead = entries[0]
  const batch = lead ? entries.filter((e) => e.kind === lead.kind && e.amount === lead.amount && e.note === lead.note && sheetOf(e.timesheetId)?.groupId === groupId) : []
  entering = batch.length > 0
  useUi.getState().setAgentOpen(false)
  if (entering && `${window.location.pathname}${window.location.search}` !== href) push(href)
  try {
    if (entering) {
      await until(() => batch.some((e) => box(e.timesheetId)), 8000)
      await sleep(500)
      const clear = one('[aria-label="Clear selection"]')
      if (clear) await press(clear)
      const picks = batch.filter((e) => box(e.timesheetId))
      const enabled = document.querySelectorAll('tr[data-row-id] [aria-label="Select row"]:not([disabled])').length
      const all = one('[aria-label="Select all on this page"]')
      if (all && picks.length > 1 && picks.length === enabled) await press(all)
      else
        for (const e of picks) {
          await press(box(e.timesheetId))
          await sleep(150)
        }
      const before = new Map(picks.map((e) => [e.timesheetId, countOf(e.timesheetId)]))
      draft = { kind: lead.kind, ...(lead.note ? { note: lead.note } : {}) }
      await press(await until(() => one('[data-tour="bulk-expense"]'), 4000))
      await type(await until(() => one(`${DIALOG} [data-tour="bulk-expense-amount"]`), 4000), lead.amount.toFixed(2))
      await press(one(`${DIALOG} [data-tour="bulk-expense-save"]`))
      await until(() => picks.every((e) => countOf(e.timesheetId) > before.get(e.timesheetId)!), 6000)
      for (const e of picks) done.add(e)
      await sleep(400)
    }
  } catch (error) {
    if (!cursorStopped(error) && error !== STOPPED) throw error
  } finally {
    draft = undefined
    restCursor()
    entering = false
  }
  let added = done.size
  for (const e of entries.filter((x) => !done.has(x))) added += (await useStore.getState().addExpenses([e.timesheetId], e.kind, e.amount, e.note)) ? 1 : 0
  return added
}
