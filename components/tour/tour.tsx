"use client"

import { AnimatePresence, motion } from "motion/react"
import { useRouter } from "next/navigation"
import { ArrowRight, Check, ChevronDown, ChevronLeft, ChevronRight, MousePointerClick, RotateCcw, WandSparkles, X } from "lucide-react"
import { useEffect, useRef, useState } from "react"
import { toast } from "sonner"

import { CHAT_COMPOSER_ID } from "@/components/agent/agent-chat"
import { useAgentThreads } from "@/components/agent/agent-store"
import { WorkspaceAvatar } from "@/components/brand/org-avatar"
import { SIDES, SideBadge } from "@/components/common/side-badge"
import {
  CHAPTERS,
  CHAPTER_ORDER,
  SCRIPT,
  STEPS,
  advance,
  handedOff,
  indexOf,
  nextClick,
  pilotStopped,
  startOf,
  stopPilot,
  type ChapterId,
  type Placement,
  type TourApi,
  type TourChapter,
  type TourContext,
  type TourItem,
  type TourStep,
} from "@/components/tour/script"
import { Button } from "@/components/ui/button"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { useTour } from "@/hooks/use-tour"
import { useUi } from "@/hooks/use-ui"
import { workspace } from "@/lib/reference"
import { commandsInFlight, commandsSent, commandsSettled, useStore } from "@/lib/store"
import { cn } from "@/lib/utils"

const EASE = [0.22, 1, 0.36, 1] as const
const SPRING = { type: "spring", stiffness: 380, damping: 36, mass: 0.9 } as const
const PAD = 6
/** How long a step may be off its page or without its target before the card says so. */
const GRACE = 600
/** How long a missing target is waited for before the step falls back to the one before it. */
const GIVE_UP = 3000
const CARD_W = 360

interface Box {
  x: number
  y: number
  w: number
  h: number
}

/** `spot`, when the card has nothing to point at, is where it last stood, so it stays there instead of jumping. */
type View =
  | { mode: "pending"; spot?: Spot }
  | { mode: "ready"; boxes: Box[]; anchor?: Box; modal: boolean; copy: string; spot: Spot }
  | { mode: "lost"; spot?: Spot }
  | { mode: "away" }
  | { mode: "paused" }
  | { mode: "preparing" }

function contextNow(): TourContext {
  const { workspaceId, data } = useStore.getState()
  const tour = useTour.getState()
  return {
    path: window.location.pathname,
    params: new URLSearchParams(window.location.search),
    wsId: workspaceId,
    data,
    thread: useAgentThreads.getState().threads[workspaceId] ?? [],
    base: tour.base,
    enteredAt: tour.enteredAt,
    proId: tour.proId,
    invoiceId: tour.invoiceId,
    groupId: tour.groupId,
    docId: tour.docId,
    sheetId: tour.sheetId,
  }
}

const boxOf = (el: Element): Box => {
  const r = el.getBoundingClientRect()
  return { x: r.left - PAD, y: r.top - PAD, w: r.width + PAD * 2, h: r.height + PAD * 2 }
}

const near = (a: number, b: number) => Math.abs(a - b) < 0.5
const sameBoxes = (a: Box[], b: Box[]) => a.length === b.length && a.every((r, i) => near(r.x, b[i].x) && near(r.y, b[i].y) && near(r.w, b[i].w) && near(r.h, b[i].h))
const sameSpot = (a?: Spot, b?: Spot) => (!a || !b ? a === b : near(a.x, b.x) && near(a.y, b.y) && a.edge === b.edge && a.at === b.at)
const spotOf = (v: View) => (v.mode === "ready" || v.mode === "pending" || v.mode === "lost" ? v.spot : undefined)
const sameView = (a: View, b: View) =>
  a.mode === b.mode &&
  sameSpot(spotOf(a), spotOf(b)) &&
  (a.mode !== "ready" ||
    (b.mode === "ready" &&
      a.modal === b.modal &&
      a.copy === b.copy &&
      sameBoxes(a.boxes, b.boxes) &&
      sameBoxes(a.anchor ? [a.anchor] : [], b.anchor ? [b.anchor] : [])))

const text = (copy: TourStep["body"], ctx: TourContext) => (typeof copy === "function" ? copy(ctx) : copy)
const titleOf = (step: TourStep, ctx: TourContext) => (typeof step.title === "function" ? step.title(ctx) : step.title)

/** The dialog or sheet on top, if any. The tour's own cards don't count. */
const topModal = () => {
  const open = document.querySelectorAll('[role="dialog"][data-state="open"]:not([data-tour-layer]), [role="alertdialog"][data-state="open"]')
  return open[open.length - 1] ?? null
}

/** Resolves once the browser is on this page, or after a few seconds if the navigation never lands. */
const arrivedAt = (href: string) =>
  new Promise<void>((resolve) => {
    const target = new URL(href, window.location.origin)
    const here = () => `${window.location.pathname}${window.location.search}`
    const from = here()
    const started = performance.now()
    // Same page, other query: wait for the query too, or the step starts before it lands. A page may tidy the query once there.
    const check = () => {
      const now = here()
      if (now === `${target.pathname}${target.search}` || (window.location.pathname === target.pathname && now !== from) || performance.now() - started > 4000) resolve()
      else window.setTimeout(check, 50)
    }
    check()
  })

const inView = (el: Element) => {
  const r = el.getBoundingClientRect()
  return r.top >= 56 && r.bottom <= window.innerHeight - 24
}

const PAGE: Record<string, string> = {
  "": "the Dashboard",
  units: "Units",
  agencies: "Agencies",
  shifts: "Shifts",
  timesheets: "Timesheets",
  rates: "Rate Cards",
  procurement: "Procurement",
  professionals: "Workers",
  invoices: "Invoices",
  reports: "Reports",
}
const pageOf = (href: string) => PAGE[href.split("?")[0].split("/")[1] ?? ""] ?? "its page"

const stop = (e: React.PointerEvent) => e.stopPropagation()

interface Spot {
  x: number
  y: number
  /** The card's edge that faces the target, and how far along it the pointer sits. */
  edge?: Placement
  at?: number
  /** Which side and alignment it is, so the card can stay put while it's still a good place. */
  key?: string
}

/** Something on the page the card shouldn't sit on, and how much it matters. */
interface Obstacle extends Box {
  weight: number
  /** A control: covering any of it costs as much as covering all of it, since a clipped button looks broken. */
  whole?: boolean
}

const hidden = (card: Box, o: Obstacle) => {
  const area = overlap(card, o)
  return o.whole && area > 0 ? o.w * o.h + CONTROL : area
}

/** What hiding any control costs on top of its size, so a small button counts for as much as a strip of text. */
const CONTROL = 1500

/** The highest the card may sit: under the app's top bar, so it never hides the search, seat or menu. */
const ceiling = () => {
  const bar = document.querySelector('[data-tour="topbar"]')?.getBoundingClientRect()
  return bar && bar.height > 0 && bar.bottom > 0 ? Math.max(16, bar.bottom + 8) : 16
}

const centered = (size: { w: number; h: number }, vw: number, vh: number): Spot => ({ x: (vw - size.w) / 2, y: Math.max(ceiling(), (vh - size.h) / 2) })

const overlap = (a: Box, b: Box) => Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x)) * Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y))

const onScreen = (b: Box, vw: number, vh: number) => b.x + b.w > 0 && b.x < vw && b.y + b.h > 0 && b.y < vh

/** How far inside a dialog the button can sit for a card beside the dialog to still point at it. */
const REACH = 96

/** A spot that points at nothing costs this much more than one beside what the step is about. */
const UNPOINTED = 6000

/** The emptiest place for the card that points at nothing, the nearer `around` the better. */
function openSpot(size: { w: number; h: number }, vw: number, vh: number, around: Box | undefined, avoid: Obstacle[], keep?: string): Spot & { cost: number } {
  const m = 16
  const top = ceiling()
  const step = 24
  const nx = around ? around.x + around.w / 2 : vw / 2
  const ny = around ? around.y + around.h / 2 : vh / 2
  const costAt = (x: number, y: number, limit = Infinity) => {
    const card = { x, y, w: size.w, h: size.h }
    let cost = UNPOINTED + Math.hypot(x + size.w / 2 - nx, y + size.h / 2 - ny) * 8
    for (const o of avoid) {
      cost += o.weight * hidden(card, o)
      if (cost >= limit) break
    }
    return cost
  }
  let best: Spot & { cost: number } = { ...centered(size, vw, vh), cost: Infinity }
  for (let y = top; y <= vh - size.h - m; y += step) {
    for (let x = m; x <= vw - size.w - m; x += step) {
      const cost = costAt(x, y, best.cost)
      if (cost < best.cost) best = { x, y, key: `open:${x},${y}`, cost }
    }
  }
  const [x, y] = keep?.startsWith("open:") ? keep.slice(5).split(",").map(Number) : []
  if (x === undefined || y === undefined || x > vw - size.w - m || y < top || y > vh - size.h - m) return best
  const cost = costAt(x, y)
  return cost <= best.cost * 1.25 + 2000 ? { x, y, key: keep, cost } : best
}

