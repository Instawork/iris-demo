import { STOPPED, cursorStopped, restCursor, sleep, type, until } from "@/components/tour/cursor"
import { useUi } from "@/hooks/use-ui"
import type { TipsAction } from "@/lib/agent-tips"
import { useStore } from "@/lib/store"

/**
 * Iris enters the tips the venue agreed to in chat the way the venue would: on the shift's timesheets, typing each
 * worker's share into the Tips column and saving it with Enter, so the room sees the split land on the page. Any share
 * she can't reach there, like a row on another page of the table, is saved directly, so the whole split always lands.
 */

let entering = false
/** Iris is typing tips into the timesheets page right now. */
export const enteringTips = () => entering

const TIP_INPUT = '[data-tour="tip-input"]'
const cell = (timesheetId: string) => document.querySelector<HTMLInputElement>(`tr[data-row-id="${timesheetId}"] ${TIP_INPUT}`)
const tipsOf = (timesheetId: string) => useStore.getState().data.timesheets.find((t) => t.id === timesheetId)?.tips

export async function enterTips(action: TipsAction, push: (href: string) => void): Promise<boolean> {
  const { data, setTips } = useStore.getState()
  const sheets = action.entries.map((e) => data.timesheets.find((t) => t.id === e.timesheetId))
  const href = `/timesheets?shift=${action.groupId}${sheets.every((t) => t?.status === "pending_approval") ? "" : "&filter=all"}`
  const typeable = !!data.groups.find((g) => g.id === action.groupId)?.badges.includes("TIPS")
  const typed = new Set<string>()
  entering = typeable
  useUi.getState().setAgentOpen(false)
  if (`${window.location.pathname}${window.location.search}` !== href) push(href)
  try {
    if (!typeable) throw STOPPED
    await until(() => action.entries.some((e) => cell(e.timesheetId)), 8000)
    await sleep(400)
    for (const entry of action.entries) {
      const input = cell(entry.timesheetId)
      if (!input || tipsOf(entry.timesheetId) === entry.tips) continue
      await type(input, entry.tips.toFixed(2))
      input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }))
      await until(() => tipsOf(entry.timesheetId) === entry.tips, 4000)
      typed.add(entry.timesheetId)
    }
  } catch (error) {
    if (!cursorStopped(error)) throw error
  } finally {
    const focused = document.activeElement
    if (focused instanceof HTMLElement && focused.matches(TIP_INPUT)) focused.blur()
    restCursor()
    entering = false
  }
  const rest = action.entries.filter((e) => !typed.has(e.timesheetId) && tipsOf(e.timesheetId) !== e.tips)
  return !rest.length || setTips(rest)
}
