"use client"

import { AnimatePresence, motion, useReducedMotion } from "motion/react"
import Link from "next/link"
import {
  ArrowLeft,
  ArrowRight,
  BadgeDollarSign,
  CalendarPlus,
  CalendarSync,
  CheckCheck,
  CheckCircle2,
  Clock,
  Download,
  FileWarning,
  ShieldAlert,
  Sparkles,
  TrendingUp,
  Upload,
  UsersRound,
  type LucideIcon,
} from "lucide-react"
import { useEffect, useMemo, useRef, useState } from "react"

import { AgentComposer, AgentMessages } from "@/components/agent/agent-thread"
import { useAgent } from "@/components/agent/use-agent"
import { LogoMark } from "@/components/brand/logo"
import { InfoTip } from "@/components/common/info-tip"
import { TodoRow } from "@/components/common/todo-card"
import { Button } from "@/components/ui/button"
import { Kbd } from "@/components/ui/kbd"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { useData, useWorkspace } from "@/hooks/use-app"
import { addDaysISO, formatDay, todayISO } from "@/lib/dates"
import { todosFor } from "@/lib/metrics"
import { predictionsFor, type Prediction } from "@/lib/predict"
import type { PersonaKind } from "@/lib/types"
import { cn } from "@/lib/utils"

const EASE = [0.22, 1, 0.36, 1] as const
export const COMPOSER_ID = "home-composer"

const NUMBER_WORDS = ["Nothing", "One thing", "Two things", "Three things", "Four things", "Five things", "Six things"]

const greetingWord = () => {
  const h = new Date().getHours()
  return h < 12 ? "Good morning" : h < 17 ? "Good afternoon" : "Good evening"
}

const SCOPE_LINE: Record<PersonaKind, string> = {
  buyer: "Iris checked your shifts, hours and invoices.",
  supplier: "Iris checked your shifts, Pros and rate cards.",
  compass: "Iris checked spend, invoices and Pro safety across the program.",
}

const TASKS: Record<PersonaKind, { label: string; prompt: string; icon: LucideIcon }[]> = {
  buyer: [
    { label: "Create a shift", prompt: "Create a shift", icon: CalendarPlus },
    { label: "Upload shifts", prompt: "Upload shifts", icon: Upload },
    { label: "Approve hours", prompt: "Confirm hours", icon: CheckCheck },
  ],
  supplier: [
    { label: "Assign Pros", prompt: "Assign Pros", icon: UsersRound },
    { label: "Upload a rate card", prompt: "Upload rate card", icon: BadgeDollarSign },
    { label: "Submit hours", prompt: "Submit hours", icon: Clock },
  ],
  compass: [
    { label: "Review flagged invoices", prompt: "Review flagged invoices", icon: FileWarning },
    { label: "Show safety exceptions", prompt: "Show safety exceptions", icon: ShieldAlert },
    { label: "Download activity template", prompt: "Download activity template", icon: Download },
  ],
}

const examplesFor = (kind: PersonaKind) => {
  const soon = formatDay(addDaysISO(todayISO(), 9), "MMMM do")
  if (kind === "buyer") return [`Create 3 line cook shifts on ${soon} from 8am to 4pm`, "Upload next month’s shifts", "Confirm this week’s hours", "Download the shift template"]
  if (kind === "supplier") return ["Assign Pros to this weekend’s shifts", "Upload a new rate card", "Submit hours for last week", "Download the Pros template"]
  return ["Review flagged invoices", "Show safety exceptions", "Download the activity template"]
}

const PREDICTION_ICON: Record<Prediction["kind"], LucideIcon> = {
  recurring: CalendarSync,
  "fill-risk": UsersRound,
  expiring: ShieldAlert,
  spend: TrendingUp,
}

function useRotating(count: number) {
  const [index, setIndex] = useState(0)
  const reduce = useReducedMotion()
  useEffect(() => {
    if (reduce || count < 2) return
    const id = window.setInterval(() => setIndex((i) => (i + 1) % count), 3600)
    return () => window.clearInterval(id)
  }, [count, reduce])
  return index % Math.max(1, count)
}