/**
 * Where the coach card sits: beside the anchor, pointing at the focus, the target itself when the anchor is something
 * bigger around it. Of the sides and alignments that fit, it takes the one hiding the least of the page, never the
 * focus or the button to click when anywhere else will do, and keeps the one it has unless another is clearly better.
 * `open`, a spot pointing at nothing, competes too, for a card with nothing left to click. Nothing, when no side fits.
 */
function place(
  anchor: Box | undefined,
  size: { w: number; h: number },
  prefer: Placement | undefined,
  vw: number,
  vh: number,
  focus = anchor,
  avoid: Obstacle[] = [],
  keep?: string,
  open?: Spot & { cost: number },
  reach = Infinity,
  tag = "",
): (Spot & { cost: number }) | undefined {
  const m = 16
  const gap = 16
  if (vw < 640) {
    const low = !!focus && focus.y + focus.h / 2 > vh / 2
    return { x: 12, y: low ? 12 : vh - size.h - 12, cost: 0 }
  }
  if (!anchor || !focus) return { ...centered(size, vw, vh), cost: UNPOINTED }
  const top = ceiling()
  const clampX = (x: number) => Math.min(Math.max(m, x), vw - size.w - m)
  const clampY = (y: number) => Math.max(top, Math.min(y, vh - size.h - m))
  const cx = focus.x + focus.w / 2
  const cy = focus.y + focus.h / 2
  const facing: Record<Placement, Placement> = { bottom: "top", top: "bottom", right: "left", left: "right" }
  const fits: Record<Placement, boolean> = {
    bottom: anchor.y + anchor.h + gap + size.h <= vh - m,
    top: anchor.y - gap - size.h >= top,
    right: anchor.x + anchor.w + gap + size.w <= vw - m,
    left: anchor.x - gap - size.w >= m,
  }
  // How far in from the anchor's edge the focus sits, so a pointer on the edge still reads as pointing at it.
  const inward: Record<Placement, number> = {
    bottom: anchor.y + anchor.h - (focus.y + focus.h),
    top: focus.y - anchor.y,
    right: anchor.x + anchor.w - (focus.x + focus.w),
    left: focus.x - anchor.x,
  }
  const sides = [...new Set<Placement>([prefer ?? "bottom", "bottom", "top", "right", "left"])]
  const spots: (Spot & { cost: number; hides: boolean })[] = []
  sides.forEach((p, rank) => {
    if (!fits[p] || inward[p] > reach) return
    const across = p === "bottom" || p === "top"
    const aligns = across
      ? { center: cx - size.w / 2, start: focus.x, end: focus.x + focus.w - size.w }
      : { center: cy - size.h / 2, start: focus.y, end: focus.y + focus.h - size.h }
    for (const [align, along] of Object.entries(aligns)) {
      const x = across ? clampX(along) : p === "right" ? anchor.x + anchor.w + gap : anchor.x - gap - size.w
      const y = across ? (p === "bottom" ? anchor.y + anchor.h + gap : anchor.y - gap - size.h) : clampY(along)
      const span = across ? size.w : size.h
      const at = Math.min(Math.max(22, across ? cx - x : cy - y), span - 22)
      // The pointer has to land on the focus, not past its end.
      const tip = (across ? x : y) + at
      if (across ? tip < focus.x || tip > focus.x + focus.w : tip < focus.y || tip > focus.y + focus.h) continue
      const card = { x, y, w: size.w, h: size.h }
      const hides = overlap(card, focus) > 0
      const cost = avoid.reduce((sum, o) => sum + o.weight * hidden(card, o), 0) + rank * 400 + (align === "center" ? 0 : 150)
      spots.push({ x, y, edge: facing[p], at, key: `${tag}${p}:${align}`, cost, hides })
    }
  })
  const clear = spots.filter((s) => !s.hides)
  const pool = clear.length ? clear : spots
  if (open) pool.push({ ...open, hides: false })
  if (!pool.length) return undefined
  const best = pool.reduce((a, b) => (b.cost < a.cost ? b : a))
  const kept = keep ? pool.find((s) => s.key === keep) : undefined
  const pick = kept && kept.cost <= best.cost * 1.25 + 2000 ? kept : best
  return { x: pick.x, y: pick.y, edge: pick.edge, at: pick.at, key: pick.key, cost: pick.cost + (pick.hides ? HIDES_FOCUS : 0) }
}

/** What a spot that covers the thing it points at costs, against spots elsewhere. */
const HIDES_FOCUS = 1_000_000

/** Of the spots pointing at different things, the one hiding least, or the one the card has while that's still a good place. */
function cheapest(spots: (Spot & { cost: number })[], keep?: string) {
  if (!spots.length) return undefined
  const best = spots.reduce((a, b) => (b.cost < a.cost ? b : a))
  const kept = spots.find((s) => s.key === keep)
  return kept && kept.cost <= best.cost * 1.25 + 2000 ? kept : best
}

const AVOID = 'button, a[href], input, textarea, select, [role="tab"], [role="checkbox"], [role="switch"], [role="combobox"], th, td, label, svg, img, canvas'

/**
 * What the card would hide, read off the page: controls, table cells, text and charts, a little for the
 * panels they sit in, the sidebar, the toasts, and above all the step's targets and the button it asks for. With a
 * dialog open, only what's in it counts, since the page behind is dimmed.
 */
function obstacles(modal: Element | null, click: Element | null | undefined, targets: Element[]): Obstacle[] {
  const vw = window.innerWidth
  const vh = window.innerHeight
  const view = { x: 0, y: 0, w: vw, h: vh }
  const frame = modal ? modal.getBoundingClientRect() : undefined
  const clip = frame ? { x: frame.left, y: frame.top, w: frame.width, h: frame.height } : view
  const out: Obstacle[] = []
  const add = (el: Element | Range, weight: number, within: Box, whole = false) => {
    const r = el.getBoundingClientRect()
    const x = Math.max(r.left, within.x)
    const y = Math.max(r.top, within.y)
    const w = Math.min(r.right, within.x + within.w) - x
    const h = Math.min(r.bottom, within.y + within.h) - y
    if (w > 0 && h > 0) out.push({ x, y, w, h, weight, whole })
  }
  for (const el of document.querySelectorAll(AVOID)) {
    if (el.closest("[data-tour-layer]")) continue
    if (modal ? !modal.contains(el) : el.closest('[role="dialog"]')) continue
    const content = el.matches("th, td, svg, img, canvas")
    const r = el.getBoundingClientRect()
    add(el, content ? 1 : 6, clip, !content && r.width * r.height >= 400 && r.width * r.height < 12000)
  }
  const walker = document.createTreeWalker(modal ?? document.body, NodeFilter.SHOW_TEXT)
  const range = document.createRange()
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const parent = node.parentElement
    if (!node.textContent?.trim() || !parent || parent.closest("[data-tour-layer], [data-sonner-toaster]")) continue
    if (!modal && parent.closest('[role="dialog"]')) continue
    range.selectNodeContents(node)
    add(range, 1, clip)
  }
  for (const el of (modal ?? document).querySelectorAll('.border[class*="rounded"]')) {
    if (el.closest("[data-tour-layer]") || (!modal && el.closest('[role="dialog"]'))) continue
    const r = el.getBoundingClientRect()
    // Not the frame the whole page sits in.
    if (r.width * r.height >= 20000 && r.width * r.height < vw * vh * 0.4) add(el, 0.5, clip)
  }
  const sidebar = document.querySelector('[data-tour="nav"]')?.closest("aside")
  if (sidebar && !modal) add(sidebar, 2, clip)
  for (const el of document.querySelectorAll("[data-sonner-toast]")) add(el, 4, view)
  for (const el of targets) add(el, 40, view)
  if (click) add(click, 40, view)
  return out
}

function useViewport() {
  const [vp, setVp] = useState(() => ({ w: window.innerWidth, h: window.innerHeight }))
  useEffect(() => {
    const onResize = () => setVp({ w: window.innerWidth, h: window.innerHeight })
    window.addEventListener("resize", onResize)
    return () => window.removeEventListener("resize", onResize)
  }, [])
  return vp
}

function useSize<T extends HTMLElement>() {
  const ref = useRef<T>(null)
  const [size, setSize] = useState({ w: CARD_W, h: 220 })
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const observer = new ResizeObserver(() => setSize({ w: el.offsetWidth, h: el.offsetHeight }))
    observer.observe(el)
    return () => observer.disconnect()
  }, [])
  return [ref, size] as const
}

