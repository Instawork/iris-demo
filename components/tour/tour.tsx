"use client"

import { AnimatePresence, motion, useReducedMotion } from "motion/react"
import { useRouter } from "next/navigation"
import { ArrowRight, Check, CornerDownLeft, Flag, MousePointerClick, Play, RotateCcw, WandSparkles, X } from "lucide-react"
import { useEffect, useRef, useState } from "react"

import { useAgentThreads } from "@/components/agent/agent-store"
import { compose } from "@/components/agent/agent-thread"
import { WorkspaceAvatar } from "@/components/brand/org-avatar"
import { COMPOSER_ID } from "@/components/home/agent-home"
import {
  CHAPTERS,
  RECAP,
  SCRIPT,
  STEPS,
  indexOf,
  type ChapterId,
  type Placement,
  type TourApi,
  type TourChapter,
  type TourContext,
  type TourItem,
  type TourStep,
} from "@/components/tour/script"
import { Button } from "@/components/ui/button"
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
const GIVE_UP = 1600
const CARD_W = 360
const CHAPTER_ORDER: ChapterId[] = ["control", "compliance", "cost"]

interface Box {
  x: number
  y: number
  w: number
  h: number
}

type View =
  | { mode: "pending" }
  | { mode: "ready"; boxes: Box[]; anchor?: Box; modal: boolean }
  | { mode: "lost" }
  | { mode: "away" }
  | { mode: "paused" }

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
    proId: tour.proId,
    invoiceId: tour.invoiceId,
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
    (b.mode === "ready" && a.modal === b.modal && sameBoxes(a.boxes, b.boxes) && sameBoxes(a.anchor ? [a.anchor] : [], b.anchor ? [b.anchor] : [])))

/** The dialog or sheet on top, if any. The tour's own cards don't count. */
const topModal = () => {
  const open = document.querySelectorAll('[role="dialog"][data-state="open"]:not([data-tour-layer]), [role="alertdialog"][data-state="open"]')
  return open[open.length - 1] ?? null
}

const inView = (el: Element) => {
  const r = el.getBoundingClientRect()
  return r.top >= 56 && r.bottom <= window.innerHeight - 24
}

/** The tour's click shields sit over the page, so wheel events are handed to whatever scrolls underneath. */
function scrollUnder(e: React.WheelEvent) {
  const below = document.elementsFromPoint(e.clientX, e.clientY).find((el) => !el.closest("[data-tour-layer]"))
  for (let node = below instanceof HTMLElement ? below : null; node && node !== document.body; node = node.parentElement) {
    const { overflowY } = getComputedStyle(node)
    if ((overflowY === "auto" || overflowY === "scroll") && node.scrollHeight > node.clientHeight) {
      node.scrollBy({ top: e.deltaY, left: e.deltaX })
      return
    }
  }
}

const PAGE: Record<string, string> = { "": "the Dashboard", shifts: "Shifts", professionals: "Professionals", invoices: "Invoices" }
const pageOf = (href: string) => PAGE[href.split("?")[0].split("/")[1] ?? ""] ?? "the right page"

const stop = (e: React.PointerEvent) => e.stopPropagation()

/**
 * Where the coach card sits: beside the anchor on the preferred side if it fits, else wherever it does.
 * It lines up with the focus, the target itself, when the anchor is something bigger around it.
 */