function Placeholder({ examples }: { examples: string[] }) {
  const example = examples[useRotating(examples.length)]
  return (
    <>
      <span className="shrink-0">
        Tell Iris what to do<span className="hidden sm:inline">, like&nbsp;</span>
        <span className="sm:hidden">…</span>
      </span>
      <AnimatePresence mode="wait" initial={false}>
        <motion.span
          key={example}
          initial={{ opacity: 0, y: 6, filter: "blur(2px)" }}
          animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
          exit={{ opacity: 0, y: -6, filter: "blur(2px)" }}
          transition={{ duration: 0.28, ease: EASE }}
          className="hidden truncate text-muted-foreground/60 sm:block"
        >
          “{example}”
        </motion.span>
      </AnimatePresence>
    </>
  )
}

/** Past weeks in solid bars, the week Iris expects in hatched brand bars. */
function Pattern({ bars }: { bars: NonNullable<Prediction["bars"]> }) {
  const max = Math.max(1, ...bars.map((b) => b.value))
  const past = bars.filter((b) => !b.predicted).map((b) => b.value)
  const expected = bars.filter((b) => b.predicted).map((b) => b.value)
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <div tabIndex={0} aria-label="Pros per shift by week" className="flex h-9 shrink-0 items-end gap-[3px] rounded-md outline-none focus-visible:ring-2 focus-visible:ring-ring/50">
          {bars.map((b, i) => (
            <span
              key={i}
              style={{ height: `${Math.max(14, (b.value / max) * 100)}%` }}
              className={cn(
                "w-[7px] rounded-[2px]",
                b.predicted
                  ? "bg-[repeating-linear-gradient(135deg,color-mix(in_oklch,var(--brand-foreground)_70%,transparent)_0_1.5px,var(--brand)_1.5px_4px)] dark:bg-[repeating-linear-gradient(135deg,var(--brand)_0_2px,color-mix(in_oklch,var(--brand)_45%,transparent)_2px_4px)]"
                  : "bg-foreground/25 dark:bg-foreground/30",
              )}
            />
          ))}
        </div>
      </TooltipTrigger>
      <TooltipContent className="flex flex-col gap-0.5">
        <span className="font-medium">Pros per shift, by week</span>
        <span className="tabular opacity-80">
          Past: {past.join(", ")}. Expected: {expected.join(", ")}.
        </span>
      </TooltipContent>
    </Tooltip>
  )
}

function SectionLabel({ icon: Icon, children, aside }: { icon?: LucideIcon; children: React.ReactNode; aside?: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <h2 className="flex items-center gap-1.5 text-[11px] font-medium tracking-[0.06em] text-muted-foreground uppercase">
        {Icon && <Icon className="size-3 text-brand-foreground dark:text-brand" aria-hidden />}
        {children}
      </h2>
      {aside && <span className="hidden text-xs text-muted-foreground tabular sm:inline">{aside}</span>}
    </div>
  )
}

function PredictionRow({ prediction, onDraft }: { prediction: Prediction; onDraft: (p: Prediction) => void }) {
  const Icon = PREDICTION_ICON[prediction.kind]
  return (
    <li className="flex flex-col gap-3 px-4 py-3 transition-colors duration-100 hover:bg-hover sm:flex-row sm:items-center sm:gap-4">
      <div className="flex min-w-0 flex-1 items-center gap-3">
        <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-brand/30 text-brand-foreground ring-1 ring-brand-foreground/15 ring-inset dark:bg-brand/12 dark:text-brand dark:ring-brand/25">
          <Icon className="size-4" strokeWidth={1.9} aria-hidden />
        </span>
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="flex min-w-0 items-center gap-1.5">
            <span className="truncate text-sm font-medium">{prediction.title}</span>
            <InfoTip className="shrink-0">{prediction.evidence}</InfoTip>
          </span>
          <span className="truncate text-xs text-muted-foreground tabular">{prediction.detail}</span>
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-4 pl-11 sm:pl-0">
        {prediction.bars && (
          <span className="hidden md:block">
            <Pattern bars={prediction.bars} />
          </span>
        )}
        {prediction.draft ? (
          <Button size="sm" className="w-[9rem]" onClick={() => onDraft(prediction)}>
            <Sparkles data-icon="inline-start" />
            {prediction.cta}
          </Button>
        ) : (
          <Button asChild size="sm" variant="outline" className="w-[9rem] bg-background">
            <Link href={prediction.href ?? "/"}>
              {prediction.cta}
              <ArrowRight data-icon="inline-end" />
            </Link>
          </Button>
        )}
      </div>
    </li>
  )
}