/** The guided tour: chapter cards between the acts, and a spotlight with a coach card for every step. */
export function Tour() {
  const active = useTour((s) => s.active)
  const index = useTour((s) => s.index)
  const item = active ? SCRIPT[Math.min(index, SCRIPT.length - 1)] : undefined
  useEffect(() => {
    document.documentElement.toggleAttribute("data-tour-on", active)
    return () => document.documentElement.removeAttribute("data-tour-on")
  }, [active])
  return (
    <>
      <AnimatePresence mode="wait">{item && item.kind !== "step" && <CardScreen key={item.id} item={item} index={index} />}</AnimatePresence>
      {item?.kind === "step" && <StepScreen step={item} />}
    </>
  )
}

/* ---------------------------------- Steps ---------------------------------- */

/** The card or step before or after this one. Nothing comes before the first part's card. */
const neighbor = (step: TourStep, by: -1 | 1) => {
  const i = indexOf(step.id) + by
  return SCRIPT[i] && SCRIPT[i].kind !== "intro" ? i : undefined
}

/** Stops Iris's cursor and closes the dialog or agent sheet a step left open. */
function clearStage() {
  stopPilot()
  toast.dismiss()
  if (topModal()) document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }))
  useUi.getState().setAgentOpen(false)
}

/** The visit of the part card a jump opened, so its Continue sets the part up again rather than carry on into it. */
let partJump: string | undefined

/** Opens a part's card. Its Continue sets the side and page, so parts can be played in any order. */
function openPart(chapter: ChapterId) {
  clearStage()
  useTour.getState().go(startOf(chapter))
  partJump = useTour.getState().enteredAt
}

const partBeside = (chapter: ChapterId, by: -1 | 1): ChapterId | undefined => CHAPTER_ORDER[CHAPTER_ORDER.indexOf(chapter) + by]

/** A part's number picks it, and Shift with an arrow the part before or after `chapter`. */
const partKey = (e: KeyboardEvent, chapter?: ChapterId): ChapterId | undefined => {
  if (e.metaKey || e.ctrlKey || e.altKey || e.isComposing || ownsKeys(e.target)) return undefined
  const n = Number(e.key)
  if (!e.shiftKey && Number.isInteger(n) && n >= 1 && n <= CHAPTER_ORDER.length) return CHAPTER_ORDER[n - 1]
  if (!e.shiftKey || !chapter || (e.key !== "ArrowLeft" && e.key !== "ArrowRight")) return undefined
  return partBeside(chapter, e.key === "ArrowLeft" ? -1 : 1)
}

const baseNow = () => {
  const { counters } = useStore.getState().data
  return { sg: counters.sg, inv: counters.inv, rep: counters.rep, at: new Date().toISOString() }
}

const byId = (id: string | undefined) => (id ? STEPS.find((s) => s.id === id) : undefined)

/** The step Iris is still setting up after a jump, by playing the step it needs. */
let preparing: string | undefined

/** While a jump puts the data back, every step holds still: the data under it is about to change. */
let rewinding = 0
let jumps = 0

const byIndex = (a: string, b: string) => indexOf(a) - indexOf(b)

/**
 * Puts the data back to how it was when `step` began this run, so it plays from the start with what came before it
 * still done. A step not begun this run goes back to the last one begun before it, or the reset, but only once a step
 * after it has been played: until then nothing ahead of it has touched the data.
 */
async function rewind(step: TourStep) {
  const { saved } = useTour.getState()
  const at = indexOf(step.id)
  const from = saved.includes(step.id) ? step.id : saved.some((id) => indexOf(id) > at) ? (saved.filter((id) => indexOf(id) < at).sort(byIndex).at(-1) ?? "start") : undefined
  if (from) await useStore.getState().restoreCheckpoint(from)
}

/** Switches side and rewinds for `step`. False when a later jump took over meanwhile. */
async function setUpFor(step: TourStep) {
  const run = ++jumps
  rewinding++
  try {
    const store = useStore.getState()
    if (store.workspaceId !== step.wsId) await store.setWorkspace(step.wsId)
    await rewind(step)
  } finally {
    rewinding--
  }
  return run === jumps
}

/**
 * Moves the tour to any step, back or ahead. Whatever is open closes, the data goes back to how it was when the step
 * began, the page and side follow, and the step judges only what's done from here on. A step that acts on an earlier
 * one, like a draft the question before it asked for, gets that played for the player first.
 */
async function jumpTo(index: number, push: (href: string) => void) {
  const item = SCRIPT[index]
  if (!item) return
  clearStage()
  partJump = undefined
  if (item.kind !== "step") {
    useTour.getState().go(index)
    if (item.kind === "chapter") partJump = useTour.getState().enteredAt
    return
  }
  if (!(await setUpFor(item))) return
  const { start } = useTour.getState()
  // A step played earlier in the run still holds, unless it lives in the chat, which the jump empties.
  const judge = (need: TourStep) => ({ ...contextNow(), base: need.inChat || need.startsChat || !start.at ? baseNow() : start })
  const setUp: TourStep[] = []
  for (let need = byId(item.needs); need && !need.done?.(judge(need)); need = byId(need.needs)) setUp.unshift(need)
  const href = (setUp[0] ?? item).href(contextNow())
  push(href)
  await arrivedAt(href)
  if (item.startsChat) useAgentThreads.getState().clear(item.wsId)
  useTour.getState().rebase(baseNow())
  if (setUp[0]?.startsChat) useAgentThreads.getState().clear(item.wsId)
  preparing = setUp.length ? item.id : undefined
  useTour.getState().go(index)
  if (item.inChat && !setUp[0]?.startsChat) useUi.getState().setAgentOpen(true)
  if (!setUp.length) {
    if (item.opensChat) useUi.getState().setAgentOpen(true)
    return
  }
  const at = useTour.getState().enteredAt
  // The step being left stops Iris as it unmounts, and a chat it left open has to finish closing, or Iris types into it.
  await new Promise((resolve) => window.setTimeout(resolve, 120))
  if (setUp[0].startsChat) for (let t = 0; t < 20 && document.getElementById(CHAT_COMPOSER_ID); t++) await new Promise((resolve) => window.setTimeout(resolve, 50))
  try {
    for (const need of setUp) {
      if (useTour.getState().enteredAt !== at) break
      if (need.inChat) for (let t = 0; t < 40 && !document.querySelector('[data-tour="agent-plan"]'); t++) await new Promise((resolve) => window.setTimeout(resolve, 50))
      await need.skip(contextNow(), { push, remember: (patch) => useTour.getState().remember(patch), now: contextNow })
    }
    // What the set-up saved can still be on its way; the step begins once it has all landed.
    await new Promise((resolve) => window.setTimeout(resolve, 150))
    await commandsSettled()
    if (useTour.getState().enteredAt === at) {
      toast.dismiss()
      const there = item.href(contextNow())
      if (there !== `${window.location.pathname}${window.location.search}`) {
        push(there)
        await arrivedAt(there)
      }
      if (item.opensChat && useTour.getState().enteredAt === at) useUi.getState().setAgentOpen(true)
    }
  } catch (error) {
    if (!pilotStopped(error)) throw error
  } finally {
    if (useTour.getState().enteredAt === at) preparing = undefined
  }
}

/** Enter belongs to a text box with something in it, which sends or breaks the line, and to widgets that pick with it. Otherwise it's the tour's. */
const ownsEnter = (target: EventTarget | null) =>
  target instanceof Element &&
  ((target instanceof HTMLTextAreaElement && !!target.value.trim()) ||
    !!target.closest('[data-tour-layer], [data-owns-enter], select, [contenteditable="true"], [role="menu"], [role="listbox"], [role="combobox"], [role="radiogroup"], [role="grid"]'))

/** Keys that belong to what has focus, like typing in a text field or arrows in a tab list. */
const ownsKeys = (target: EventTarget | null) =>
  target instanceof Element && !!target.closest('input, textarea, select, [contenteditable="true"], [role="tablist"], [role="radiogroup"], [role="menu"], [role="listbox"], [role="slider"], [role="grid"]')

/** Arrows in an empty text field have nothing to move through, like the chat box once Iris sent what a step asked. */
/** A tab the tour clicked keeps focus, so tabs leave the arrows to the tour. */
const ownsArrows = (target: EventTarget | null) =>
  ((target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) && !target.value) || (target instanceof Element && !!target.closest('[role="tablist"]'))
    ? false
    : ownsKeys(target)

