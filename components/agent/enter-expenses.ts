import { STOPPED, cursorStopped, press, restCursor, sleep, type, until } from "@/components/tour/cursor"
import { useUi } from "@/hooks/use-ui"
import { useStore } from "@/lib/store"
import type { ExpenseKind } from "@/lib/types"

/**
 * Iris enters an agency's expense sheet the way the agency would: she opens each worker's timesheet, clicks Add
 * expense, types the amount and saves it, so the room sees the form do the work. She does the first few on screen and
 * saves the rest directly, so a long sheet still lands in seconds.
 */

export interface ExpenseEntry {
  timesheetId: string
  kind: ExpenseKind
  amount: number
  note?: string
}

const ON_SCREEN = 3

let entering = false
/** Iris is entering expenses on the timesheets page right now. */
export const enteringExpenses = () => entering

const one = (selector: string) => document.querySelector<HTMLElement>(selector)
const countOf = (timesheetId: string) => useStore.getState().data.timesheets.find((t) => t.id === timesheetId)?.expenses?.length ?? 0
const opened = (timesheetId: string) => new URLSearchParams(window.location.search).get("ts") === timesheetId && one('[data-tour="timesheet-sheet"] [data-tour="expense-add"]')

export async function enterExpenses(entries: ExpenseEntry[], push: (href: string) => void): Promise<number> {
  const done = new Set<ExpenseEntry>()
  const shown = entries.filter((e) => e.kind === "parking").slice(0, ON_SCREEN)
  entering = shown.length > 0
  useUi.getState().setAgentOpen(false)
  try {
    for (const entry of shown) {
      const before = countOf(entry.timesheetId)
      push(`/timesheets?ts=${entry.timesheetId}`)
      await press(await until(() => opened(entry.timesheetId), 8000))
      await type(await until(() => one('[data-tour="expense-form"] [data-tour="expense-amount"]'), 4000), entry.amount.toFixed(2))
      await press(one('[data-tour="expense-form"] [data-tour="expense-save"]'))
      await until(() => countOf(entry.timesheetId) > before, 4000)
      done.add(entry)
      await sleep(250)
    }
    if (shown.length) push("/timesheets")
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