function Briefing({ onDraft }: { onDraft: (p: Prediction) => void }) {
  const data = useData()
  const { ws } = useWorkspace()
  const reduce = useReducedMotion()
  const todos = useMemo(() => todosFor(data, ws), [data, ws])
  const predictions = useMemo(() => predictionsFor(data, ws), [data, ws])
  const rise = (delay: number) =>
    reduce ? {} : { initial: { opacity: 0, y: 10, filter: "blur(4px)" }, animate: { opacity: 1, y: 0, filter: "blur(0px)" }, transition: { duration: 0.45, ease: EASE, delay } }

  return (
    <div className="mx-auto flex w-full max-w-[1080px] flex-col gap-6 px-4 pt-8 pb-10 md:px-8 md:pt-12">
      <motion.header {...rise(0)} className="flex flex-col gap-3">
        <div className="flex flex-col gap-1">
          <span className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
            {formatDay(todayISO(), "EEEE, MMMM d")}
            <span className="inline-flex h-[18px] items-center gap-1 rounded-[5px] bg-brand px-1.5 text-caption-2 font-semibold text-brand-foreground">
              <span className="size-1.5 animate-pulse rounded-full bg-brand-foreground" />
              Live
            </span>
          </span>
          <h1 className="font-heading text-[30px] leading-tight font-semibold tracking-tight md:text-[34px]">
            {greetingWord()}, {ws.user.firstName}.
          </h1>
        </div>
        <p className="flex items-start gap-2.5 text-[15px] leading-relaxed text-muted-foreground">
          <LogoMark className="mt-0.5 size-5" />
          <span className="text-pretty">
            {SCOPE_LINE[ws.kind]}{" "}
            <span className="font-medium text-foreground">
              {NUMBER_WORDS[Math.min(todos.length, NUMBER_WORDS.length - 1)]} {todos.length === 1 ? "needs" : "need"} you.
            </span>
          </span>
        </p>
      </motion.header>

      <motion.section {...rise(0.08)} className="flex flex-col gap-2.5" aria-label="To-dos">
        <SectionLabel aside={todos.length ? `${todos.length} open` : undefined}>To-dos</SectionLabel>
        {todos.length ? (
          <ul className="stagger-in divide-y divide-border overflow-hidden rounded-2xl border border-border bg-card/80 backdrop-blur-sm">
            {todos.map((todo) => (
              <TodoRow key={todo.id} todo={todo} />
            ))}
          </ul>
        ) : (
          <div className="flex items-center gap-2.5 rounded-2xl border border-border bg-card px-4 py-3.5 text-sm text-muted-foreground">
            <CheckCircle2 className="size-4 text-positive" aria-hidden />
            You&apos;re all caught up. Iris brings you the next one as soon as it lands.
          </div>
        )}
      </motion.section>

      {predictions.length > 0 && (
        <motion.section {...rise(0.16)} className="flex flex-col gap-2.5 pt-2" aria-label="Iris predicts" data-tour="predictions">
          <SectionLabel icon={Sparkles} aside={ws.kind === "buyer" ? "From your last 6 weeks of shifts" : "Updated live"}>
            Iris predicts
          </SectionLabel>
          <ul className="stagger-in divide-y divide-border overflow-hidden rounded-2xl border border-border bg-card/80 backdrop-blur-sm">
            {predictions.map((prediction) => (
              <PredictionRow key={prediction.id} prediction={prediction} onDraft={onDraft} />
            ))}
          </ul>
        </motion.section>
      )}
    </div>
  )
}