function StepScreen({ step }: { step: TourStep }) {
  const router = useRouter()
  useStore((s) => s.data)
  useStore((s) => s.workspaceId)
  const [view, setView] = useState<{ step: string; view: View }>({ step: step.id, view: { mode: "pending" } })
  const enteredAt = useTour((s) => s.enteredAt)
  const [celebrate, setCelebrate] = useState<{ step: string; at?: string; message: string; kept: boolean }>()
  /** The visit of the step "Do it for me" is playing, and whether it's typing a screen in. */
  const [piloting, setPiloting] = useState<{ visit: string; filling: boolean }>()
  /** The visit in which the player changed something or finished the step, so Back starts it again before leaving it. */
  const [moved, setMoved] = useState<string>()
  const closing = useRef<string>(undefined)
  const leaving = useRef<string>(undefined)
  const vp = useViewport()
  const [cardRef, cardSize] = useSize<HTMLDivElement>()

  useEffect(() => {
    let raf = 0
    let finished = false
    let missingSince: number | undefined
    let awaySince: number | undefined
    let checkedAt = 0
    let ranAt = 0
    const scrolled = new WeakMap<Element, { times: number; at: number }>()
    const update = (next: View) => setView((prev) => (prev.step === step.id && sameView(prev.view, next) ? prev : { step: step.id, view: next }))
    let avoid: Obstacle[] = []
    let readAt = -Infinity
    let kept: string | undefined
    let held: Spot | undefined
    let celebrating = false
    let began = false
    let beganDone = false
    let sentBefore = 0
    let shownAt: string | undefined
    let movedOn = false
    const visit = useTour.getState().enteredAt
    const moveOn = () => {
      if (movedOn) return
      movedOn = true
      setMoved(visit)
    }
    let open: (Spot & { cost: number }) | undefined
    let dialog: Element | undefined
    let aim: Element | undefined
    /**
     * Where the card goes for these boxes. The page is read again at most every 200ms, as the card follows each frame.
     * A card with nothing to point at on screen stays where it stood. Once done, or with no room beside what it points
     * at, it takes the emptiest place near it.
     */
    const spotFor = (els: Element[], anchor: Box | undefined, ctx: TourContext, t: number): Spot => {
      const card = cardRef.current
      const size = card ? { w: card.offsetWidth, h: card.offsetHeight } : { w: CARD_W, h: 220 }
      const vw = window.innerWidth
      const vh = window.innerHeight
      if (t - readAt > 200) {
        readAt = t
        const modal = topModal()
        avoid = obstacles(modal, handedOff() ?? nextClick(step, ctx), els)
        open = undefined
        // In a dialog, the card stands outside it so the dialog stays readable. Beside a target holding the button it asks for, it points at the button.
        const button = handedOff() ?? step.clicks?.(ctx)
        dialog = modal && els[0] && modal.contains(els[0]) && !anchor ? modal : undefined
        aim = button && els[0] && button !== els[0] && els[0].contains(button) && button.getClientRects().length > 0 ? button : undefined
      }
      const boxes = els.map(boxOf)
      const button = aim?.isConnected ? boxOf(aim) : boxes[0]
      const around = anchor ?? (dialog?.isConnected ? boxOf(dialog) : undefined) ?? boxes[0]
      const shown = around && onScreen(around, vw, vh) ? around : undefined
      const openNow = () => (open ??= openSpot(size, vw, vh, shown ?? (held && { ...held, ...size }), avoid, kept))
      const extra = celebrating ? openNow() : undefined
      // Beside what's around the button, pointing at it; at a composer holding it, whichever of the two hides less. Failing that,
      // at what the step is about, then right beside the button.
      const beside = (by: Box | undefined, focus: Box | undefined, tag = "") =>
        (by && focus && onScreen(by, vw, vh) && place(by, size, step.placement, vw, vh, focus, avoid, kept, extra, by === focus ? Infinity : REACH, tag)) || undefined
      const atButton = beside(shown, button)
      // Level with the button, on the target's edge.
      const row = { x: boxes[0]?.x ?? 0, w: boxes[0]?.w ?? 0, y: button?.y ?? 0, h: button?.h ?? 0 }
      const atTarget = button !== boxes[0] ? beside(shown, row, "target:") : undefined
      const composer = !!els[0]?.matches('[data-slot="input-group"]')
      const spot =
        (composer ? cheapest([atButton, atTarget && { ...atTarget, cost: atTarget.cost + 1500 }].filter((s) => !!s), kept) : atButton) ??
        atTarget ??
        (shown !== button ? beside(button, button) : undefined) ??
        (shown || celebrating ? openNow() : held && { x: held.x, y: held.y, key: held.key }) ??
        centered(size, vw, vh)
      kept = spot.key
      held = spot
      return spot
    }
    /** Once done, the card keeps pointing at the target while that hides little, and otherwise sits near it. */
    const follow = (t: number) => {
      const ctx = contextNow()
      const modal = topModal()
      const els = step.targets(ctx).filter((el): el is Element => !!el && el.getClientRects().length > 0 && (!modal || modal.contains(el)))
      const spot = spotFor(els, undefined, ctx, t)
      update(els.length ? { mode: "ready", boxes: els.map(boxOf), modal: !!modal, copy: "", spot } : { mode: "pending", spot })
    }

    const tick = () => {
      const t = performance.now()
      ranAt = t
      if (finished) {
        if (celebrating) follow(t)
        return
      }
      if (preparing === step.id || rewinding) return update({ mode: "preparing" })
      const ctx = contextNow()
      if (t - checkedAt > 120) {
        checkedAt = t
        const done = !!step.done?.(ctx)
        // Where the step begins, for a jump back to it, once what came before has landed. Not once it's done: that's where it ends.
        if (!began && !commandsInFlight()) {
          began = true
          beganDone = done
          sentBefore = commandsSent()
          if (!done) {
            useTour.getState().kept(step.id)
            void useStore.getState().saveCheckpoint(step.id)
          }
        }
        if (began && commandsSent() > sentBefore) moveOn()
        if (done) {
          if (began && !beganDone) moveOn()
          finished = true
          celebrating = true
          closing.current = useTour.getState().enteredAt
          readAt = -Infinity
          // Already done on arrival, like a step jumped back to: the card still has to point at it.
          follow(t)
          setCelebrate({ step: step.id, at: useTour.getState().enteredAt, message: step.success?.(ctx) ?? "Done", kept: !!step.targets(ctx)[0]?.isConnected })
          return
        }
      }
      if (ctx.wsId !== step.wsId || !step.path.test(ctx.path)) {
        awaySince ??= t
        if (t - awaySince > GRACE) update({ mode: "away" })
        return
      }
      awaySince = undefined
      const els = step.targets(ctx).filter((el): el is Element => !!el && el.getClientRects().length > 0)
      const primary = els[0]
      if (!primary) {
        missingSince ??= t
        if (step.back && t - missingSince > GIVE_UP) {
          finished = true
          useTour.getState().go(indexOf(step.back))
          return
        }
        if (t - missingSince > GRACE) update({ mode: "lost", spot: held })
        return
      }
      missingSince = undefined
      if (!primary.hasAttribute("data-tour-target")) {
        document.querySelectorAll("[data-tour-target]").forEach((el) => el.removeAttribute("data-tour-target"))
        primary.setAttribute("data-tour-target", "")
      }
      // A second try once the page settles, for targets that moved while content above them was still opening.
      const tried = scrolled.get(primary) ?? { times: 0, at: 0 }
      if (tried.times === 0 || (tried.times === 1 && t - tried.at > 900)) {
        scrolled.set(primary, { times: tried.times + 1, at: t })
        if (!inView(primary)) primary.scrollIntoView({ block: "center", behavior: "smooth" })
      }
      const modal = topModal()
      if (modal && !modal.contains(primary)) return update({ mode: "paused" })
      const anchor = step.anchor?.()
      const copy = [titleOf(step, ctx), text(step.body, ctx), text(step.action, ctx), handedOff()?.textContent, step.fill?.when(ctx)].join("|")
      const around = anchor ? boxOf(anchor) : undefined
      const url = `${window.location.pathname}${window.location.search}`
      shownAt ??= url
      if (url !== shownAt) moveOn()
      update({ mode: "ready", boxes: els.map(boxOf), anchor: around, modal: !!modal, copy, spot: spotFor(els, around, ctx, t) })
    }

    const frame = () => {
      raf = requestAnimationFrame(frame)
      tick()
    }
    raf = requestAnimationFrame(frame)
    // Browsers stop animation frames for tabs they aren't painting; the steps still need to notice what the player did.
    const fallback = window.setInterval(() => {
      if (performance.now() - ranAt > 200) tick()
    }, 200)
    return () => {
      cancelAnimationFrame(raf)
      window.clearInterval(fallback)
      document.querySelectorAll("[data-tour-target]").forEach((el) => el.removeAttribute("data-tour-target"))
      stopPilot()
    }
  }, [step, router, cardRef, enteredAt])

  const ctx = contextNow()
  const mine = view.step === step.id
  const mode = mine ? view.view.mode : "pending"
  const party = celebrate?.step === step.id && celebrate.at === enteredAt ? celebrate : undefined
  const done = party?.message
  const showCard = mode === "ready" || mode === "lost" || mode === "preparing" || !!party
  const pos = (mine ? spotOf(view.view) : undefined) ?? place(undefined, cardSize, step.placement, vp.w, vp.h) ?? centered(cardSize, vp.w, vp.h)

  const api: TourApi = { push: (href) => router.push(href), remember: (patch) => useTour.getState().remember(patch), now: contextNow }
  /** Moves on to the next step once the page the step sends the player to has loaded, so that step starts there. */
  const finish = async (how: "done" | "skipped") => {
    const at = useTour.getState().enteredAt
    if (leaving.current === at) return
    leaving.current = at
    let to: string | undefined
    step.onDone?.(contextNow(), {
      ...api,
      push: (href) => {
        to = href
        router.push(href)
      },
    })
    // A step that doesn't say where the next one starts still lands the player there, on an empty chat if it starts from one.
    const next = SCRIPT[indexOf(step.id) + 1]
    const now = contextNow()
    if (!to && next?.kind === "step" && (next.startsChat || now.wsId !== next.wsId || !next.path.test(now.path))) {
      if (now.wsId !== next.wsId) await useStore.getState().setWorkspace(next.wsId)
      if (next.startsChat) useAgentThreads.getState().clear(next.wsId)
      to = next.href(contextNow())
      router.push(to)
    }
    if (next?.kind === "step" && !next.inChat && !next.startsChat) useUi.getState().setAgentOpen(false)
    if (to) await arrivedAt(to)
    if (useTour.getState().enteredAt !== at) return
    if (next?.kind === "step" && next.opensChat) useUi.getState().setAgentOpen(true)
    useTour.getState().finish(step.id, how)
  }
  const visit = enteredAt
  const flying = piloting?.visit === visit
  const handoff = mine && mode === "ready" ? handedOff() : undefined
  const canAdvance = mode === "ready" && (!!handoff || !!step.fill?.when(ctx) || !!nextClick(step, ctx))
  const act = async () => {
    setPiloting({ visit, filling: !handedOff() && !!step.fill?.when(contextNow()) })
    try {
      await advance(step, contextNow(), api)
    } catch (error) {
      if (!pilotStopped(error)) throw error
    } finally {
      setPiloting((p) => (p?.visit === visit ? undefined : p))
    }
  }
  const skip = async () => {
    setPiloting({ visit, filling: false })
    try {
      await step.skip(contextNow(), api)
      // The server confirms what was done a moment later. Give the step that long to notice and show its success.
      const until = performance.now() + (step.done ? 3000 : 300)
      while (performance.now() < until && closing.current !== visit && useTour.getState().enteredAt === visit) await new Promise((resolve) => window.setTimeout(resolve, 100))
    } catch (error) {
      if (!pilotStopped(error)) throw error
      return
    } finally {
      setPiloting((p) => (p?.visit === visit ? undefined : p))
    }
    if (useTour.getState().enteredAt !== visit || closing.current === visit) return
    await finish("skipped")
  }
  const goThere = () => {
    const now = contextNow()
    if (now.wsId !== step.wsId) useStore.getState().setWorkspace(step.wsId)
    router.push(step.href(now))
  }

  const pointer = mode === "ready" && pos.edge && pos.at !== undefined && !(party && !party.kept)
  const jump = (index: number | undefined) => index !== undefined && void jumpTo(index, router.push)
  const again = moved === visit
  const back = again ? indexOf(step.id) : neighbor(step, -1)
  const ahead = () => (done ? void finish("done") : jump(neighbor(step, 1)))
  const handoffLabel = handoff?.textContent?.trim() || handoff?.getAttribute("aria-label") || undefined
  /** What the card's main button does right now, for Enter. */
  const primary =
    !mine || flying
      ? undefined
      : party || (mode === "ready" && !handoffLabel && !text(step.action, ctx) && !step.example)
        ? () => void finish("done")
        : mode === "lost"
          ? () => void skip()
          : canAdvance
            ? () => void act()
            : mode === "away"
              ? goThere
              : undefined
  /** While the card shows, Enter is the tour's even with nothing to press, so it can't reach a button on the page. */
  const holdsEnter = mine && (showCard || mode === "away")
  const keys = useRef({ back: () => jump(back), ahead, primary, holdsEnter, chapter: step.chapter })
  useEffect(() => {
    keys.current = { back: () => jump(back), ahead, primary, holdsEnter, chapter: step.chapter }
  })
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Enter") {
        if (e.metaKey || e.ctrlKey || e.altKey || e.shiftKey || e.isComposing || ownsEnter(e.target) || !keys.current.holdsEnter) return
        e.preventDefault()
        e.stopPropagation()
        if (!e.repeat) keys.current.primary?.()
        return
      }
      const part = partKey(e, keys.current.chapter)
      if (part) {
        e.preventDefault()
        if (!e.repeat) openPart(part)
        return
      }
      if ((e.key !== "ArrowLeft" && e.key !== "ArrowRight") || e.metaKey || e.ctrlKey || e.altKey || e.shiftKey || ownsArrows(e.target)) return
      e.preventDefault()
      if (e.key === "ArrowLeft") keys.current.back()
      else keys.current.ahead()
    }
    // Capturing, so Enter reaches the tour before a focused button or tab on the page acts on it.
    window.addEventListener("keydown", onKey, true)
    return () => window.removeEventListener("keydown", onKey, true)
  }, [])

  return (
    <>
      <motion.div
        ref={cardRef}
        data-tour-layer
        onPointerDown={stop}
        className="fixed top-0 left-0 z-[60] w-[340px] max-w-[calc(100vw-24px)]"
        initial={{ opacity: 0, x: pos.x, y: pos.y + 10 }}
        animate={{ opacity: showCard && mine ? 1 : 0, x: pos.x, y: pos.y }}
        transition={SPRING}
        style={{ pointerEvents: showCard && mine ? "auto" : "none" }}
      >
        {pointer && <Pointer edge={pos.edge!} at={pos.at!} />}
        <StepCard
          step={step}
          ctx={ctx}
          mode={mode}
          done={done}
          flying={flying}
          filling={flying && !!piloting?.filling}
          handoff={handoffLabel}
          canAdvance={canAdvance}
          canBack={back !== undefined}
          again={again}
          onNext={() => void finish("done")}
          onAdvance={() => void act()}
          onSkip={() => void skip()}
          onBack={() => jump(back)}
          onAhead={ahead}
          onJump={jump}
        />
      </motion.div>
      <AnimatePresence>{mine && mode === "away" && <PausedPill step={step} ctx={ctx} onResume={goThere} />}</AnimatePresence>
    </>
  )
}