function place(anchor: Box | undefined, size: { w: number; h: number }, prefer: Placement | undefined, vw: number, vh: number, focus = anchor) {
  const m = 16
  const gap = 14
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
  for (const p of [prefer ?? "bottom", "bottom", "top", "right", "left"] as Placement[]) if (options[p].fits) return { x: options[p].x, y: options[p].y }
  return { x: clampX(cx - size.w / 2), y: vh - size.h - m }
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

function StepScreen({ step }: { step: TourStep }) {
  const router = useRouter()
  useStore((s) => s.data)
  useStore((s) => s.workspaceId)
  const [view, setView] = useState<{ step: string; view: View }>({ step: step.id, view: { mode: "pending" } })
  const [celebrate, setCelebrate] = useState<{ step: string; message: string; kept: boolean }>()
  const vp = useViewport()
  const [cardRef, cardSize] = useSize<HTMLDivElement>()

  useEffect(() => {
    let raf = 0
    let timer: number | undefined
    let finished = false
    let missingSince: number | undefined
    let awaySince: number | undefined
    let checkedAt = 0
    let ranAt = 0
    const scrolled = new WeakSet<Element>()
    const api: TourApi = { push: (href) => router.push(href), remember: (patch) => useTour.getState().remember(patch) }
    const update = (next: View) => setView((prev) => (prev.step === step.id && sameView(prev.view, next) ? prev : { step: step.id, view: next }))

    const tick = () => {
      const t = performance.now()
      ranAt = t
      if (finished) return
      const ctx = contextNow()
      if (t - checkedAt > 120) {
        checkedAt = t
        if (step.done?.(ctx)) {
          finished = true
          step.onDone?.(ctx, api)
          if (!step.success) {
            useTour.getState().finish(step.id, "done")
            return
          }
          setCelebrate({ step: step.id, message: step.success(ctx), kept: !!step.targets(ctx)[0]?.isConnected })
          timer = window.setTimeout(() => useTour.getState().finish(step.id, "done"), 1150)
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
      if (!scrolled.has(primary)) {
        scrolled.add(primary)
        if (!inView(primary)) primary.scrollIntoView({ block: "center", behavior: "smooth" })
      }
      const modal = topModal()
      if (modal && !modal.contains(primary)) return update({ mode: "paused" })
      const anchor = step.anchor?.()
      update({ mode: "ready", boxes: els.map(boxOf), anchor: anchor ? boxOf(anchor) : undefined, modal: !!modal })
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
      window.clearTimeout(timer)
    }
  }, [step, router])

  const ctx = contextNow()
  const mine = view.step === step.id
  const mode = mine ? view.view.mode : "pending"
  const ready = view.view.mode === "ready" ? view.view : undefined
  const party = celebrate?.step === step.id ? celebrate : undefined
  const done = party?.message
  const look = !step.action
  const showCard = mode === "ready" || mode === "lost" || mode === "away"
  const dimmed = mode !== "paused" && !(mode === "ready" && ready?.modal)
  const cutouts = (mode === "ready" || mode === "pending") && !(party && !party.kept) ? (ready?.boxes ?? []) : []
  const anchor = mode === "ready" ? ready?.boxes[0] : undefined
  const pos = place(mode === "ready" ? (ready?.anchor ?? anchor) : undefined, cardSize, step.placement, vp.w, vp.h, anchor)

  const api: TourApi = { push: (href) => router.push(href), remember: (patch) => useTour.getState().remember(patch) }
  const finish = (how: "done" | "skipped") => useTour.getState().finish(step.id, how)
  const skip = () => {
    step.skip(contextNow(), api)
    finish("skipped")
  }
  const goThere = () => {
    const now = contextNow()
    if (now.wsId !== step.wsId) useStore.getState().setWorkspace(step.wsId)
    router.push(step.href(now))
  }

  return (
    <>
      <Dim boxes={cutouts} visible={dimmed} />
      {mode !== "paused" && !(ready?.modal && mode === "ready") && (
        <Shield hole={done || look || mode !== "ready" ? undefined : anchor} />
      )}
      {mode === "ready" && ready && !(party && !party.kept) && <Rings boxes={ready.boxes} flash={!!done} />}
      <motion.div
        ref={cardRef}
        data-tour-layer
        onPointerDown={stop}
        className="fixed top-0 left-0 z-[60] w-[360px] max-w-[calc(100vw-24px)]"
        initial={{ opacity: 0, x: pos.x, y: pos.y + 10 }}
        animate={{ opacity: showCard && mine ? 1 : 0, x: pos.x, y: pos.y }}
        transition={SPRING}
        style={{ pointerEvents: showCard && mine ? "auto" : "none" }}
      >
        <StepCard step={step} ctx={ctx} mode={mode} done={done} onNext={() => finish("done")} onSkip={skip} onGo={goThere} />
      </motion.div>
    </>
  )
}

function StepCard({
  step,
  ctx,
  mode,
  done,
  onNext,
  onSkip,
  onGo,
}: {
  step: TourStep
  ctx: TourContext
  mode: View["mode"]
  done?: string
  onNext: () => void
  onSkip: () => void
  onGo: () => void
}) {
  const meta = CHAPTERS[step.chapter]
  const Icon = meta.icon
  const n = STEPS.indexOf(step) + 1
  const following = SCRIPT[indexOf(step.id) + 1]
  const wrapsChapter = !following || following.kind === "finale" || (following.kind === "chapter" && following.chapter !== step.chapter)
  const title = typeof step.title === "function" ? step.title(ctx) : step.title
  const body = typeof step.body === "function" ? step.body(ctx) : step.body
  const status = step.status?.(ctx)
  const away = mode === "away"
  const lost = mode === "lost"

  return (
    <div
      role="dialog"
      aria-label={`Guided tour: ${title}`}
      className="overflow-hidden rounded-2xl bg-foreground text-background shadow-overlay ring-1 ring-black/10 dark:ring-white/10"
    >
      <div className="flex items-center justify-between gap-3 pt-3.5 pr-2.5 pl-4">
        <span className="inline-flex min-w-0 items-center gap-1.5 text-[11px] font-semibold tracking-[0.08em] text-background/55 uppercase">
          <Icon className="size-3.5 shrink-0 text-brand dark:text-brand-foreground" strokeWidth={2.2} />
          {meta.label}
          <span className="text-background/30">·</span>
          <span className="tracking-normal normal-case tabular">
            Step {n} of {STEPS.length}
          </span>
        </span>
        <button
          type="button"
          onClick={() => useTour.getState().exit()}
          aria-label="Exit tour"
          className="flex size-7 items-center justify-center rounded-md text-background/50 transition-colors outline-none hover:bg-background/10 hover:text-background focus-visible:ring-2 focus-visible:ring-brand/60"
        >
          <X className="size-4" />
        </button>
      </div>

      <AnimatePresence mode="wait" initial={false}>
        {done ? (
          <motion.div
            key="done"
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
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
              <span className="text-[12.5px] text-background/55">{wrapsChapter ? `${meta.label} complete` : `Step ${n} of ${STEPS.length} done`}</span>
            </span>
          </motion.div>
        ) : (
          <motion.div key={`${step.id}-${mode}`} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ duration: 0.22, ease: EASE }}>
            <h2 className="px-4 pt-2 text-[17px] leading-snug font-semibold tracking-[-0.01em] text-balance">{title}</h2>
            <p className="px-4 pt-1 text-[13.5px] leading-relaxed text-pretty text-background/70">
              {away ? `This step happens on ${pageOf(step.href(ctx))} as ${workspace(step.wsId).user.firstName}.` : body}
            </p>
            {!away && step.example && <Example text={step.example(ctx)} />}
            {!away && status && (
              <p className="mx-4 mt-3 inline-flex items-center gap-2 rounded-lg bg-background/[0.08] px-2.5 py-1.5 text-[12.5px] font-medium tabular">
                <span className="size-1.5 animate-live rounded-full bg-brand" />
                {status}
              </p>
            )}
            {!away && !lost && step.action && !step.example && (
              <p className="flex items-center gap-2 px-4 pt-3 text-[12.5px] font-medium text-brand dark:text-brand-foreground">
                <MousePointerClick className="size-3.5" />
                {step.action}
              </p>
            )}
          </motion.div>
        )}
      </AnimatePresence>

      <div className="flex items-center gap-3 px-4 pt-3.5 pb-3.5">
        <Progress current={n - 1} />
        <span className="ml-auto flex items-center gap-1">
          {away ? (
            <CardButton onClick={onGo}>
              Take me there <ArrowRight className="size-3.5" />
            </CardButton>
          ) : done ? null : !step.action ? (
            <CardButton onClick={onNext}>
              Next <ArrowRight className="size-3.5" />
            </CardButton>
          ) : lost ? (
            <CardButton onClick={onSkip}>
              Do it for me <ArrowRight className="size-3.5" />
            </CardButton>
          ) : (
            <button
              type="button"
              onClick={onSkip}
              className="h-7 rounded-md px-2 text-[12.5px] font-medium text-background/55 transition-colors outline-none hover:bg-background/10 hover:text-background focus-visible:ring-2 focus-visible:ring-brand/60"
            >
              Do it for me
            </button>
          )}
        </span>
      </div>
    </div>
  )
}

function Example({ text }: { text: string }) {
  const [typed, setTyped] = useState(false)
  return (
    <div className="mx-4 mt-3 rounded-xl bg-background/[0.07] p-3 ring-1 ring-background/10">
      <p className="text-[13px] leading-snug text-background/90">“{text}”</p>
      <AnimatePresence mode="wait" initial={false}>
        {typed ? (
          <motion.p
            key="enter"
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            className="mt-2.5 flex items-center gap-1.5 text-[12.5px] font-medium text-brand dark:text-brand-foreground"
          >
            <CornerDownLeft className="size-3.5" /> Now press Enter to send it
          </motion.p>
        ) : (
          <motion.button
            key="type"
            type="button"
            exit={{ opacity: 0 }}
            onClick={() => {
              compose(COMPOSER_ID, text)
              setTyped(true)
            }}
            className="mt-2.5 inline-flex h-7 items-center gap-1.5 rounded-lg bg-brand px-2.5 text-[12.5px] font-semibold text-brand-foreground transition-transform outline-none hover:-translate-y-px focus-visible:ring-2 focus-visible:ring-brand/60 active:translate-y-0"
          >
            <WandSparkles className="size-3.5" /> Type it for me
          </motion.button>
        )}
      </AnimatePresence>
    </div>
  )
}

function CardButton({ onClick, children }: { onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-brand px-3 text-[13px] font-semibold text-brand-foreground transition-transform outline-none hover:-translate-y-px focus-visible:ring-2 focus-visible:ring-brand/60 active:translate-y-0"
    >
      {children}
    </button>
  )
}

/** One bar per step, grouped by chapter. */
function Progress({ current }: { current: number }) {
  return (
    <span className="flex items-center gap-1.5" aria-hidden>
      {CHAPTER_ORDER.map((chapter) => (
        <span key={chapter} className="flex gap-[3px]">
          {STEPS.map((s, i) =>
            s.chapter === chapter ? (
              <span
                key={s.id}
                className={cn(
                  "h-1 w-2 rounded-full transition-colors duration-300",
                  i < current ? "bg-brand" : i === current ? "bg-background" : "bg-background/20",
                )}
              />
            ) : null,
          )}
        </span>
      ))}
    </span>
  )
}

/** Dims the page with a rounded window around each target. */
function Dim({ boxes, visible }: { boxes: Box[]; visible: boolean }) {
  return (
    <motion.svg
      aria-hidden
      className="pointer-events-none fixed inset-0 z-[45] h-full w-full"
      initial={{ opacity: 0 }}
      animate={{ opacity: visible ? 1 : 0 }}
      transition={{ duration: 0.25 }}
    >
      <defs>
        <mask id="tour-cutouts">
          <rect width="100%" height="100%" fill="white" />
          {boxes.map((b, i) => (
            <motion.rect key={i} initial={false} animate={{ attrX: b.x, attrY: b.y, width: b.w, height: b.h }} transition={SPRING} rx={14} fill="black" />
          ))}
        </mask>
      </defs>
      <rect width="100%" height="100%" mask="url(#tour-cutouts)" className="fill-[rgb(18_16_13/0.56)] dark:fill-black/65" />
    </motion.svg>
  )
}

/** Catches clicks everywhere except the hole, so the player stays on the step. */
function Shield({ hole }: { hole?: Box }) {
  const base = "fixed z-[45]"
  if (!hole) return <div data-tour-layer className={cn(base, "inset-0")} onWheel={scrollUnder} />
  const right = hole.x + hole.w
  const bottom = hole.y + hole.h
  return (
    <>
      <div data-tour-layer className={base} style={{ left: 0, top: 0, right: 0, height: Math.max(0, hole.y) }} onWheel={scrollUnder} />
      <div data-tour-layer className={base} style={{ left: 0, top: bottom, right: 0, bottom: 0 }} onWheel={scrollUnder} />
      <div data-tour-layer className={base} style={{ left: 0, top: hole.y, width: Math.max(0, hole.x), height: hole.h }} onWheel={scrollUnder} />
      <div data-tour-layer className={base} style={{ left: right, top: hole.y, right: 0, height: hole.h }} onWheel={scrollUnder} />
    </>
  )
}

function Rings({ boxes, flash }: { boxes: Box[]; flash: boolean }) {
  const reduce = useReducedMotion()
  return (
    <>
      {boxes.map((b, i) => (
        <motion.div
          key={i}
          aria-hidden
          className="pointer-events-none fixed top-0 left-0 z-[60] rounded-[14px] ring-2 ring-brand shadow-[0_0_0_5px_color-mix(in_oklch,var(--brand)_30%,transparent),0_0_28px_4px_color-mix(in_oklch,var(--brand)_35%,transparent)]"
          initial={{ opacity: 0, x: b.x, y: b.y, width: b.w, height: b.h }}
          animate={{ opacity: 1, x: b.x, y: b.y, width: b.w, height: b.h }}
          transition={SPRING}
        >
          {!reduce && (
            <motion.span
              className="absolute -inset-px rounded-[inherit] ring-2 ring-brand"
              animate={flash ? { opacity: [0.9, 0], scale: [1, 1.12] } : { opacity: [0.75, 0], scale: [1, 1.05] }}
              transition={flash ? { duration: 0.7, ease: "easeOut" } : { duration: 1.7, repeat: Infinity, ease: "easeOut" }}
            />
          )}
          {flash && <motion.span className="absolute inset-0 rounded-[inherit] bg-brand/25" initial={{ opacity: 0 }} animate={{ opacity: [0, 1, 0] }} transition={{ duration: 0.8 }} />}
        </motion.div>
      ))}
    </>
  )
}

/* ---------------------------------- Cards ---------------------------------- */

function CardScreen({ item, index }: { item: Exclude<TourItem, TourStep>; index: number }) {
  const router = useRouter()
  const exit = () => useTour.getState().exit()

  const start = async () => {
    await useStore.getState().resetDemo()
    useAgentThreads.setState({ threads: {} })
    useUi.setState({ welcomeSeen: { buyer: true, supplier: true, compass: true }, agentOpen: false })
    const { counters } = useStore.getState().data
    useTour.getState().begin({ sg: counters.sg, inv: counters.inv })
  }

  const play = (chapter: TourChapter) => {
    const store = useStore.getState()
    if (store.workspaceId !== chapter.wsId) store.setWorkspace(chapter.wsId)
    useAgentThreads.getState().clear(chapter.wsId)
    useUi.getState().setAgentOpen(false)
    router.push(chapter.href)
    useTour.getState().go(index + 1)
  }

  const previous = SCRIPT[index - 1]
  const continued = item.kind === "chapter" && previous?.kind === "step" && previous.chapter === item.chapter

  return (
    <motion.div
      data-tour-layer
      onPointerDown={stop}
      className="fixed inset-0 z-[60] flex items-center justify-center overflow-y-auto bg-[rgb(18_16_13/0.5)] p-4 backdrop-blur-[3px] dark:bg-black/65"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.25 }}
    >
      <motion.div
        role="dialog"
        aria-modal="true"
        aria-labelledby="tour-card-title"
        data-tour-layer
        className="w-full max-w-[540px] overflow-hidden rounded-[22px] bg-card text-card-foreground shadow-overlay ring-1 ring-border"
        initial={{ opacity: 0, y: 18, scale: 0.97 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: -10, scale: 0.98 }}
        transition={{ duration: 0.38, ease: EASE }}
      >
        {item.kind === "intro" && <IntroCard onStart={start} onClose={exit} />}
        {item.kind === "chapter" && <ChapterCard item={item} continued={continued} onPlay={() => play(item)} onExit={exit} />}
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

function IntroCard({ onStart, onClose }: { onStart: () => void; onClose: () => void }) {
  return (
    <>
      <div className="relative overflow-hidden px-7 pt-7 pb-5">
        <Glow />
        <span className="relative inline-flex items-center gap-1.5 rounded-full bg-foreground px-2.5 py-1 text-[11px] font-semibold tracking-[0.06em] text-background uppercase">
          <Play className="size-3 fill-current" /> Guided tour · about 3 minutes
        </span>
        <h2 id="tour-card-title" className="relative mt-4 font-heading text-[28px] leading-[1.15] font-semibold tracking-tight text-balance">
          Run a day of staffing on Iris
        </h2>
        <p className="relative mt-2 text-[15px] leading-relaxed text-pretty text-muted-foreground">
          You&apos;ll play a buyer, an agency and Compass, and do the real work one step at a time.
        </p>
      </div>
      <ol className="flex flex-col gap-2 px-7">
        {CHAPTER_ORDER.map((id, i) => {
          const c = CHAPTERS[id]
          return (
            <motion.li
              key={id}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.35, ease: EASE, delay: 0.12 + i * 0.07 }}
              className="flex items-center gap-3.5 rounded-xl border border-border bg-page-faded/60 px-3.5 py-3"
            >
              <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-brand/30 text-brand-foreground ring-1 ring-brand-foreground/15 ring-inset dark:bg-brand/12 dark:text-brand">
                <c.icon className="size-[18px]" strokeWidth={1.9} />
              </span>
              <span className="flex min-w-0 flex-col">
                <span className="text-[14px] font-semibold">{c.label}</span>
                <span className="text-[13px] leading-snug text-muted-foreground">{c.blurb}</span>
              </span>
              <span className="ml-auto pl-2 font-mono text-[12px] text-subtle">0{c.number}</span>
            </motion.li>
          )
        })}
      </ol>
      <div className="flex flex-wrap items-center justify-between gap-3 px-7 pt-5 pb-6">
        <span className="text-[12.5px] text-subtle">Starts from fresh demo data.</span>
        <span className="flex gap-2">
          <Button variant="ghost" className="h-9 rounded-lg" onClick={onClose}>
            Not now
          </Button>
          <Button className="h-9 gap-1.5 rounded-lg px-3.5" onClick={onStart} autoFocus>
            Start the tour <ArrowRight className="size-4" />
          </Button>
        </span>
      </div>
    </>
  )
}

