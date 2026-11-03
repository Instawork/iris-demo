import { STOPPED, cursorStopped, press, restCursor, sleep, type, until } from "@/components/tour/cursor"
import { useUi } from "@/hooks/use-ui"
import { useStore } from "@/lib/store"
import type { ExpenseKind } from "@/lib/types"

/**
 * Iris enters an agency's expenses the way the agency would: on the shift's timesheets she clicks each worker, clicks
 * Add expense, types the amount, saves it and closes the timesheet, so the room sees the form do the work. Anything she
 * can't reach on the page, like a row on another page of the table, is saved directly, so every expense still lands.
 */

export interface ExpenseEntry {
  timesheetId: string
  kind: ExpenseKind
  amount: number
  note?: string
}

const ON_SCREEN = 8
const SHEET = '[data-tour="timesheet-sheet"]'

let entering = false
/** Iris is entering expenses on the timesheets page right now. */
export const enteringExpenses = () => entering

const one = (selector: string) => document.querySelector<HTMLElement>(selector)
const row = (timesheetId: string) => one(`tr[data-row-id="${timesheetId}"]`)
const countOf = (timesheetId: string) => useStore.getState().data.timesheets.find((t) => t.id === timesheetId)?.expenses?.length ?? 0
const openOn = () => new URLSearchParams(window.location.search).get("ts")
const addButton = (timesheetId: string) => (openOn() === timesheetId ? one(`${SHEET} [data-tour="expense-add"]`) : null)

/** The shift most of the entries are on, so Iris works from that shift's table. */
const shiftOf = (entries: ExpenseEntry[]) => {
  const groups = entries.map((e) => useStore.getState().data.timesheets.find((t) => t.id === e.timesheetId)?.groupId)
  return groups.find((g, _, all) => g && all.filter((x) => x === g).length * 2 > all.length) ?? groups[0]
}

export async function enterExpenses(entries: ExpenseEntry[], push: (href: string) => void): Promise<number> {
  const done = new Set<ExpenseEntry>()
  const groupId = shiftOf(entries)
  const href = groupId ? `/timesheets?shift=${groupId}&filter=all` : "/timesheets?filter=all"
  const shown = entries.slice(0, ON_SCREEN)
  entering = shown.length > 0
  useUi.getState().setAgentOpen(false)
  if (`${window.location.pathname}${window.location.search}` !== href) push(href)
  try {
    await until(() => shown.some((e) => row(e.timesheetId)), 8000)
    await sleep(500)
    for (const entry of shown) {
      const target = row(entry.timesheetId)
      if (!target) continue
      const before = countOf(entry.timesheetId)
      await press(target.querySelector<HTMLElement>("td span.font-semibold") ?? target)
      await press(await until(() => addButton(entry.timesheetId), 6000))
      await type(await until(() => one(`${SHEET} [data-tour="expense-form"] [data-tour="expense-amount"]`), 4000), entry.amount.toFixed(2))
      await press(one(`${SHEET} [data-tour="expense-form"] [data-tour="expense-save"]`))
      await until(() => countOf(entry.timesheetId) > before, 4000)
      done.add(entry)
      await sleep(500)
      await press(one(`${SHEET} [data-slot="sheet-close"]`))
      await until(() => !openOn() && !one(SHEET), 4000)
      await sleep(250)
    }
  } catch (error) {
    if (!cursorStopped(error) && error !== STOPPED) throw error
  } finally {
    restCursor()
    entering = false
  }
  let added = done.size
  for (const e of entries.filter((x) => !done.has(x))) added += (await useStore.getState().addExpenses([e.timesheetId], e.kind, e.amount, e.note)) ? 1 : 0
  return added
}