/** A small notch on the card's edge, aimed at what the step is about. */
function Pointer({ edge, at }: { edge: Placement; at: number }) {
  const style: React.CSSProperties =
    edge === "top"
      ? { top: -5, left: at - 6 }
      : edge === "bottom"
        ? { bottom: -5, left: at - 6 }
        : edge === "left"
          ? { left: -5, top: at - 6 }
          : { right: -5, top: at - 6 }
  return <span aria-hidden className="absolute size-3 rotate-45 rounded-[2px] bg-foreground transition-[top,left] duration-200" style={style} />
}

/** Shown instead of the card when the player wanders off the step's page or side, so the page stays theirs. */
function PausedPill({ step, ctx, onResume }: { step: TourStep; ctx: TourContext; onResume: () => void }) {
  const meta = CHAPTERS[step.chapter]
  const ws = workspace(step.wsId)
  return (
    <motion.div
      data-tour-layer
      onPointerDown={stop}
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: 12, transition: { duration: 0.12 } }}
      transition={{ duration: 0.22, ease: EASE }}
      className="fixed inset-x-0 bottom-5 z-[60] mx-auto flex w-fit max-w-[calc(100vw-24px)] items-center gap-3 rounded-full bg-foreground py-1.5 pr-1.5 pl-4 text-background shadow-overlay"
      role="status"
    >
      <span className="flex items-center gap-2 text-[13px] whitespace-nowrap">
        <span className="font-semibold">Tour paused</span>
        <span className="text-background/55">
          {meta.short} continues on {pageOf(step.href(ctx))} as
        </span>
        <SideBadge kind={ws.kind} onDark size="sm" />
      </span>
      <CardButton onClick={onResume}>
        Resume <ArrowRight className="size-3.5" />
      </CardButton>
      <button
        type="button"
        onClick={() => useTour.getState().exit()}
        aria-label="Exit tour"
        className="flex size-7 items-center justify-center rounded-full text-background/50 transition-colors outline-none hover:bg-background/10 hover:text-background focus-visible:ring-2 focus-visible:ring-brand/60"
      >
        <X className="size-4" />
      </button>
    </motion.div>
  )
}