function ChapterRail({ current }: { current: ChapterId }) {
  const at = CHAPTER_ORDER.indexOf(current)
  return (
    <div className="relative mt-5 grid grid-cols-3 gap-1.5">
      {CHAPTER_ORDER.map((id, i) => (
        <span key={id} className="flex flex-col gap-1.5">
          <span className={cn("h-1 rounded-full", i < at ? "bg-brand" : i === at ? "bg-foreground" : "bg-foreground/10")} />
          <span className={cn("text-[11.5px] font-medium", i === at ? "text-foreground" : "text-subtle")}>
            {i < at && <Check className="mr-1 inline size-3 text-brand-strong" strokeWidth={3} />}
            {CHAPTERS[id].label}
          </span>
        </span>
      ))}
    </div>
  )
}

function ChapterCard({ item, continued, onPlay, onExit }: { item: TourChapter; continued: boolean; onPlay: () => void; onExit: () => void }) {
  const meta = CHAPTERS[item.chapter]
  const ws = workspace(item.wsId)
  return (
    <>
      <div className="relative overflow-hidden px-7 pt-7 pb-5">
        <Glow />
        <span className="relative text-[12px] font-medium text-muted-foreground">
          Chapter {meta.number} of 3{continued ? ", continued" : ""}
        </span>
        <div className="relative mt-1.5 flex items-end justify-between gap-4">
          <h2 id="tour-card-title" className="font-heading text-[44px] leading-none font-semibold tracking-[-0.02em]">
            {item.title}
          </h2>
          <span aria-hidden className="font-heading text-[72px] leading-[0.75] font-semibold text-foreground/[0.07] tabular">
            0{meta.number}
          </span>
        </div>
        <p className="relative mt-3 text-[16px] leading-snug text-pretty text-muted-foreground">{item.line}</p>
        <ChapterRail current={item.chapter} />
      </div>
      <div className="mx-7 flex items-center gap-3.5 rounded-xl border border-border bg-page-faded/60 px-4 py-3.5">
        <WorkspaceAvatar ws={ws} size="lg" />
        <span className="flex min-w-0 flex-col">
          <span className="text-[14px] font-semibold">
            You&apos;re {ws.user.name}
            {item.again ? " again" : ""}
          </span>
          <span className="truncate text-[13px] text-muted-foreground">
            {ws.user.title} · {ws.name}
          </span>
        </span>
      </div>
      <p className="mx-7 mt-3.5 flex items-start gap-2.5 text-[14px] leading-relaxed">
        <Flag className="mt-[3px] size-4 shrink-0 text-brand-strong" />
        <span>
          <span className="font-semibold">Your mission: </span>
          {item.mission}
        </span>
      </p>
      <div className="flex items-center justify-end gap-2 px-7 pt-5 pb-6">
        <Button variant="ghost" className="h-9 rounded-lg" onClick={onExit}>
          Exit tour
        </Button>
        <Button className="h-9 gap-1.5 rounded-lg px-3.5" onClick={onPlay} autoFocus>
          Play as {ws.user.firstName} <ArrowRight className="size-4" />
        </Button>
      </div>
    </>
  )
}