/** Home is the agent: what needs you and what Iris expects next, with the ask bar docked below. A conversation takes over the same page. */
export function AgentHome() {
  const { ws } = useWorkspace()
  const agent = useAgent()
  const reduce = useReducedMotion()
  const scrollRef = useRef<HTMLDivElement>(null)
  const examples = useMemo(() => examplesFor(ws.kind), [ws.kind])
  const empty = agent.messages.length === 0

  useEffect(() => {
    const el = scrollRef.current
    if (el && !empty) el.scrollTo({ top: el.scrollHeight, behavior: reduce ? "auto" : "smooth" })
  }, [agent.messages.length, empty, reduce])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const commandJ = (e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "j"
      const slash = e.key === "/" && !e.metaKey && !e.ctrlKey && !e.altKey && !(e.target instanceof Element && e.target.closest("input, textarea, select, [contenteditable=true]"))
      if (!commandJ && !slash) return
      e.preventDefault()
      document.getElementById(COMPOSER_ID)?.focus()
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [])

  const draft = (p: Prediction) => p.draft && agent.draftShift(p.draft.ask, p.draft.request)

  const fade = reduce
    ? {}
    : { initial: { opacity: 0, y: 12, filter: "blur(4px)" }, animate: { opacity: 1, y: 0, filter: "blur(0px)" }, exit: { opacity: 0, y: -8, filter: "blur(4px)" }, transition: { duration: 0.3, ease: EASE } }

  return (
    <div className="relative flex min-h-0 flex-1 flex-col">
      <div ref={scrollRef} role="log" aria-label="Conversation with Iris" className="min-h-0 flex-1 overflow-y-auto overscroll-contain scrollbar-thin">
        <AnimatePresence mode="wait" initial={false}>
          {empty ? (
            <motion.div key="briefing" {...fade}>
              <Briefing onDraft={draft} />
            </motion.div>
          ) : (
            <motion.div key="thread" {...fade} className="px-4 pt-6 pb-10 md:px-8">
              <div className="mx-auto flex w-full max-w-3xl flex-col gap-6">
                <div className="-mb-2 flex">
                  <Button variant="ghost" size="sm" className="-ml-2.5 text-muted-foreground" onClick={agent.clear}>
                    <ArrowLeft data-icon="inline-start" />
                    Today
                  </Button>
                </div>
                <AgentMessages messages={agent.messages} onRun={agent.runAction} />
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      <div className="pointer-events-none relative shrink-0 px-4 pb-4 md:px-8 md:pb-6">
        <div aria-hidden className="absolute inset-x-0 -top-10 h-10 bg-gradient-to-t from-background to-transparent" />
        <div className="pointer-events-auto mx-auto flex max-w-3xl flex-col gap-2.5">
          <AnimatePresence initial={false}>
            {empty ? (
              <motion.div
                key="tasks"
                initial={reduce ? false : { opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: 6, transition: { duration: 0.15 } }}
                transition={{ duration: 0.3, ease: EASE, delay: 0.1 }}
                className="hidden flex-wrap justify-center gap-2 sm:flex"
              >
                {TASKS[ws.kind].map((task) => (
                  <button
                    key={task.label}
                    type="button"
                    onClick={() => agent.respond(task.prompt)}
                    className="inline-flex h-8 items-center gap-1.5 rounded-full border bg-card/90 px-3 text-[13px] text-foreground/80 shadow-[0_1px_2px_color-mix(in_oklch,var(--foreground)_5%,transparent)] backdrop-blur-sm transition-[color,border-color,transform] duration-200 outline-none hover:-translate-y-px hover:border-foreground/20 hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50 active:translate-y-0"
                  >
                    <task.icon className="size-3.5 text-muted-foreground" aria-hidden />
                    {task.label}
                  </button>
                ))}
              </motion.div>
            ) : null}
          </AnimatePresence>
          <AgentComposer id={COMPOSER_ID} size="lg" label="Tell Iris what to do" placeholder={<Placeholder examples={examples} />} onSubmit={agent.respond} onAttach={agent.attach}>
            <Kbd className="mr-1 hidden md:inline-flex">⌘J</Kbd>
          </AgentComposer>
        </div>
      </div>
    </div>
  )
}