function StepCard({
  step,
  ctx,
  mode,
  done,
  flying,
  filling,
  handoff,
  canAdvance,
  canBack,
  again,
  onNext,
  onAdvance,
  onSkip,
  onBack,
  onAhead,
  onJump,
}: {
  step: TourStep
  ctx: TourContext
  mode: View["mode"]
  done?: string
  flying: boolean
  filling: boolean
  /** The label of the button Iris left for the player after filling the screen in. */
  handoff?: string
  canAdvance: boolean
  canBack: boolean
  /** Back starts this step again, since it moved on from how it began. */
  again: boolean
  onNext: () => void
  onAdvance: () => void
  onSkip: () => void
  onBack: () => void
  onAhead: () => void
  onJump: (index: number) => void
}) {
  const meta = CHAPTERS[step.chapter]
  const Icon = meta.icon
  const action = handoff ? `Click ${handoff}` : text(step.action, ctx)
  const following = SCRIPT[indexOf(step.id) + 1]
  const wrapsChapter = !following || following.kind === "finale" || (following.kind === "chapter" && following.chapter !== step.chapter)
  const title = titleOf(step, ctx)
  const body = text(step.body, ctx)
  const status = step.status?.(ctx)
  const example = step.example?.(ctx)
  const lost = mode === "lost"
  const preparing = mode === "preparing"
  const [parts, setParts] = useState(false)
  const played = useTour((s) => s.done)

  return (
    <div
      role="dialog"
      aria-label={`Guided tour: ${title}`}
      className="overflow-hidden rounded-2xl bg-foreground text-background shadow-overlay ring-1 ring-black/10 dark:ring-white/10"
    >
      <div className="flex items-center gap-2 pt-3 pr-2 pl-4">
        <span className="flex min-w-0 flex-1">
          <button
            type="button"
            onClick={() => setParts((v) => !v)}
            aria-expanded={parts}
            className="-ml-1.5 flex min-w-0 items-center gap-1.5 rounded-md px-1.5 py-0.5 text-[12px] font-medium whitespace-nowrap text-background/60 transition-colors outline-none hover:bg-background/10 hover:text-background focus-visible:ring-2 focus-visible:ring-brand/60"
          >
            <Icon className="size-3.5 shrink-0 text-brand dark:text-brand-foreground" strokeWidth={2.2} />
            <span className="truncate">{meta.short}</span>
            <ChevronDown className={cn("size-3 shrink-0 transition-transform", parts && "rotate-180")} />
          </button>
        </span>
        <SideBadge kind={workspace(step.wsId).kind} onDark size="sm" />
        <button
          type="button"
          onClick={() => useTour.getState().exit()}
          aria-label="Exit tour"
          className="flex size-7 shrink-0 items-center justify-center rounded-md text-background/50 transition-colors outline-none hover:bg-background/10 hover:text-background focus-visible:ring-2 focus-visible:ring-brand/60"
        >
          <X className="size-4" />
        </button>
      </div>

      {/* Swapped at once rather than after an exit: a page mid-navigation can hold an exit open and leave the old step on screen. */}
        {parts ? (
          <PartList
            dark
            initial={step.chapter}
            here={step.id}
            played={played}
            onStep={(s) => {
              setParts(false)
              if (s.id !== step.id) onJump(indexOf(s.id))
            }}
          />
        ) : done ? (
          <motion.div
            key="done"
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.22, ease: EASE }}
            className="flex items-center gap-3 px-4 pt-3 pb-1"
          >
            <motion.span
              initial={{ scale: 0.4, rotate: -20 }}
              animate={{ scale: 1, rotate: 0 }}
              transition={{ type: "spring", stiffness: 520, damping: 20 }}
              className="flex size-10 shrink-0 items-center justify-center rounded-full bg-brand text-brand-foreground"
            >
              <Check className="size-5" strokeWidth={3} />
            </motion.span>
            <span className="flex min-w-0 flex-col">
              <span className="text-[16px] leading-snug font-semibold">{done}</span>
              {wrapsChapter && <span className="text-[12.5px] text-background/55">{meta.label} complete</span>}
            </span>
          </motion.div>
        ) : (
          <motion.div key={step.id} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.22, ease: EASE }}>
            <h2 className="px-4 pt-2 text-[17px] leading-snug font-semibold tracking-[-0.01em] text-balance">{title}</h2>
            {body && <p className="px-4 pt-1 text-[13.5px] leading-relaxed text-pretty text-background/70">{body}</p>}
            {example && <Example text={example} />}
            {status && (
              <p className="mx-4 mt-3 inline-flex items-center gap-2 rounded-lg bg-background/[0.08] px-2.5 py-1.5 text-[12.5px] font-medium tabular">
                <span className="size-1.5 animate-live rounded-full bg-brand" />
                {status}
              </p>
            )}
            {filling || preparing ? (
              <p className="flex items-center gap-2 px-4 pt-3 text-[12.5px] font-medium text-brand dark:text-brand-foreground">
                <WandSparkles className="size-3.5 shrink-0 animate-pulse" />
                {preparing ? "Iris is setting it up" : "Iris is filling it in"}
              </p>
            ) : (
              !lost &&
              action && (
              <p className="flex items-center gap-2 px-4 pt-3 text-[12.5px] font-medium text-brand dark:text-brand-foreground">
                <ArrowRight className="size-3.5 shrink-0" />
                {action}
              </p>
              )
            )}
          </motion.div>
        )}

      <div className="flex items-center gap-3 px-4 pt-3.5 pb-3.5">
        <span className="-ml-1.5 flex items-center gap-1">
          <StepArrow label={again ? "Start this step again" : "Previous step"} disabled={!canBack} onClick={onBack}>
            <ChevronLeft className="size-4" />
          </StepArrow>
          <PartBars chapter={step.chapter} stepId={step.id} onStep={(s) => s.id !== step.id && onJump(indexOf(s.id))} />
          <StepArrow label={done ? "Next" : "Skip to the next step"} onClick={onAhead}>
            <ChevronRight className="size-4" />
          </StepArrow>
        </span>
        <span className="ml-auto flex items-center gap-1">
          {flying || preparing ? null : done || (!action && !step.example) ? (
            <CardButton onClick={onNext}>
              Next <ArrowRight className="size-3.5" />
            </CardButton>
          ) : lost ? (
            <CardButton onClick={onSkip} pilot>
              Do it for me <ArrowRight className="size-3.5" />
            </CardButton>
          ) : (
            canAdvance && (
              <CardButton onClick={onAdvance} pilot>
                <MousePointerClick className="size-3.5" /> Do it for me
              </CardButton>
            )
          )}
        </span>
      </div>
    </div>
  )
}

function Example({ text }: { text: string }) {
  return (
    <div className="mx-4 mt-3 rounded-xl bg-background/[0.07] p-3 ring-1 ring-background/10">
      <p className="text-[13px] leading-snug text-background/90">“{text}”</p>
    </div>
  )
}

function CardButton({ onClick, pilot, children }: { onClick: () => void; /** Iris's cursor sets off from here. */ pilot?: boolean; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      data-tour-do={pilot ? "" : undefined}
      className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-lg bg-brand px-3 text-[13px] whitespace-nowrap font-semibold text-brand-foreground transition-transform outline-none hover:-translate-y-px focus-visible:ring-2 focus-visible:ring-brand/60 active:translate-y-0"
    >
      {children}
    </button>
  )
}

function StepArrow({ label, disabled, onClick, children }: { label: string; disabled?: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      title={label}
      className="flex size-6 items-center justify-center rounded-md text-background/50 transition-colors outline-none hover:bg-background/10 hover:text-background focus-visible:ring-2 focus-visible:ring-brand/60 disabled:pointer-events-none disabled:opacity-30"
    >
      {children}
    </button>
  )
}

/** How wide each step's segment is in the part being played, so a part's bar stays about the same length however many steps it has. */
const segmentWidth = (steps: number) => (steps === 1 ? 40 : Math.max(5, Math.round((40 - 2 * (steps - 1)) / steps)))

/**
 * One bar per part, each a way into it. The part being played is split into its steps, each a way to that step, and
 * fills as they go by.
 */