const BURST = Array.from({ length: 22 }, (_, i) => {
  const angle = (i / 22) * Math.PI * 2 + ((i * 37) % 10) / 20
  const reach = 70 + ((i * 53) % 70)
  return { x: Math.cos(angle) * reach, y: Math.sin(angle) * reach * 0.8 + 26, rotate: ((i * 71) % 360) - 180, tone: i % 3, delay: (i % 5) * 0.02 }
})

function Confetti() {
  const reduce = useReducedMotion()
  if (reduce) return null
  return (
    <span aria-hidden className="pointer-events-none absolute top-[64px] left-1/2">
      {BURST.map((p, i) => (
        <motion.span
          key={i}
          className={cn("absolute h-2.5 w-1.5 rounded-[2px]", p.tone === 0 ? "bg-brand" : p.tone === 1 ? "bg-foreground" : "bg-warning")}
          initial={{ x: 0, y: 0, opacity: 0, rotate: 0, scale: 0.6 }}
          animate={{ x: p.x, y: p.y, opacity: [0, 1, 1, 0], rotate: p.rotate, scale: 1 }}
          transition={{ duration: 1.25, ease: [0.16, 1, 0.3, 1], delay: 0.15 + p.delay }}
        />
      ))}
    </span>
  )
}

function FinaleCard({ onReplay, onClose }: { onReplay: () => void; onClose: () => void }) {
  return (
    <>
      <div className="relative flex flex-col items-center overflow-hidden px-7 pt-9 pb-6 text-center">
        <Glow />
        <Confetti />
        <motion.span
          initial={{ scale: 0.5, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ type: "spring", stiffness: 420, damping: 18, delay: 0.1 }}
          className="relative flex size-14 items-center justify-center rounded-full bg-brand text-brand-foreground shadow-[0_0_0_8px_color-mix(in_oklch,var(--brand)_28%,transparent)]"
        >
          <Check className="size-7" strokeWidth={3} />
        </motion.span>
        <h2 id="tour-card-title" className="relative mt-5 font-heading text-[30px] leading-tight font-semibold tracking-tight">
          That&apos;s Iris.
        </h2>
        <p className="relative mt-1 text-[16px] text-muted-foreground">Built for how Compass operates.</p>
        <p className="relative mt-3 text-[12.5px] text-subtle">Keep exploring. Switch roles anytime from the top of the sidebar.</p>
      </div>
      <ul className="mx-7 flex flex-col divide-y divide-border overflow-hidden rounded-xl border border-border">
        {RECAP.map((r, i) => (
          <motion.li
            key={r.step}
            initial={{ opacity: 0, x: -6 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ duration: 0.3, ease: EASE, delay: 0.35 + i * 0.08 }}
            className="flex items-center gap-3 px-4 py-2.5 text-[14px]"
          >
            <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-brand text-brand-foreground">
              <Check className="size-3" strokeWidth={3.2} />
            </span>
            {r.label}
          </motion.li>
        ))}
      </ul>
      <div className="flex flex-wrap items-center justify-between gap-3 px-7 pt-5 pb-6">
        <Button variant="ghost" className="h-9 gap-1.5 rounded-lg" onClick={onReplay}>
          <RotateCcw className="size-4" /> Replay the tour
        </Button>
        <Button className="h-9 gap-1.5 rounded-lg px-3.5" onClick={onClose} autoFocus>
          Explore on my own <ArrowRight className="size-4" />
        </Button>
      </div>
    </>
  )
}
