/**
 * Iris's cursor, drawn over the page while she works so everyone watching sees what she clicks and types. The guided
 * tour drives it for the player, and the agent drives it when it does what the chat asked on the page itself.
 */

/** Bumped to stop whatever Iris is doing on screen, so she stops where she is. */
let pilot = 0
export const STOPPED = new Error("Iris's cursor stopped")

export const haltCursor = () => {
  pilot++
  restCursor(250)
}
export const cursorStopped = (error: unknown) => error === STOPPED

export const sleep = (ms: number) => {
  const run = pilot
  return new Promise<void>((resolve, reject) => window.setTimeout(() => (run === pilot ? resolve() : reject(STOPPED)), ms))
}

/** Waits for the next screen, or gives up and hands the work back. */
export async function until<T>(find: () => T | null | undefined | false, ms = 5000): Promise<T> {
  const end = performance.now() + ms
  for (;;) {
    const found = find()
    if (found) return found
    if (performance.now() > end) throw STOPPED
    await sleep(80)
  }
}

let cursor: HTMLElement | undefined
let cursorAt = { x: 0, y: 0 }
let resting = 0

const CURSOR = `<svg width="27" height="29" viewBox="0 0 22 24" aria-hidden="true"><path d="M3 2.5v16.2l4.3-4.1 2.9 6.4 2.9-1.3-2.8-6.3 6-.3z" fill="#16130f" stroke="#fff" stroke-width="1.6" stroke-linejoin="round"/></svg><span>Iris</span>`

const cursorEl = () => {
  if (cursor?.isConnected) return cursor
  cursor = document.createElement("div")
  cursor.setAttribute("data-tour-cursor", "")
  cursor.setAttribute("aria-hidden", "true")
  cursor.innerHTML = CURSOR
  document.body.append(cursor)
  return cursor
}

const moveCursor = (el: HTMLElement, x: number, y: number, ms: number) => {
  el.style.setProperty("--glide", `${ms}ms`)
  el.style.transform = `translate(${x}px, ${y}px)`
  cursorAt = { x, y }
}

export function restCursor(after = 850) {
  window.clearTimeout(resting)
  resting = window.setTimeout(() => cursor?.removeAttribute("data-on"), after)
}

/** Glides the cursor onto an element, from the tour card's button if it isn't on screen yet. */
export async function point(target: Element) {
  const c = cursorEl()
  window.clearTimeout(resting)
  const r = target.getBoundingClientRect()
  const to = { x: r.left + Math.min(r.width / 2, 140), y: r.top + Math.min(r.height / 2, 24) }
  if (!c.hasAttribute("data-on")) {
    const from = document.querySelector("[data-tour-do]")?.getBoundingClientRect()
    moveCursor(c, from ? from.left + from.width / 2 : window.innerWidth / 2, from ? from.top + from.height / 2 : window.innerHeight - 80, 0)
    c.getBoundingClientRect()
    c.setAttribute("data-on", "")
  }
  const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches
  const ms = still ? 0 : Math.round(Math.min(750, Math.max(300, 240 + Math.hypot(to.x - cursorAt.x, to.y - cursorAt.y) * 0.5)))
  moveCursor(c, to.x, to.y, ms)
  await sleep(ms + 60)
}

/** Types into a field a few letters at a time, through the field's own change handler. */
export async function type(el: Element | null | undefined, value: string) {
  if (!(el instanceof HTMLInputElement)) throw STOPPED
  if (el.value === value) return
  const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set
  el.scrollIntoView({ block: "nearest" })
  await point(el)
  el.focus()
  const pace = value.length > 20 ? 22 : 38
  for (let i = 1; i <= value.length; i++) {
    setValue?.call(el, value.slice(0, i))
    el.dispatchEvent(new Event("input", { bubbles: true }))
    await sleep(pace)
  }
  await sleep(220)
}

/** Presses a button the way a person would: the cursor goes to it, it lights up for a moment, then clicks. */
export async function press(el: Element | null | undefined) {
  if (!(el instanceof HTMLElement)) throw STOPPED
  el.scrollIntoView({ block: "nearest" })
  await point(el)
  const c = cursorEl()
  el.setAttribute("data-tour-press", "")
  c.setAttribute("data-down", "")
  try {
    await sleep(300)
  } finally {
    el.removeAttribute("data-tour-press")
    c.removeAttribute("data-down")
  }
  el.click()
  restCursor()
  await sleep(300)
}