function PartBars({
  chapter,
  stepId,
  light,
  onStep,
}: {
  chapter: ChapterId
  stepId?: string
  /** On a light card rather than the dark step card. */
  light?: boolean
  onStep: (step: TourStep) => void
}) {
  const at = CHAPTER_ORDER.indexOf(chapter)
  const before = light ? "bg-foreground/40 group-hover/part:bg-foreground/60" : "bg-brand"
  const after = light ? "bg-foreground/15 group-hover/part:bg-foreground/35" : "bg-background/20 group-hover/part:bg-background/45"
  const tip = cn("z-[70] font-medium", !light && "bg-background text-foreground [&_svg]:bg-background [&_svg]:fill-background")
  return (
    <span className="flex items-center" role="group" aria-label="Parts">
      {CHAPTER_ORDER.map((id, c) => {
        const part = CHAPTERS[id]
        if (id === chapter) {
          const steps = STEPS.filter((x) => x.chapter === id)
          const current = steps.findIndex((x) => x.id === stepId)
          const width = segmentWidth(steps.length)
          return (
            <span key={id} className="flex items-center px-[3px]" role="group" aria-label={`Part ${part.number}: ${part.label}`}>
              {steps.map((x, i) => (
                <Tooltip key={x.id}>
                  <TooltipTrigger asChild>
                    <button
                      type="button"
                      onClick={() => onStep(x)}
                      aria-label={`Step ${i + 1} of ${steps.length}: ${x.label}`}
                      aria-current={i === current ? "step" : undefined}
                      data-tour-step-bar={x.id}
                      className={cn("group/step flex h-6 items-center rounded-md px-px outline-none focus-visible:ring-2 focus-visible:ring-brand/60", i === current && "cursor-default")}
                    >
                      <span
                        style={{ width }}
                        className={cn(
                          "rounded-full transition-[height,background-color] duration-150",
                          i === current ? "h-1.5" : "h-1 group-hover/step:h-1.5",
                          light
                            ? "bg-foreground/80 group-hover/step:bg-foreground"
                            : i <= current
                              ? "bg-brand"
                              : "bg-background/25 group-hover/step:bg-background/55",
                        )}
                      />
                    </button>
                  </TooltipTrigger>
                  <TooltipContent side="top" sideOffset={6} className={tip}>
                    <span className="tabular opacity-55">
                      {i + 1}/{steps.length}
                    </span>
                    {x.label}
                  </TooltipContent>
                </Tooltip>
              ))}
            </span>
          )
        }
        return (
          <Tooltip key={id}>
            <TooltipTrigger asChild>
              <button
                type="button"
                onClick={() => openPart(id)}
                aria-label={`Part ${part.number}: ${part.label}`}
                className="group/part flex h-6 items-center rounded-md px-px outline-none focus-visible:ring-2 focus-visible:ring-brand/60"
              >
                <span className={cn("h-1 w-2 rounded-full transition-[height,background-color] group-hover/part:h-1.5", c < at ? before : after)} />
              </button>
            </TooltipTrigger>
            <TooltipContent side="top" sideOffset={6} className={tip}>
              <span className="tabular opacity-55">0{part.number}</span>
              {part.label}
            </TooltipContent>
          </Tooltip>
        )
      })}
    </span>
  )
}

/* ---------------------------------- Cards ---------------------------------- */

/** The demo reset Start kicks off. The first part card shows while it runs, and its Continue waits for it. */
let resetting: Promise<void> | undefined

function CardScreen({ item, index }: { item: Exclude<TourItem, TourStep>; index: number }) {
  const router = useRouter()
  const exit = () => useTour.getState().exit()

  const [starting, setStarting] = useState<string>()

  /** Resets the demo and opens the tour at `at`, or at the first part. */
  const start = (at?: number) => {
    useAgentThreads.setState({ threads: {} })
    useUi.setState({ welcomeSeen: { buyer: true, supplier: true, compass: true }, agentOpen: false })
    useTour.getState().begin(baseNow(), at)
    resetting = useStore
      .getState()
      .resetDemo()
      .then(() => useTour.getState().restart(baseNow()))
      .finally(() => {
        resetting = undefined
      })
  }

  /** Starts at a step. The first step of a part starts at its card, which sets the side. */
  const startAt = async (step: TourStep) => {
    if (STEPS.find((s) => s.chapter === step.chapter) === step) return start(startOf(step.chapter))
    setStarting(step.id)
    start(index)
    await resetting
    await jumpTo(indexOf(step.id), router.push)
  }

  const play = async (chapter: TourChapter) => {
    await resetting
    const jumped = partJump === useTour.getState().enteredAt
    partJump = undefined
    const first = SCRIPT[index + 1]
    if (jumped && first?.kind === "step" && !(await setUpFor(first))) return
    const store = useStore.getState()
    const switching = store.workspaceId !== chapter.wsId ? store.setWorkspace(chapter.wsId) : undefined
    useAgentThreads.getState().clear(chapter.wsId)
    useUi.getState().setAgentOpen(false)
    toast.dismiss()
    await switching
    const href = typeof chapter.href === "string" ? chapter.href : chapter.href(contextNow())
    router.push(href)
    // The part's first step must not judge the page being left: its sheet or labels can look like that step done.
    await arrivedAt(href)
    if (first?.kind === "step" && first.opensChat) useUi.getState().setAgentOpen(true)
    useTour.getState().go(index + 1)
  }

  /** From a part's card to one of its steps. The first is the card's own Continue. */
  const toStep = async (step: TourStep) => {
    if (item.kind !== "chapter") return
    if (STEPS.find((s) => s.chapter === step.chapter) === step) return play(item)
    await resetting
    await jumpTo(indexOf(step.id), router.push)
  }

  /** The step before this card, or the part card before the finale. The first part's card has none. */
  const before = index > 1 && item.kind !== "intro" ? index - 1 : undefined
  const back = async () => {
    if (before === undefined) return
    await resetting
    await jumpTo(before, router.push)
  }

  const primary = useRef<() => void>(undefined)
  const previous = useRef<() => void>(undefined)
  useEffect(() => {
    primary.current = item.kind === "intro" ? () => start() : item.kind === "chapter" ? () => void play(item) : exit
    previous.current = before === undefined ? undefined : () => void back()
  })
  useEffect(() => {
    useUi.getState().setAgentOpen(false)
  }, [item.id])
  useEffect(() => {
    const here = item.kind === "chapter" ? item.chapter : undefined
    const onKey = (e: KeyboardEvent) => {
      if (item.kind !== "intro" && !e.repeat) {
        const part = partKey(e, here)
        if (part) {
          e.preventDefault()
          e.stopPropagation()
          openPart(part)
          return
        }
        if ((e.key === "ArrowLeft" || e.key === "ArrowRight") && !e.shiftKey && !e.metaKey && !e.ctrlKey && !e.altKey && !ownsArrows(e.target)) {
          e.preventDefault()
          e.stopPropagation()
          if (e.key === "ArrowLeft") previous.current?.()
          else if (item.kind === "chapter") primary.current?.()
          return
        }
      }
      if (e.key !== "Enter" || e.metaKey || e.ctrlKey || e.altKey || e.shiftKey || e.repeat || e.isComposing) return
      if (e.target instanceof Element && e.target.closest("[data-tour-layer]")) return
      e.preventDefault()
      e.stopPropagation()
      primary.current?.()
    }
    window.addEventListener("keydown", onKey, true)
    return () => window.removeEventListener("keydown", onKey, true)
  }, [item])

  return (
    <motion.div
      data-tour-layer
      onPointerDown={stop}
      className="fixed inset-0 z-[60] flex items-center justify-center overflow-y-auto bg-[rgb(18_16_13/0.22)] p-4 dark:bg-black/45"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0, transition: { duration: 0.12 } }}
      transition={{ duration: 0.2 }}
      style={{ pointerEvents: "auto" }}
    >
      <motion.div
        role="dialog"
        aria-modal="true"
        aria-labelledby="tour-card-title"
        data-tour-layer
        className="w-full max-w-[540px] overflow-hidden rounded-[22px] bg-card text-card-foreground shadow-overlay ring-1 ring-border"
        initial={{ opacity: 0, y: 18, scale: 0.97 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: -6, scale: 0.98, transition: { duration: 0.12 } }}
        transition={{ duration: 0.28, ease: EASE }}
      >
        {item.kind === "intro" && <IntroCard onStart={() => start()} onStartAt={(step) => void startAt(step)} starting={starting} onClose={exit} />}
        {item.kind === "chapter" && <ChapterCard item={item} onPlay={() => play(item)} onBack={before === undefined ? undefined : () => void back()} onExit={exit} onStep={(step) => void toStep(step)} />}
        {item.kind === "finale" && <FinaleCard onReplay={() => useTour.getState().open()} onBack={() => void back()} onClose={exit} />}
      </motion.div>
    </motion.div>
  )
}

function Glow() {
  return (
    <>
      <div aria-hidden className="pointer-events-none absolute inset-0 bg-dotted opacity-60 [mask-image:radial-gradient(ellipse_at_100%_0%,black,transparent_70%)] dark:opacity-30" />
      <div aria-hidden className="pointer-events-none absolute -top-24 -right-20 size-64 rounded-full bg-brand/30 blur-3xl dark:bg-brand/10" />
    </>
  )
}

function IntroCard({ onStart, onStartAt, starting, onClose }: { onStart: () => void; onStartAt: (step: TourStep) => void; starting?: string; onClose: () => void }) {
  return (
    <>
      <div className="relative overflow-hidden px-7 pt-7 pb-5">
        <Glow />
        <h2 id="tour-card-title" className="relative font-heading text-[28px] leading-[1.15] font-semibold tracking-tight">
          Guided demo
        </h2>
      </div>
      <div className="mx-7">
        <PartList busy={starting} onStep={onStartAt} />
      </div>
      <div className="flex items-center justify-end gap-2 px-7 pt-5 pb-6">
        <Button variant="ghost" className="h-9 rounded-lg" onClick={onClose}>
          Not now
        </Button>
        <Button className="h-9 gap-1.5 rounded-lg px-3.5" onClick={onStart} autoFocus>
          Play all <ArrowRight className="size-4" />
        </Button>
      </div>
    </>
  )
}

