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
import { useStore } from "@/lib/store"
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

type View =
  | { mode: "pending" }
  | { mode: "ready"; boxes: Box[]; anchor?: Box; modal: boolean; copy: string }
  | { mode: "lost" }
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
const sameView = (a: View, b: View) =>
  a.mode === b.mode &&
  (a.mode !== "ready" ||
    (b.mode === "ready" && a.modal === b.modal && a.copy === b.copy && sameBoxes(a.boxes, b.boxes) && sameBoxes(a.anchor ? [a.anchor] : [], b.anchor ? [b.anchor] : [])))

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
    const target = new URL(href, window.location.origin).pathname
    const started = performance.now()
    const check = () => {
      if (window.location.pathname === target || performance.now() - started > 4000) resolve()
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
}

/**
 * Where the coach card sits: beside the anchor on the preferred side if it fits, else wherever it does. Its pointer
 * aims at the focus, the target itself, when the anchor is something bigger around it.
 */
function place(anchor: Box | undefined, size: { w: number; h: number }, prefer: Placement | undefined, vw: number, vh: number, focus = anchor): Spot {
  const m = 16
  const gap = 16
  if (vw < 640) {
    const low = !!focus && focus.y + focus.h / 2 > vh / 2
    return { x: 12, y: low ? 12 : vh - size.h - 12 }
  }
  if (!anchor || !focus) return { x: (vw - size.w) / 2, y: Math.max(m, (vh - size.h) / 2) }
  const clampX = (x: number) => Math.min(Math.max(m, x), vw - size.w - m)
  const clampY = (y: number) => Math.min(Math.max(m, y), vh - size.h - m)
  const cx = focus.x + focus.w / 2
  const cy = focus.y + focus.h / 2
  const options: Record<Placement, { x: number; y: number; fits: boolean }> = {
    bottom: { x: clampX(cx - size.w / 2), y: anchor.y + anchor.h + gap, fits: anchor.y + anchor.h + gap + size.h <= vh - m },
    top: { x: clampX(cx - size.w / 2), y: anchor.y - gap - size.h, fits: anchor.y - gap - size.h >= m },
    right: { x: anchor.x + anchor.w + gap, y: clampY(cy - size.h / 2), fits: anchor.x + anchor.w + gap + size.w <= vw - m },
    left: { x: anchor.x - gap - size.w, y: clampY(cy - size.h / 2), fits: anchor.x - gap - size.w >= m },
  }
  const facing: Record<Placement, Placement> = { bottom: "top", top: "bottom", right: "left", left: "right" }
  const covers = (x: number, y: number) => x < focus.x + focus.w && x + size.w > focus.x && y < focus.y + focus.h && y + size.h > focus.y
  for (const p of [prefer ?? "bottom", "bottom", "top", "right", "left"] as Placement[]) {
    if (!options[p].fits) continue
    const x = clampX(options[p].x)
    const y = clampY(options[p].y)
    // Clamping a side that barely fits can slide the card onto the thing it points at.
    if (covers(x, y)) continue
    const along = p === "bottom" || p === "top" ? cx - x : cy - y
    const span = p === "bottom" || p === "top" ? size.w : size.h
    return { x, y, edge: facing[p], at: Math.min(Math.max(22, along), span - 22) }
  }
  const above = focus.y - gap - size.h
  return { x: clampX(cx - size.w / 2), y: above >= m ? above : vh - size.h - m }
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
  return (
    <>
      <AnimatePresence mode="wait">{item && item.kind !== "step" && <CardScreen key={item.id} item={item} index={index} />}</AnimatePresence>
      {item?.kind === "step" && <StepScreen step={item} />}
    </>
  )
}

/* ---------------------------------- Steps ---------------------------------- */

/** The step before or after this one, skipping the part cards between them. The finale is after the last. */
const neighbor = (step: TourStep, by: -1 | 1) => {
  for (let i = indexOf(step.id) + by; i >= 0 && i < SCRIPT.length; i += by) {
    const item = SCRIPT[i]
    if (item.kind === "step" || item.kind === "finale") return i
  }
  return undefined
}