/** The parts, each opening onto its steps. Any step starts the tour there. */
function PartList({
  dark,
  initial,
  here,
  played = [],
  busy,
  onStep,
}: {
  /** On the dark step card rather than the light start card. */
  dark?: boolean
  initial?: ChapterId
  here?: string
  played?: string[]
  busy?: string
  onStep: (step: TourStep) => void
}) {
  const [open, setOpen] = useState<ChapterId | undefined>(initial)
  return (
    <ul className={cn("flex flex-col", dark ? "px-2 pt-2" : "divide-y divide-border overflow-hidden rounded-xl border border-border")} aria-label="Parts">
      {CHAPTER_ORDER.map((id) => {
        const c = CHAPTERS[id]
        const expanded = open === id
        const steps = STEPS.filter((s) => s.chapter === id)
        return (
          <li key={id}>
            <button
              type="button"
              onClick={() => setOpen(expanded ? undefined : id)}
              aria-expanded={expanded}
              data-tour-part={id}
              className={cn(
                "flex w-full items-center text-left font-medium transition-colors outline-none",
                dark
                  ? cn("gap-2.5 rounded-lg px-2 py-1.5 text-[13.5px] hover:bg-background/10 focus-visible:bg-background/10", expanded ? "text-background" : "text-background/70")
                  : "gap-3 px-4 py-2.5 text-[14px] font-semibold hover:bg-hover focus-visible:bg-hover",
              )}
            >
              <c.icon className={cn("shrink-0", dark ? "size-3.5 text-background/50" : "size-[18px] text-muted-foreground")} strokeWidth={dark ? 2.2 : 1.9} />
              {c.label}
              <ChevronDown className={cn("ml-auto size-3.5 shrink-0 transition-transform", dark ? "text-background/45" : "text-subtle", expanded && "rotate-180")} />
            </button>
            {expanded && (
              <ol
                className={cn(steps.length > 4 ? "grid grid-flow-col grid-cols-2 gap-x-1" : "flex flex-col", dark ? "mb-1 ml-[15px] border-l border-background/15 pl-1.5" : "pb-2 pl-[42px] pr-2")}
                style={steps.length > 4 ? { gridTemplateRows: `repeat(${Math.ceil(steps.length / 2)}, auto)` } : undefined}
                aria-label="Steps"
              >
                {steps.map((s) => {
                  const current = s.id === here
                  return (
                    <li key={s.id}>
                      <button
                        type="button"
                        onClick={() => onStep(s)}
                        disabled={!!busy}
                        aria-current={current ? "step" : undefined}
                        data-tour-jump={s.id}
                        className={cn(
                          "group flex w-full items-center gap-2 rounded-md text-left transition-colors outline-none",
                          dark
                            ? cn("px-2 py-1 text-[12.5px] hover:bg-background/10 focus-visible:bg-background/10", current ? "bg-background/10 font-semibold text-background" : "text-background/60")
                            : "px-2 py-1.5 text-[13.5px] text-muted-foreground hover:bg-hover hover:text-foreground focus-visible:bg-hover disabled:opacity-60",
                        )}
                      >
                        {dark && played.includes(s.id) ? (
                          <Check className="size-3 shrink-0 text-brand dark:text-brand-foreground" strokeWidth={3} />
                        ) : (
                          <span className={cn("mx-[3px] size-1.5 shrink-0 rounded-full", current ? "bg-brand" : dark ? "bg-background/30" : "bg-foreground/20")} />
                        )}
                        {s.label}
                        {!dark && (
                          <span className={cn("ml-auto items-center gap-1 text-[12.5px] font-medium text-foreground", busy === s.id ? "flex" : "hidden group-hover:flex group-focus-visible:flex")}>
                            {busy === s.id ? "Starting" : "Play"} <ArrowRight className="size-3.5" />
                          </span>
                        )}
                      </button>
                    </li>
                  )
                })}
              </ol>
            )}
          </li>
        )
      })}
    </ul>
  )
}

function ChapterCard({
  item,
  onPlay,
  onBack,
  onExit,
  onStep,
}: {
  item: TourChapter
  onPlay: () => void
  /** To the step before this card. None on the first part's card. */
  onBack?: () => void
  onExit: () => void
  onStep: (step: TourStep) => void
}) {
  const meta = CHAPTERS[item.chapter]
  const ws = workspace(item.wsId)
  const side = SIDES[ws.kind]
  return (
    <>
      <div className="relative overflow-hidden px-7 pt-7 pb-5">
        <Glow />
        <span className="relative z-10 -my-1 flex items-center justify-between gap-3 text-[12px] font-medium text-muted-foreground">
          Part {meta.number} of {CHAPTER_ORDER.length}
          <PartBars chapter={item.chapter} light onStep={onStep} />
        </span>
        <h2 id="tour-card-title" className="relative mt-1.5 font-heading text-[32px] leading-[1.1] font-semibold tracking-[-0.02em] text-balance">
          {item.title}
        </h2>
        <p className="relative mt-2 text-[15px] leading-snug text-pretty text-muted-foreground">{item.shows}</p>
      </div>
      <div className="mx-7 flex items-center gap-3 rounded-xl border border-border px-4 py-3" style={{ backgroundColor: `color-mix(in oklch, ${side.color} 7%, transparent)` }}>
        <WorkspaceAvatar ws={ws} size="lg" />
        <span className="min-w-0 flex-1 text-[14px] font-semibold">
          You&apos;re {ws.kind === "compass" ? "Compass corporate" : `${ws.kind === "buyer" ? "the buyer" : "the agency"}: ${ws.name}`}
        </span>
        <SideBadge kind={ws.kind} />
      </div>
      <div className="flex items-center justify-end gap-2 px-7 pt-5 pb-6">
        <Button variant="ghost" size="icon" className="mr-auto size-9 rounded-lg" onClick={onBack} disabled={!onBack} aria-label="Previous step" title="Previous step" data-tour-card-back>
          <ChevronLeft className="size-4" />
        </Button>
        <Button variant="ghost" className="h-9 rounded-lg" onClick={onExit}>
          Exit tour
        </Button>
        <Button className="h-9 gap-1.5 rounded-lg px-3.5" onClick={onPlay} autoFocus>
          Continue as {ws.kind === "compass" ? "corporate" : ws.kind === "buyer" ? "the buyer" : "the agency"} <ArrowRight className="size-4" />
        </Button>
      </div>
    </>
  )
}

function FinaleCard({ onReplay, onBack, onClose }: { onReplay: () => void; onBack: () => void; onClose: () => void }) {
  return (
    <>
      <div className="relative overflow-hidden px-7 pt-7 pb-5">
        <Glow />
        <span className="relative text-[12px] font-medium text-muted-foreground">Guided demo</span>
        <h2 id="tour-card-title" className="relative mt-1.5 font-heading text-[28px] leading-tight font-semibold tracking-tight">
          That&apos;s the program
        </h2>
        <p className="relative mt-1 text-[15px] text-pretty text-muted-foreground">Everything you did is still there to explore.</p>
      </div>
      <ul className="mx-7 flex flex-col divide-y divide-border overflow-hidden rounded-xl border border-border">
        {CHAPTER_ORDER.map((id, i) => (
          <motion.li key={id} initial={{ opacity: 0, x: -6 }} animate={{ opacity: 1, x: 0 }} transition={{ duration: 0.3, ease: EASE, delay: 0.1 + i * 0.05 }}>
            <button
              type="button"
              onClick={() => openPart(id)}
              className="group flex w-full items-center gap-3 px-4 py-2.5 text-left transition-colors outline-none hover:bg-hover focus-visible:bg-hover"
            >
              <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-brand text-brand-foreground">
                <Check className="size-3" strokeWidth={3.2} />
              </span>
              <span className="text-[14px] font-semibold">{CHAPTERS[id].label}</span>
              <span className="ml-auto hidden items-center gap-1 text-[12.5px] font-medium group-hover:flex group-focus-visible:flex">
                Play again <ArrowRight className="size-3.5" />
              </span>
            </button>
          </motion.li>
        ))}
      </ul>
      <div className="flex items-center justify-between gap-3 px-7 pt-5 pb-6">
        <Button variant="ghost" size="icon" className="size-9 rounded-lg" onClick={onBack} aria-label="Previous step" title="Previous step" data-tour-card-back>
          <ChevronLeft className="size-4" />
        </Button>
        <Button variant="ghost" className="mr-auto h-9 gap-1.5 rounded-lg" onClick={onReplay}>
          <RotateCcw className="size-4" /> Start over
        </Button>
        <Button className="h-9 gap-1.5 rounded-lg px-3.5" onClick={onClose} autoFocus>
          Explore on my own <ArrowRight className="size-4" />
        </Button>
      </div>
    </>
  )
}