/** Stops Iris's cursor and closes the dialog or agent sheet a step left open. */
function clearStage() {
  stopPilot()
  toast.dismiss()
  if (topModal()) document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }))
  useUi.getState().setAgentOpen(false)
}

/** Opens a part's card. Its Continue sets the side and page, so parts can be played in any order. */
function openPart(chapter: ChapterId) {
  clearStage()
  useTour.getState().go(startOf(chapter))
}

const partBeside = (chapter: ChapterId, by: -1 | 1): ChapterId | undefined => CHAPTER_ORDER[CHAPTER_ORDER.indexOf(chapter) + by]

/** A part's number picks it, and Shift with an arrow the part before or after `chapter`. */
const partKey = (e: KeyboardEvent, chapter?: ChapterId): ChapterId | undefined => {
  if (e.metaKey || e.ctrlKey || e.altKey || e.isComposing || ownsArrows(e.target)) return undefined
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

/**
 * Moves the tour to any step, back or ahead. Whatever is open closes, the page and side follow, and the step judges
 * only what's done from here on. A step that acts on an earlier one, like a draft the question before it asked for,
 * gets that played for the player first.
 */
async function jumpTo(index: number, push: (href: string) => void) {
  const item = SCRIPT[index]
  if (!item) return
  clearStage()
  if (item.kind !== "step") return useTour.getState().go(index)
  const store = useStore.getState()
  const switching = store.workspaceId !== item.wsId ? store.setWorkspace(item.wsId) : undefined
  await switching
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
  if (!setUp.length) return
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
    if (useTour.getState().enteredAt === at) {
      toast.dismiss()
      const there = item.href(contextNow())
      if (there !== `${window.location.pathname}${window.location.search}`) {
        push(there)
        await arrivedAt(there)
      }
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
    !!target.closest('[data-tour-layer], select, [contenteditable="true"], [role="menu"], [role="listbox"], [role="combobox"], [role="radiogroup"], [role="grid"]'))

/** Keys that belong to what has focus, like arrows in a tab list or a text field. */
const ownsArrows = (target: EventTarget | null) =>
  target instanceof Element && !!target.closest('input, textarea, select, [contenteditable="true"], [role="tablist"], [role="radiogroup"], [role="menu"], [role="listbox"], [role="slider"], [role="grid"]')

function StepScreen({ step }: { step: TourStep }) {
  const router = useRouter()
  useStore((s) => s.data)
  useStore((s) => s.workspaceId)
  const [view, setView] = useState<{ step: string; view: View }>({ step: step.id, view: { mode: "pending" } })
  const enteredAt = useTour((s) => s.enteredAt)
  const [celebrate, setCelebrate] = useState<{ step: string; at?: string; message: string; kept: boolean }>()
  /** The visit of the step "Do it for me" is playing, and whether it's typing a screen in. */
  const [piloting, setPiloting] = useState<{ visit: string; filling: boolean }>()
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

    const tick = () => {
      const t = performance.now()
      ranAt = t
      if (finished) return
      if (preparing === step.id) return update({ mode: "preparing" })
      const ctx = contextNow()
      if (t - checkedAt > 120) {
        checkedAt = t
        if (step.done?.(ctx)) {
          finished = true
          closing.current = useTour.getState().enteredAt
          // Already done on arrival, like a step jumped back to: the card still has to point at it.
          const els = step.targets(ctx).filter((el): el is Element => !!el && el.getClientRects().length > 0)
          update(els.length ? { mode: "ready", boxes: els.map(boxOf), modal: !!topModal(), copy: "" } : { mode: "pending" })
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
        if (t - missingSince > GRACE) update({ mode: "lost" })
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
      update({ mode: "ready", boxes: els.map(boxOf), anchor: anchor ? boxOf(anchor) : undefined, modal: !!modal, copy })
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
  }, [step, router])

  const ctx = contextNow()
  const mine = view.step === step.id
  const mode = mine ? view.view.mode : "pending"
  const ready = view.view.mode === "ready" ? view.view : undefined
  const party = celebrate?.step === step.id && celebrate.at === enteredAt ? celebrate : undefined
  const done = party?.message
  const showCard = mode === "ready" || mode === "lost" || mode === "preparing" || !!party
  const anchor = mode === "ready" ? ready?.boxes[0] : undefined
  const pos = place(mode === "ready" ? (ready?.anchor ?? anchor) : undefined, cardSize, step.placement, vp.w, vp.h, anchor)

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
    if (to) await arrivedAt(to)
    if (useTour.getState().enteredAt === at) useTour.getState().finish(step.id, how)
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
  const back = neighbor(step, -1)
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
            {step.example && <Example text={step.example(ctx)} />}
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
          <StepArrow label="Previous step" disabled={!canBack} onClick={onBack}>
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
const segmentWidth = (steps: number) => (steps === 1 ? 40 : Math.max(8, Math.round((40 - 2 * (steps - 1)) / steps)))

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
                className="group/part flex h-6 items-center rounded-md px-[2px] outline-none focus-visible:ring-2 focus-visible:ring-brand/60"
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
    useTour.getState().go(index + 1)
  }

  /** From a part's card to one of its steps. The first is the card's own Continue. */
  const toStep = async (step: TourStep) => {
    if (item.kind !== "chapter") return
    if (STEPS.find((s) => s.chapter === step.chapter) === step) return play(item)
    await resetting
    await jumpTo(indexOf(step.id), router.push)
  }

  const primary = useRef<() => void>(undefined)
  useEffect(() => {
    primary.current = item.kind === "intro" ? () => start() : item.kind === "chapter" ? () => void play(item) : exit
  })
  useEffect(() => {
    useUi.getState().setAgentOpen(false)
  }, [item.id])
  useEffect(() => {
    const here = item.kind === "chapter" ? item.chapter : undefined
    const onKey = (e: KeyboardEvent) => {
      if (item.kind !== "intro" && !e.repeat) {
        const arrow = e.key === "ArrowLeft" ? -1 : e.key === "ArrowRight" ? 1 : 0
        const part =
          partKey(e, here) ??
          (arrow && !e.shiftKey && !e.metaKey && !e.ctrlKey && !e.altKey
            ? here
              ? partBeside(here, arrow)
              : arrow < 0
                ? CHAPTER_ORDER.at(-1)
                : undefined
            : undefined)
        if (part) {
          e.preventDefault()
          e.stopPropagation()
          openPart(part)
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
        {item.kind === "chapter" && <ChapterCard item={item} onPlay={() => play(item)} onExit={exit} onStep={(step) => void toStep(step)} />}
        {item.kind === "finale" && <FinaleCard onReplay={() => useTour.getState().open()} onClose={exit} />}
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
              <ol className={cn("flex flex-col", dark ? "mb-1 ml-[15px] border-l border-background/15 pl-1.5" : "pb-2 pl-[42px] pr-2")} aria-label="Steps">
                {STEPS.filter((s) => s.chapter === id).map((s) => {
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

function ChapterCard({ item, onPlay, onExit, onStep }: { item: TourChapter; onPlay: () => void; onExit: () => void; onStep: (step: TourStep) => void }) {
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

function FinaleCard({ onReplay, onClose }: { onReplay: () => void; onClose: () => void }) {
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
        <Button variant="ghost" className="h-9 gap-1.5 rounded-lg" onClick={onReplay}>
          <RotateCcw className="size-4" /> Start over
        </Button>
        <Button className="h-9 gap-1.5 rounded-lg px-3.5" onClick={onClose} autoFocus>
          Explore on my own <ArrowRight className="size-4" />
        </Button>
      </div>
    </>
  )
}
